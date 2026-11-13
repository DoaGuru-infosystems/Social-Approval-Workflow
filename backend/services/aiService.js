const nspell = require('nspell');
const { createWorker } = require('tesseract.js');
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');

let spellEnInstance = null;
let spellHiInstance = null;

// Initialize English spellchecker
const getEnglishChecker = async () => {
  if (!spellEnInstance) {
    const { default: dictionaryEn } = await import('dictionary-en');
    spellEnInstance = nspell(dictionaryEn);
  }
  return spellEnInstance;
};

// Initialize Hindi spellchecker
const getHindiChecker = async () => {
  if (!spellHiInstance) {
    const { default: dictionaryHi } = await import('@ashukr321/typefix-dictionary-hi');
    spellHiInstance = nspell(dictionaryHi);
  }
  return spellHiInstance;
};

/**
 * Fetch Brand Guidelines for a specific Client
 * @param {number} clientId
 * @returns {Promise<{whitelist: string[], banned: string[], mandatory: string[]}>}
 */
const getClientGuidelines = async (clientId) => {
  if (!clientId) {
    return { whitelist: [], banned: [], mandatory: [] };
  }

  try {
    const [rows] = await pool.query(
      'SELECT whitelist_words, banned_words, mandatory_phrases FROM client_brand_guidelines WHERE client_id = ?',
      [clientId]
    );

    if (rows.length === 0) {
      return { whitelist: [], banned: [], mandatory: [] };
    }

    const g = rows[0];
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

    return {
      whitelist: parseList(g.whitelist_words),
      banned: parseList(g.banned_words),
      mandatory: parseList(g.mandatory_phrases),
    };
  } catch (err) {
    console.error(`Error loading brand guidelines for client ${clientId}:`, err);
    return { whitelist: [], banned: [], mandatory: [] };
  }
};

/**
 * Check spelling of given text with Hindi + English script-based routing and whitelist support
 * @param {string} text
 * @param {string[]} whitelist
 * @returns {Promise<Array<{word: string, script: string, suggestions: string[]}>>}
 */
const checkBilingualSpelling = async (text, whitelist = []) => {
  if (!text || typeof text !== 'string') return [];

  const spellEn = await getEnglishChecker();
  const spellHi = await getHindiChecker();

  // Load whitelist words into spellcheckers
  const whitelistLowerSet = new Set();
  whitelist.forEach((w) => {
    if (typeof w === 'string' && w.trim()) {
      const cleanW = w.trim();
      whitelistLowerSet.add(cleanW.toLowerCase());
      try {
        spellEn.add(cleanW);
        spellHi.add(cleanW);
      } catch {
        // ignore duplicate add errors
      }
    }
  });

  // Split text by whitespace
  const rawWords = text.split(/\s+/).filter(Boolean);
  const checked = new Set();
  const issues = [];

  for (const raw of rawWords) {
    // 1. Detect Devanagari script characters (U+0900 to U+097F)
    if (/[\u0900-\u097F]/.test(raw)) {
      // Clean leading/trailing punctuation
      const cleanHindi = raw.replace(/^[^\u0900-\u097F]+|[^\u0900-\u097F]+$/g, '').trim();
      if (!cleanHindi || cleanHindi.length < 2 || checked.has(cleanHindi)) continue;
      checked.add(cleanHindi);

      // Check if word is whitelisted
      if (whitelistLowerSet.has(cleanHindi.toLowerCase())) continue;

      // Check Hindi spelling
      if (!spellHi.correct(cleanHindi)) {
        const suggestions = spellHi.suggest(cleanHindi).slice(0, 5);
        issues.push({
          word: cleanHindi,
          script: 'Hindi',
          suggestions,
        });
      }
      continue;
    }

    // 2. Detect pure Latin/English characters
    const cleanLatin = raw.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '').trim();
    if (cleanLatin && /^[A-Za-z]{2,}$/.test(cleanLatin)) {
      const lowerLatin = cleanLatin.toLowerCase();
      if (checked.has(lowerLatin)) continue;
      checked.add(lowerLatin);

      // Check if word is whitelisted
      if (whitelistLowerSet.has(lowerLatin)) continue;

      // Check English spelling
      if (!spellEn.correct(cleanLatin) && !spellEn.correct(lowerLatin)) {
        const suggestions = spellEn.suggest(cleanLatin).slice(0, 5);
        issues.push({
          word: cleanLatin,
          script: 'English',
          suggestions,
        });
      }
      continue;
    }

    // 3. Numbers, symbols, emoji, or punctuation -> SKIP per prompt rules
  }

  return issues;
};

/**
 * Scan text for Banned Words (case-insensitive)
 * @param {string} fullText
 * @param {string[]} bannedWords
 * @returns {string[]}
 */
