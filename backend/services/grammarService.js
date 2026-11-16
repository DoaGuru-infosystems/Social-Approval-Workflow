const path = require('path');
const dotenv = require('dotenv');

// Ensure env variables loaded
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const MODEL_NAME = 'gemini-flash-lite-latest';

// In-memory cache for grammar checks: key = `${lang}:${text.slice(0, 200)}`
const grammarCache = new Map();

/**
 * Detect language of text: 'hi' if Devanagari > 10%, else 'en'
 */
const detectTextLanguage = (text) => {
  if (!text || typeof text !== 'string') return 'en';
  const visible = text.replace(/\s+/g, '');
  if (!visible.length) return 'en';
  const devanagariCount = (text.match(/[\u0900-\u097f]/g) || []).length;
  return devanagariCount / visible.length > 0.1 ? 'hi' : 'en';
};

/**
 * Check grammar and spelling of caption, title, or poster OCR text using Google Gemini API.
 * For Hindi: Acts as the PRIMARY language engine for BOTH spelling & grammar.
 * For English: Acts as the PRIMARY language engine for BOTH spelling & grammar.
 * Fully dynamic: Client brand name and whitelist are loaded dynamically.
 *
 * @param {string} text
 * @param {string} [language] 'en', 'hi', or 'auto'
 * @param {Array<string>} [whitelist] Whitelist words to never flag as errors
 * @param {string} [brandName] Official brand name from DB
 * @returns {Promise<Array<{ original: string, suggestion: string, reason: string, type: 'grammar'|'spelling'|'grammar_error' }>>}
 */
