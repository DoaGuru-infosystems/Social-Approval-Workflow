const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { buildPostCheckPrompt } = require('./postCheckPrompt');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

/**
 * Check whether OPENROUTER_API_KEY is configured and valid
 */
const isKeyConfigured = () => {
  const key = (process.env.OPENROUTER_API_KEY || '').trim();
  if (!key) return false;
  const k = key.toLowerCase();
  return !(k.startsWith('dummy') || k.startsWith('test') || k === 'your_openrouter_api_key');
};

let sharp;
try {
  sharp = require('sharp');
} catch (_) {
  sharp = null;
}

/**
 * Preprocess and normalize image buffer for OpenRouter / OpenAI Vision:
 * - Downscales if max dimension > 1600 (prevents OpenAI 400 "unsupported image" / image_parse_error)
 * - Converts non-standard formats to optimized PNG or JPEG
 */
const prepareVisionBuffer = async (buffer, mimeType, maxSide = 1600) => {
  if (!buffer || buffer.length === 0 || !sharp) {
    return { buffer, mimeType };
  }

  try {
    const meta = await sharp(buffer).metadata();
    const width = meta.width || 1000;
    const height = meta.height || 1000;
    const maxDim = Math.max(width, height);

    if (maxDim > maxSide || (meta.format !== 'jpeg' && meta.format !== 'png' && meta.format !== 'webp')) {
      const isPng = meta.format === 'png' || meta.hasAlpha;
      let pipeline = sharp(buffer).resize({
        width: maxSide,
        height: maxSide,
        fit: 'inside',
        withoutEnlargement: true,
      });

      if (isPng) {
        const outBuf = await pipeline.png({ quality: 85, compressionLevel: 6 }).toBuffer();
        return { buffer: outBuf, mimeType: 'image/png' };
      } else {
        const outBuf = await pipeline.jpeg({ quality: 85 }).toBuffer();
        return { buffer: outBuf, mimeType: 'image/jpeg' };
      }
    }
  } catch (err) {
    console.warn('[openRouterService] Vision buffer prep notice:', err.message);
  }

  return { buffer, mimeType };
};

/**
 * Foolproof asset path resolver across Windows and POSIX environments.
 */
const resolveAssetPath = (rawPath) => {
  if (!rawPath || typeof rawPath !== 'string') return null;

  try {
    if (fs.existsSync(rawPath)) return path.resolve(rawPath);
  } catch (_) {}

  const clean = rawPath.replace(/^[/\\]+/, '');
  const candBackend = path.resolve(__dirname, '..', clean);
  if (fs.existsSync(candBackend)) return candBackend;

  const candCwd = path.resolve(process.cwd(), clean);
  if (fs.existsSync(candCwd)) return candCwd;

  const candCwdBackend = path.resolve(process.cwd(), 'backend', clean);
  if (fs.existsSync(candCwdBackend)) return candCwdBackend;

  const candDirname = path.resolve(__dirname, clean);
  if (fs.existsSync(candDirname)) return candDirname;

  return null;
};

/**
 * Extract image dimensions from standard PNG/JPEG buffer header in RAM.
 */
const getImageDimensions = (buffer) => {
  try {
    if (!buffer || buffer.length < 24) return { width: 1000, height: 1000 };
    // PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width: width || 1000, height: height || 1000 };
    }
    // JPEG
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset = 2;
      while (offset < buffer.length - 8) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        if (marker === 0xc0 || marker === 0xc2) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width: width || 1000, height: height || 1000 };
        }
        const len = buffer.readUInt16BE(offset + 2);
        offset += 2 + len;
      }
    }
  } catch (_) {}
  return { width: 1000, height: 1000 };
};

const getMimeType = (filePath, buffer) => {
  if (filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
  }
  if (buffer && buffer.length > 8) {
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'image/webp';
  }
  return 'image/jpeg';
};

const LOCATION_HINDI_MAP = {
  'top-left': 'Upar Left corner me',
  'top-right': 'Upar Right corner me',
  'bottom-left': 'Neeche Left corner me',
  'bottom-right': 'Neeche Right corner me',
  center: 'Beech me (Center)',
  unknown: 'Kahin nahi mila',
};

