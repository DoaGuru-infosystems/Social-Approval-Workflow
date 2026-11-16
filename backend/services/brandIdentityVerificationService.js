const fuzz = require('fuzzball');

/**
 * Calculate Levenshtein edit distance between two strings of identical or near-identical length.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
const getEditDistance = (a, b) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
};

/**
 * 1. FUZZY PHRASE MATCHING (Brand Name Presence & Integrity)
 * Extracts sliding windows of 2 to 5 consecutive words from OCR text and compares
 * them against the official organization name using fuzzball.ratio().
 * 
 * Classification:
 *  a) score >= 90: brand_name_correct: true
 *  b) score 55-89: possible_brand_name_error: true
 *  c) score < 55:  brand_name_not_found: true
 * 
 * @param {string} ocrText
 * @param {string} officialName
 * @returns {Object}
 */
const verifyBrandNamePresence = (ocrText, officialName) => {
  if (!officialName || !officialName.trim()) {
    return {
      verified: false,
      reason: 'No official organization name registered',
    };
  }

  const cleanOfficial = officialName.trim();
  const normalizedOfficial = cleanOfficial.toLowerCase().replace(/[^\w\s\u0900-\u097f]/g, '');

  if (!ocrText || !ocrText.trim()) {
    return {
      verified: false,
      brand_name_correct: false,
      brand_name_not_found: true,
      possible_brand_name_error: false,
      score: 0,
      matched_text: '',
      message: 'Brand name not found in image (OCR text is empty).',
    };
  }

  // Tokenize OCR text into words/tokens
  const rawTokens = ocrText
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (rawTokens.length === 0) {
    return {
      verified: false,
      brand_name_correct: false,
      brand_name_not_found: true,
      possible_brand_name_error: false,
      score: 0,
      matched_text: '',
      message: 'Brand name not found in image.',
    };
  }

  // Extract core brand name (e.g. without trailing legal or business suffixes)
  const coreBrandName = cleanOfficial
    .replace(/\s+(pvt\s+ltd|ltd|llc|inc|corp|co|organization|services|enterprises)\b/gi, '')
    .trim();

  let bestMatch = {
    windowStr: '',
    score: 0,
    size: 0,
    isCoreMatch: false,
  };

  let bestCoreMatch = {
    windowStr: '',
    score: 0,
    size: 0,
  };

  // Sliding windows of size 2 to 5 consecutive tokens
  for (let size = 2; size <= Math.min(5, rawTokens.length); size++) {
    for (let i = 0; i <= rawTokens.length - size; i++) {
      const windowTokens = rawTokens.slice(i, i + size);
      const windowStr = windowTokens.join(' ');
      const normalizedWindow = windowStr.toLowerCase().replace(/[^\w\s\u0900-\u097f]/g, '');

      // Compare against full official name
      const fullScore = fuzz.ratio(normalizedWindow, normalizedOfficial);

      // Also compare against core brand name if official name is a multi-word compound
      const coreScore = coreBrandName && coreBrandName !== cleanOfficial
        ? fuzz.ratio(normalizedWindow, coreBrandName.toLowerCase().replace(/[^\w\s\u0900-\u097f]/g, ''))
        : 0;

      if (coreScore > bestCoreMatch.score) {
        bestCoreMatch = { windowStr, score: coreScore, size };
      }

      if (fullScore > bestMatch.score) {
        bestMatch = { windowStr, score: fullScore, size };
      }
    }
  }

  // Check primary key brand word (e.g. first distinctive word of organization_name)
  const orgWords = cleanOfficial.split(/\s+/).filter((w) => w.length >= 3);
  const primaryWord = orgWords[0] || cleanOfficial;
  const cleanPrimary = primaryWord.toLowerCase().replace(/[^\w\u0900-\u097f]/g, '');

  let bestPrimarySim = 0;
  let bestPrimaryCandidate = '';
  for (const tok of rawTokens) {
    const unhyphen = tok.replace(/[-_]/g, '');
    const tokensToCheck = unhyphen !== tok ? [tok, unhyphen] : [tok];
    for (const t of tokensToCheck) {
      const cleanT = t.toLowerCase().replace(/[^\w\u0900-\u097f]/g, '');
      if (!cleanT || cleanT.length < 2) continue;
      const sim = fuzz.ratio(cleanT, cleanPrimary);
      if (sim > bestPrimarySim) {
        bestPrimarySim = sim;
        bestPrimaryCandidate = tok;
      }
    }
  }

  // If primary brand word is present but has an error (similarity 55-94%):
  if (cleanPrimary.length >= 3 && bestPrimarySim >= 55 && bestPrimarySim < 95) {
    const errorMsg = `Poster me brand name galat likha hai: '${bestPrimaryCandidate}' vs official '${primaryWord}' (${bestPrimarySim}% similarity < 95%). OCR ne sahi padha hai. Designer ko bolo: Poster me ${bestPrimaryCandidate} ki jagah '${primaryWord}' likho.`;
    return {
      verified: true,
      brand_name_correct: false,
      possible_brand_name_error: errorMsg,
      brand_name_not_found: false,
      score: bestPrimarySim,
      matched_text: bestPrimaryCandidate,
      official_name: cleanOfficial,
      message: errorMsg,
    };
  }

  // Classification: Brand Name requires >= 95% similarity
  const isExactMatch = bestMatch.windowStr && normalizedOfficial &&
    (bestMatch.windowStr.toLowerCase().replace(/[^\w\s\u0900-\u097f]/g, '') === normalizedOfficial);

  if (isExactMatch || bestMatch.score >= 95) {
    return {
      verified: true,
      brand_name_correct: true,
      possible_brand_name_error: false,
      brand_name_not_found: false,
      score: bestMatch.score,
      matched_text: bestMatch.windowStr,
      official_name: cleanOfficial,
      message: `Official brand name matched successfully (${bestMatch.score}% similarity).`,
    };
  }

  // If there's an error or discrepancy in the brand name (score in 55-94% range):
  const reportedMatch = (bestCoreMatch.score >= 55 && bestCoreMatch.score < 95)
    ? bestCoreMatch
    : bestMatch;

  const effectiveScore = reportedMatch.score;
  const effectiveText = reportedMatch.windowStr;

  if (effectiveScore >= 55) {
    const errorMsg = `Poster me brand name galat likha hai: '${effectiveText}' vs official '${cleanOfficial}' (${effectiveScore}% similarity < 95%). OCR ne sahi padha hai. Designer se theek karwao.`;
    return {
      verified: true,
      brand_name_correct: false,
      possible_brand_name_error: errorMsg,
      brand_name_not_found: false,
      score: effectiveScore,
      matched_text: effectiveText,
      official_name: cleanOfficial,
      message: errorMsg,
    };
  } else {
    return {
      verified: true,
      brand_name_correct: false,
      possible_brand_name_error: false,
      brand_name_not_found: true,
      score: effectiveScore,
      matched_text: effectiveText || '',
      official_name: cleanOfficial,
      message: `Brand name not found in image (best candidate similarity: ${effectiveScore}%).`,
    };
  }
};

