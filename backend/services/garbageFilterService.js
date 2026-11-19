const DEVANAGARI_REGEX = /[\u0900-\u097f]/;
const LATIN_REGEX = /[A-Za-z]/;
const VOWEL_REGEX = /[aeiouAEIOU]/;

// Common valid 1-2 letter words and standard abbreviations
const VALID_SHORT_WORDS = new Set([
  // English 1-2 letter words & common abbreviations
  'a', 'i', 'to', 'in', 'on', 'at', 'is', 'it', 'as', 'or', 'by', 'my', 'we',
  'he', 'do', 'go', 'no', 'so', 'up', 'am', 'an', 'if', 'me', 'us', 'be',
  'dr', 'mr', 'ms', 'tv', 'ok', 'hi', 'of', 'pvt', 'ltd', 'co', 'st', 'rd', 'nd', 'th',
  // Hindi common 1-2 letter words
  'का', 'की', 'के', 'को', 'से', 'में', 'पर', 'है', 'हो', 'दो', 'लो', 'दी',
  'इस', 'उस', 'यह', 'वह', 'जो', 'भी', 'ना', 'था', 'थी', 'थे', 'कल', 'अब',
  'जब', 'तब', 'कम', 'मन', 'तन', 'घर', 'चल', 'सच', 'हक', 'एक', 'व', 'न'
]);

// Known standard uppercase acronyms (medical, tech, etc.)
const KNOWN_UPPERCASE_ACRONYMS = new Set([
  'MBBS', 'DNB', 'OPD', 'EEG', 'IAP', 'PDA', 'ICU', 'MRI', 'CT', 'ECG', 'WHO', 'AI'
]);

/**
 * Detailed analysis of an OCR token to detect visual garbage/noise.
 * @param {string} token
 * @param {Set<string>|Array<string>} [whitelist]
 * @returns {{ isGarbage: boolean, reason: string | null }}
 */
