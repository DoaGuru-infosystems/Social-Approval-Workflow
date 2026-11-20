const fuzz = require('fuzzball');
const { isProfessionalTerm, getProfessionalTermsSet } = require('./crossClientService');

/**
 * Calculate Levenshtein edit distance between two strings.
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
 * Internal helper to verify OCR text against a single brand name.
 * Client-agnostic: uses professional_terms.json to distinguish generic qualifications/descriptors.
 * Never skips brand checks; flags BRAND_NOT_FOUND or UNAUTHORIZED_BRAND when missing.
 * @param {string} ocrText
 * @param {string} officialName
 * @param {Array<string>} [clientWhitelist]
 * @returns {Object}
 */
const _checkSingleBrandName = (ocrText, officialName, clientWhitelist = []) => {
  if (!officialName || !officialName.trim()) {
    return {
      verified: false,
      brand_name_correct: false,
      brand_name_not_found: true,
      possible_brand_name_error: false,
      status: 'UNAUTHORIZED_BRAND',
      score: 0,
      matched_text: '',
      official_name: '',
      message: 'No official organization name registered. Unauthorized brand.',
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
      status: 'BRAND_NOT_FOUND',
      score: 0,
      matched_text: '',
      official_name: cleanOfficial,
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
      status: 'BRAND_NOT_FOUND',
      score: 0,
      matched_text: '',
      official_name: cleanOfficial,
      message: 'Brand name not found in image.',
    };
  }

  // Extract core brand name (without trailing legal or entity suffixes)
  const coreBrandName = cleanOfficial
    .replace(/\s+(pvt\s+ltd|ltd|llc|inc|corp|co|organization|services|enterprises)\b/gi, '')
    .trim();
  const normalizedCore = coreBrandName.toLowerCase().replace(/[^\w\s\u0900-\u097f]/g, '');

  let bestMatch = { windowStr: '', score: 0, size: 0 };
  let bestCoreMatch = { windowStr: '', score: 0, size: 0 };

  // Sliding windows of size 2 to 5 consecutive tokens
  for (let size = 2; size <= Math.min(5, rawTokens.length); size++) {
    for (let i = 0; i <= rawTokens.length - size; i++) {
      const windowTokens = rawTokens.slice(i, i + size);
      const windowStr = windowTokens.join(' ');
      const normalizedWindow = windowStr.toLowerCase().replace(/[^\w\s\u0900-\u097f]/g, '');

      const fullScore = fuzz.ratio(normalizedWindow, normalizedOfficial);
      const coreScore = coreBrandName && coreBrandName !== cleanOfficial
        ? fuzz.ratio(normalizedWindow, normalizedCore)
        : 0;

      if (coreScore > bestCoreMatch.score) {
        bestCoreMatch = { windowStr, score: coreScore, size };
      }
      if (fullScore > bestMatch.score) {
        bestMatch = { windowStr, score: fullScore, size };
      }
    }
  }

  // 1. Full/Core Brand Name exact or high-confidence match (>= 85%)
  const isExactFullMatch = bestMatch.windowStr && normalizedOfficial &&
    (bestMatch.windowStr.toLowerCase().replace(/[^\w\s\u0900-\u097f]/g, '') === normalizedOfficial);
  const isExactCoreMatch = bestCoreMatch.windowStr && normalizedCore &&
    (bestCoreMatch.windowStr.toLowerCase().replace(/[^\w\s\u0900-\u097f]/g, '') === normalizedCore);

  if (isExactFullMatch || bestMatch.score >= 90) {
    return {
      verified: true,
      brand_name_correct: true,
      possible_brand_name_error: false,
      brand_name_not_found: false,
      status: 'PASS',
      score: bestMatch.score,
      matched_text: bestMatch.windowStr,
      official_name: cleanOfficial,
      message: `Official brand name matched successfully (${bestMatch.score}% similarity).`,
    };
  }

  if (isExactCoreMatch || bestCoreMatch.score >= 88) {
    return {
      verified: true,
      brand_name_correct: true,
      possible_brand_name_error: false,
      brand_name_not_found: false,
      status: 'PASS',
      score: bestCoreMatch.score,
      matched_text: bestCoreMatch.windowStr,
      official_name: cleanOfficial,
      message: `Official core brand name matched successfully (${bestCoreMatch.score}% similarity).`,
    };
  }

  // 2. Distinctive Brand Word matching (filter out generic professional terms from official name)
  const orgWords = cleanOfficial.split(/\s+/).filter((w) => w.length >= 3 && !isProfessionalTerm(w));
  const distinctiveWords = orgWords.length > 0 ? orgWords : [cleanOfficial.split(/\s+/)[0] || cleanOfficial];

  let bestDistinctiveMatch = null;
  let bestDistinctiveScore = 0;
  let candidateTypo = null;

  for (const primaryWord of distinctiveWords) {
    const cleanPrimary = primaryWord.toLowerCase().replace(/[^\w\u0900-\u097f]/g, '');
    if (!cleanPrimary || cleanPrimary.length < 3) continue;

    for (const tok of rawTokens) {
      // Ignore generic professional / qualification terms
      if (isProfessionalTerm(tok)) continue;

      const unhyphen = tok.replace(/[-_]/g, '');
      const tokensToCheck = unhyphen !== tok ? [tok, unhyphen] : [tok];

      for (const t of tokensToCheck) {
        const cleanT = t.toLowerCase().replace(/[^\w\u0900-\u097f]/g, '');
        if (!cleanT || cleanT.length < 3) continue;

        // Skip if this token is an authorized client whitelist word
        if (clientWhitelist && clientWhitelist.some((w) => String(w).toLowerCase() === cleanT)) {
          continue;
        }

        const sim = fuzz.ratio(cleanT, cleanPrimary);
        const dist = getEditDistance(cleanT, cleanPrimary);

        if (sim >= 95 || (cleanT === cleanPrimary)) {
          if (sim > bestDistinctiveScore) {
            bestDistinctiveScore = sim;
            bestDistinctiveMatch = { word: t, score: sim, primaryWord };
          }
        } else if (sim >= 80 && dist <= 2 && cleanPrimary.length >= 4) {
          // Genuine typographical distortion of the brand name (edit distance <= 2, high similarity)
          if (!candidateTypo || sim > candidateTypo.score) {
            candidateTypo = {
              candidate: t,
              primaryWord,
              score: sim,
              dist,
            };
          }
        }
      }
    }
  }

  if (bestDistinctiveMatch && bestDistinctiveScore >= 90) {
    return {
      verified: true,
      brand_name_correct: true,
      possible_brand_name_error: false,
      brand_name_not_found: false,
      status: 'PASS',
      score: bestDistinctiveScore,
      matched_text: bestDistinctiveMatch.word,
      official_name: cleanOfficial,
      message: `Distinctive brand token '${bestDistinctiveMatch.word}' matched official '${bestDistinctiveMatch.primaryWord}' (${bestDistinctiveScore}% similarity).`,
    };
  }

  // 3. Brand Typo / Distortion: Only trigger when candidate is NOT a professional term,
  // has high similarity (>= 80%) AND edit distance <= 2 to the brand word.
  if (candidateTypo) {
    const errorMsg = `Poster me brand name galat likha hai: '${candidateTypo.candidate}' vs official '${candidateTypo.primaryWord}' (${candidateTypo.score}% similarity, ${candidateTypo.dist} char diff). OCR ne sahi padha hai. Designer ko bolo: Poster me '${candidateTypo.candidate}' ki jagah '${candidateTypo.primaryWord}' likho.`;
    return {
      verified: true,
      brand_name_correct: false,
      possible_brand_name_error: errorMsg,
      brand_name_not_found: false,
      status: 'BRAND_TYPO',
      score: candidateTypo.score,
      matched_text: candidateTypo.candidate,
      official_name: cleanOfficial,
      message: errorMsg,
    };
  }

  // 4. Brand Not Found / Unauthorized Brand (poster does not contain this client's brand)
  return {
    verified: true,
    brand_name_correct: false,
    possible_brand_name_error: false,
    brand_name_not_found: true,
    status: 'BRAND_NOT_FOUND',
    score: Math.max(bestMatch.score, bestCoreMatch.score),
    matched_text: bestMatch.windowStr || '',
    official_name: cleanOfficial,
    message: `Brand name '${cleanOfficial}' not found in image.`,
  };
};

