const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

// Ensure environment variables are loaded if invoked directly
const backendRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(backendRoot, '.env') });

const AI_CHECK_TIMEOUT_MS = 150_000;

/**
 * Fetch Brand Guidelines for a specific Client
 * @param {number} clientId
 * @returns {Promise<{whitelist: string[], banned: string[], mandatory: string[]}>}
 */
const getClientGuidelines = async (clientId) => {
  if (!clientId) {
    return { whitelist: [], banned: [], mandatory: [] };
  }

  const [rows] = await pool.query(
    'SELECT whitelist_words, banned_words, mandatory_phrases FROM client_brand_guidelines WHERE client_id = ?',
    [clientId]
  );

  if (rows.length === 0) {
    return { whitelist: [], banned: [], mandatory: [] };
  }

  const g = rows[0];
  const parseList = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        return val.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    return [];
  };

  return {
    whitelist: parseList(g.whitelist_words),
    banned: parseList(g.banned_words),
    mandatory: parseList(g.mandatory_phrases),
  };
};

/**
 * Run OCR and brand compliance check via Remote A2 Hosting Python API.
 * @param {Object} inputData
 * @param {string} [inputData.title]
 * @param {string} [inputData.caption]
 * @param {string} [inputData.image_path]
 * @param {string[]} [inputData.whitelist_words]
 * @param {string[]} [inputData.banned_words]
 * @param {string[]} [inputData.mandatory_phrases]
 * @returns {Promise<Object>}
 */
const runRemoteAICheck = async (inputData) => {
  const apiUrl = (process.env.A2_OCR_API_URL || 'https://siarasystems.com/ocr-test').replace(/\/+$/, '');
  const apiKey = (process.env.A2_OCR_API_KEY || '').trim();

  if (!apiKey) {
    throw new Error('Server configuration error: A2_OCR_API_KEY is not defined in environment.');
  }

  const endpoint = `${apiUrl}/check-post`;

  let imageBase64 = null;
  let imageFilename = null;

  if (inputData.image_path) {
    const resolvedPath = path.resolve(inputData.image_path);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Image file not found on disk at: ${resolvedPath}`);
    }
    const imageBuffer = fs.readFileSync(resolvedPath);
    imageBase64 = imageBuffer.toString('base64');
    imageFilename = path.basename(resolvedPath);
  }

  const payload = {
    title: inputData.title || '',
    caption: inputData.caption || '',
    image_base64: imageBase64,
    image_filename: imageFilename,
    whitelist_words: inputData.whitelist_words || [],
    banned_words: inputData.banned_words || [],
    mandatory_phrases: inputData.mandatory_phrases || [],
  };

  let response;
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(AI_CHECK_TIMEOUT_MS),
    });

    if (response.status === 503 && attempt < maxRetries) {
      await new Promise((res) => setTimeout(res, (attempt + 1) * 4000));
      continue;
    }
    break;
  }

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status} ${response.statusText}`;
    try {
      const errJson = await response.json();
      if (errJson && errJson.error) {
        errorDetail = errJson.error;
      }
    } catch (_) {}
    throw new Error(`Remote AI check failed: ${errorDetail}`);
  }

  const result = await response.json();

  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    typeof result.ocr_text !== 'string' ||
    typeof result.ocr_reliable !== 'boolean' ||
    !Number.isFinite(result.ocr_confidence_avg) ||
    !Array.isArray(result.spelling_issues) ||
    !Array.isArray(result.ocr_issues) ||
    !Array.isArray(result.banned_words_found) ||
    !Array.isArray(result.missing_mandatory_phrases)
  ) {
    throw new Error('Unexpected response shape from Remote AI check');
  }

  return result;
};

const resolveImagePath = (imagePath) => {
  if (!imagePath) return null;
  if (path.isAbsolute(imagePath)) return path.resolve(imagePath);
  if (fs.existsSync(path.resolve(imagePath))) return path.resolve(imagePath);
  return path.resolve(path.join(backendRoot, imagePath));
};

/**
 * Comprehensive AI Quality Check for a Post with Multi-Client Brand Guidelines
 * @param {Object} params
 * @param {number} [params.clientId]
 * @param {string} [params.title]
 * @param {string} [params.caption]
 * @param {string} [params.imagePath]
 */
const runAiCheck = async ({ clientId = null, title = '', caption = '', imagePath = null }) => {
  const guidelines = await getClientGuidelines(clientId);
  const resolvedImagePath = resolveImagePath(imagePath);
  const result = await runRemoteAICheck({
    image_path: resolvedImagePath,
    caption: caption || '',
    title: title || '',
    whitelist_words: guidelines.whitelist,
    banned_words: guidelines.banned,
    mandatory_phrases: guidelines.mandatory,
  });

  const ocrExtractedText = result.ocr_text;
  const ocrConfidenceAverage = result.ocr_confidence_avg;
  const ocrUnreliable = Boolean(resolvedImagePath && !result.ocr_reliable);
  const spellingIssues = result.spelling_issues;
  const ocrIssues = result.ocr_issues;
  const bannedWordsFound = result.banned_words_found;
  const missingMandatoryPhrases = result.missing_mandatory_phrases;

  const hasSpellingIssues = spellingIssues.length > 0;
  const hasBannedWords = bannedWordsFound.length > 0;
  const hasMissingMandatory = missingMandatoryPhrases.length > 0;
  const passed = !hasSpellingIssues && !hasBannedWords && !hasMissingMandatory && !ocrUnreliable;

  let summary = 'Verified Clean';
  if (ocrUnreliable) {
    summary = `Image text could not be read clearly (OCR confidence ${Math.round(
      ocrConfidenceAverage * 100
    )}%). Please verify it manually.`;
  } else if (hasBannedWords) {
    summary = `Flagged: Banned brand terms found (${bannedWordsFound.join(', ')})`;
  } else if (hasMissingMandatory) {
    summary = `Warning: Missing mandatory phrase (${missingMandatoryPhrases.join(', ')})`;
  } else if (hasSpellingIssues) {
    summary = `Spelling: ${spellingIssues.length} issue(s) detected`;
  }

  return {
    passed,
    summary,
    engine: 'PaddleOCR (English/Hindi) + Hunspell (spylls)',
    spelling_issues: spellingIssues,
    ocr_extracted_text: ocrExtractedText,
    ocr_issues: ocrIssues,
    ocr_confidence: Math.round(ocrConfidenceAverage * 10000) / 100,
    ocr_confidence_avg: ocrConfidenceAverage,
    ocr_reliable: Boolean(result.ocr_reliable),
    ocr_unreliable: ocrUnreliable,
    banned_words_found: bannedWordsFound,
    missing_mandatory_phrases: missingMandatoryPhrases,
    brand_rules_applied: {
      client_id: clientId,
      whitelist_count: guidelines.whitelist.length,
      banned_words_checked: guidelines.banned.length,
      mandatory_phrases_checked: guidelines.mandatory.length,
    },
  };
};

module.exports = {
  getClientGuidelines,
  runRemoteAICheck,
  runPythonAICheck: runRemoteAICheck,
  runAiCheck,
};
