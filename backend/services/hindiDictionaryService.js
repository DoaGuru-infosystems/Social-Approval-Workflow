const fs = require('fs');
const path = require('path');
const nspell = require('nspell');
const { distance } = require('fastest-levenshtein');

let cachedHindiSpeller = null;
let isInitialized = false;
let initPromise = null;
let globalWhitelistSet = new Set();
let hindiFrequencyMap = {};
let hindiMatraRules = {};
let hindiConfusionRules = [];
let hindiBarakhadiData = null;
let hindiEnglishPhoneticData = null;

const COMMON_WORDS_PATH = path.resolve(__dirname, '..', 'dictionaries', 'common_hindi_words.txt');
const FREQ_JSON_PATH = path.resolve(__dirname, '..', 'dictionaries', 'hindi_word_frequency.json');
const MATRA_RULES_PATH = path.resolve(__dirname, '..', 'dictionaries', 'hindi_matra_rules.json');
const CONFUSION_RULES_PATH = path.resolve(__dirname, '..', 'dictionaries', 'confusion_rules.json');
const BARAKHADI_JSON_PATH = path.resolve(__dirname, '..', 'dictionaries', 'hindi_barakhadi.json');
const PHONETIC_JSON_PATH = path.resolve(__dirname, '..', 'dictionaries', 'hindi_english_phonetic.json');

const DEVANAGARI_CONSONANTS_SET = new Set([
  ...'कखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसहक़ख़ग़ज़ड़ढ़फ़य़'
]);
const DEVANAGARI_VOWEL_SIGNS_SET = new Set([
  ...'ािीुूृॄॅॆेैॉॊोौ'
]);
const DEVANAGARI_ALL_MATRAS_SET = new Set([
  ...'ािीुूृॄॅॆेैॉॊोौंःँ्'
]);

/**
 * Loads common_hindi_words.txt into globalWhitelistSet
 */
const loadGlobalWhitelist = () => {
  try {
    const candidatePaths = [
      COMMON_WORDS_PATH,
      path.resolve(__dirname, '..', '..', 'common_hindi_words.txt'),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8');
        const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (const w of lines) {
          globalWhitelistSet.add(w.toLowerCase());
          globalWhitelistSet.add(w);
        }
      }
    }
  } catch (err) {
    console.warn('[hindiDictionaryService] Notice loading common_hindi_words.txt:', err.message);
  }
};

/**
 * Loads hindi_word_frequency.json into memory
 */
const loadHindiWordFrequency = () => {
  try {
    const candidatePaths = [
      FREQ_JSON_PATH,
      path.resolve(__dirname, '..', '..', 'hindi_word_frequency.json'),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8');
        hindiFrequencyMap = JSON.parse(content);
        break;
      }
    }
  } catch (err) {
    console.warn('[hindiDictionaryService] Notice loading hindi_word_frequency.json:', err.message);
  }
};

/**
 * Loads hindi_matra_rules.json into memory
 */
const loadHindiMatraRules = () => {
  try {
    const candidatePaths = [
      MATRA_RULES_PATH,
      path.resolve(__dirname, '..', '..', 'hindi_matra_rules.json'),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8');
        hindiMatraRules = JSON.parse(content);
        break;
      }
    }
  } catch (err) {
    console.warn('[hindiDictionaryService] Notice loading hindi_matra_rules.json:', err.message);
  }
};

/**
 * Loads confusion_rules.json into memory
 */
const loadConfusionRules = () => {
  try {
    const candidatePaths = [
      CONFUSION_RULES_PATH,
      path.resolve(__dirname, '..', '..', 'confusion_rules.json'),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(content);
        hindiConfusionRules = Array.isArray(parsed) ? parsed : (parsed.rules || []);
        break;
      }
    }
  } catch (err) {
    console.warn('[hindiDictionaryService] Notice loading confusion_rules.json:', err.message);
  }
};

/**
 * Loads hindi_barakhadi.json into memory
 */