/**
 * Normalize phone string into 10-digit number.
 * Removes non-digits and leading +91 or 0 if present.
 * @param {string} phone
 * @returns {string}
 */
const normalizePhone = (phone) => {
  if (!phone || typeof phone !== 'string') return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits;
};

/**
 * 2. PHONE NUMBER VERIFICATION
 * Scans OCR text and caption for 10-digit numbers and compares each digit-by-digit
 * against primaryPhone and alternatePhone.
 * 
 * @param {string} ocrText
 * @param {string} caption
 * @param {string} primaryPhone
 * @param {string} [alternatePhone]
 * @returns {Array<Object>}
 */
const verifyPhoneNumbers = (ocrText = '', caption = '', primaryPhone = '', alternatePhone = '') => {
  const normPrimary = normalizePhone(primaryPhone);
  const normAlternate = normalizePhone(alternatePhone);
  const registeredNumbers = [];
  if (normPrimary) registeredNumbers.push({ type: 'primary', number: normPrimary, raw: primaryPhone });
  if (normAlternate) registeredNumbers.push({ type: 'alternate', number: normAlternate, raw: alternatePhone });

  if (registeredNumbers.length === 0) {
    return [];
  }

  // Regex to extract 10-digit phone patterns (with optional spaces/dashes, e.g. "987-654-3210", "9876543210")
  // Allows optional country code prefix (+91 or 0)
  const phonePattern = /(?:\+?91[\s-]?)?(?:0[\s-]?)?[6-9]\d{2}[\s-]?\d{3}[\s-]?\d{4}|\b[6-9]\d{9}\b/g;

  const foundPhoneEntries = [];
  const seenNumbers = new Set();

  const scanSource = (text, source) => {
    if (!text || typeof text !== 'string') return;
    const matches = text.match(phonePattern) || [];
    for (const match of matches) {
      const normalized = normalizePhone(match);
      if (normalized.length === 10 && !seenNumbers.has(normalized)) {
        seenNumbers.add(normalized);
        foundPhoneEntries.push({ raw: match, normalized, source });
      }
    }
  };

  scanSource(ocrText, 'OCR');
  scanSource(caption, 'caption');

  const verificationResults = [];

  for (const entry of foundPhoneEntries) {
    let bestDist = Infinity;
    let closestReg = null;

    for (const reg of registeredNumbers) {
      const dist = getEditDistance(entry.normalized, reg.number);
      if (dist < bestDist) {
        bestDist = dist;
        closestReg = reg;
      }
    }

    if (bestDist === 0) {
      // Exact match
      verificationResults.push({
        found_phone: entry.raw,
        normalized_phone: entry.normalized,
        source: entry.source,
        matched_type: closestReg.type,
        matched_phone: closestReg.number,
        status: 'clean',
        message: `Phone number matches registered ${closestReg.type} number (${closestReg.number}).`,
      });
    } else if (bestDist >= 1 && bestDist <= 2) {
      // 1-2 digits difference -> FLAG as Manual Check
      const warningMsg = `Poster me '${entry.raw}' dikh raha hai, sahi registered number '${closestReg.number}' hai. Manual check karo.`;
      verificationResults.push({
        found_phone: entry.raw,
        normalized_phone: entry.normalized,
        source: entry.source,
        matched_type: closestReg.type,
        matched_phone: closestReg.number,
        edit_distance: bestDist,
        status: 'mismatch_warning',
        message: warningMsg,
      });
    } else {
      // Unknown number
      const unknownMsg = `Unknown phone number mila jo registered numbers se match nahi karta: '${entry.raw}' (${entry.source})`;
      verificationResults.push({
        found_phone: entry.raw,
        normalized_phone: entry.normalized,
        source: entry.source,
        edit_distance: bestDist,
        status: 'unknown_phone',
        message: unknownMsg,
      });
    }
  }

  return verificationResults;
};

