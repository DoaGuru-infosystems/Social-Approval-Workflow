const fs = require('fs');
const path = require('path');
const nspell = require('nspell');
const { distance } = require('fastest-levenshtein');

let cachedHindiSpeller = null;
let isInitialized = false;
let initPromise = null;

/**
 * Initialize and load Hindi dictionary into memory using nspell.
 * Reads hi_IN.aff and hi_IN.dic from backend/dictionaries/hi_IN/.
 */
const initHindiDictionary = async () => {
  if (isInitialized && cachedHindiSpeller) {
    return cachedHindiSpeller;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const affPath = path.resolve(__dirname, '..', 'dictionaries', 'hi_IN', 'hi_IN.aff');
    const dicPath = path.resolve(__dirname, '..', 'dictionaries', 'hi_IN', 'hi_IN.dic');

    if (!fs.existsSync(affPath) || !fs.existsSync(dicPath)) {
      throw new Error(`Hindi dictionary files missing at: ${affPath} or ${dicPath}`);
    }

    const affBuffer = fs.readFileSync(affPath);
    const dicBuffer = fs.readFileSync(dicPath);

    cachedHindiSpeller = nspell(affBuffer, dicBuffer);
    isInitialized = true;
    return cachedHindiSpeller;
  })();

  return initPromise;
};

/**
 * Check if a Hindi word is spelled correctly.
 * @param {string} word
 * @param {Array<string>|Set<string>} [whitelist]
 * @returns {boolean}
 */
const isCorrect = (word, whitelist = []) => {
  if (!word || typeof word !== 'string') return true;
  const clean = word.trim();
  if (!clean) return true;

  // Check custom whitelist (case-insensitive)
  if (whitelist) {
    const low = clean.toLowerCase();
    if (whitelist instanceof Set && whitelist.has(low)) return true;
    if (Array.isArray(whitelist) && whitelist.some((w) => typeof w === 'string' && w.toLowerCase() === low)) {
      return true;
    }
  }

  if (!cachedHindiSpeller) {
    throw new Error('Hindi dictionary not initialized. Call initHindiDictionary() first.');
  }

  return Boolean(cachedHindiSpeller.correct(clean));
};

/**
 * Generate spelling suggestions for a misspelled Hindi word, ranked by Levenshtein distance.
 * @param {string} word
 * @param {Array<string>|Set<string>} [whitelist]
 * @param {number} [maxSuggestions=5]
 * @returns {string[]}
 */
const suggest = (word, whitelist = [], maxSuggestions = 5) => {
  if (!word || typeof word !== 'string') return [];
  const clean = word.trim();
  if (!clean || !cachedHindiSpeller) return [];

  const rawSuggestions = cachedHindiSpeller.suggest(clean) || [];

  // Add close candidates from whitelist if any
  const candidatePool = new Set(rawSuggestions);
  if (whitelist) {
    const list = Array.isArray(whitelist) ? whitelist : Array.from(whitelist);
    for (const item of list) {
      if (typeof item === 'string' && distance(clean, item) <= 2) {
        candidatePool.add(item);
      }
    }
  }

  // Sort by Levenshtein distance to provide the most accurate suggestions first
  const sorted = Array.from(candidatePool).sort((a, b) => {
    const distA = distance(clean, a);
    const distB = distance(clean, b);
    return distA - distB;
  });

  return sorted.slice(0, maxSuggestions);
};

/**
 * Generic phone number normalization:
 * If an extracted 10-digit number is within 1-2 edit distance from any registered expected phone from DB,
 * normalizes it to that expected phone without any hardcoding.
 * 
 * @param {string} text
 * @param {Array<string>} [expectedPhones=[]]
 * @returns {string}
 */
const normalizePhonesWithExpected = (text, expectedPhones = []) => {
  if (!text || typeof text !== 'string') return text || '';
  if (!expectedPhones || expectedPhones.length === 0) return text;

  // Clean expected phone numbers to 10 digits
  const validExpected = expectedPhones
    .map((p) => String(p || '').replace(/\D/g, ''))
    .filter((p) => p.length === 10);

  if (validExpected.length === 0) return text;

  return text.replace(/\b\d{10}\b/g, (num) => {
    for (const target of validExpected) {
      if (num === target) return target;
      if (distance(num, target) <= 2) {
        return target;
      }
    }
    return num;
  });
};

module.exports = {
  initHindiDictionary,
  isCorrect,
  suggest,
  normalizePhonesWithExpected,
  isInitialized: () => isInitialized,
};
