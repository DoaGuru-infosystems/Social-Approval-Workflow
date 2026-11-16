const fs = require('fs');
const path = require('path');
const hindiDictionaryService = require('./hindiDictionaryService');

const DEVANAGARI_REGEX = /[\u0900-\u097f]/;
const WORD_PATTERN = /[\u0900-\u097f]+|[A-Za-z]+(?:['’][A-Za-z]+)*/g;

// Module-level in-memory cache for dictionaries
let cachedEnglishSpell = null;
let cachedHindiSpell = null;
let initPromise = null;
let isInitialized = false;

/**
 * Check if a word contains Devanagari characters (U+0900 to U+097F).
 * @param {string} word
 * @returns {boolean}
 */
const isDevanagariWord = (word) => {
  if (!word || typeof word !== 'string') return false;
  return DEVANAGARI_REGEX.test(word);
};

/**
 * Initialize and load English (nspell) and Hindi (hunspell-asm) dictionaries into memory.
 * Idempotent: returns immediately if already initialized.
 * @returns {Promise<{ englishLoaded: boolean, hindiLoaded: boolean, durationMs: number }>}
 */
const initDictionaries = async () => {
  if (isInitialized && cachedEnglishSpell && cachedHindiSpell) {
    return { englishLoaded: true, hindiLoaded: true, durationMs: 0 };
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const startTime = Date.now();
    try {
      // 1. Load English dictionary via nspell + dictionary-en
      const nspellModule = (await import('nspell')).default || require('nspell');
      const dictionaryEn = (await import('dictionary-en')).default;
      const { aff: enAff, dic: enDic } = dictionaryEn;
      cachedEnglishSpell = nspellModule(enAff, enDic);

      // 2. Load Hindi dictionary via hindiDictionaryService (nspell + hi_IN files)
      cachedHindiSpell = await hindiDictionaryService.initHindiDictionary();

      isInitialized = true;
      const durationMs = Date.now() - startTime;
      console.log(`[SpellCheckService] Dictionaries initialized in ${durationMs} ms (English: nspell, Hindi: hindiDictionaryService).`);
      return { englishLoaded: true, hindiLoaded: true, durationMs };
    } catch (error) {
      console.error('[SpellCheckService] Failed to initialize dictionaries:', error.message);
      throw error;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
};

/**
 * Check spelling of a single word against the in-memory dictionaries and client whitelist.
 * @param {string} word
 * @param {Set<string>|Array<string>} [whitelist]
 * @returns {Promise<{ correct: boolean, suggestions: string[] }>}
 */
const checkWord = async (word, whitelist = null) => {
  if (!word || typeof word !== 'string') {
    return { correct: true, suggestions: [] };
  }

  const cleanWord = word.trim();
  if (!cleanWord || cleanWord.startsWith('#')) {
    return { correct: true, suggestions: [] };
  }

  // Ensure dictionaries are loaded
  if (!isInitialized || !cachedEnglishSpell || !cachedHindiSpell) {
    await initDictionaries();
  }

  // Whitelist check (case-insensitive)
  const lowered = cleanWord.toLowerCase();
  if (whitelist) {
    if (whitelist instanceof Set) {
      if (whitelist.has(lowered)) return { correct: true, suggestions: [] };
    } else if (Array.isArray(whitelist)) {
      if (whitelist.some((w) => typeof w === 'string' && w.toLowerCase() === lowered)) {
        return { correct: true, suggestions: [] };
      }
    }
  }

  const isHindi = isDevanagariWord(cleanWord);

  if (isHindi) {
    const isOk = hindiDictionaryService.isCorrect(cleanWord, whitelist);
    if (isOk) {
      return { correct: true, suggestions: [] };
    }
    const suggestions = hindiDictionaryService.suggest(cleanWord, whitelist, 5);
    return { correct: false, suggestions };
  } else {
    // English / Latin check (check exact case and lowercase)
    const isCorrect =
      cachedEnglishSpell.correct(cleanWord) || cachedEnglishSpell.correct(lowered);
    if (isCorrect) {
      return { correct: true, suggestions: [] };
    }
    const suggestions = (cachedEnglishSpell.suggest(cleanWord) || []).slice(0, 5);
    return { correct: false, suggestions };
  }
};

/**
 * Check spelling of an entire text (title, caption, or OCR text).
 * Skips numbers, symbols, emojis, and extracts valid word tokens.
 * @param {string} text
 * @param {Set<string>|Array<string>} [whitelist]
 * @returns {Promise<Array<{ word: string, script: 'hindi'|'english', suggestions: string[] }>>}
 */
const checkText = async (text, whitelist = null) => {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // Ensure dictionaries are loaded once
  if (!isInitialized || !cachedEnglishSpell || !cachedHindiSpell) {
    await initDictionaries();
  }

  // Normalize whitelist Set of lowercased words for O(1) lookup
  let whitelistSet = new Set();
  if (whitelist instanceof Set) {
    whitelist.forEach((w) => typeof w === 'string' && whitelistSet.add(w.toLowerCase()));
  } else if (Array.isArray(whitelist)) {
    whitelist.forEach((w) => typeof w === 'string' && whitelistSet.add(w.toLowerCase()));
  }

  // Exclude hashtags from word-level spell check (hashtags are checked via mandatory phrases)
  const textWithoutHashtags = text.replace(/#[\w\u0900-\u097f-]+/g, ' ');

  const matches = textWithoutHashtags.match(WORD_PATTERN);
  if (!matches) {
    return [];
  }

  const issues = [];
  const seen = new Set();

  const brandRulesService = require('./brandRulesService');
  const whitelistArray = Array.from(whitelistSet);

  for (const rawWord of matches) {
    const cleanWord = rawWord.replace(/[\u0964\u0965।,.;:!?()'"_/-]/g, '').trim();
    if (!cleanWord || cleanWord.length <= 1) continue;

    // Skip pure numerals (Devanagari or Arabic digits)
    if (/^[\u0966-\u096f0-9]+$/.test(cleanWord)) continue;

    const isHindi = isDevanagariWord(cleanWord);

    // Skip uppercase Latin acronyms (e.g. OPD, MBBS, DNB, IAP, PDF, NEUROLOGY)
    if (!isHindi && /^[A-Z]{2,8}$/.test(cleanWord)) continue;

    // Skip OCR detached matra ligature artifacts (e.g. isolated short-i matra)
    if (isHindi && /^[\u093e-\u094f]/.test(cleanWord)) continue;

    const script = isHindi ? 'hindi' : 'english';
    const key = `${script}:${cleanWord.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    // Whitelist check (exact or fuzzy >= 80%)
    if (whitelistSet.has(cleanWord.toLowerCase())) {
      continue;
    }
    if (whitelistArray.length > 0 && brandRulesService.fuzzyMatchWhitelist(cleanWord, whitelistArray, 80)) {
      continue;
    }

    const result = await checkWord(cleanWord, whitelistSet);
    if (!result.correct) {
      issues.push({
        word: cleanWord,
        script,
        suggestions: result.suggestions || [],
      });
    }
  }

  return issues;
};

module.exports = {
  initDictionaries,
  isDevanagariWord,
  checkWord,
  checkText,
  isInitialized: () => isInitialized,
};