const PATTERN_REGEXES = {
  email: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
  url: /\b(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?(?:\/\S*)?\b/g,
  phone: /\b(?:\+?\d{1,3}[-\s]?)?\d{10}\b/g,
  hashtag: /#\w[\w]*/g,
  handle: /(?<!\w)@\w[\w.]*/g,
};

const tagPatternTokens = (text) => {
  if (!text || typeof text !== 'string') return [];
  const tags = [];
  for (const [pType, regex] of Object.entries(PATTERN_REGEXES)) {
    let m;
    regex.lastIndex = 0;
    while ((m = regex.exec(text)) !== null) {
      tags.push({
        type: pType,
        value: m[0],
        start: m.index,
        end: m.index + m[0].length,
      });
    }
  }
  tags.sort((a, b) => a.start - b.start);
  return tags;
};

const classifyRegionType = (rect, text, neighborRects = []) => {
  if (!rect) return 'uncertain';
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  const wordCount = tokens.length;
  const heightPct = Number(rect.height || 0);
  const widthPct = Number(rect.width || 0);
  const topPct = Number(rect.top || 0);
  const myVCenter = topPct + (heightPct / 2.0);
  const band = 1.5 * Math.max(heightPct, 0.5);

  let closeNeighbors = 0;
  for (const nr of neighborRects) {
    if (!nr) continue;
    const nrTop = Number(nr.top || 0);
    const nrHeight = Number(nr.height || 0);
    const nrVCenter = nrTop + (nrHeight / 2.0);
    if (Math.abs(myVCenter - nrVCenter) <= band) {
      closeNeighbors += 1;
    }
  }

  if (wordCount <= 2 && heightPct <= 2.5 && widthPct <= 18.0 && closeNeighbors <= 1) {
    return 'isolated_element';
  } else if (wordCount >= 4 && closeNeighbors >= 1) {
    return 'prose';
  }
  return 'uncertain';
};

const SUGGESTION_RULES = {
  MISSING: 'Logo post me kahin nahi mila. Logo ko post me lagayein.',
  WRONG_LOGO: 'Ye galat / purana logo hai. Brand Guidelines se naya logo download karke wahi lagayein.',
  TOO_SMALL: 'Logo bahut chhota hai. Logo ko kam se kam 10% bada karein.',
  HIDDEN: 'Logo text ke peeche chhup gaya hai. Logo ko khali jagah pe le jayein.',
  COLOR_CHANGED: 'Logo ka rang badal gaya hai. Logo ka original rang wapas rakhein.',
  CORRECT: 'Logo bilkul sahi jagah aur size me laga hua hai.',
  SKIPPED: 'Logo Check Skipped - Logo upload nahi hai',
};

const detectTextLanguage = (text) => {
  if (!text || typeof text !== 'string') return 'en';
  const visible = text.replace(/\s+/g, '');
  if (!visible.length) return 'en';
  const devanagariCount = (text.match(/[\u0900-\u097f]/g) || []).length;
  return devanagariCount / visible.length > 0.1 ? 'hi' : 'en';
};

/**
 * -----------------------------------------------------------------------------
 * 1. TEXT CHECK (Spelling & Grammar) via OpenRouter API (Fallback after Gemini)
 * -----------------------------------------------------------------------------
 */
const checkGrammarOpenRouter = async (
  text,
  language = 'auto',
  whitelist = [],
  brandName = '',
  gmbData = null
) => {
  if (!isKeyConfigured()) {
    throw new Error('OPENROUTER_API_KEY is not configured in environment.');
  }

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

  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  const configuredModel = (process.env.OPENROUTER_MODEL || DEFAULT_MODEL).trim();

  const executeApiCall = async (targetModel) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    try {
      const res = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.CLIENT_REDIRECT_URL || 'http://localhost:5001',
          'X-Title': process.env.OPENROUTER_SITE_NAME || 'Social Approval Workflow Platform',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: targetModel,
          max_tokens: 2000,
          temperature: 0.1,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res;
    } catch (netErr) {
      clearTimeout(timeout);
      throw new Error(`OpenRouter network error: ${netErr.message}`);
    }
  };

  try {
    console.log(`  [OpenRouter Text] Sending text (${cleanText.length} chars) to OpenRouter API (Model: ${configuredModel})...`);
    let response = await executeApiCall(configuredModel);

    if (!response.ok && (response.status === 402 || response.status === 400) && configuredModel !== 'openai/gpt-4o-mini') {
      console.warn(`  ⚠️ [OpenRouter Text] Model '${configuredModel}' returned HTTP ${response.status} (${response.status === 402 ? 'Credit budget exceeded' : 'Request rejected'}). Automatically retrying with fallback model 'openai/gpt-4o-mini'...`);
      response = await executeApiCall('openai/gpt-4o-mini');
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn(`  ✖ [OpenRouter Text] API call failed with HTTP ${response.status}: ${errText.slice(0, 150)}`);
      throw new Error(`OpenRouter HTTP ${response.status}: ${errText.slice(0, 150)}`);
    }

    const json = await response.json();
    const rawContent = json.choices?.[0]?.message?.content;
    if (!rawContent) return [];

    let cleaned = rawContent.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/, '');
    if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '');
    if (cleaned.endsWith('```')) cleaned = cleaned.replace(/```$/, '');
    cleaned = cleaned.trim();

    let parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed) && parsed && typeof parsed === 'object') {
      parsed = parsed.issues || parsed.errors || parsed.spelling_issues || [];
    }

    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((i) => i && (i.original || i.word))
      .map((i) => ({
        original: String(i.original || i.word || '').trim(),
        suggestion: String(i.suggestion || '').trim(),
        reason: String(i.reason || '').trim(),
        type: i.type === 'grammar' ? 'grammar' : 'spelling',
        source: 'openrouter_ai',
      }));
  } catch (err) {
    clearTimeout(timeout);
    console.warn('[OpenRouter] Text check error:', err.message);
    throw err;
  }
};

/**
 * -----------------------------------------------------------------------------
 * 2. IMAGE CHECK (Multimodal 5-in-1) via OpenRouter API (Fallback after Gemini)
 * -----------------------------------------------------------------------------
 */
const runOpenRouterPostCheck = async ({
  imagePath,
  imageBuffer,
  referenceLogoPath,
  referenceLogoBuffer,
  brandRules = {},
}) => {
  if (!isKeyConfigured()) {
    throw new Error('OPENROUTER_API_KEY is not configured in environment.');
  }

  // 1. Load Poster Image into RAM
  let posterBuf = imageBuffer;
  let posterDims = { width: 1000, height: 1000 };
  let posterMime = 'image/jpeg';

  if (!posterBuf && imagePath) {
    const resolvedPath = resolveAssetPath(imagePath);
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      throw new Error(`Poster image file does not exist on disk: ${imagePath}`);
    }
    posterBuf = fs.readFileSync(resolvedPath);
    posterMime = getMimeType(resolvedPath, posterBuf);
    posterDims = getImageDimensions(posterBuf);
  }

  if (!posterBuf || posterBuf.length === 0) {
    throw new Error('No poster image data provided to OpenRouter Post Check.');
  }

  // 2. Load Reference Logo into RAM if configured
  let logoBuf = referenceLogoBuffer;
  let logoMime = 'image/png';
  let hasLogo = false;

  if (!logoBuf && referenceLogoPath) {
    const resolvedLogo = resolveAssetPath(referenceLogoPath);
    if (resolvedLogo && fs.existsSync(resolvedLogo)) {
      try {
        logoBuf = fs.readFileSync(resolvedLogo);
        logoMime = getMimeType(resolvedLogo, logoBuf);
        hasLogo = logoBuf && logoBuf.length > 0;
      } catch (_) {
        hasLogo = false;
      }
    }
  } else if (logoBuf && logoBuf.length > 0) {
    hasLogo = true;
  }

  // Preprocess buffers for OpenAI Vision API (max side: 1600 for poster, 800 for logo)
  const preppedPoster = await prepareVisionBuffer(posterBuf, posterMime, 1600);
  posterBuf = preppedPoster.buffer;
  posterMime = preppedPoster.mimeType;

  if (hasLogo && logoBuf) {
    const preppedLogo = await prepareVisionBuffer(logoBuf, logoMime, 800);
    logoBuf = preppedLogo.buffer;
    logoMime = preppedLogo.mimeType;
  }

  const effectiveBrandRules = {
    ...brandRules,
    has_reference_logo: hasLogo,
  };

  // 3. Build Unified 5-in-1 Prompt
  const promptText = buildPostCheckPrompt(effectiveBrandRules);

  // 4. Build OpenAI Vision Messages Format
  const content = [];

  if (hasLogo && logoBuf) {
    content.push({
      type: 'text',
      text: 'Image 1: Official Client Brand Reference Logo:',
    });
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${logoMime};base64,${logoBuf.toString('base64')}`,
      },
    });
  }

  content.push({
    type: 'text',
    text: hasLogo ? 'Image 2: Poster Creative to Inspect:\n' + promptText : promptText,
  });

  content.push({
    type: 'image_url',
    image_url: {
      url: `data:${posterMime};base64,${posterBuf.toString('base64')}`,
    },
  });

  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  const configuredModel = (process.env.OPENROUTER_MODEL || DEFAULT_MODEL).trim();
  const maxTokens = parseInt(process.env.OPENROUTER_MAX_TOKENS || '2500', 10);

  const executeApiCall = async (targetModel) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 40000);

    try {
      const res = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.CLIENT_REDIRECT_URL || 'http://localhost:5001',
          'X-Title': process.env.OPENROUTER_SITE_NAME || 'Social Approval Workflow Platform',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: targetModel,
          max_tokens: maxTokens,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content }],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res;
    } catch (netErr) {
      clearTimeout(timeout);
      throw new Error(`OpenRouter network error: ${netErr.message}`);
    }
  };

  console.log(`  [OpenRouter Vision] Sending 5-in-1 multimodal request to OpenRouter API (Model: ${configuredModel}, Max Tokens: ${maxTokens})...`);
  let response = await executeApiCall(configuredModel);

  // If configured model hits credit limit (402) or bad request (400), try gpt-4o-mini
  if (!response.ok && (response.status === 402 || response.status === 400) && configuredModel !== 'openai/gpt-4o-mini') {
    console.warn(`  ⚠️ [OpenRouter Vision] Model '${configuredModel}' returned HTTP ${response.status} (${response.status === 402 ? 'Credit budget exceeded' : 'Request rejected'}). Automatically retrying with fallback model 'openai/gpt-4o-mini'...`);
    response = await executeApiCall('openai/gpt-4o-mini');
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.warn(`  ✖ [OpenRouter Vision] API call failed with HTTP ${response.status}: ${errText.slice(0, 150)}`);
    throw new Error(`OpenRouter API failed with status ${response.status}: ${errText.slice(0, 150)}`);
  }

  console.log(`  ✔ [OpenRouter Vision] Response received from OpenRouter API.`);

  const resJson = await response.json();
  const rawText = resJson.choices?.[0]?.message?.content;
  if (!rawText) {
    throw new Error('OpenRouter API returned empty content.');
  }

  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/, '');
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '');
  if (cleaned.endsWith('```')) cleaned = cleaned.replace(/```$/, '');
  cleaned = cleaned.trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (parseErr) {
    throw new Error(`OpenRouter returned invalid JSON: ${parseErr.message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('OpenRouter JSON output is not a valid object');
  }

  // 5. Normalize OCR Boxes to strict percentages
  const rawBoxes = Array.isArray(parsed.ocr_boxes) ? parsed.ocr_boxes : [];
  const normalizedBoxes = rawBoxes.map((b, idx) => {
    const text = String(b.text || '').trim();
    let conf = Number(b.confidence ?? 0.95);
    if (conf > 1.0) conf = conf / 100.0;
    conf = Math.min(1.0, Math.max(0.0, conf));

    const r = b.rect || {};
    let left = Number(r.left ?? 0);
    let top = Number(r.top ?? 0);
    let width = Number(r.width ?? 100);
    let height = Number(r.height ?? 10);

    if (left > 100 || width > 100 || top > 100) {
      left = Math.round((left / posterDims.width) * 10000) / 100;
      top = Math.round((top / posterDims.height) * 10000) / 100;
      width = Math.round((width / posterDims.width) * 10000) / 100;
      height = Math.round((height / posterDims.height) * 10000) / 100;
    }

    left = Math.max(0, Math.min(99, left));
    top = Math.max(0, Math.min(99, top));
    width = Math.max(1, Math.min(100 - left, width));
    height = Math.max(1, Math.min(100 - top, height));

    return {
      id: idx + 1,
      text,
      confidence: conf,
      rect: {
        left: Math.round(left * 100) / 100,
        top: Math.round(top * 100) / 100,
        width: Math.round(width * 100) / 100,
        height: Math.round(height * 100) / 100,
      },
    };
  }).filter((b) => b.text.length > 0);

  const allRects = normalizedBoxes.map((b) => b.rect);
  normalizedBoxes.forEach((b, i) => {
    const neighborRects = allRects.filter((_, idx) => idx !== i);
    b.region_type = classifyRegionType(b.rect, b.text, neighborRects);
    b.pattern_tags = tagPatternTokens(b.text);
    b.suspect_words = [];
  });

  let avgConf = Number(parsed.ocr_confidence_avg);
  if (!Number.isFinite(avgConf) || avgConf <= 0) {
    if (normalizedBoxes.length > 0) {
      const sum = normalizedBoxes.reduce((acc, cur) => acc + cur.confidence, 0);
      avgConf = sum / normalizedBoxes.length;
    } else {
      avgConf = 0.95;
    }
  }
  if (avgConf > 1.0) avgConf = avgConf / 100.0;

  // 6. Normalize Logo Check
  let logoCheck = null;
  if (!hasLogo) {
    logoCheck = {
      status: 'SKIPPED',
      found: false,
      score: 0.0,
      location: 'unknown',
      location_hindi: LOCATION_HINDI_MAP.unknown,
      size_percent: 0,
      reason: 'SKIPPED',
      suggestion: SUGGESTION_RULES.SKIPPED,
      checked_by: 'OpenRouter',
    };
  } else {
    const rawLc = parsed.logo_check || {};
    const found = Boolean(rawLc.found);
    let score = Number(rawLc.score ?? (found ? 0.95 : 0.0));
    if (score > 1.0) score = score / 100.0;
    score = Math.max(0.0, Math.min(1.0, score));

    const rawLoc = String(rawLc.location || 'unknown').toLowerCase().replace('_', '-');
    let locKey = 'unknown';
    for (const k of Object.keys(LOCATION_HINDI_MAP)) {
      if (rawLoc.includes(k)) {
        locKey = k;
        break;
      }
    }
    const locHindi = rawLc.location_hindi || LOCATION_HINDI_MAP[locKey] || LOCATION_HINDI_MAP.unknown;
    const sizePct = Math.max(0, parseInt(rawLc.size_percent ?? 0, 10));

    let reason = String(rawLc.reason || '').toUpperCase().trim();
    if (!SUGGESTION_RULES[reason]) {
      reason = (found && score >= 0.85) ? 'CORRECT' : 'MISSING';
    }

    const isPass = found && score >= 0.85 && reason === 'CORRECT';
    const status = isPass ? 'PASS' : 'FAIL';
    const suggestion = rawLc.suggestion && String(rawLc.suggestion).trim()
      ? String(rawLc.suggestion).trim()
      : SUGGESTION_RULES[reason] || SUGGESTION_RULES.MISSING;

    logoCheck = {
      status,
      found,
      score: Math.round(score * 100) / 100,
      location: locKey,
      location_hindi: locHindi,
      size_percent: sizePct,
      reason,
      suggestion,
      checked_by: 'OpenRouter',
    };
  }

  // 7. Normalize Spelling Issues
  const rawSpelling = Array.isArray(parsed.spelling_issues) ? parsed.spelling_issues : [];
  const normalizedSpelling = rawSpelling
    .filter((s) => s && (s.word || s.original))
    .map((s) => ({
      word: String(s.word || s.original || '').trim(),
      suggestions: Array.isArray(s.suggestions)
        ? s.suggestions.map(String)
        : s.suggestion
        ? [String(s.suggestion).trim()]
        : [],
      script: String(s.script || 'en').toLowerCase(),
      reason: String(s.reason || 'Spelling check').trim(),
      source: 'image_openrouter',
    }));

  // 8. Normalize Banned Words & Mandatory
  const bannedFound = Array.isArray(parsed.banned_words_found)
    ? parsed.banned_words_found.map(String).filter(Boolean)
    : [];
  const missingMandatory = Array.isArray(parsed.missing_mandatory_phrases)
    ? parsed.missing_mandatory_phrases.map(String).filter(Boolean)
    : [];

  const brandIdentityCheck = parsed.brand_identity_check && typeof parsed.brand_identity_check === 'object'
    ? parsed.brand_identity_check
    : { possible_brand_name_error: null, phone_verification: [] };

  return {
    ocr_text: String(parsed.ocr_text || '').trim(),
    ocr_extracted_text: String(parsed.ocr_text || '').trim(),
    ocr_boxes: normalizedBoxes,
    ocr_issues: normalizedBoxes,
    ocr_confidence: Math.round(avgConf * 10000) / 100,
    ocr_confidence_avg: Math.round(avgConf * 100) / 100,
    ocr_reliable: avgConf >= 0.8,
    spelling_issues: normalizedSpelling,
    banned_words_found: bannedFound,
    missing_mandatory_phrases: missingMandatory,
    brand_identity_check: brandIdentityCheck,
    logo_check: logoCheck,
    suggestion: String(parsed.suggestion || '').trim(),
    ai_provider: 'openrouter',
    fallback_used: true,
    fallback_reason: 'gemini_failed_openrouter_used',
    image_status: 'completed',
    engine: 'openrouter_multimodal',
  };
};

module.exports = {
  isKeyConfigured,
  checkGrammarOpenRouter,
  runOpenRouterPostCheck,
};