const analyzeToken = (token, whitelist = null) => {
  if (!token || typeof token !== 'string') {
    return { isGarbage: true, reason: 'empty_or_invalid' };
  }

  const raw = token.trim();
  if (!raw) {
    return { isGarbage: true, reason: 'empty_string' };
  }

  // Whitelist bypass: If token is in client whitelist, never treat as garbage
  const lowered = raw.toLowerCase();
  if (whitelist) {
    if (whitelist instanceof Set && whitelist.has(lowered)) {
      return { isGarbage: false, reason: null };
    }
    if (Array.isArray(whitelist) && whitelist.some((w) => typeof w === 'string' && w.toLowerCase() === lowered)) {
      return { isGarbage: false, reason: null };
    }
  }

  // Known uppercase acronym bypass (e.g. MBBS, OPD, DNB)
  if (KNOWN_UPPERCASE_ACRONYMS.has(raw.toUpperCase())) {
    return { isGarbage: false, reason: null };
  }

  // Pure numbers, valid punctuation, or dates (e.g. "2026", "0761-4927230", "14")
  if (/^[\d\s,.\-+/:()]+$/.test(raw)) {
    // Lone single punctuation symbol like "-" or "?" or "1?"
    if (raw.length <= 2 && !/^\d+$/.test(raw)) {
      return { isGarbage: true, reason: 'isolated_symbol' };
    }
    return { isGarbage: false, reason: null };
  }

  const hasDevanagari = DEVANAGARI_REGEX.test(raw);
  const hasLatin = LATIN_REGEX.test(raw);

  // A) MIXED SCRIPT: Token contains BOTH Devanagari and Latin letters (e.g. "Iocकlक?", "Eक")
  if (hasDevanagari && hasLatin) {
    return {
      isGarbage: true,
      reason: 'mixed_script (Devanagari + Latin combined in single token)',
    };
  }

  // B) INVALID SYMBOL PLACEMENT: Trailing punctuation like "Word!" or "Offer?" is normal.
  // Only flag if ! or ? is embedded inside letters (e.g. "Com!pleted" or "1?")
  const innerToken = raw.replace(/^[!?]+|[!?]+$/g, '');
  if (/[!?]/.test(innerToken)) {
    return {
      isGarbage: true,
      reason: 'invalid_symbol_placement (unexpected ! or ? inside token)',
    };
  }

  // Digits mixed directly inside letters (e.g. "P1he", "sPhl6", "Ebh8", "8h")
  if (hasLatin && /\d/.test(raw)) {
    // If it's not a common ordinal or model number (e.g. "1st", "2nd", "3rd", "4th")
    if (!/^\d+(st|nd|rd|th)$/i.test(raw)) {
      // e.g. "P1he", "sPhl6"
      if (/[A-Za-z]+\d+[A-Za-z]+/i.test(raw) || /[A-Za-z]+\d+/i.test(raw) || /\d+[A-Za-z]{2,}/i.test(raw)) {
        return {
          isGarbage: true,
          reason: 'corrupted_alphanumeric (digits intermixed within alphabets)',
        };
      }
    }
  }

  // C) UNPRONOUNCEABLE CONSONANT CLUSTER / NO VOWELS (Latin only)
  // e.g. 3+ consecutive consonants and no vowel in entire token ("hbb", "hhh", "Dhlh", "Uhss", "Ebh")
  if (hasLatin && !hasDevanagari) {
    const lettersOnly = raw.replace(/[^A-Za-z]/g, '');
    const hasVowel = VOWEL_REGEX.test(lettersOnly);

    if (!hasVowel) {
      // Common abbreviations bypass (e.g. Pvt, Ltd)
      const cleanLower = lettersOnly.toLowerCase();
      if (VALID_SHORT_WORDS.has(cleanLower) || cleanLower === 'pvt' || cleanLower === 'ltd') {
        return { isGarbage: false, reason: null };
      }

      // If 3 or more letters and NO vowel at all (e.g. "hbb", "hhh", "dhlh", "uhss")
      if (lettersOnly.length >= 3) {
        return {
          isGarbage: true,
          reason: 'unpronounceable_consonant_cluster (zero vowels in Latin token)',
        };
      }
      // If 2 letters with no vowel and not in VALID_SHORT_WORDS (e.g. "gh", "bb", "hh")
      if (lettersOnly.length === 2 && !VALID_SHORT_WORDS.has(lettersOnly.toLowerCase())) {
        return {
          isGarbage: true,
          reason: 'unpronounceable_short_cluster (2 consonants with no vowel)',
        };
      }
    }

    // Unpronounceable final consonant combinations common in OCR noise (e.g. "Iobh", "Dhlh", "Ebh")
    if (lettersOnly.length <= 6 && /(?:bh|lh|hh|hb|hl|hbb|qq|jj|xx|zz)$/i.test(lettersOnly)) {
      return {
        isGarbage: true,
        reason: 'unpronounceable_final_cluster (rare/abnormal consonant ending in OCR noise)',
      };
    }

    // 5+ consecutive consonants (allows natural 4-consonant clusters without treating as noise)
    if (/[bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ]{5,}/.test(lettersOnly)) {
      return {
        isGarbage: true,
        reason: 'consecutive_consonant_cluster (5+ consonants in sequence)',
      };
    }
  }

  // D) TOO SHORT (Length <= 2) and not in valid common words or whitelist
  const stripped = raw.replace(/[.,:;'"_()\\[\\]{}]/g, '');
  if (stripped.length <= 2) {
    const strippedLower = stripped.toLowerCase();
    if (!VALID_SHORT_WORDS.has(strippedLower)) {
      // Single latin letter (like "h", "k", "s", "q") except 'a' or 'i'
      if (stripped.length === 1 && hasLatin) {
        return {
          isGarbage: true,
          reason: 'isolated_single_character (low semantic value)',
        };
      }
      // 2-letter token not recognized as valid word or acronym
      if (stripped.length <= 2 && (hasLatin || !hasDevanagari)) {
        return {
          isGarbage: true,
          reason: 'unrecognized_short_token (length <= 2 and not a standard word)',
        };
      }
    }
  }

  return { isGarbage: false, reason: null };
};

/**
 * Check if token is garbage/noise.
 * @param {string} token
 * @param {Set<string>|Array<string>} [whitelist]
 * @returns {boolean}
 */
const isGarbageToken = (token, whitelist = null) => {
  return analyzeToken(token, whitelist).isGarbage;
};

/**
 * Filter an array or line-separated text of tokens into clean vs noise.
 * @param {string[]|string} tokens
 * @param {Set<string>|Array<string>} [whitelist]
 * @returns {{ cleanTokens: string[], noiseTokens: Array<{ token: string, reason: string }> }}
 */
const filterTokens = (tokens, whitelist = null) => {
  let list = [];
  if (Array.isArray(tokens)) {
    list = tokens;
  } else if (typeof tokens === 'string') {
    list = tokens.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  }

  const cleanTokens = [];
  const noiseTokens = [];

  for (const token of list) {
    const analysis = analyzeToken(token, whitelist);
    if (analysis.isGarbage) {
      noiseTokens.push({ token, reason: analysis.reason });
    } else {
      cleanTokens.push(token);
    }
  }

  return { cleanTokens, noiseTokens };
};

module.exports = {
  isGarbageToken,
  analyzeToken,
  filterTokens,
};