const loadHindiBarakhadi = () => {
  try {
    const candPaths = [
      BARAKHADI_JSON_PATH,
      path.resolve(__dirname, '..', '..', 'hindi_barakhadi.json'),
    ];
    for (const p of candPaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8');
        hindiBarakhadiData = JSON.parse(content);
        break;
      }
    }
  } catch (err) {
    console.warn('[hindiDictionaryService] Notice loading hindi_barakhadi.json:', err.message);
  }
};

/**
 * Loads hindi_english_phonetic.json into memory
 */
const loadHindiEnglishPhonetic = () => {
  try {
    const candPaths = [
      PHONETIC_JSON_PATH,
      path.resolve(__dirname, '..', '..', 'hindi_english_phonetic.json'),
    ];
    for (const p of candPaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8');
        hindiEnglishPhoneticData = JSON.parse(content);
        break;
      }
    }
  } catch (err) {
    console.warn('[hindiDictionaryService] Notice loading hindi_english_phonetic.json:', err.message);
  }
};

/**
 * Structural Validation Layer using hindi_barakhadi.json.
 * Validates if an OCR word is structurally possible in Hindi.
 * If not (like 'नः'), flag it for review. Do NOT use for auto-correction!
 * @param {string} word
 * @returns {{ isValid: boolean, reason: string }}
 */
const validateHindiWordStructure = (word) => {
  if (!word || typeof word !== 'string' || !/[\u0900-\u097f]/.test(word)) {
    return { isValid: true, reason: '' };
  }

  const clean = word.trim();
  if (clean.length === 0) return { isValid: true, reason: '' };

  // Check 1: Leading matra or modifier
  if (DEVANAGARI_ALL_MATRAS_SET.has(clean[0])) {
    return { isValid: false, reason: `Invalid leading matra/sign '${clean[0]}'` };
  }

  // Check 2: 'नः' as standalone word or anomalous prefix before consonant (PaddleOCR drop of short-i)
  if (clean === 'नः') {
    return { isValid: false, reason: "Structurally impossible standalone syllable 'नः' (visarga artifact)" };
  }
  if (clean.startsWith('नः') && clean.length > 2 && DEVANAGARI_CONSONANTS_SET.has(clean[2])) {
    return { isValid: false, reason: "Structurally impossible prefix 'नः' before consonant (missing matra)" };
  }

  // Check 3: Visarga position
  for (let idx = 0; idx < clean.length; idx++) {
    if (clean[idx] === '\u0903') { // ः
      if (idx === 0) {
        return { isValid: false, reason: 'Visarga cannot start a word' };
      }
      if (idx + 1 < clean.length && DEVANAGARI_VOWEL_SIGNS_SET.has(clean[idx + 1])) {
        return { isValid: false, reason: `Visarga followed by vowel sign '${clean[idx + 1]}'` };
      }
    }
  }

  // Check 4: Consecutive vowel signs
  let prevVowelSign = false;
  for (let idx = 0; idx < clean.length; idx++) {
    const isVowelSign = DEVANAGARI_VOWEL_SIGNS_SET.has(clean[idx]);
    if (isVowelSign && prevVowelSign) {
      return { isValid: false, reason: 'Consecutive vowel signs' };
    }
    prevVowelSign = isVowelSign;
  }

  // Check 5: Consecutive halants
  if (clean.includes('\u094D\u094D')) {
    return { isValid: false, reason: 'Consecutive halants' };
  }

  return { isValid: true, reason: '' };
};

/**
 * Visual Rule Engine for Hindi Devanagari words.
 * Analyzes matra positioning, consecutive vowel signs, and generates replacement candidates.
 * @param {string} word
 * @returns {{ isValid: boolean, issues: string[], candidates: string[] }}
 */
