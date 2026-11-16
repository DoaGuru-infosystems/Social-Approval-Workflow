const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const spellCheckService = require('./spellCheckService');
const garbageFilterService = require('./garbageFilterService');
const brandRulesService = require('./brandRulesService');
const textCorrectionService = require('./textCorrectionService');
const brandIdentityVerificationService = require('./brandIdentityVerificationService');

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
    return {
      whitelist: [],
      banned: [],
      mandatory: [],
      organization_name: '',
      primary_phone: '',
      alternate_phone: '',
      address: '',
    };
  }

  // Fetch brand guidelines and client official identity
  const [rows] = await pool.query(
    'SELECT whitelist_words, banned_words, mandatory_phrases FROM client_brand_guidelines WHERE client_id = ?',
    [clientId]
  );

  const [clientRows] = await pool.query(
    'SELECT name, primary_phone, alternate_phone, address FROM clients WHERE id = ?',
    [clientId]
  );

  const clientInfo = clientRows.length > 0 ? clientRows[0] : null;

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

  const g = rows.length > 0 ? rows[0] : {};

  return {
    whitelist: parseList(g.whitelist_words),
    banned: parseList(g.banned_words),
    mandatory: parseList(g.mandatory_phrases),
    organization_name: clientInfo?.name || '',
    primary_phone: clientInfo?.primary_phone || '',
    alternate_phone: clientInfo?.alternate_phone || '',
    address: clientInfo?.address || '',
  };
};

/**
 * Run OCR via Remote A2 Hosting Python API.
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
    !Number.isFinite(result.ocr_confidence_avg)
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
 * Comprehensive AI Quality Check for a Post with Multi-Client Brand Guidelines.
 * OCR extraction is fetched from Remote Python PaddleOCR, while all text analysis,
 * spelling verification, garbage token filtering, fuzzy whitelist matching, and
 * brand compliance checks are executed natively in Node.js.
 * 
 * @param {Object} params
 * @param {number} [params.clientId]
 * @param {string} [params.title]
 * @param {string} [params.caption]
 * @param {string} [params.imagePath]
 */
