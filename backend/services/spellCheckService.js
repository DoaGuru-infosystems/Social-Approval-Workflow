const fs = require('fs');
const path = require('path');
const hindiDictionaryService = require('./hindiDictionaryService');
const garbageFilterService = require('./garbageFilterService');

const DEVANAGARI_REGEX = /[\u0900-\u097f]/;
const WORD_PATTERN = /[\u0900-\u097f]+|[A-Za-z]+(?:['’][A-Za-z]+)*/g;

// Common valid English contractions without apostrophe commonly produced by OCR punctuation drops
const COMMON_CONTRACTIONS = new Set([
  'thats', 'isnt', 'theyre', 'arent', 'dont', 'didnt', 'doesnt', 'wont',
  'cant', 'couldnt', 'shouldnt', 'wouldnt', 'hasnt', 'havent', 'hadnt',
  'youre', 'weve', 'theyve', 'youve', 'youll', 'theyll', 'shell', 'hell',
  'itll', 'whats', 'whos', 'wheres', 'whens', 'whys', 'hows', 'lets',
  'competitors', 'clients', 'todays'
]);

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

  // B1: Format/Pattern check: URLs, emails, phone numbers, and handles are not prose words
  if (
    /^(https?:\/\/|www\.)/i.test(cleanWord) ||
    /@/.test(cleanWord) ||
    /^\+?\d{10,}$/.test(cleanWord) ||
    cleanWord.startsWith('@')
  ) {
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
    // Digits or invalid matras inside Devanagari words are OCR artifacts, not words
    if (/[\u0966-\u096F]/.test(cleanWord) || /^[\u093e-\u094f]/.test(cleanWord)) {
      return { correct: true, suggestions: [] };
    }
    const isOk = hindiDictionaryService.isCorrect(cleanWord, whitelist);
    if (isOk) {
      return { correct: true, suggestions: [] };
    }
    const suggestions = hindiDictionaryService.suggest(cleanWord, whitelist, 5);
    return { correct: false, suggestions };
  } else {
    // English contraction tolerance (OCR dropped apostrophe)
    if (COMMON_CONTRACTIONS.has(lowered)) {
      return { correct: true, suggestions: [] };
    }
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

  // Exclude pattern-tagged tokens (urls, emails, phones, hashtags, handles) from word-level spell check
  const PATTERN_URL_REGEX = /\b(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?(?:\/\S*)?\b/gi;
  const PATTERN_EMAIL_REGEX = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi;
  const PATTERN_PHONE_REGEX = /\b(?:\+?\d{1,3}[-\s]?)?\d{10}\b/g;
  const PATTERN_HASHTAG_REGEX = /#\w[\w]*/g;
  const PATTERN_HANDLE_REGEX = /(?<!\w)@\w[\w.]*/g;

  const textWithoutPatterns = text
    .replace(PATTERN_URL_REGEX, ' ')
    .replace(PATTERN_EMAIL_REGEX, ' ')
    .replace(PATTERN_PHONE_REGEX, ' ')
    .replace(PATTERN_HASHTAG_REGEX, ' ')
    .replace(PATTERN_HANDLE_REGEX, ' ');

  const matches = textWithoutPatterns.match(WORD_PATTERN);
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

    // Skip OCR noise and icon artifacts identified by garbageFilterService
    if (garbageFilterService.isGarbageToken(cleanWord, whitelistSet)) continue;

    const isHindi = isDevanagariWord(cleanWord);

    // Skip Hindi tokens containing numerals or invalid matras
    if (isHindi && (/[\u0966-\u096F]/.test(cleanWord) || /^[\u093e-\u094f]/.test(cleanWord))) continue;

    // Skip common English contractions without apostrophe (OCR dropped apostrophe)
    if (!isHindi && COMMON_CONTRACTIONS.has(cleanWord.toLowerCase())) continue;

    // Skip uppercase Latin acronyms (e.g. OPD, MBBS, DNB, IAP, PDF, NEUROLOGY)
    if (!isHindi && /^[A-Z]{2,8}$/.test(cleanWord)) continue;

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