const analyzeHindiWord = (word) => {
  if (!word || typeof word !== 'string' || !/[\u0900-\u097f]/.test(word)) {
    return { isValid: true, issues: [], candidates: [] };
  }

  const clean = word.trim();
  const issues = [];
  const candidates = [];

  let prevIsConsonant = false;
  let prevIsVowelSign = false;
  let prevChar = '';

  for (let idx = 0; idx < clean.length; idx++) {
    const ch = clean[idx];
    const isConsonant = DEVANAGARI_CONSONANTS_SET.has(ch);
    const isVowelSign = DEVANAGARI_VOWEL_SIGNS_SET.has(ch);

    // Rule 1: A matra like \u093F (ि) or \u0903 (ः) must be preceded by a consonant
    if (ch === 'ि' || ch === 'ः') {
      if (idx === 0 || !prevIsConsonant) {
        issues.push(`invalid_matra_position: '${ch}' at index ${idx}`);
      }
    }

    // Rule 2: Consecutive vowel signs (e.g. \u093F followed by \u0941)
    if (isVowelSign && prevIsVowelSign) {
      issues.push(`consecutive_matras: '${prevChar}' followed by '${ch}' at index ${idx}`);
    }

    prevChar = ch;
    prevIsConsonant = isConsonant;
    prevIsVowelSign = isVowelSign;
  }

  // Rule 3: Visarga check & replacement candidates
  if (clean.includes('ः')) {
    issues.push('visarga_confusion');
    const matrasConfig = hindiMatraRules.matras || {};
    const confusedWith = matrasConfig['ः']?.confused_with || ['ि', 'ी'];
    for (const cMatra of confusedWith) {
      candidates.push(clean.replace(/ः/g, cMatra));
    }
    if (clean.startsWith('नः')) {
      const pref = 'निः' + clean.slice(2);
      candidates.push(pref);
      candidates.push(pref.replace('शुलक', 'शुल्क'));
    }
  }

  // Halant conjunct candidates (Phase 3)
  if (clean.includes('कष')) {
    candidates.push(clean.replace(/कष/g, 'क्ष'));
  }
  if (clean.includes('शुलक')) {
    candidates.push(clean.replace(/शुलक/g, 'शुल्क'));
  }
  if (clean.includes('सुंबह')) {
    candidates.push('सुबह');
  }

  // Check confusion rules for any direct candidate matches
  for (const rule of hindiConfusionRules) {
    if (rule.pattern === clean && rule.replacement) {
      candidates.push(rule.replacement);
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
    candidates: Array.from(new Set(candidates)),
  };
};

/**
 * Adds a verified word to global whitelist and appends to common_hindi_words.txt.
 * @param {string} word
 * @returns {boolean}
 */
const addWordToGlobalWhitelist = (word) => {
  if (!word || typeof word !== 'string') return false;
  const clean = word.trim();
  if (!clean) return false;

  const low = clean.toLowerCase();
  if (globalWhitelistSet.has(low) || globalWhitelistSet.has(clean)) {
    return false; // Already present
  }

  globalWhitelistSet.add(low);
  globalWhitelistSet.add(clean);

  try {
    const dir = path.dirname(COMMON_WORDS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(COMMON_WORDS_PATH, `\n${clean}`, 'utf8');

    const rootPath = path.resolve(__dirname, '..', '..', 'common_hindi_words.txt');
    if (fs.existsSync(path.dirname(rootPath))) {
      fs.appendFileSync(rootPath, `\n${clean}`, 'utf8');
    }
  } catch (err) {
    console.error('[hindiDictionaryService] Failed to append word to common_hindi_words.txt:', err.message);
  }
  return true;
};

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
    loadGlobalWhitelist();
    loadHindiWordFrequency();
    loadHindiMatraRules();
    loadConfusionRules();
    loadHindiBarakhadi();
    loadHindiEnglishPhonetic();

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

  const low = clean.toLowerCase();

  // 1. Human-in-the-Loop Global Whitelist (return true immediately)
  if (globalWhitelistSet.has(low) || globalWhitelistSet.has(clean)) {
    return true;
  }

  // 2. Client Whitelist (case-insensitive)
  if (whitelist) {
    if (whitelist instanceof Set && (whitelist.has(low) || whitelist.has(clean))) return true;
    if (Array.isArray(whitelist) && whitelist.some((w) => typeof w === 'string' && w.toLowerCase() === low)) {
      return true;
    }
  }

  // 3. High-Frequency Hindi Word Corpus Check
  if (hindiFrequencyMap && (hindiFrequencyMap[clean] || hindiFrequencyMap[low])) {
    return true;
  }

  if (!cachedHindiSpeller) {
    throw new Error('Hindi dictionary not initialized. Call initHindiDictionary() first.');
  }

  // 4. nspell dictionary exact check
  if (cachedHindiSpeller.correct(clean) || cachedHindiSpeller.correct(low)) {
    return true;
  }

  return false;
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
  const candidatePool = new Set(rawSuggestions);

  // Add candidates from Visual Rule Engine (matra rules, halant conjuncts, confusion rules)
  const analysis = analyzeHindiWord(clean);
  for (const cand of analysis.candidates) {
    if (typeof cand === 'string' && cand !== clean) {
      candidatePool.add(cand);
    }
  }

  // Loanword Phonetic Suggestions (hindi_english_phonetic.json)
  // CRITICAL CONSTRAINT: Suggestions ONLY, never auto-correct!
  if (hindiEnglishPhoneticData && Array.isArray(hindiEnglishPhoneticData.loanwords)) {
    const cleanLower = clean.toLowerCase();
    for (const pair of hindiEnglishPhoneticData.loanwords) {
      const eng = String(pair.english || '').toLowerCase();
      const hiList = Array.isArray(pair.hindi) ? pair.hindi : [pair.hindi];

      // If word matches English loanword or close to it, suggest standard Hindi form
      if (cleanLower === eng || distance(cleanLower, eng) <= 2) {
        hiList.forEach((h) => candidatePool.add(h));
      }
      // If word matches Hindi loanword or close to it, suggest correct Hindi forms
      for (const h of hiList) {
        if (typeof h === 'string' && (clean === h || distance(clean, h) <= 2)) {
          hiList.forEach((alt) => candidatePool.add(alt));
        }
      }
    }
  }

  // Add close candidates from whitelist and global whitelist if any
  if (whitelist) {
    const list = Array.isArray(whitelist) ? whitelist : Array.from(whitelist);
    for (const item of list) {
      if (typeof item === 'string' && distance(clean, item) <= 2) {
        candidatePool.add(item);
      }
    }
  }
  for (const item of globalWhitelistSet) {
    if (typeof item === 'string' && distance(clean, item) <= 2) {
      candidatePool.add(item);
    }
  }

  // Sort by Levenshtein distance, with bonus for words in frequency map
  const sorted = Array.from(candidatePool).sort((a, b) => {
    const distA = distance(clean, a);
    const distB = distance(clean, b);
    if (distA !== distB) return distA - distB;
    const freqA = hindiFrequencyMap[a] || 0;
    const freqB = hindiFrequencyMap[b] || 0;
    return freqB - freqA;
  });

  return sorted.slice(0, maxSuggestions);
};

/**
 * Generic phone number normalization:
 * If an extracted 10-digit number is within 1-2 edit distance from any registered expected phone from DB,
 * normalizes it to that expected phone without any hardcoding.
 */
const normalizePhonesWithExpected = (text, expectedPhones = []) => {
  if (!text || typeof text !== 'string') return text || '';
  if (!expectedPhones || expectedPhones.length === 0) return text;

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
  analyzeHindiWord,
  validateHindiWordStructure,
  isStructurallyValidHindi: (w) => validateHindiWordStructure(w).isValid,
  normalizePhonesWithExpected,
  addWordToGlobalWhitelist,
  getGlobalWhitelist: () => Array.from(globalWhitelistSet),
  isInitialized: () => isInitialized,
};
