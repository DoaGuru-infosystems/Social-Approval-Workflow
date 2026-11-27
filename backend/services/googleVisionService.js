const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { buildPostCheckPrompt } = require('./postCheckPrompt');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

/**
 * Check whether a GEMINI_API_KEY is missing, dummy, or invalid placeholder.
 * DUMMY mode must NEVER return PASS. It must be skipped and routed to Python fallback.
 */
const isDummyKey = (key) => {
  if (!key || typeof key !== 'string') return true;
  const k = key.trim().toLowerCase();
  return (
    k === '' ||
    k === 'your_gemini_api_key' ||
    k.startsWith('dummy') ||
    k.startsWith('test') ||
    k.includes('dummy') ||
    k.includes('test')
  );
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

/**
 * Execute Full 5-in-1 Multimodal Quality Check with Gemini PRIMARY.
 *
 * @param {Object} params
 * @param {string} [params.imagePath] Local path to poster creative
 * @param {Buffer} [params.imageBuffer] Optional poster buffer
 * @param {string} [params.referenceLogoPath] Local path to reference logo (if uploaded)
 * @param {Buffer} [params.referenceLogoBuffer] Optional reference logo buffer
 * @param {Object} [params.brandRules] Brand guidelines (whitelist, banned, mandatory, phone, name)
 * @returns {Promise<Object>}
 */
const runGoogleVisionPostCheck = async ({
  imagePath,
  imageBuffer,
  referenceLogoPath,
  referenceLogoBuffer,
  brandRules = {},
}) => {
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_VISION_API_KEY || '').trim();

  // 1. DUMMY MODE GUARD: If missing or dummy, DO NOT PASS. Throw to route immediately to Python.
  if (isDummyKey(apiKey)) {
    console.warn('[Gemini] Gemini DUMMY mode me hai - skipping Gemini and routing to Python Fallback.');
    const dummyErr = new Error('Gemini DUMMY mode me hai');
    dummyErr.isDummy = true;
    dummyErr.isKeyError = true;
    dummyErr.code = 'GEMINI_DUMMY_MODE';
    throw dummyErr;
  }

  // 2. Load Poster Image into RAM (NO-DISK Policy)
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
    throw new Error('No poster image data provided to Gemini Post Check.');
  }

  // 3. Load Reference Logo into RAM if configured
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

  const effectiveBrandRules = {
    ...brandRules,
    has_reference_logo: hasLogo,
  };

  // 4. Build Unified 5-in-1 Prompt
  const promptText = buildPostCheckPrompt(effectiveBrandRules);

  const parts = [{ text: promptText }];

  if (hasLogo && logoBuf) {
    parts.push({ text: 'Image 1: Official Client Brand Reference Logo:' });
    parts.push({
      inline_data: {
        mime_type: logoMime,
        data: logoBuf.toString('base64'),
      },
    });
  }

  parts.push({ text: hasLogo ? 'Image 2: Poster Creative to Inspect:' : 'Poster Creative to Inspect:' });
  parts.push({
    inline_data: {
      mime_type: posterMime,
      data: posterBuf.toString('base64'),
    },
  });

  const modelName = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  console.log(`  [Gemini Vision] Requesting 5-in-1 multimodal check via model '${modelName}'...`);
  console.log(`  [Gemini Vision] Poster dimensions: ${posterDims.width}x${posterDims.height} | Reference logo: ${hasLogo ? 'Attached' : 'None'}`);

  const requestBody = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0.1,
    },
  });

  // 5. Execute with 30s Timeout and 1 Retry on 429/503
  let response;
  const maxAttempts = 2; // Initial + 1 retry
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if ((response.status === 503 || response.status === 429) && attempt < maxAttempts) {
        console.warn(`  ⚠️ [Gemini Vision] Attempt ${attempt} returned status ${response.status}. Retrying in 2000ms...`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      break;
    } catch (netErr) {
      clearTimeout(timeout);
      if (attempt < maxAttempts) {
        console.warn(`  ⚠️ [Gemini Vision] Attempt ${attempt} network notice (${netErr.message}). Retrying in 2000ms...`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw netErr;
    }
  }

  if (!response || !response.ok) {
    const errText = await response?.text().catch(() => '') || '';
    console.warn(`  ✖ [Gemini Vision] API error HTTP ${response?.status || 'ERR'}: ${errText.slice(0, 150)}`);
    const err = new Error(`Gemini check failed with status ${response?.status || 'network_error'}: ${errText.slice(0, 150)}`);
    if (response?.status === 400 || response?.status === 401 || response?.status === 403 || /api_key|expired|billing|permission/i.test(errText)) {
      err.isKeyError = true;
      err.code = 'GEMINI_KEY_EXPIRED';
    }
    throw err;
  }

  // 6. Parse and Validate JSON
  const resJson = await response.json();
  const rawText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini API returned an empty candidate payload.');
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
    throw new Error(`Gemini returned invalid JSON: ${parseErr.message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Gemini JSON output is not a valid object');
  }

  // 7. Normalize OCR Boxes to strict percentages
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

    // If coordinates were returned in pixel space (> 100), convert to percentage
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

  // Calculate region_type and pattern_tags for each normalized box
  const allGeminiRects = normalizedBoxes.map((b) => b.rect);
  normalizedBoxes.forEach((b, i) => {
    const neighborRects = allGeminiRects.filter((_, idx) => idx !== i);
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

  // 8. Normalize Logo Check
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
      checked_by: 'Gemini',
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
      checked_by: 'Gemini',
    };
  }

  // 9. Normalize Spelling Issues
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
      source: 'image',
    }));

  // 10. Normalize Banned Words & Mandatory
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
    ai_provider: 'gemini',
    fallback_used: false,
    fallback_reason: 'none',
    image_status: 'completed',
    engine: 'gemini_multimodal',
  };
};

/**
 * Backward compatibility wrapper for runGoogleVisionOCR
 */
const runGoogleVisionOCR = async (params) => {
  return runGoogleVisionPostCheck(params);
};

module.exports = {
  isDummyKey,
  runGoogleVisionPostCheck,
  runGoogleVisionOCR,
};
