const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const CANDIDATE_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3-flash-preview',
  'gemini-flash-latest',
];

/**
 * Extract image dimensions from standard PNG/JPEG buffer header
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
  } catch {
    // fallback
  }
  return { width: 1000, height: 1000 };
};

/**
 * Execute Gemini Multimodal OCR on a poster image.
 * Uses Google Gemini API via GEMINI_API_KEY.
 *
 * @param {Object} params
 * @param {string} [params.imagePath] Absolute path to local image file
 * @param {string} [params.imageBase64] Optional pre-encoded base64 string
 * @param {string} [params.mimeType] Image mime type
 * @returns {Promise<Object>} Formatted PaddleOCR-compatible OCR result
 */
const runGeminiOCR = async ({ imagePath, imageBase64, mimeType = 'image/jpeg' }) => {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey.startsWith('DUMMY')) {
    const err = new Error('GEMINI_API_KEY not found or DUMMY in environment.');
    err.isKeyError = true;
    err.code = 'GEMINI_KEY_EXPIRED';
    throw err;
  }

  let base64Data = imageBase64;
  let dims = { width: 1000, height: 1000 };

  if (!base64Data && imagePath) {
    const resolvedPath = path.resolve(imagePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Image file does not exist on disk: ${resolvedPath}`);
    }
    const buf = fs.readFileSync(resolvedPath);
    base64Data = buf.toString('base64');
    dims = getImageDimensions(buf);

    const ext = path.extname(resolvedPath).toLowerCase();
    if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.webp') mimeType = 'image/webp';
  }

  if (!base64Data) {
    throw new Error('No image path or base64 provided to Gemini OCR.');
  }

  const systemInstruction = `You are an expert Optical Character Recognition (OCR) engine specialized in bilingual (Hindi / English) Indian posters.
Your task is to accurately transcribe all visible text in the image into structured JSON format.
CRITICAL INSTRUCTION:
1. Transcribe characters EXACTLY as they appear visually on the poster. Do NOT autocorrect any typos, misspellings, or unusual character sequences (e.g. if the poster prints 'Helthcare', 'Succesfully', 'Compeleted', 'annouce', or 'suppport', transcribe it faithfully character-by-character as printed; NEVER auto-fix or guess intended words).
2. Preserve exact spellings, diacritics, and ligatures in both Latin and Devanagari scripts.

Return STRICT JSON matching this schema:
{
  "ocr_text": "all extracted text separated by newlines",
  "ocr_boxes": [
    {
      "text": "transcribed text of this visual block or line",
      "confidence": 0.98,
      "rect": {
        "left": 10.5,
        "top": 15.0,
        "width": 30.0,
        "height": 5.0
      }
    }
  ]
}
Where rect coordinates are percentages from 0.0 to 100.0 relative to image width and height.`;

  const requestBody = JSON.stringify({
    contents: [
      {
        parts: [
          { text: systemInstruction },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data,
            },
          },
        ],
      },
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0.1,
    },
  });

  const modelsToTry = CANDIDATE_MODELS;
  let response;
  let lastError;

  for (const model of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptController = new AbortController();
      const attemptTimeout = setTimeout(() => attemptController.abort(), 35000);
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
          signal: attemptController.signal,
        });
        clearTimeout(attemptTimeout);

        if (response.status === 503 || response.status === 429) {
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          // If still 503, switch to next candidate model immediately
          break;
        }
        break;
      } catch (netErr) {
        clearTimeout(attemptTimeout);
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        lastError = netErr;
      }
    }

    if (response && response.ok) {
      break;
    }
  }

  if (!response || !response.ok) {
    const errText = response ? await response.text().catch(() => '') : (lastError?.message || 'Network error');
    const status = response ? response.status : 500;
    const err = new Error(`Gemini OCR failed with status ${status}: ${errText.slice(0, 150)}`);
    if (status === 400 || status === 401 || status === 403 || /api_key|expired|billing|permission/i.test(errText)) {
      err.isKeyError = true;
      err.code = 'GEMINI_KEY_EXPIRED';
    }
    throw err;
  }

  const resJson = await response.json();
  const rawText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini OCR returned an empty candidate payload.');
  }

  const parsed = JSON.parse(rawText);
  const ocrText = String(parsed.ocr_text || '').trim();
  const rawBoxes = Array.isArray(parsed.ocr_boxes) ? parsed.ocr_boxes : [];

  // Normalize bounding boxes to strict 0..100 percentage floats
  const normalizedBoxes = rawBoxes.map((b) => {
    const text = String(b.text || '').trim();
    let conf = Number(b.confidence ?? 0.95);
    if (conf > 1.0) conf = conf / 100.0;
    conf = Math.min(1.0, Math.max(0.0, conf));

    const r = b.rect || {};
    let left = Number(r.left ?? 0);
    let top = Number(r.top ?? 0);
    let width = Number(r.width ?? 100);
    let height = Number(r.height ?? 10);

    // If coordinates are in pixel space (> 100), convert to percentage
    if (left > 100 || width > 100 || top > 100) {
      left = Math.round((left / dims.width) * 10000) / 100;
      top = Math.round((top / dims.height) * 10000) / 100;
      width = Math.round((width / dims.width) * 10000) / 100;
      height = Math.round((height / dims.height) * 10000) / 100;
    }

    left = Math.max(0, Math.min(99, left));
    top = Math.max(0, Math.min(99, top));
    width = Math.max(1, Math.min(100 - left, width));
    height = Math.max(1, Math.min(100 - top, height));

    return {
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

  // Compute average confidence
  let avgConf = 0.95;
  if (normalizedBoxes.length > 0) {
    const sum = normalizedBoxes.reduce((acc, cur) => acc + cur.confidence, 0);
    avgConf = sum / normalizedBoxes.length;
  }

  return {
    ocr_text: ocrText,
    ocr_extracted_text: ocrText,
    ocr_boxes: normalizedBoxes,
    ocr_confidence: Math.round(avgConf * 10000) / 100,
    ocr_confidence_avg: Math.round(avgConf * 100) / 100,
    ocr_reliable: avgConf >= 0.8,
    image_status: 'completed',
    engine: 'gemini_ai',
  };
};

module.exports = {
  runGeminiOCR,
  runGoogleVisionOCR: runGeminiOCR, // Backwards-compatible alias
};
