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
 * Fast Native Node.js Text Quality & Brand Compliance Check (Title + Caption).
 * Runs synchronously in ~50-100ms.
 * 
 * @param {Object} params
 * @param {number} [params.clientId]
 * @param {string} [params.title]
 * @param {string} [params.caption]
 * @returns {Promise<Object>}
 */
const runTextCheck = async ({ clientId = null, title = '', caption = '' }) => {
  const guidelines = await getClientGuidelines(clientId);

  const textParts = [];
  if (title && title.trim()) textParts.push(title.trim());
  if (caption && caption.trim()) textParts.push(caption.trim());
  const combinedText = textParts.join('\n');

  // 1. Native Node.js Spellcheck (English via nspell + Hindi via hunspell-asm)
  const rawSpellingIssues = combinedText.trim()
    ? await spellCheckService.checkText(combinedText, guidelines.whitelist)
    : [];

  // 2. Fuzzy Whitelist Check: If word achieves >= 80% similarity with any whitelist entry, forgive it
  const spellingIssues = rawSpellingIssues.filter((issue) => {
    const isFuzzyWhitelisted = brandRulesService.fuzzyMatchWhitelist(
      issue.word,
      guidelines.whitelist,
      80
    );
    return !isFuzzyWhitelisted;
  });

  // 3. Brand Compliance: Banned Words Check (against combinedText)
  const bannedWordsFound = combinedText.trim()
    ? brandRulesService.findBannedWords(combinedText, guidelines.banned)
    : [];

  // 4. Brand Compliance: Missing Mandatory Phrases (against caption only)
  const missingMandatoryPhrases = brandRulesService.findMissingMandatoryPhrases(
    caption || '',
    guidelines.mandatory
  );

  // 5. Phone Verification in Caption
  let phoneVerification = [];
  if (caption && (guidelines.primary_phone || guidelines.alternate_phone)) {
    phoneVerification = brandIdentityVerificationService.verifyPhoneNumbers(
      '',
      caption,
      guidelines.primary_phone,
      guidelines.alternate_phone
    );
  }

  const phoneWarnings = phoneVerification.filter(
    (p) => p.status === 'mismatch_warning' || p.status === 'unknown_phone'
  );

  const hasSpellingIssues = spellingIssues.length > 0;
  const hasBannedWords = bannedWordsFound.length > 0;
  const hasMissingMandatory = missingMandatoryPhrases.length > 0;
  const hasPhoneIssues = phoneWarnings.length > 0;

  const passed = !hasSpellingIssues && !hasBannedWords && !hasMissingMandatory && !hasPhoneIssues;

  let summary = 'Text Check Clean';
  if (hasBannedWords) {
    summary = `Flagged: Banned brand terms found (${bannedWordsFound.join(', ')})`;
  } else if (hasPhoneIssues) {
    summary = `Phone Verification Alert: ${phoneWarnings[0].message}`;
  } else if (hasMissingMandatory) {
    summary = `Warning: Missing mandatory phrase (${missingMandatoryPhrases.join(', ')})`;
  } else if (hasSpellingIssues) {
    summary = `Spelling: ${spellingIssues.length} issue(s) detected in text`;
  }

  return {
    text_status: 'completed',
    passed,
    summary,
    spelling_issues: spellingIssues,
    banned_words_found: bannedWordsFound,
    missing_mandatory_phrases: missingMandatoryPhrases,
    brand_identity_check: {
      brand_name_correct: true,
      possible_brand_name_error: null,
      phone_verification: phoneVerification,
      address_match_percentage: 100,
      address_warning: null,
    },
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

/**
 * Image AI Quality Check: Remote PaddleOCR + OCR Cleaning + Image Brand Rules.
 * Runs in background (takes 15-20s).
 * 
 * @param {Object} params
 * @param {number} [params.clientId]
 * @param {string} [params.imagePath]
 * @param {string} [params.caption]
 * @returns {Promise<Object>}
 */
const runImageCheck = async ({ clientId = null, imagePath = null, caption = '' }) => {
  if (!imagePath) {
    return {
      image_status: 'not_applicable',
      passed: true,
      summary: 'No image attached',
      ocr_extracted_text: '',
      ocr_confidence: 0,
      ocr_confidence_avg: 0,
      ocr_reliable: true,
      ocr_unreliable: false,
      spelling_issues: [],
      noise_tokens: [],
      banned_words_found: [],
      brand_identity_check: null,
    };
  }

  const resolvedImagePath = resolveImagePath(imagePath);
  if (!resolvedImagePath || !fs.existsSync(resolvedImagePath)) {
    return {
      image_status: 'failed',
      image_error: `Image file not found on disk at: ${imagePath}`,
      passed: false,
      summary: 'Image file not found on disk',
      ocr_extracted_text: '',
      ocr_confidence: 0,
      ocr_confidence_avg: 0,
      ocr_reliable: false,
      ocr_unreliable: true,
      spelling_issues: [],
      noise_tokens: [],
      banned_words_found: [],
      brand_identity_check: null,
    };
  }

  const guidelines = await getClientGuidelines(clientId);

  let remoteResult;
  try {
    remoteResult = await runRemoteAICheck({
      image_path: resolvedImagePath,
      caption: caption || '',
      title: '',
      whitelist_words: guidelines.whitelist,
      banned_words: guidelines.banned,
      mandatory_phrases: guidelines.mandatory,
    });
  } catch (err) {
    console.error('Remote OCR API execution error:', err.message);
    return {
      image_status: 'failed',
      image_error: err.message || 'Remote OCR server request failed',
      passed: false,
      summary: `Image OCR failed: ${err.message || 'Remote server unreachable'}`,
      ocr_extracted_text: '',
      ocr_confidence: 0,
      ocr_confidence_avg: 0,
      ocr_reliable: false,
      ocr_unreliable: true,
      spelling_issues: [],
      noise_tokens: [],
      banned_words_found: [],
      brand_identity_check: null,
    };
  }

  const rawOcrText = remoteResult.ocr_text || '';
  const ocrConfidenceAverage = remoteResult.ocr_confidence_avg || 0.0;
  const ocrReliable = Boolean(remoteResult.ocr_reliable);

  // Clean and filter OCR text if reliable
  let cleanedOcrText = '';
  const noiseTokens = [];

  if (ocrReliable && rawOcrText.trim()) {
    const correctedText = textCorrectionService.fixCommonOcrErrors(rawOcrText);
    const rawLines = correctedText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const validLines = [];

    for (const line of rawLines) {
      const tokens = line.split(/\s+/).filter(Boolean);
      let lineHasGarbage = false;

      for (const token of tokens) {
        const analysis = garbageFilterService.analyzeToken(token, guidelines.whitelist);
        if (analysis.isGarbage) {
          noiseTokens.push({ token, reason: analysis.reason });
          lineHasGarbage = true;
        }
      }

      if (!lineHasGarbage) {
        validLines.push(line);
      }
    }

    cleanedOcrText = validLines.join('\n');
  } else if (!ocrReliable && rawOcrText.trim()) {
    cleanedOcrText = rawOcrText;
  }

  // Spell check and banned words on OCR text
  let spellingIssues = [];
  let bannedWordsFound = [];

  if (ocrReliable && cleanedOcrText.trim()) {
    const rawSpelling = await spellCheckService.checkText(cleanedOcrText, guidelines.whitelist);
    spellingIssues = rawSpelling.filter((issue) => {
      const isFuzzyWhitelisted = brandRulesService.fuzzyMatchWhitelist(
        issue.word,
        guidelines.whitelist,
        80
      );
      return !isFuzzyWhitelisted;
    });

    bannedWordsFound = brandRulesService.findBannedWords(cleanedOcrText, guidelines.banned);
  }

  // Official Brand Identity Verification against OCR
  const ocrForIdentity = (ocrReliable && cleanedOcrText.trim()) ? cleanedOcrText : (rawOcrText || '');
  let brandIdentityCheck = {
    brand_name_correct: true,
    possible_brand_name_error: null,
    phone_verification: [],
    address_match_percentage: 100,
    address_warning: null,
  };

  if (guidelines.organization_name && ocrForIdentity) {
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

  if ((guidelines.primary_phone || guidelines.alternate_phone) && ocrForIdentity) {
    brandIdentityCheck.phone_verification = brandIdentityVerificationService.verifyPhoneNumbers(
      ocrForIdentity,
      caption || '',
      guidelines.primary_phone,
      guidelines.alternate_phone
    );
  }

  if (guidelines.address && ocrForIdentity) {
    const addrCheck = brandIdentityVerificationService.verifyAddressMention(
      ocrForIdentity,
      guidelines.address
    );
    brandIdentityCheck.address_match_percentage = addrCheck.match_percentage;
    brandIdentityCheck.address_warning = addrCheck.warning;
  }

  const ocrUnreliable = !ocrReliable;
  const hasSpellingIssues = spellingIssues.length > 0;
  const hasBannedWords = bannedWordsFound.length > 0;
  const hasBrandNameError = Boolean(brandIdentityCheck.possible_brand_name_error);
  const phoneWarnings = brandIdentityCheck.phone_verification.filter(
    (p) => p.status === 'mismatch_warning' || p.status === 'unknown_phone'
  );
  const hasPhoneIssues = phoneWarnings.length > 0;

  const passed = !ocrUnreliable && !hasSpellingIssues && !hasBannedWords && !hasBrandNameError && !hasPhoneIssues;

  let summary = 'Image Check Clean';
  if (ocrUnreliable) {
    summary = `Image text could not be read clearly (OCR confidence ${Math.round(
      ocrConfidenceAverage * 100
    )}%). Manual verification recommended.`;
  } else if (hasBannedWords) {
    summary = `Image Flagged: Banned brand terms found (${bannedWordsFound.join(', ')})`;
  } else if (hasBrandNameError) {
    summary = `Brand Identity Error in Image: ${brandIdentityCheck.possible_brand_name_error}`;
  } else if (hasPhoneIssues) {
    summary = `Phone Mismatch in Image: ${phoneWarnings[0].message}`;
  } else if (hasSpellingIssues) {
    summary = `Spelling: ${spellingIssues.length} issue(s) detected in image text`;
  }

  return {
    image_status: 'completed',
    passed,
    summary,
    ocr_extracted_text: cleanedOcrText || rawOcrText,
    ocr_confidence: Math.round(ocrConfidenceAverage * 10000) / 100,
    ocr_confidence_avg: ocrConfidenceAverage,
    ocr_reliable: ocrReliable,
    ocr_unreliable: ocrUnreliable,
    spelling_issues: spellingIssues,
    noise_tokens: noiseTokens,
    banned_words_found: bannedWordsFound,
    brand_identity_check: brandIdentityCheck,
  };
};

/**
 * Merge Text and Image Quality Check Results into a Unified AI Quality Report.
 * 
 * @param {Object} textResult
 * @param {Object} imageResult
 * @returns {Object}
 */
const mergeAiCheckResults = (textResult, imageResult) => {
  const textSpelling = textResult?.spelling_issues || [];
  const imgSpelling = imageResult?.spelling_issues || [];

  // Deduplicate spelling issues by word (case-insensitive)
  const seenWords = new Set();
  const mergedSpelling = [];
  for (const item of textSpelling) {
    const key = (item.word || '').toLowerCase();
    if (!seenWords.has(key)) {
      seenWords.add(key);
      mergedSpelling.push({ ...item, source: 'text' });
    }
  }
  for (const item of imgSpelling) {
    const key = (item.word || '').toLowerCase();
    if (!seenWords.has(key)) {
      seenWords.add(key);
      mergedSpelling.push({ ...item, source: 'image' });
    }
  }

  // Combine banned words
  const bannedWordsFound = Array.from(
    new Set([...(textResult?.banned_words_found || []), ...(imageResult?.banned_words_found || [])])
  );

  // Missing mandatory phrases (from text check against caption)
  const missingMandatoryPhrases = textResult?.missing_mandatory_phrases || [];

  // Merge phone verification records
  const textPhones = textResult?.brand_identity_check?.phone_verification || [];
  const imgPhones = imageResult?.brand_identity_check?.phone_verification || [];
  const phoneMap = new Map();
  textPhones.forEach((p) => phoneMap.set(p.extracted || p.normalized, p));
  imgPhones.forEach((p) => {
    const key = p.extracted || p.normalized;
    if (!phoneMap.has(key)) {
      phoneMap.set(key, p);
    }
  });

  const mergedBrandIdentity = {
    brand_name_correct: imageResult?.brand_identity_check?.brand_name_correct !== false,
    brand_name_match_score: imageResult?.brand_identity_check?.brand_name_match_score || null,
    matched_brand_text: imageResult?.brand_identity_check?.matched_brand_text || null,
    possible_brand_name_error: imageResult?.brand_identity_check?.possible_brand_name_error || null,
    phone_verification: Array.from(phoneMap.values()),
    address_match_percentage: imageResult?.brand_identity_check?.address_match_percentage ?? 100,
    address_warning: imageResult?.brand_identity_check?.address_warning || null,
  };

  const imageStatus = imageResult?.image_status || 'not_applicable';
  const isImageCompleted = imageStatus === 'completed';
  const isImagePending = imageStatus === 'pending';
  const isImageFailed = imageStatus === 'failed';
  const isImageNA = imageStatus === 'not_applicable';

  const ocrUnreliable = Boolean(imageResult?.ocr_unreliable);
  const hasSpellingIssues = mergedSpelling.length > 0;
  const hasBannedWords = bannedWordsFound.length > 0;
  const hasMissingMandatory = missingMandatoryPhrases.length > 0;
  const hasBrandNameError = Boolean(mergedBrandIdentity.possible_brand_name_error);
  const phoneWarnings = mergedBrandIdentity.phone_verification.filter(
    (p) => p.status === 'mismatch_warning' || p.status === 'unknown_phone'
  );
  const hasPhoneIssues = phoneWarnings.length > 0;

  const passed =
    (textResult?.passed !== false) &&
    (isImageNA || (isImageCompleted && imageResult?.passed !== false && !ocrUnreliable)) &&
    !hasSpellingIssues &&
    !hasBannedWords &&
    !hasMissingMandatory &&
    !hasBrandNameError &&
    !hasPhoneIssues;

  let summary = 'Verified Clean';
  if (isImageFailed) {
    summary = `Image check failed: ${imageResult.image_error || 'Error processing image'}`;
  } else if (ocrUnreliable) {
    summary = `Image text could not be read clearly (OCR confidence ${Math.round(
      (imageResult?.ocr_confidence_avg || 0) * 100
    )}%). Please verify it manually.`;
  } else if (hasBannedWords) {
    summary = `Flagged: Banned brand terms found (${bannedWordsFound.join(', ')})`;
  } else if (hasBrandNameError) {
    summary = `Brand Identity Error: ${mergedBrandIdentity.possible_brand_name_error}`;
  } else if (hasPhoneIssues) {
    summary = `Phone Verification Alert: ${phoneWarnings[0].message}`;
  } else if (hasMissingMandatory) {
    summary = `Warning: Missing mandatory phrase (${missingMandatoryPhrases.join(', ')})`;
  } else if (hasSpellingIssues) {
    summary = `Spelling: ${mergedSpelling.length} issue(s) detected`;
  } else if (isImagePending) {
    summary = 'Text verified clean. Image check in progress...';
  }

  return {
    passed,
    summary,
    engine: 'Node.js (nspell + hunspell-asm + fuzzball) + Remote PaddleOCR',
    spelling_issues: mergedSpelling,
    noise_tokens: imageResult?.noise_tokens || [],
    ocr_extracted_text: imageResult?.ocr_extracted_text || '',
    ocr_issues: [],
    ocr_confidence: imageResult?.ocr_confidence || 0,
    ocr_confidence_avg: imageResult?.ocr_confidence_avg || 0,
    ocr_reliable: Boolean(imageResult?.ocr_reliable),
    ocr_unreliable: ocrUnreliable,
    image_status: imageStatus,
    text_status: textResult?.text_status || 'completed',
    image_error: imageResult?.image_error || null,
    banned_words_found: bannedWordsFound,
    missing_mandatory_phrases: missingMandatoryPhrases,
    brand_identity_check: mergedBrandIdentity,
    brand_rules_applied: textResult?.brand_rules_applied || {},
    text_result: textResult,
    image_result: imageResult,
  };
};

/**
 * Parallel execution wrapper maintaining 100% backward compatibility.
 */
const runAiCheck = async ({ clientId = null, title = '', caption = '', imagePath = null }) => {
  const textPromise = runTextCheck({ clientId, title, caption });
  const imagePromise = runImageCheck({ clientId, imagePath, caption });
  const [textResult, imageResult] = await Promise.all([textPromise, imagePromise]);
  return mergeAiCheckResults(textResult, imageResult);
};

module.exports = {
  getClientGuidelines,
  runRemoteAICheck,
  runPythonAICheck: runRemoteAICheck,
  runTextCheck,
  runImageCheck,
  mergeAiCheckResults,
  runAiCheck,
};