const checkBannedWords = (fullText, bannedWords = []) => {
  if (!fullText || !Array.isArray(bannedWords) || bannedWords.length === 0) return [];

  const lowerText = fullText.toLowerCase();
  const found = [];

  for (const word of bannedWords) {
    if (!word || typeof word !== 'string') continue;
    const cleanWord = word.trim().toLowerCase();
    if (!cleanWord) continue;

    // Use word boundary for Latin words, or substring match for Unicode
    let matched = false;
    if (/^[A-Za-z0-9\s_-]+$/.test(cleanWord)) {
      const escaped = cleanWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^A-Za-z0-9])`, 'i');
      matched = regex.test(lowerText);
    } else {
      matched = lowerText.includes(cleanWord);
    }

    if (matched && !found.includes(word.trim())) {
      found.push(word.trim());
    }
  }

  return found;
};

/**
 * Check if required mandatory phrases are present in the post caption
 * @param {string} caption
 * @param {string[]} mandatoryPhrases
 * @returns {string[]} missing phrases
 */
const checkMandatoryPhrases = (caption, mandatoryPhrases = []) => {
  if (!Array.isArray(mandatoryPhrases) || mandatoryPhrases.length === 0) return [];
  const lowerCaption = (caption || '').toLowerCase();
  const missing = [];

  for (const phrase of mandatoryPhrases) {
    if (!phrase || typeof phrase !== 'string') continue;
    const cleanPhrase = phrase.trim();
    if (!cleanPhrase) continue;

    if (!lowerCaption.includes(cleanPhrase.toLowerCase())) {
      missing.push(cleanPhrase);
    }
  }

  return missing;
};

/**
 * Extract text from an image using Tesseract.js (Both English + Hindi simultaneously: 'eng+hin')
 * @param {string} imagePath
 * @returns {Promise<string>}
 */
const extractImageText = async (imagePath) => {
  if (!imagePath || !fs.existsSync(imagePath)) {
    return '';
  }

  // Tesseract.js always loaded with both English and Hindi scripts: ['eng', 'hin']
  const worker = await createWorker(['eng', 'hin']);
  try {
    const result = await worker.recognize(imagePath);
    return (result.data.text || '').trim();
  } catch (err) {
    console.error('Tesseract OCR error:', err);
    return '';
  } finally {
    await worker.terminate();
  }
};

/**
 * Comprehensive AI Quality Check for a Post with Multi-Client Brand Guidelines
 * @param {Object} params
 * @param {number} [params.clientId]
 * @param {string} [params.title]
 * @param {string} [params.caption]
 * @param {string} [params.imagePath]
 */
const runAiCheck = async ({ clientId = null, title = '', caption = '', imagePath = null }) => {
  // 1. Fetch Client Brand Guidelines (whitelist, banned, mandatory)
  const guidelines = await getClientGuidelines(clientId);

  // Combine title + caption for spellchecking
  const postTextToCheck = `${title || ''}\n${caption || ''}`.trim();

  // 2. Bilingual Script-Based Spelling Check with Whitelist
  const spellingIssues = await checkBilingualSpelling(postTextToCheck, guidelines.whitelist);

  // 3. OCR Processing with 'eng+hin' simultaneous language models
  let ocrExtractedText = '';
  let ocrIssues = [];

  let resolvedImagePath = imagePath;
  if (imagePath && !path.isAbsolute(imagePath)) {
    resolvedImagePath = path.join(__dirname, '..', imagePath);
  }

  if (resolvedImagePath && fs.existsSync(resolvedImagePath)) {
    ocrExtractedText = await extractImageText(resolvedImagePath);
    if (ocrExtractedText) {
      ocrIssues = await checkBilingualSpelling(ocrExtractedText, guidelines.whitelist);
    }
  }

  // 4. Banned Words Check across Title + Caption + OCR Text
  const aggregateContent = `${title || ''} ${caption || ''} ${ocrExtractedText || ''}`;
  const bannedWordsFound = checkBannedWords(aggregateContent, guidelines.banned);

  // 5. Mandatory Phrases Check in Caption
  const missingMandatoryPhrases = checkMandatoryPhrases(caption, guidelines.mandatory);

  // 6. Overall Verification Status
  const hasSpellingIssues = spellingIssues.length > 0;
  const hasBannedWords = bannedWordsFound.length > 0;
  const hasMissingMandatory = missingMandatoryPhrases.length > 0;
  const passed = !hasSpellingIssues && !hasBannedWords && !hasMissingMandatory;

  // Build human-friendly summary
  let summary = 'Verified Clean';
  if (hasBannedWords) {
    summary = `Flagged: Banned brand terms found (${bannedWordsFound.join(', ')})`;
  } else if (hasMissingMandatory) {
    summary = `Warning: Missing mandatory phrase (${missingMandatoryPhrases.join(', ')})`;
  } else if (hasSpellingIssues) {
    summary = `Spelling: ${spellingIssues.length} issue(s) detected`;
  }

  return {
    passed,
    summary,
    engine: 'Bilingual Engine (nspell Devanagari/Latin + Tesseract.js eng+hin)',
    spelling_issues: spellingIssues,
    ocr_extracted_text: ocrExtractedText,
    ocr_issues: ocrIssues,
    banned_words_found: bannedWordsFound,
    missing_mandatory_phrases: missingMandatoryPhrases,
    brand_rules_applied: {
      client_id: clientId,
      whitelist_count: guidelines.whitelist.length,
      banned_words_checked: guidelines.banned.length,
      mandatory_phrases_checked: guidelines.mandatory.length,
    },
  };
};

module.exports = {
  getEnglishChecker,
  getHindiChecker,
  getClientGuidelines,
  checkBilingualSpelling,
  checkBannedWords,
  checkMandatoryPhrases,
  extractImageText,
  runAiCheck,
};
