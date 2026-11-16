const fuzzball = require('fuzzball');

/**
 * Find banned terms in text using word-boundary matching for Latin terms
 * and substring matching for Devanagari / multi-word phrases.
 * @param {string} text
 * @param {string[]} bannedWordsList
 * @returns {string[]} List of matched banned words
 */
const findBannedWords = (text, bannedWordsList) => {
  if (!text || !Array.isArray(bannedWordsList) || bannedWordsList.length === 0) {
    return [];
  }

  const loweredText = text.toLowerCase();
  const found = [];

  for (const word of bannedWordsList) {
    if (typeof word !== 'string') continue;
    const cleanWord = word.trim();
    if (!cleanWord) continue;

    const loweredWord = cleanWord.toLowerCase();
    let matched = false;

    // For alphanumeric Latin terms, enforce word boundaries so substrings inside larger words aren't falsely flagged
    if (/^[a-z0-9\s_-]+$/.test(loweredWord)) {
      const escaped = loweredWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Lookaround word boundaries compatible with Node.js
      const regex = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
      matched = regex.test(loweredText);
    } else {
      // Substring check for Devanagari or special character phrases
      matched = loweredText.includes(loweredWord);
    }

    if (matched && !found.includes(cleanWord)) {
      found.push(cleanWord);
    }
  }

  return found;
};

/**
 * Check which mandatory compliance phrases are missing in the caption.
 * @param {string} caption
 * @param {string[]} mandatoryPhrasesList
 * @returns {string[]} Missing phrases
 */
const findMissingMandatoryPhrases = (caption, mandatoryPhrasesList) => {
  if (!Array.isArray(mandatoryPhrasesList) || mandatoryPhrasesList.length === 0) {
    return [];
  }

  const loweredCaption = (caption || '').toLowerCase();
  const missing = [];

  for (const phrase of mandatoryPhrasesList) {
    if (typeof phrase !== 'string') continue;
    const cleanPhrase = phrase.trim();
    if (!cleanPhrase) continue;

    if (!loweredCaption.includes(cleanPhrase.toLowerCase())) {
      missing.push(cleanPhrase);
    }
  }

  return missing;
};

/**
 * Compare a candidate word against a client's whitelist using fuzzy string similarity.
 * Returns true if any entry achieves a similarity score >= threshold (default 80%).
 * @param {string} word
 * @param {string[]} whitelistList
 * @param {number} [threshold=80]
 * @returns {boolean}
 */
const fuzzyMatchWhitelist = (word, whitelistList, threshold = 80) => {
  if (!word || !Array.isArray(whitelistList) || whitelistList.length === 0) {
    return false;
  }

  const cleanWord = word.trim().toLowerCase();
  if (!cleanWord) return false;

  for (const entry of whitelistList) {
    if (typeof entry !== 'string') continue;
    const cleanEntry = entry.trim().toLowerCase();
    if (!cleanEntry) continue;

    // Exact match is always 100%
    if (cleanWord === cleanEntry) {
      return true;
    }

    const score = fuzzball.ratio(cleanWord, cleanEntry);
    if (score >= threshold) {
      return true;
    }
  }

  return false;
};

module.exports = {
  findBannedWords,
  findMissingMandatoryPhrases,
  fuzzyMatchWhitelist,
};
