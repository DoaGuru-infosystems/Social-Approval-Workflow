const path = require('path');
const dotenv = require('dotenv');
const openRouterService = require('./openRouterService');

// Ensure env variables loaded
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const CANDIDATE_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3-flash-preview',
  'gemini-flash-latest',
];

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
 * @param {Object} [gmbData] Optional GMB snapshot / auto-whitelist data
 * @returns {Promise<Array<{ original: string, suggestion: string, reason: string, type: 'grammar'|'spelling'|'grammar_error' }>>}
 */
const checkGrammar = async (text, language = 'auto', whitelist = [], brandName = '', gmbData = null) => {
  if (!text || typeof text !== 'string' || text.trim().length < 5) {
    return [];
  }

  const cleanText = text.trim();
  const lang = language === 'auto' || !language ? detectTextLanguage(cleanText) : language;
  const validWhitelist = Array.isArray(whitelist)
    ? whitelist.map((w) => String(w).trim()).filter(Boolean)
    : [];
  const cleanBrand = (brandName || '').trim();
  const gmbOfficialName = (gmbData?.officialName || '').trim();
  const cacheKey = `${lang}:${cleanBrand}:${gmbOfficialName}:${validWhitelist.slice(0, 5).join(',')}:${cleanText.slice(0, 200)}`;

  if (grammarCache.has(cacheKey)) {
    return grammarCache.get(cacheKey);
  }

  const tryOpenRouterFallback = async (primaryFailReason = 'Gemini unavailable/failed') => {
    if (openRouterService.isKeyConfigured()) {
      try {
        const configuredModel = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
        console.log(`\n🔄 [TEXT CHECK - TRIGGERING FALLBACK 1: OpenRouter AI]`);
        console.log(`   Engine: OpenRouter API (Model: ${configuredModel})`);
        console.log(`   Reason: Primary Gemini failed (${primaryFailReason})`);
        console.log(`   Checking: Spelling & Grammar in ${lang === 'hi' ? 'Hindi' : 'English'} copy...`);

        const orResult = await openRouterService.checkGrammarOpenRouter(
          cleanText,
          lang,
          validWhitelist,
          cleanBrand,
          gmbData
        );
        console.log(`✔ [TEXT CHECK - FALLBACK 1 SUCCESS: OpenRouter AI] Processed successfully (${orResult.length} issue(s) detected).`);
        grammarCache.set(cacheKey, orResult);
        return orResult;
      } catch (orErr) {
        console.warn(`✖ [TEXT CHECK - FALLBACK 1 FAILED: OpenRouter AI] Error: ${orErr.message}`);
      }
    } else {
      console.log(`⚠️ [TEXT CHECK - FALLBACK 1 SKIPPED] OPENROUTER_API_KEY is not configured.`);
    }

    console.log(`\n🔄 [TEXT CHECK - TRIGGERING FALLBACK 2 (BACKUP): Node Local Dictionary Engine]`);
    console.log(`   Backup Name: Node Hunspell / nspell Dictionary Engine`);
    console.log(`   Checking: Pure spelling against offline word lists (Grammar checking unavailable in dictionary mode).`);
    return null;
  };

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();

  if (!apiKey) {
    console.warn('\n⚠️ [TEXT CHECK - PRIMARY SKIPPED: Google Gemini AI] GEMINI_API_KEY not found in environment.');
    const orResult = await tryOpenRouterFallback('GEMINI_API_KEY missing');
    if (orResult !== null) return orResult;

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
    let gmbClause = '';
    if (gmbData && (gmbOfficialName || (Array.isArray(gmbData.autoWhitelist) && gmbData.autoWhitelist.length > 0))) {
      const gmbTokens = Array.isArray(gmbData.autoWhitelist) ? gmbData.autoWhitelist.join(', ') : '';
      gmbClause = `\nGOOGLE MY BUSINESS (GMB) OFFICIAL DATA:
- GMB Official Name: "${gmbOfficialName}"
${gmbTokens ? `- GMB Derived Keywords: ${gmbTokens}` : ''}
IMPORTANT PRECEDENCE RULE: If MANUAL and GMB differ, treat GMB as ground truth for brand name, but NEVER flag manual whitelist words as error.`;
    }

    let prompt;
    if (lang === 'hi') {
      const whitelistClause = validWhitelist.length > 0
        ? `\nIMPORTANT WHITELIST (ये शब्द आधिकारिक और सही हैं, इनको कभी अशुद्ध / गलत मत बोलना): ${validWhitelist.join(', ')}`
        : '';

      const brandClause = cleanBrand
        ? `\n- "${cleanBrand}" आधिकारिक ब्रांड नाम है। इसे कभी अशुद्ध मत बोलना और न ही अलग-अलग शब्दों में तोड़ना।`
        : '';

      prompt = `You are an expert Hindi copy editor and language (वर्तनी एवं व्याकरण) validator for professional marketing copy.
Critically evaluate the following Hindi text for genuine language errors.

IMPORTANT OCR AWARENESS:
The text may originate from poster OCR transcription. OCR may sometimes fragment characters or split ligatures (e.g. 'वृिदवि', 'संतुिलत', 'हािदेक', 'बचोंकी', 'ाइए').
- If a word appears imperfect due to OCR ligature splitting or visual font artifacts (e.g. 'ाइए' for 'आइए', 'वृिदवि' for 'वृद्धि'), DO NOT flag it as a human spelling error. Treat it as an OCR artifact.
- ONLY flag a spelling error when a word is unambiguously misspelled in human writing (e.g., clear incorrect letters like 'दवस' instead of 'दिवस').
- Do NOT flag common and valid Hindi words (such as 'शुभकामनाएँ', 'स्वास्थ्य', 'आइए') as spelling errors.
- NEVER fabricate unnatural or incorrect suggestions (e.g., NEVER suggest 'शुभकामनाएओँ' for 'शुभकामनाएँ').
- If there is NO genuine error, return strictly []. Do not force unnecessary suggestions.

EVALUATION CRITERIA:
1. Spelling Errors (वर्तनी / हिज्जे की वास्तविक अशुद्धियाँ): Mark "type": "spelling".
2. Grammar & Punctuation (व्याकरण एवं विराम-चिह्न):
   - Missing comma after introductory clauses, viram-chinh (।), proper spacing.
   - Word Order (पदक्रम): Clause verb must come at the end of the clause.
   Mark "type": "grammar".

RULES TO STRICTLY FOLLOW:${brandClause}${gmbClause}
- Do NOT flag brand names, proper nouns, company/organization names, person names and professional titles, professional qualifications/degrees (e.g. CA, BTech, MBBS, PhD), or valid hashtags as spelling errors; brand discrepancies are evaluated separately.
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
2. Grammar, Punctuation & Capitalization (syntax flaws, improper mid-sentence capitalization like 'a Great Season' -> 'a great season', missing punctuation, subject-verb agreement). Mark "type": "grammar".

CRITICAL RULES TO FOLLOW:${brandClause}${gmbClause}
- Do NOT flag official brand names, registered company names, or logos as simple spelling errors; any brand name or logo discrepancy is checked by an independent brand verification engine.
- Do NOT flag proper nouns, registered abbreviations/acronyms, person/specialist names, professional titles, hashtags, phone numbers, or addresses as spelling errors.
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

    let res;
    let lastErrorText = '';
    const requestPayload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        response_mime_type: 'application/json',
        temperature: 0.1,
      },
    });

    console.log(`\n▶ [TEXT CHECK - PRIMARY: Google Gemini AI]`);
    console.log(`   Engine: Google Gemini Flash (${lang === 'hi' ? 'Hindi वर्तनी व व्याकरण' : 'English Spelling & Grammar'})`);
    console.log(`   Checking: Copy length ${cleanText.length} chars (Whitelist: ${validWhitelist.length} terms)`);

    for (const modelName of CANDIDATE_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestPayload,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.status === 503 || res.status === 429) {
          console.warn(`  [Gemini Model] ${modelName} returned status ${res.status}. Trying next candidate model...`);
          continue;
        }

        if (res.ok) {
          break;
        } else {
          lastErrorText = await res.text().catch(() => '');
          if (res.status === 400 || res.status === 401 || res.status === 403 || /api_key|expired|billing|unauthorized/i.test(lastErrorText)) {
            break;
          }
        }
      } catch (fetchErr) {
        clearTimeout(timeout);
        lastErrorText = fetchErr.message;
      }
    }

    if (!res || !res.ok) {
      const errText = await res?.text().catch(() => '') || lastErrorText || 'Network/timeout';
      console.warn(`✖ [TEXT CHECK - PRIMARY FAILED: Google Gemini AI] HTTP ${res?.status || 'ERR'}: ${errText.slice(0, 150)}`);

      const orResult = await tryOpenRouterFallback(`Gemini HTTP ${res?.status || 'ERR'}`);
      if (orResult !== null) return orResult;

      const isKeyErr = res?.status === 400 || res?.status === 401 || res?.status === 403 || /api_key|expired|billing|unauthorized/i.test(errText);
      if (isKeyErr) {
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
      return [];
    }

    const data = await res.json();
    const rawOut = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawOut) {
      console.log(`✔ [TEXT CHECK - PRIMARY SUCCESS: Google Gemini AI] Clean response (0 issues found).`);
      return [];
    }

    let parsed = [];
    try {
      parsed = JSON.parse(rawOut);
    } catch {
      const match = rawOut.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch { parsed = []; }
      }
    }

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
        source: 'gemini_ai',
      }));

    console.log(`✔ [TEXT CHECK - PRIMARY SUCCESS: Google Gemini AI] Processed successfully (${normalized.length} issue(s) found).`);
    grammarCache.set(cacheKey, normalized);
    return normalized;
  } catch (err) {
    console.warn(`✖ [TEXT CHECK - PRIMARY FAILED: Google Gemini AI] Error: ${err.message}`);

    const orResult = await tryOpenRouterFallback(err.message);
    if (orResult !== null) return orResult;

    const isHardKeyError = /api_key|expired|billing|permission|unauthorized|401|403/i.test(err.message);
    if (isHardKeyError) {
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
    return [];
  }
};

module.exports = {
  checkGrammar,
  detectTextLanguage,
};
