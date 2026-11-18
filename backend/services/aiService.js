const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const spellCheckService = require('./spellCheckService');
const garbageFilterService = require('./garbageFilterService');
const brandRulesService = require('./brandRulesService');
const textCorrectionService = require('./textCorrectionService');
const brandIdentityVerificationService = require('./brandIdentityVerificationService');
const googleVisionService = require('./googleVisionService');
const grammarService = require('./grammarService');
const fuzzball = require('fuzzball');

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

  // Fetch brand guidelines and client official identity (including GMB synced data)
  const [rows] = await pool.query(
    'SELECT whitelist_words, banned_words, mandatory_phrases FROM client_brand_guidelines WHERE client_id = ?',
    [clientId]
  );

  const [clientRows] = await pool.query(
    'SELECT name, primary_phone, alternate_phone, address, gmb_snapshot, gmb_auto_whitelist FROM clients WHERE id = ?',
    [clientId]
  );

  const clientInfo = clientRows.length > 0 ? clientRows[0] : null;

  let gmbSnapshot = null;
  if (clientInfo?.gmb_snapshot) {
    try {
      gmbSnapshot = typeof clientInfo.gmb_snapshot === 'string'
        ? JSON.parse(clientInfo.gmb_snapshot)
        : clientInfo.gmb_snapshot;
    } catch {
      gmbSnapshot = null;
    }
  }

  let gmbAutoWhitelist = [];
  if (clientInfo?.gmb_auto_whitelist) {
    try {
      gmbAutoWhitelist = typeof clientInfo.gmb_auto_whitelist === 'string'
        ? JSON.parse(clientInfo.gmb_auto_whitelist)
        : clientInfo.gmb_auto_whitelist;
    } catch {
      gmbAutoWhitelist = [];
    }
  }
  if (!Array.isArray(gmbAutoWhitelist)) gmbAutoWhitelist = [];

  const parseList = (val, splitTokens = false) => {
    let list = [];
    if (!val) list = [];
    else if (Array.isArray(val)) list = val;
    else if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) list = parsed;
        else list = val.split(',').map((s) => s.trim()).filter(Boolean);
      } catch {
        list = val.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }

    const set = new Set();
    for (const item of list) {
      if (!item || typeof item !== 'string') continue;
      const clean = item.trim();
      if (!clean) continue;
      set.add(clean);
      if (splitTokens && (clean.includes(' ') || clean.includes('-'))) {
        clean.split(/[\s\-]+/).forEach((t) => {
          if (t.length >= 2) set.add(t);
        });
      }
    }
    return Array.from(set);
  };

  const g = rows.length > 0 ? rows[0] : {};

  const whitelist = parseList(g.whitelist_words, true);
  if (clientInfo?.address) {
    clientInfo.address.split(/[\s,.-]+/).forEach((t) => {
      if (t.length >= 2 && !whitelist.includes(t)) whitelist.push(t);
    });
  }
  if (clientInfo?.name) {
    const fullOrg = clientInfo.name.trim();
    if (!whitelist.includes(fullOrg)) whitelist.push(fullOrg);
    clientInfo.name.split(/[\s,.-]+/).forEach((t) => {
      if (t.length >= 3 && !whitelist.includes(t)) whitelist.push(t);
    });
  }

  // Union with GMB Auto Whitelist tokens (Derived from GMB Place details)
  for (const token of gmbAutoWhitelist) {
    if (token && typeof token === 'string') {
      const cleanTok = token.trim();
      if (cleanTok && !whitelist.includes(cleanTok)) {
        whitelist.push(cleanTok);
      }
    }
  }

  // Also add GMB Official Name if present
  if (gmbSnapshot?.officialName) {
    const cleanGmbName = gmbSnapshot.officialName.trim();
    if (cleanGmbName && !whitelist.includes(cleanGmbName)) {
      whitelist.push(cleanGmbName);
    }
  }

  return {
    whitelist,
    banned: parseList(g.banned_words, false),
    mandatory: parseList(g.mandatory_phrases, false),
    organization_name: clientInfo?.name || '',
    primary_phone: clientInfo?.primary_phone || '',
    alternate_phone: clientInfo?.alternate_phone || '',
    address: clientInfo?.address || '',
    gmb_snapshot: gmbSnapshot,
    gmb_auto_whitelist: gmbAutoWhitelist,
    gmb_official_name: gmbSnapshot?.officialName || '',
    gmb_phone: gmbSnapshot?.nationalPhoneNumber || gmbSnapshot?.internationalPhoneNumber || '',
    gmb_address: gmbSnapshot?.formattedAddress || '',
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
    expected_phones: inputData.expected_phones || [],
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
 * Helper to identify if a word is an erroneous distortion of the client's official brand name.
 * Brand distortions are handled as Brand Identity Errors, not regular dictionary typos.
 */
const isBrandCandidateError = (word, orgName, gmbName = '') => {
  if (!word || (!orgName && !gmbName)) return false;
  const cleanW = String(word).trim().toLowerCase().replace(/[^\w\u0900-\u097f]/g, '');
  if (cleanW.length < 3) return false;

  const namesToCheck = [orgName, gmbName].filter(Boolean);
  for (const name of namesToCheck) {
    const orgWords = name.trim().toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
    for (const ow of orgWords) {
      const cleanOw = ow.replace(/[^\w\u0900-\u097f]/g, '');
      if (!cleanOw || cleanOw.length < 3) continue;
      const sim = fuzzball.ratio(cleanW, cleanOw);
      if (sim >= 50 && sim < 95) {
        return true;
      }
    }
  }
  return false;
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

  const isDevanagari = (text) => {
    if (!text || typeof text !== 'string') return false;
    const visible = text.replace(/\s+/g, '');
    if (!visible.length) return false;
    const devanagariCount = (text.match(/[\u0900-\u097f]/g) || []).length;
    return devanagariCount / visible.length > 0.10;
  };

  const isHindi = isDevanagari(combinedText);
  let spellingIssues = [];
  let grammarSuggestions = [];
  let keyError = null;

  const gmbData = {
    officialName: guidelines.gmb_official_name,
    autoWhitelist: guidelines.gmb_auto_whitelist,
  };

  if (isHindi) {
    // 1. PRIMARY: Gemini AI for Hindi Spelling + Grammar
    let geminiOut = [];
    if (combinedText.trim()) {
      geminiOut = await grammarService.checkGrammar(
        combinedText,
        'hi',
        guidelines.whitelist,
        guidelines.organization_name,
        gmbData
      );
    }

    const hasGeminiKeyError = geminiOut.some((i) => i.type === 'grammar_error' || i.key_error);

    if (hasGeminiKeyError) {
      // Gemini failed (401 / 403 / key expired / error) -> FALLBACK to Node Dictionary
      const errItem = geminiOut.find((i) => i.key_error);
      keyError = errItem?.key_error || {
        service: 'gemini',
        code: 'GEMINI_FALLBACK',
        user_message: 'AI se check nahi hua, Dictionary se check kiya gaya',
      };

      const rawSpelling = combinedText.trim()
        ? await spellCheckService.checkText(combinedText, guidelines.whitelist)
        : [];
      spellingIssues = rawSpelling.filter((issue) => {
        if (isBrandCandidateError(issue.word, guidelines.organization_name, guidelines.gmb_official_name)) return false;
        return !brandRulesService.fuzzyMatchWhitelist(issue.word, guidelines.whitelist, 80);
      });
    } else {
      // Gemini Succeeded -> AI is PRIMARY for both Spelling and Grammar (NO DICTIONARY)
      spellingIssues = geminiOut
        .filter((item) => item.type === 'spelling')
        .map((item) => ({
          word: item.original,
          script: 'hindi',
          suggestion: item.suggestion,
          suggestions: [item.suggestion],
          reason: item.reason,
          source: 'gemini_ai',
        }));
      grammarSuggestions = geminiOut.filter((item) => item.type === 'grammar');
    }

    // Node Whitelist Filter: If Gemini flagged any whitelist word, remove it!
    spellingIssues = spellingIssues.filter((issue) => {
      if (isBrandCandidateError(issue.word, guidelines.organization_name, guidelines.gmb_official_name)) return false;
      return !brandRulesService.fuzzyMatchWhitelist(issue.word, guidelines.whitelist, 80);
    });
    grammarSuggestions = grammarSuggestions.filter((item) => {
      return !brandRulesService.fuzzyMatchWhitelist(item.original, guidelines.whitelist, 80);
    });
  } else {
    // English System: Gemini AI PRIMARY for both Spelling & Grammar
    let geminiOut = [];
    if (combinedText.trim()) {
      geminiOut = await grammarService.checkGrammar(
        combinedText,
        'en',
        guidelines.whitelist,
        guidelines.organization_name,
        gmbData
      );
    }

    const hasGeminiKeyError = geminiOut.some((i) => i.type === 'grammar_error' || i.key_error);

    if (hasGeminiKeyError) {
      // Gemini failed (401 / 403 / key expired / error) -> FALLBACK to Node Dictionary (nspell)
      const errItem = geminiOut.find((i) => i.key_error);
      keyError = errItem?.key_error || {
        service: 'gemini',
        code: 'GEMINI_FALLBACK',
        user_message: 'AI se check nahi hua, Dictionary se check kiya gaya',
      };

      const rawSpellingIssues = combinedText.trim()
        ? await spellCheckService.checkText(combinedText, guidelines.whitelist)
        : [];

      spellingIssues = rawSpellingIssues.filter((issue) => {
        if (isBrandCandidateError(issue.word, guidelines.organization_name, guidelines.gmb_official_name)) return false;
        return !brandRulesService.fuzzyMatchWhitelist(issue.word, guidelines.whitelist, 80);
      });
    } else {
      // Gemini Succeeded -> AI is PRIMARY for both Spelling and Grammar (NO DICTIONARY)
      spellingIssues = geminiOut
        .filter((item) => item.type === 'spelling')
        .map((item) => ({
          word: item.original,
          script: 'english',
          suggestion: item.suggestion,
          suggestions: [item.suggestion],
          reason: item.reason,
          source: 'gemini_ai',
        }));
      grammarSuggestions = geminiOut.filter((item) => item.type === 'grammar');
    }

    // Node Whitelist Filter: If Gemini flagged any whitelist word, remove it!
    spellingIssues = spellingIssues.filter((issue) => {
      if (isBrandCandidateError(issue.word, guidelines.organization_name, guidelines.gmb_official_name)) return false;
      return !brandRulesService.fuzzyMatchWhitelist(issue.word, guidelines.whitelist, 80);
    });
    grammarSuggestions = grammarSuggestions.filter((item) => {
      return !brandRulesService.fuzzyMatchWhitelist(item.original, guidelines.whitelist, 80);
    });
  }

  // 3. Brand Compliance: Banned Words Check (against combinedText in Node)
  const bannedWordsFound = combinedText.trim()
    ? brandRulesService.findBannedWords(combinedText, guidelines.banned)
    : [];

  // 4. Brand Compliance: Missing Mandatory Phrases (against caption only in Node)
  const missingMandatoryPhrases = brandRulesService.findMissingMandatoryPhrases(
    caption || '',
    guidelines.mandatory
  );

  // 5. Phone Verification in Caption (Node)
  let phoneVerification = [];
  if (caption && (guidelines.primary_phone || guidelines.alternate_phone || guidelines.gmb_phone)) {
    phoneVerification = brandIdentityVerificationService.verifyPhoneNumbers(
      '',
      caption,
      guidelines.primary_phone,
      guidelines.alternate_phone,
      guidelines.gmb_phone
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
    grammar_suggestions: grammarSuggestions,
    key_error: keyError,
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
/**
 * Group raw PaddleOCR detected line-fragments into 6-10 logical spatial region boxes.
 * Merges vertically adjacent and horizontally aligned blocks (e.g. Header, Logo, Body, Footer).
 */
const groupOcrBoxes = (rawBoxes, maxTarget = 8) => {
  if (!Array.isArray(rawBoxes) || rawBoxes.length <= maxTarget) {
    return rawBoxes || [];
  }

  const valid = rawBoxes.filter((b) => (b.text || b.ocr_read || '').trim().length > 0);
  if (valid.length <= maxTarget) return valid;

  // Sort primarily by top, secondarily by left
  const sorted = [...valid].sort((a, b) => {
    const topA = a.rect ? a.rect.top : 0;
    const topB = b.rect ? b.rect.top : 0;
    if (Math.abs(topA - topB) > 4) return topA - topB;
    const leftA = a.rect ? a.rect.left : 0;
    const leftB = b.rect ? b.rect.left : 0;
    return leftA - leftB;
  });

  const groups = [];

  for (const box of sorted) {
    const text = (box.text || box.ocr_read || '').trim();
    const conf = Number(box.conf ?? box.confidence ?? 0.85);
    const rect = box.rect || { left: 0, top: 0, width: 100, height: 10 };

    let matchedGroup = null;

    for (const g of groups) {
      const gBottom = g.rect.top + g.rect.height;
      const gRight = g.rect.left + g.rect.width;

      const vDist = Math.max(0, rect.top - gBottom, g.rect.top - (rect.top + rect.height));
      const hDist = Math.max(0, rect.left - gRight, g.rect.left - (rect.left + rect.width));

      // Separate far left from far right in top header (Headline on left vs Logo on right)
      const isHeaderColumnSplit =
        rect.top < 25 && g.rect.top < 25 &&
        ((rect.left > 60 && g.rect.left < 50) || (rect.left < 50 && g.rect.left > 60));

      if (isHeaderColumnSplit) {
        continue;
      }

      if (vDist <= 6.5 && hDist <= 25.0) {
        matchedGroup = g;
        break;
      }
    }

    if (matchedGroup) {
      matchedGroup.texts.push(text);
      matchedGroup.confs.push(conf);
      const newLeft = Math.min(matchedGroup.rect.left, rect.left);
      const newTop = Math.min(matchedGroup.rect.top, rect.top);
      const newRight = Math.max(matchedGroup.rect.left + matchedGroup.rect.width, rect.left + rect.width);
      const newBottom = Math.max(matchedGroup.rect.top + matchedGroup.rect.height, rect.top + rect.height);

      matchedGroup.rect = {
        left: Math.round(newLeft * 100) / 100,
        top: Math.round(newTop * 100) / 100,
        width: Math.round((newRight - newLeft) * 100) / 100,
        height: Math.round((newBottom - newTop) * 100) / 100,
      };
    } else {
      groups.push({
        texts: [text],
        confs: [conf],
        rect: { ...rect },
      });
    }
  }

  return groups.map((g) => ({
    text: g.texts.join(' '),
    conf: g.confs.length
      ? Math.round((g.confs.reduce((a, b) => a + b, 0) / g.confs.length) * 100) / 100
      : 0.85,
    rect: g.rect,
  }));
};

/**
 * Build dynamic annotated poster boxes from real PaddleOCR detection boxes,
 * evaluating each against client guidelines (DB), OCR confidence, and caption.
 * Zero hardcoded Hindi words, brand names, phones, or addresses.
 * 
 * @param {Object} params
 * @param {string} params.rawOcrText
 * @param {Array<Object>} [params.ocrBoxes=[]]
 * @param {Object} [params.guidelines={}]
 * @param {string} [params.caption='']
 * @param {Array<Object>} [params.spellingIssues=[]]
 * @returns {Array<Object>}
 */
const buildAnnotatedPosterBoxes = ({
  rawOcrText = '',
  ocrBoxes = [],
  guidelines = {},
  caption = '',
  spellingIssues = [],
}) => {
  const normOcr = (rawOcrText || '').trim();
  const orgName = guidelines.organization_name || '';
  const gmbOfficialName = guidelines.gmb_official_name || '';
  const bannedList = Array.isArray(guidelines.banned) ? guidelines.banned : [];
  const whitelist = Array.isArray(guidelines.whitelist) ? guidelines.whitelist : [];
  const expectedPhones = [guidelines.primary_phone, guidelines.alternate_phone, guidelines.gmb_phone]
    .filter(Boolean)
    .map((p) => String(p).replace(/\D/g, ''));

  // Use real PaddleOCR boxes if available; group into 6-10 logical regions
  let sourceBoxes = [];
  if (Array.isArray(ocrBoxes) && ocrBoxes.length > 0) {
    sourceBoxes = groupOcrBoxes(ocrBoxes, 8);
  } else if (normOcr) {
    const lines = normOcr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const lineCount = Math.max(1, Math.min(lines.length, 8));
    const stepHeight = Math.min(18, Math.max(8, Math.floor(90 / lineCount)));
    sourceBoxes = lines.slice(0, 8).map((lineText, idx) => ({
      text: lineText,
      conf: 0.88,
      rect: {
        left: 2.0,
        top: Math.round((2.0 + idx * stepHeight) * 10) / 10,
        width: 96.0,
        height: Math.round((stepHeight - 1.5) * 10) / 10,
      },
    }));
  }

  if (sourceBoxes.length === 0) {
    return [];
  }

  // Caption lines / sentences for deriving poster_expected
  const captionSegments = (caption || '')
    .split(/[\n।!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);

  const annotated = [];

  sourceBoxes.forEach((item, index) => {
    const boxId = index + 1;
    const text = (item.text || '').trim();
    if (!text) return;

    const rawConf = Number(item.conf ?? item.confidence ?? 0.85);
    const confPercent = rawConf <= 1.0 ? Math.round(rawConf * 100) : Math.round(rawConf);
    const rect = item.rect || { left: 2.0, top: 2.0 + index * 12, width: 96.0, height: 10.0 };

    // 1. Check Banned Words from Client Guidelines using word boundaries
    const matchedBannedList = brandRulesService.findBannedWords(text, bannedList);
    const matchedBanned = matchedBannedList.length > 0 ? matchedBannedList[0] : null;

    // 2. Check Whitelist Fuzzy Match (>=80%)
    let isWhitelisted = false;
    if (whitelist.length > 0) {
      const tokens = text.split(/\s+/).filter(Boolean);
      for (const token of tokens) {
        if (brandRulesService.fuzzyMatchWhitelist(token, whitelist, 80)) {
          isWhitelisted = true;
          break;
        }
      }
    }

    // Check Organization / Brand Name match & Discrepancies (95%+ required)
    let isBrandExact = false;
    let hasBrandNameError = false;
    let brandErrorReason = null;

    if (orgName && text.length > 3) {
      const cleanOrg = orgName.trim();
      const orgWords = cleanOrg.split(/\s+/).filter((w) => w.length >= 3);
      const primaryWord = orgWords[0] || cleanOrg;
      const cleanPrimary = primaryWord.toLowerCase().replace(/[^\w\u0900-\u097f]/g, '');
      const cleanOrgFull = cleanOrg.toLowerCase().replace(/[^\w\s\u0900-\u097f]/g, '');

      // Check tokens and 2-word combinations in this box for brand word
      const boxTokens = text.split(/\s+/).map((t) => t.trim()).filter(Boolean);
      const candidates = [];
      for (let i = 0; i < boxTokens.length; i++) {
        candidates.push(boxTokens[i]);
        if (i < boxTokens.length - 1) {
          candidates.push(`${boxTokens[i]} ${boxTokens[i + 1]}`);
          candidates.push(`${boxTokens[i]}${boxTokens[i + 1]}`);
        }
      }

      let bestPrimarySim = 0;
      let bestPrimaryCandidate = '';

      for (const tok of candidates) {
        const unhyphen = tok.replace(/[-_.]/g, '');
        const tokensToCheck = unhyphen !== tok ? [tok, unhyphen] : [tok];
        for (const t of tokensToCheck) {
          const cleanT = t.toLowerCase().replace(/[^\w\u0900-\u097f]/g, '');
          if (!cleanT || cleanT.length < 3) continue;

          // Check whole token + sliding slices if OCR concatenated tokens into a single token
          const testStrings = [cleanT];
          if (!tok.includes(' ') && cleanPrimary.length >= 4 && cleanT.length > cleanPrimary.length) {
            for (let s = 0; s <= cleanT.length - cleanPrimary.length; s++) {
              testStrings.push(cleanT.slice(s, s + cleanPrimary.length));
              if (s + cleanPrimary.length + 1 <= cleanT.length) {
                testStrings.push(cleanT.slice(s, s + cleanPrimary.length + 1));
              }
            }
          }

          for (const sub of testStrings) {
            if (cleanPrimary.length >= 5 && Math.abs(sub.length - cleanPrimary.length) > 2) continue;
            const sim = fuzzball.ratio(sub, cleanPrimary);
            if (sim > bestPrimarySim) {
              bestPrimarySim = sim;
              bestPrimaryCandidate = tok;
            }
          }
        }
      }

      const cleanBoxText = text.toLowerCase().replace(/[^\w\s\u0900-\u097f]/g, '');
      const fullOrgSim = fuzzball.ratio(cleanBoxText, cleanOrgFull);

      if (cleanPrimary.length >= 3 && bestPrimarySim >= 55 && bestPrimarySim < 95) {
        hasBrandNameError = true;
        brandErrorReason = `Poster me hi brand name galat likha hai: "${bestPrimaryCandidate}" vs official "${primaryWord}" (${bestPrimarySim}% similarity < 95%). OCR ne sahi padha hai. Designer ko bolo: Poster me ${bestPrimaryCandidate} ki jagah ${primaryWord} likho.`;
      } else if (bestPrimarySim >= 95 || fullOrgSim >= 95) {
        isBrandExact = true;
      }
    }

    // Also verify against GMB official name if available
    if (gmbOfficialName && text.length > 3) {
      const cleanGmb = gmbOfficialName.trim();
      const cleanGmbFull = cleanGmb.toLowerCase().replace(/[^\w\s\u0900-\u097f]/g, '');
      const cleanBoxText = text.toLowerCase().replace(/[^\w\s\u0900-\u097f]/g, '');
      if (fuzzball.ratio(cleanBoxText, cleanGmbFull) >= 95) {
        isBrandExact = true;
        hasBrandNameError = false;
        brandErrorReason = null;
      }
    }

    if (hasBrandNameError) {
      isWhitelisted = false; // Brand name error MUST NEVER be excused by whitelist
    }

    // Check Phone Numbers in this box
    let matchedExpectedPhone = null;
    let hasPhoneMismatch = false;
    let phoneMismatchReason = null;
    const digitsInBox = text.replace(/\D/g, '');
    for (const ep of expectedPhones) {
      if (ep && (text.includes(ep) || (digitsInBox.length >= 10 && digitsInBox.includes(ep)))) {
        matchedExpectedPhone = ep;
        break;
      }
    }

    if (!matchedExpectedPhone && digitsInBox.length === 10) {
      const { distance } = require('fastest-levenshtein');
      for (const ep of expectedPhones) {
        if (ep) {
          const dist = distance(digitsInBox, ep);
          if (dist >= 1 && dist <= 2) {
            hasPhoneMismatch = true;
            phoneMismatchReason = `Phone mismatch: Poster me "${digitsInBox}" dikh raha hai, sahi registered number "${ep}" hai. Manual check karo.`;
            break;
          }
        }
      }
    }

    // Check Address numbers mismatch (e.g. 1053 vs 1063)
    let hasAddressMismatch = false;
    let addressMismatchReason = null;
    const { distance } = require('fastest-levenshtein');
    if (guidelines.address) {
      const addrNumbers = guidelines.address.match(/\b\d{3,5}\b/g) || [];
      const boxNumbers = text.match(/\b\d{3,5}\b/g) || [];
      for (const bn of boxNumbers) {
        for (const an of addrNumbers) {
          if (bn !== an && distance(bn, an) === 1) {
            hasAddressMismatch = true;
            addressMismatchReason = `OCR Doubt: Poster me "${bn}" padha gaya hai jabki registered address me "${an}" hai (1 digit farak). OCR font confusion ho sakta hai, poster par check karein.`;
            break;
          }
        }
        if (hasAddressMismatch) break;
      }
    }

    // Check if box text contains OCR noise / broken fragments (e.g. './६.', '!८', 'b?')
    let boxNoiseReason = null;
    const boxWordTokens = text.split(/\s+/).filter(Boolean);
    for (const tok of boxWordTokens) {
      const analysis = garbageFilterService.analyzeToken(tok, whitelist);
      if (analysis.isGarbage && !/^\d+$/.test(tok)) {
        boxNoiseReason = `OCR Noise detected in token '${tok}' (${analysis.reason})`;
        break;
      }
      if (/[./!?'#@%&*]{2,}/.test(tok) || /^[^\w\s\u0900-\u097f]+$/.test(tok)) {
        boxNoiseReason = `Unusual OCR symbol artifact '${tok}'`;
        break;
      }
    }

    // 3. Derive poster_expected dynamically from caption and brand rules
    let posterExpected = text;
    if ((isBrandExact || hasBrandNameError) && orgName) {
      posterExpected = `${orgName} (Official Brand)`;
    } else if (matchedExpectedPhone) {
      posterExpected = `Contact: ${matchedExpectedPhone}`;
    } else if (hasPhoneMismatch && expectedPhones.length > 0) {
      posterExpected = `Contact: ${expectedPhones[0]} (Registered)`;
    } else if ((hasAddressMismatch || (guidelines.address && text.length >= 10 && fuzzball.partial_ratio(text.toLowerCase(), guidelines.address.toLowerCase()) >= 70))) {
      posterExpected = guidelines.address;
    } else if (captionSegments.length > 0) {
      // Find closest segment in caption
      let bestCapScore = 0;
      let bestCapText = '';
      for (const seg of captionSegments) {
        const sim = fuzzball.ratio(text.toLowerCase(), seg.toLowerCase());
        if (sim > bestCapScore) {
          bestCapScore = sim;
          bestCapText = seg;
        }
      }
      if (bestCapScore >= 60 && bestCapText) {
        posterExpected = bestCapText;
      }
    }

    // 4. Status determination
    let status = 'green';
    let statusLabel = 'GREEN = OK';
    let reason = `Verified OK (Confidence ${confPercent}%).`;

    if (matchedBanned) {
      status = 'red';
      statusLabel = 'RED = Real Error';
      reason = `Banned word detected: "${matchedBanned}"`;
    } else if (hasBrandNameError && confPercent >= 80) {
      // High-confidence brand name mismatch is ALWAYS RED = Real Error
      status = 'red';
      statusLabel = 'RED = Real Error';
      reason = brandErrorReason;
    } else if (hasPhoneMismatch) {
      // Phone mismatch: YELLOW = Manual Check (do not quietly auto-correct)
      status = 'yellow';
      statusLabel = 'YELLOW = Manual Check';
      reason = phoneMismatchReason;
    } else if (hasAddressMismatch) {
      status = 'yellow';
      statusLabel = 'YELLOW = OCR Doubt';
      reason = addressMismatchReason;
    } else if (boxNoiseReason) {
      status = 'yellow';
      statusLabel = 'YELLOW = OCR Doubt';
      reason = `OCR Doubt: ${boxNoiseReason}. Unclear visual region on poster.`;
    } else if (confPercent < 80) {
      status = 'yellow';
      statusLabel = 'YELLOW = OCR Doubt';
      reason = `OCR Doubt: Low confidence (${confPercent}% < 80%). Font styling or complex character ligature.`;
    } else if (isWhitelisted || isBrandExact || matchedExpectedPhone) {
      status = 'green';
      statusLabel = 'GREEN = OK';
      reason = 'Verified OK against client whitelist/brand guidelines.';
    } else {
      // Check for confirmed spelling issue in this clear box
      const boxSpellError = (spellingIssues || []).find((issue) =>
        issue && issue.word && text.toLowerCase().includes(String(issue.word).toLowerCase())
      );
      if (boxSpellError && confPercent >= 80) {
        status = 'red';
        statusLabel = 'RED = Real Error';
        reason = `Spelling error detected: "${boxSpellError.word}"`;
      }
    }

    annotated.push({
      id: boxId,
      section: `${boxId}. Region: ${text.slice(0, 32)}${text.length > 32 ? '...' : ''}`,
      rect,
      poster_expected: posterExpected,
      ocr_read: text,
      status,
      status_label: statusLabel,
      confidence: confPercent,
      reason,
    });
  });

  return annotated;
};

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
  const expectedPhones = [guidelines.primary_phone, guidelines.alternate_phone].filter(Boolean);

  const isDevanagariCaption = (text) => {
    if (!text || typeof text !== 'string') return false;
    const visible = text.replace(/\s+/g, '');
    if (!visible.length) return false;
    const devanagariCount = (text.match(/[\u0900-\u097f]/g) || []).length;
    return (devanagariCount / visible.length) > 0.10;
  };

  const isHindiOrMix = isDevanagariCaption(caption);
  let remoteResult;
  let ocrEngineUsed = '';
  let keyError = null;
  let fallbackUsed = false;

  const tryA2PaddleOCR = async () => {
    return await runRemoteAICheck({
      image_path: resolvedImagePath,
      caption: caption || '',
      title: '',
      whitelist_words: guidelines.whitelist,
      banned_words: guidelines.banned,
      mandatory_phrases: guidelines.mandatory,
      expected_phones: expectedPhones,
    });
  };

  const tryGoogleVision = async () => {
    return await googleVisionService.runGoogleVisionOCR({
      imagePath: resolvedImagePath,
    });
  };

  try {
    // 1. PRIMARY (always first for BOTH Hindi & English): AI OCR (Google Vision / Gemini Multimodal)
    const aiResult = await tryGoogleVision();
    const extractedText = (aiResult?.ocr_text || aiResult?.text || '').trim();
    if (!extractedText) {
      throw new Error('AI returned empty text');
    }
    remoteResult = aiResult;
    ocrEngineUsed = 'gemini_ai';
    fallbackUsed = false;
  } catch (aiError) {
    // 2. FALLBACK (only if AI fails, errors, or returns empty text): A2 Remote PaddleOCR
    console.log('AI OCR failed, falling back to PaddleOCR:', aiError.message);
    fallbackUsed = true;
    ocrEngineUsed = 'a2_paddleocr';
    keyError = {
      service: 'google_vision',
      code: 'VISION_KEY_EXPIRED',
      user_message:
        'AI se check nahi hua, A2 se check kiya gaya (Warning: Hindi matra aur OCR text ki accuracy kam ho sakti hai, kripya poster manually verify karein).',
    };
    try {
      remoteResult = await tryA2PaddleOCR();
    } catch (a2Err) {
      console.error('[OCR Pipeline] Both AI OCR and A2 PaddleOCR failed:', a2Err.message);
      return {
        image_status: 'failed',
        image_error: `AI OCR failed (${aiError.message}) and A2 PaddleOCR fallback failed (${a2Err.message})`,
        passed: false,
        summary: `Image OCR failed: Both AI and A2 fallback unreachable`,
        ocr_extracted_text: '',
        ocr_confidence: 0,
        ocr_confidence_avg: 0,
        ocr_reliable: false,
        ocr_unreliable: true,
        spelling_issues: [],
        grammar_suggestions: [],
        noise_tokens: [],
        banned_words_found: [],
        brand_identity_check: null,
        ocr_engine: 'none',
        fallback_used: true,
        key_error: keyError,
      };
    }
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

  // Spell check and grammar on OCR text
  let spellingIssues = [];
  let imageGrammarSuggestions = [];
  let bannedWordsFound = [];
  let imageKeyError = keyError;

  const gmbData = {
    officialName: guidelines.gmb_official_name,
    autoWhitelist: guidelines.gmb_auto_whitelist,
  };

  if (isHindiOrMix) {
    // 1. PRIMARY: Gemini AI for Hindi Spelling + Grammar on OCR text
    let geminiOut = [];
    if (ocrReliable && (cleanedOcrText || rawOcrText).trim()) {
      geminiOut = await grammarService.checkGrammar(
        cleanedOcrText || rawOcrText,
        'hi',
        guidelines.whitelist,
        guidelines.organization_name,
        gmbData
      );
    }

    const hasGeminiKeyError = geminiOut.some((i) => i.type === 'grammar_error' || i.key_error);

    if (hasGeminiKeyError) {
      // Gemini failed -> FALLBACK to Node Dictionary
      const errItem = geminiOut.find((i) => i.key_error);
      imageKeyError = imageKeyError || errItem?.key_error || {
        service: 'gemini',
        code: 'GEMINI_FALLBACK',
        user_message: 'AI se check nahi hua, Dictionary se check kiya gaya',
      };

      if (ocrReliable && cleanedOcrText.trim()) {
        const rawSpelling = await spellCheckService.checkText(cleanedOcrText, guidelines.whitelist);
        spellingIssues = rawSpelling.filter((issue) => {
          if (isBrandCandidateError(issue.word, guidelines.organization_name, guidelines.gmb_official_name)) return false;
          return !brandRulesService.fuzzyMatchWhitelist(issue.word, guidelines.whitelist, 80);
        });
      }
    } else {
      // Gemini Succeeded -> AI is PRIMARY for both Spelling and Grammar (NO DICTIONARY)
      spellingIssues = geminiOut
        .filter((item) => item.type === 'spelling')
        .map((item) => ({
          word: item.original,
          script: 'hindi',
          suggestion: item.suggestion,
          suggestions: [item.suggestion],
          reason: item.reason,
          source: 'gemini_ai',
        }));
      imageGrammarSuggestions = geminiOut.filter((item) => item.type === 'grammar');
    }

    // Node Whitelist Filter: If Gemini flagged any whitelist word, remove it!
    spellingIssues = spellingIssues.filter((issue) => {
      if (isBrandCandidateError(issue.word, guidelines.organization_name, guidelines.gmb_official_name)) return false;
      return !brandRulesService.fuzzyMatchWhitelist(issue.word, guidelines.whitelist, 80);
    });
    imageGrammarSuggestions = imageGrammarSuggestions.filter((item) => {
      return !brandRulesService.fuzzyMatchWhitelist(item.original, guidelines.whitelist, 80);
    });

    if (ocrReliable && cleanedOcrText.trim()) {
      bannedWordsFound = brandRulesService.findBannedWords(cleanedOcrText, guidelines.banned);
    }
  } else {
    // English System: Gemini AI PRIMARY for both Spelling & Grammar on OCR text
    let geminiOut = [];
    if (ocrReliable && (cleanedOcrText || rawOcrText).trim()) {
      geminiOut = await grammarService.checkGrammar(
        cleanedOcrText || rawOcrText,
        'en',
        guidelines.whitelist,
        guidelines.organization_name,
        gmbData
      );
    }

    const hasGeminiKeyError = geminiOut.some((i) => i.type === 'grammar_error' || i.key_error);

    if (hasGeminiKeyError) {
      // Gemini failed -> FALLBACK to Node Dictionary (nspell)
      const errItem = geminiOut.find((i) => i.key_error);
      imageKeyError = imageKeyError || errItem?.key_error || {
        service: 'gemini',
        code: 'GEMINI_FALLBACK',
        user_message: 'AI se check nahi hua, Dictionary se check kiya gaya',
      };

      if (ocrReliable && cleanedOcrText.trim()) {
        const rawSpelling = await spellCheckService.checkText(cleanedOcrText, guidelines.whitelist);
        spellingIssues = rawSpelling.filter((issue) => {
          if (isBrandCandidateError(issue.word, guidelines.organization_name, guidelines.gmb_official_name)) return false;
          return !brandRulesService.fuzzyMatchWhitelist(issue.word, guidelines.whitelist, 80);
        });
      }
    } else {
      // Gemini Succeeded -> AI is PRIMARY for both Spelling and Grammar (NO DICTIONARY)
      spellingIssues = geminiOut
        .filter((item) => item.type === 'spelling')
        .map((item) => ({
          word: item.original,
          script: 'english',
          suggestion: item.suggestion,
          suggestions: [item.suggestion],
          reason: item.reason,
          source: 'gemini_ai',
        }));
      imageGrammarSuggestions = geminiOut.filter((item) => item.type === 'grammar');
    }

    // Node Whitelist Filter: If Gemini flagged any whitelist word, remove it!
    spellingIssues = spellingIssues.filter((issue) => {
      if (isBrandCandidateError(issue.word, guidelines.organization_name, guidelines.gmb_official_name)) return false;
      return !brandRulesService.fuzzyMatchWhitelist(issue.word, guidelines.whitelist, 80);
    });
    imageGrammarSuggestions = imageGrammarSuggestions.filter((item) => {
      return !brandRulesService.fuzzyMatchWhitelist(item.original, guidelines.whitelist, 80);
    });

    if (ocrReliable && cleanedOcrText.trim()) {
      bannedWordsFound = brandRulesService.findBannedWords(cleanedOcrText, guidelines.banned);
    }
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

  if ((guidelines.organization_name || guidelines.gmb_official_name) && ocrForIdentity) {
    const nameCheck = brandIdentityVerificationService.verifyBrandNamePresence(
      ocrForIdentity,
      guidelines.organization_name,
      guidelines.gmb_official_name
    );
    brandIdentityCheck.brand_name_correct = nameCheck.brand_name_correct;
    brandIdentityCheck.brand_name_match_score = nameCheck.score;
    brandIdentityCheck.matched_brand_text = nameCheck.matched_text;
    if (nameCheck.possible_brand_name_error) {
      brandIdentityCheck.possible_brand_name_error = nameCheck.message;
    }
  }

  if ((guidelines.primary_phone || guidelines.alternate_phone || guidelines.gmb_phone) && ocrForIdentity) {
    brandIdentityCheck.phone_verification = brandIdentityVerificationService.verifyPhoneNumbers(
      ocrForIdentity,
      caption || '',
      guidelines.primary_phone,
      guidelines.alternate_phone,
      guidelines.gmb_phone
    );
  }

  if ((guidelines.address || guidelines.gmb_address) && ocrForIdentity) {
    const addrCheck = brandIdentityVerificationService.verifyAddressMention(
      ocrForIdentity,
      guidelines.address,
      guidelines.gmb_address
    );
    brandIdentityCheck.address_match_percentage = addrCheck.match_percentage;
    brandIdentityCheck.address_warning = addrCheck.warning;
  }

  // Generate structured annotated poster zones matching visual OCR boxes
  const annotatedBoxes = buildAnnotatedPosterBoxes({
    rawOcrText,
    ocrBoxes: remoteResult.ocr_boxes || [],
    guidelines,
    caption,
    spellingIssues,
  });

  const ocrDoubts = annotatedBoxes.filter((b) => b.status === 'yellow');

  // OCR Doubt Words: If overall OCR confidence is low (< 80%), or word fuzzy matches whitelist/guidelines,
  // or word matches caption (>80% similarity indicating OCR ligature transcription artifact),
  // classify as OCR Doubt, NOT a confirmed poster spelling error
  const realSpellingIssues = spellingIssues.filter((issue) => {
    if (ocrConfidenceAverage < 0.80) return false;
    const isFuzzyWhitelisted = brandRulesService.fuzzyMatchWhitelist(
      issue.word,
      guidelines.whitelist,
      70
    );
    if (isFuzzyWhitelisted) return false;

    // Caption cross-verification: If caption contains the intended word (>=80% similarity),
    // it confirms OCR transcribed an imperfect ligature artifact (e.g. 'ाइए' vs 'आइए')
    if (caption) {
      const captionTokens = caption.split(/[\s,।!?:;()\n\r]+/).map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2);
      const cleanIssueWord = (issue.word || '').trim().toLowerCase();
      for (const ct of captionTokens) {
        if (fuzzball.ratio(cleanIssueWord, ct) >= 80) {
          return false;
        }
      }
    }

    return true;
  });

  // Filter phone warnings to only validate true 10-digit phone candidate strings
  const validPhoneWarnings = (brandIdentityCheck.phone_verification || []).filter(
    (p) =>
      (p.status === 'mismatch_warning' || p.status === 'unknown_phone') &&
      String(p.found_phone || '').replace(/\D/g, '').length === 10
  );

  const ocrUnreliable = !ocrReliable;
  const hasSpellingIssues = realSpellingIssues.length > 0;
  const hasBannedWords = bannedWordsFound.length > 0;
  const hasBrandNameError = Boolean(brandIdentityCheck.possible_brand_name_error);
  const hasPhoneIssues = validPhoneWarnings.length > 0;

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
    summary = `Phone Mismatch in Image: ${validPhoneWarnings[0].message}`;
  } else if (hasSpellingIssues) {
    summary = `Spelling: ${realSpellingIssues.length} real issue(s) detected in image text`;
  } else if (ocrDoubts.length > 0) {
    summary = `Image Verified: 0 Real Errors (${ocrDoubts.length} OCR Doubts to check manually on poster)`;
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
    spelling_issues: realSpellingIssues,
    grammar_suggestions: imageGrammarSuggestions,
    ocr_engine: ocrEngineUsed,
    key_error: imageKeyError,
    fallback_used: fallbackUsed,
    ocr_doubts: ocrDoubts,
    ocr_issues: annotatedBoxes,
    ocr_boxes: annotatedBoxes,
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

  // Merge Grammar Suggestions from Text (caption/title) and Image (OCR)
  const textGrammar = textResult?.grammar_suggestions || [];
  const imgGrammar = imageResult?.grammar_suggestions || [];
  const mergedGrammar = [...textGrammar];
  for (const ig of imgGrammar) {
    if (!mergedGrammar.some((tg) => tg.original === ig.original)) {
      mergedGrammar.push(ig);
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

  const activeKeyError = imageResult?.key_error || textResult?.key_error || null;
  const isFallbackUsed = Boolean(imageResult?.fallback_used);

  return {
    passed,
    summary,
    engine: `Hybrid Engine (${imageResult?.ocr_engine || 'auto'}) + Gemini Grammar Check`,
    ocr_engine: imageResult?.ocr_engine || 'auto',
    fallback_used: isFallbackUsed,
    key_error: activeKeyError,
    spelling_issues: mergedSpelling,
    grammar_suggestions: mergedGrammar,
    noise_tokens: imageResult?.noise_tokens || [],
    ocr_extracted_text: imageResult?.ocr_extracted_text || '',
    ocr_issues: imageResult?.ocr_issues || [],
    ocr_doubts: imageResult?.ocr_doubts || [],
    ocr_boxes: imageResult?.ocr_boxes || [],
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
  buildAnnotatedPosterBoxes,
  mergeAiCheckResults,
  runAiCheck,
};