/**
 * 1. FUZZY PHRASE MATCHING (Brand Name Presence & Integrity)
 * Extracts sliding windows of 2 to 5 consecutive words from OCR text and compares
 * them against the official organization name and/or GMB official name.
 * 
 * If either matches >= 90% (or >= 95%), brand_name_correct is true.
 * 
 * @param {string} ocrText
 * @param {string} officialName Manual official name
 * @param {string} [gmbOfficialName] GMB fetched official name
 * @param {Array<string>} [clientWhitelist] Client specific whitelist
 * @returns {Object}
 */
const verifyBrandNamePresence = (ocrText, officialName, gmbOfficialName = '', clientWhitelist = []) => {
  const cleanManual = (officialName || '').trim();
  const cleanGmb = (gmbOfficialName || '').trim();

  if (!cleanManual && !cleanGmb) {
    return {
      verified: false,
      brand_name_correct: false,
      brand_name_not_found: true,
      possible_brand_name_error: false,
      status: 'UNAUTHORIZED_BRAND',
      score: 0,
      matched_text: '',
      message: 'No official organization name registered. Unauthorized brand.',
    };
  }

  const resManual = cleanManual ? _checkSingleBrandName(ocrText, cleanManual, clientWhitelist) : null;
  const resGmb = cleanGmb && cleanGmb !== cleanManual ? _checkSingleBrandName(ocrText, cleanGmb, clientWhitelist) : null;

  if (resManual && resManual.brand_name_correct) return resManual;
  if (resGmb && resGmb.brand_name_correct) return resGmb;

  // If neither is 100% / >= 95% correct, pick the higher scoring candidate
  if (resManual && resGmb) {
    return (resGmb.score || 0) > (resManual.score || 0) ? resGmb : resManual;
  }
  return resManual || resGmb;
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
 * against primaryPhone, alternatePhone, and gmbPhone.
 * 
 * @param {string} ocrText
 * @param {string} caption
 * @param {string} primaryPhone
 * @param {string} [alternatePhone]
 * @param {string} [gmbPhone]
 * @returns {Array<Object>}
 */
const verifyPhoneNumbers = (ocrText = '', caption = '', primaryPhone = '', alternatePhone = '', gmbPhone = '') => {
  const normPrimary = normalizePhone(primaryPhone);
  const normAlternate = normalizePhone(alternatePhone);
  const normGmb = normalizePhone(gmbPhone);

  const registeredNumbers = [];
  if (normPrimary) registeredNumbers.push({ type: 'primary', number: normPrimary, raw: primaryPhone });
  if (normAlternate && normAlternate !== normPrimary) {
    registeredNumbers.push({ type: 'alternate', number: normAlternate, raw: alternatePhone });
  }
  if (normGmb && normGmb !== normPrimary && normGmb !== normAlternate) {
    registeredNumbers.push({ type: 'gmb', number: normGmb, raw: gmbPhone });
  }

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
 * Internal helper to verify OCR text against a single registered address.
 * @param {string} ocrText
 * @param {string} address
 * @returns {Object}
 */
const _verifySingleAddress = (ocrText = '', address = '') => {
  if (!address || !address.trim()) {
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

  const cleanAddress = address.trim().toLowerCase();
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

/**
 * 3. ADDRESS VERIFICATION (Soft / Informational Check)
 * Deconstructs registered address (manual and/or GMB) into keywords and checks presence in OCR text.
 * 
 * @param {string} ocrText
 * @param {string} registeredAddress
 * @param {string} [gmbAddress]
 * @returns {Object}
 */
const verifyAddressMention = (ocrText = '', registeredAddress = '', gmbAddress = '') => {
  const cleanManual = (registeredAddress || '').trim();
  const cleanGmb = (gmbAddress || '').trim();

  if (!cleanManual && !cleanGmb) {
    return {
      match_percentage: 100,
      matched_keywords: [],
      total_keywords: 0,
      warning: null,
    };
  }

  const resManual = cleanManual ? _verifySingleAddress(ocrText, cleanManual) : null;
  const resGmb = cleanGmb && cleanGmb !== cleanManual ? _verifySingleAddress(ocrText, cleanGmb) : null;

  if (resManual && resGmb) {
    return (resGmb.match_percentage || 0) > (resManual.match_percentage || 0) ? resGmb : resManual;
  }
  return resManual || resGmb;
};

module.exports = {
  verifyBrandNamePresence,
  verifyPhoneNumbers,
  verifyAddressMention,
};