const runAiCheck = async ({ clientId = null, title = '', caption = '', imagePath = null }) => {
  // 1. Fetch Client Brand Guidelines from MySQL
  const guidelines = await getClientGuidelines(clientId);
  const resolvedImagePath = resolveImagePath(imagePath);

  // 2. Fetch OCR text from Remote Python API if an image is provided
  let rawOcrText = '';
  let ocrConfidenceAverage = 0.0;
  let ocrReliable = false;

  if (resolvedImagePath) {
    const remoteResult = await runRemoteAICheck({
      image_path: resolvedImagePath,
      caption: caption || '',
      title: title || '',
      whitelist_words: guidelines.whitelist,
      banned_words: guidelines.banned,
      mandatory_phrases: guidelines.mandatory,
    });

    rawOcrText = remoteResult.ocr_text || '';
    ocrConfidenceAverage = remoteResult.ocr_confidence_avg || 0.0;
    ocrReliable = Boolean(remoteResult.ocr_reliable);
  }

  // 3. Clean and filter OCR text if reliable
  let cleanedOcrText = '';
  const noiseTokens = [];

  if (ocrReliable && rawOcrText.trim()) {
    // a. Fix common OCR character confusion errors (phone numbers, etc.)
    const correctedText = textCorrectionService.fixCommonOcrErrors(rawOcrText);

    // b. Filter out visual garbage / noise tokens
    const rawLines = correctedText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const validLines = [];

    for (const line of rawLines) {
      // Split line into words/tokens to check for garbage
      const tokens = line.split(/\s+/).filter(Boolean);
      let lineHasGarbage = false;

      for (const token of tokens) {
        const analysis = garbageFilterService.analyzeToken(token, guidelines.whitelist);
        if (analysis.isGarbage) {
          noiseTokens.push({ token, reason: analysis.reason });
          lineHasGarbage = true;
        }
      }

      // If the line is not purely noise, retain it
      if (!lineHasGarbage) {
        validLines.push(line);
      }
    }

    cleanedOcrText = validLines.join('\n');
  } else if (!ocrReliable && rawOcrText.trim()) {
    // If OCR is unreliable, retain raw text for reference without running compliance checks against it
    cleanedOcrText = rawOcrText;
  }

  // 4. Combine text for linguistic and compliance checks (title + caption + reliable OCR text)
  const textParts = [];
  if (title && title.trim()) textParts.push(title.trim());
  if (caption && caption.trim()) textParts.push(caption.trim());
  if (ocrReliable && cleanedOcrText.trim()) textParts.push(cleanedOcrText.trim());
  const combinedText = textParts.join('\n');

  // 5. Native Node.js Spellcheck (English via nspell + Hindi via hunspell-asm)
  const rawSpellingIssues = await spellCheckService.checkText(combinedText, guidelines.whitelist);

  // 6. Fuzzy Whitelist Check: If word achieves >= 80% similarity with any whitelist entry, forgive it
  const spellingIssues = rawSpellingIssues.filter((issue) => {
    const isFuzzyWhitelisted = brandRulesService.fuzzyMatchWhitelist(
      issue.word,
      guidelines.whitelist,
      80
    );
    return !isFuzzyWhitelisted;
  });

  // 7. Brand Compliance: Banned Words Check (against combinedText)
  const bannedWordsFound = brandRulesService.findBannedWords(combinedText, guidelines.banned);

  // 8. Brand Compliance: Missing Mandatory Phrases (against caption only)
  const missingMandatoryPhrases = brandRulesService.findMissingMandatoryPhrases(
    caption,
    guidelines.mandatory
  );

  // 9. Official Brand Identity Verification (Brand Name, Phone Numbers, Address)
  const ocrForIdentity = (ocrReliable && cleanedOcrText.trim()) ? cleanedOcrText : (rawOcrText || '');
  let brandIdentityCheck = {
    brand_name_correct: true,
    possible_brand_name_error: null,
    phone_verification: [],
    address_match_percentage: 100,
    address_warning: null,
  };

  if (guidelines.organization_name) {
    if (ocrForIdentity) {
      const nameCheck = brandIdentityVerificationService.verifyBrandNamePresence(
        ocrForIdentity,
        guidelines.organization_name
      );
      brandIdentityCheck.brand_name_correct = nameCheck.brand_name_correct;
      brandIdentityCheck.brand_name_match_score = nameCheck.score;
      brandIdentityCheck.matched_brand_text = nameCheck.matched_text;
      if (nameCheck.possible_brand_name_error) {
        brandIdentityCheck.possible_brand_name_error = nameCheck.message;
      }
    }

    // Phone verification against OCR and caption
    if (guidelines.primary_phone || guidelines.alternate_phone) {
      brandIdentityCheck.phone_verification = brandIdentityVerificationService.verifyPhoneNumbers(
        ocrForIdentity,
        caption,
        guidelines.primary_phone,
        guidelines.alternate_phone
      );
    }

    // Soft Address verification against OCR
    if (guidelines.address && ocrForIdentity) {
      const addrCheck = brandIdentityVerificationService.verifyAddressMention(
        ocrForIdentity,
        guidelines.address
      );
      brandIdentityCheck.address_match_percentage = addrCheck.match_percentage;
      brandIdentityCheck.address_warning = addrCheck.warning;
    }
  }

  // 10. Overall Compliance Evaluation
  const ocrUnreliable = Boolean(resolvedImagePath && !ocrReliable);
  const hasSpellingIssues = spellingIssues.length > 0;
  const hasBannedWords = bannedWordsFound.length > 0;
  const hasMissingMandatory = missingMandatoryPhrases.length > 0;
  const hasBrandNameError = Boolean(brandIdentityCheck.possible_brand_name_error);
  const phoneWarnings = brandIdentityCheck.phone_verification.filter(
    (p) => p.status === 'mismatch_warning' || p.status === 'unknown_phone'
  );
  const hasPhoneIssues = phoneWarnings.length > 0;

  const passed =
    !hasSpellingIssues &&
    !hasBannedWords &&
    !hasMissingMandatory &&
    !ocrUnreliable &&
    !hasBrandNameError &&
    !hasPhoneIssues;

  let summary = 'Verified Clean';
  if (ocrUnreliable) {
    summary = `Image text could not be read clearly (OCR confidence ${Math.round(
      ocrConfidenceAverage * 100
    )}%). Please verify it manually.`;
  } else if (hasBannedWords) {
    summary = `Flagged: Banned brand terms found (${bannedWordsFound.join(', ')})`;
  } else if (hasBrandNameError) {
    summary = `Brand Identity Error: ${brandIdentityCheck.possible_brand_name_error}`;
  } else if (hasPhoneIssues) {
    summary = `Phone Verification Alert: ${phoneWarnings[0].message}`;
  } else if (hasMissingMandatory) {
    summary = `Warning: Missing mandatory phrase (${missingMandatoryPhrases.join(', ')})`;
  } else if (hasSpellingIssues) {
    summary = `Spelling: ${spellingIssues.length} issue(s) detected`;
  }

  return {
    passed,
    summary,
    engine: 'Node.js (nspell + hunspell-asm + fuzzball) + Remote PaddleOCR',
    spelling_issues: spellingIssues,
    noise_tokens: noiseTokens,
    ocr_extracted_text: cleanedOcrText || rawOcrText,
    ocr_issues: [], // Node pipeline performs unified check across title + caption + OCR
    ocr_confidence: Math.round(ocrConfidenceAverage * 10000) / 100,
    ocr_confidence_avg: ocrConfidenceAverage,
    ocr_reliable: ocrReliable,
    ocr_unreliable: ocrUnreliable,
    banned_words_found: bannedWordsFound,
    missing_mandatory_phrases: missingMandatoryPhrases,
    brand_identity_check: brandIdentityCheck,
    brand_rules_applied: {
      client_id: clientId,
      organization_name: guidelines.organization_name,
      whitelist_count: guidelines.whitelist.length,
      banned_words_checked: guidelines.banned.length,
      mandatory_phrases_checked: guidelines.mandatory.length,
      primary_phone_configured: Boolean(guidelines.primary_phone),
      address_configured: Boolean(guidelines.address),
    },
  };
};

module.exports = {
  getClientGuidelines,
  runRemoteAICheck,
  runPythonAICheck: runRemoteAICheck,
  runAiCheck,
};