const checkGrammar = async (text, language = 'auto', whitelist = [], brandName = '') => {
  if (!text || typeof text !== 'string' || text.trim().length < 5) {
    return [];
  }

  const cleanText = text.trim();
  const lang = language === 'auto' || !language ? detectTextLanguage(cleanText) : language;
  const validWhitelist = Array.isArray(whitelist)
    ? whitelist.map((w) => String(w).trim()).filter(Boolean)
    : [];
  const cleanBrand = (brandName || '').trim();
  const cacheKey = `${lang}:${cleanBrand}:${validWhitelist.slice(0, 5).join(',')}:${cleanText.slice(0, 200)}`;

  if (grammarCache.has(cacheKey)) {
    return grammarCache.get(cacheKey);
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_VISION_API_KEY;

  if (!apiKey) {
    console.warn('[GrammarService] GEMINI_API_KEY not found in environment.');
    return [
      {
        original: '',
        suggestion: '',
        reason: 'AI se check nahi hua, Dictionary se check kiya gaya',
        type: 'grammar_error',
        key_error: {
          service: 'gemini',
          code: 'GEMINI_KEY_EXPIRED',
          user_message: 'AI se check nahi hua, Dictionary se check kiya gaya',
        },
      },
    ];
  }

  try {
    let prompt;
    if (lang === 'hi') {
      const whitelistClause = validWhitelist.length > 0
        ? `\nIMPORTANT WHITELIST (ये शब्द आधिकारिक और सही हैं, इनको कभी अशुद्ध / गलत मत बोलना): ${validWhitelist.join(', ')}`
        : '';

      const brandClause = cleanBrand
        ? `\n- "${cleanBrand}" आधिकारिक ब्रांड नाम है। इसे कभी अशुद्ध मत बोलना और न ही अलग-अलग शब्दों में तोड़ना।`
        : '';

      prompt = `You are an expert Hindi copy editor and language (वर्तनी एवं व्याकरण) validator for professional marketing copy.
Critically evaluate the following Hindi text for BOTH:
1. Spelling Errors (वर्तनी / हिज्जे की अशुद्धियाँ): Misspelled Hindi words, missing or wrong matras (मात्रा दोष), missing or misplaced anuswar/chandrabindu (अनुस्वार / अनुनासिक). Mark "type": "spelling".
2. Grammar & Punctuation (व्याकरण एवं विराम-चिह्न):
   - Missing comma (अल्पविराम ',') after introductory clauses, proper viram-chinh (पूर्णविराम '।'), spacing around punctuation.
   - Word Order (पदक्रम): Standard Hindi SOV word order (clause verb must come at the end of the clause).
   Mark "type": "grammar".

RULES TO STRICTLY FOLLOW:${brandClause}
- Do NOT flag brand names, proper nouns, business/clinic names, doctor/specialist names, or valid hashtags as spelling errors; brand discrepancies are evaluated separately.
- Do NOT flag phone numbers, numbers, pin codes, or addresses.
${whitelistClause}
- If there are NO errors, return strictly [].

Input Text: "${cleanText.replace(/"/g, '\\"')}"

Return STRICT JSON as an array of objects matching this exact schema:
[
  {
    "original": "the exact misspelled or faulty word/phrase from the input",
    "suggestion": "the grammatically / orthographically corrected Hindi version",
    "reason": "clear explanation in Hindi or Hinglish describing the issue",
    "type": "spelling" | "grammar"
  }
]
If there are no issues at all, return []`;
    } else {
      const whitelistClause = validWhitelist.length > 0
        ? `\nIMPORTANT WHITELIST (these words are official and correct, do NOT flag them as spelling errors): ${validWhitelist.join(', ')}`
        : '';

      const brandClause = cleanBrand
        ? `\n- "${cleanBrand}" is the official client brand name. Do NOT split it into separate words or flag it as an error.`
        : '';

      prompt = `You are an expert copy editor and English language validator (Spelling, Grammar, Capitalization, and Syntax) for professional marketing copy.
Critically evaluate the following English text for BOTH:
1. Spelling Errors (pure spelling typos, e.g. "childern" -> "children", "healty" -> "healthy", "tommorow" -> "tomorrow"). Mark "type": "spelling".
2. Grammar, Punctuation & Capitalization (syntax flaws, improper mid-sentence capitalization like 'a Healthy Childhood' -> 'a healthy childhood', missing punctuation, subject-verb agreement). Mark "type": "grammar".

CRITICAL RULES TO FOLLOW:${brandClause}
- Do NOT flag official brand names, registered company names, or logos as simple spelling errors; any brand name or logo discrepancy is checked by an independent brand verification engine.
- Do NOT flag proper nouns, registered abbreviations/acronyms, doctor/specialist names, hashtags, phone numbers, or addresses as spelling errors.
${whitelistClause}
- If there are NO errors, return strictly [].

Input Text: "${cleanText.replace(/"/g, '\\"')}"
Language: English

Return STRICT JSON as an array of objects matching this exact schema:
[
  {
    "original": "the exact misspelled or faulty word/phrase from the input",
    "suggestion": "the grammatically / orthographically corrected version",
    "reason": "clear concise explanation of the spelling or grammatical issue",
    "type": "spelling" | "grammar"
  }
]
If there are no issues at all, return []`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;
    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          response_mime_type: 'application/json',
          temperature: 0.1,
        },
      }),
      signal: controller.signal,
    });

    if (res.status === 503) {
      // Retry once after 1.5s on temporary Google high demand spike
      await new Promise((r) => setTimeout(r, 1500));
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            response_mime_type: 'application/json',
            temperature: 0.1,
          },
        }),
      });
    }

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[GrammarService] Gemini returned ${res.status}: ${errText.slice(0, 150)}`);
      return [
        {
          original: '',
          suggestion: '',
          reason: 'AI se check nahi hua, Dictionary se check kiya gaya',
          type: 'grammar_error',
          key_error: {
            service: 'gemini',
            code: 'GEMINI_KEY_EXPIRED',
            user_message: 'AI se check nahi hua, Dictionary se check kiya gaya',
          },
        },
      ];
    }

    const data = await res.json();
    const rawOut = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawOut) return [];

    let parsed = JSON.parse(rawOut);
    if (!Array.isArray(parsed)) {
      if (parsed && typeof parsed === 'object') {
        parsed = parsed.suggestions || parsed.issues || parsed.grammar || [];
      } else {
        parsed = [];
      }
    }

    const normalized = parsed
      .filter((item) => item && (item.original || item.suggestion))
      .map((item) => ({
        original: String(item.original || '').trim(),
        suggestion: String(item.suggestion || '').trim(),
        reason: String(item.reason || (item.type === 'spelling' ? 'Spelling correction' : 'Grammar correction')).trim(),
        type: item.type === 'spelling' ? 'spelling' : 'grammar',
      }));

    grammarCache.set(cacheKey, normalized);
    return normalized;
  } catch (err) {
    console.warn('[GrammarService] Error checking grammar/spelling:', err.message);
    return [
      {
        original: '',
        suggestion: '',
        reason: 'AI se check nahi hua, Dictionary se check kiya gaya',
        type: 'grammar_error',
        key_error: {
          service: 'gemini',
          code: 'GEMINI_FALLBACK',
          user_message: 'AI se check nahi hua, Dictionary se check kiya gaya',
        },
      },
    ];
  }
};

module.exports = {
  checkGrammar,
  detectTextLanguage,
};