/**
 * 3. ADDRESS VERIFICATION (Soft / Informational Check)
 * Deconstructs registered address into keywords and checks presence in OCR text.
 * 
 * @param {string} ocrText
 * @param {string} registeredAddress
 * @returns {Object}
 */
const verifyAddressMention = (ocrText = '', registeredAddress = '') => {
  if (!registeredAddress || !registeredAddress.trim()) {
    return {
      match_percentage: 100,
      matched_keywords: [],
      total_keywords: 0,
      warning: null,
    };
  }

  if (!ocrText || !ocrText.trim()) {
    return {
      match_percentage: 0,
      matched_keywords: [],
      total_keywords: 0,
      warning: null,
    };
  }

  const cleanAddress = registeredAddress.trim().toLowerCase();
  const rawWords = cleanAddress
    .replace(/[^\w\s\u0900-\u097f]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  // Exclude common noise / stop words in addresses
  const stopWords = new Set([
    'near', 'opposite', 'behind', 'beside', 'at', 'in', 'on', 'road', 'street',
    'lane', 'floor', 'building', 'plot', 'no', 'and', 'the', 'of', 'for', 'by'
  ]);

  const keywords = [];
  for (const word of rawWords) {
    if (word.length >= 3 && !stopWords.has(word) && !keywords.includes(word)) {
      keywords.push(word);
    }
  }

  if (keywords.length === 0) {
    return {
      match_percentage: 100,
      matched_keywords: [],
      total_keywords: 0,
      warning: null,
    };
  }

  const ocrLower = ocrText.toLowerCase();
  const matchedKeywords = [];

  for (const kw of keywords) {
    // 1. Direct substring match
    if (ocrLower.includes(kw)) {
      matchedKeywords.push(kw);
      continue;
    }

    // 2. Generic fuzzy match for words with length >= 4
    if (kw.length >= 4 && fuzz.partial_ratio(kw, ocrLower) >= 85) {
      matchedKeywords.push(kw);
    }
  }

  const matchPercentage = Math.round((matchedKeywords.length / keywords.length) * 100);

  // Generic address indicator keywords in OCR (street, road, sector, suite, floor, pin, etc.)
  const hasAddressContextInOcr = /\b(?:address|location|floor|sector|block|suite|road|street|lane|marg|city|state|pin|\d{6})\b/i.test(ocrLower);

  let warning = null;
  if (matchPercentage === 0 && hasAddressContextInOcr) {
    warning = 'Address registered address se match nahi kar raha, verify kar lein';
  }

  return {
    match_percentage: matchPercentage,
    matched_keywords: matchedKeywords,
    total_keywords: keywords.length,
    warning,
  };
};

module.exports = {
  verifyBrandNamePresence,
  verifyPhoneNumbers,
  verifyAddressMention,
};
