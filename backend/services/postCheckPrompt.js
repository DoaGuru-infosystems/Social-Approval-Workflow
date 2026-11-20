/**
 * Shared Post Check Prompt Builder for Google Gemini Multimodal Inspection.
 * File: backend/services/postCheckPrompt.js
 *
 * Implements 5 unified tasks:
 * 1. OCR Text Extract (exact transcription, preserving typos, normalized bounding boxes)
 * 2. Grammar & Spelling Check (Hindi + English + Hinglish, respects whitelist)
 * 3. Brand Rules Check (Banned words, whitelist words, mandatory phrases, brand identity)
 * 4. Brand Logo Check (searches whole image, no position assumption: found, location, size_percent, score, reason)
 * 5. Actionable Suggestion in new line (in Hindi/Hinglish)
 */

function buildPostCheckPrompt(brandRules = {}) {
  const brandName = brandRules.brand_name || brandRules.organization_name || '';
  const whitelist = Array.isArray(brandRules.whitelist)
    ? brandRules.whitelist
    : (brandRules.whitelist_words || []);
  const banned = Array.isArray(brandRules.banned)
    ? brandRules.banned
    : (brandRules.banned_words || []);
  const mandatory = Array.isArray(brandRules.mandatory)
    ? brandRules.mandatory
    : (brandRules.mandatory_phrases || []);
  const expectedPhones = Array.isArray(brandRules.expected_phones)
    ? brandRules.expected_phones
    : [];
  const hasReferenceLogo = Boolean(brandRules.has_reference_logo);

  return `You are an expert AI quality inspector and brand compliance auditor for Indian bilingual and Hinglish social media posters and creatives.
You are evaluating this social media poster image across 5 strict quality criteria.

CRITICAL INSTRUCTIONS ACROSS 5 TASKS:

1. OCR TEXT EXTRACTION:
- Transcribe ALL visible text on the poster EXACTLY character-by-character as visually printed (English, Hindi / Devanagari script, numbers, contact info, hashtags).
- CRITICAL: Do NOT autocorrect, normalize, or guess intended words. If a word is misspelled or has a typo on the graphic, transcribe that EXACT typo character-by-character.
- Provide "ocr_boxes" where each item contains "text", "confidence" (0.0 to 1.0), and normalized bounding box "rect": { "left", "top", "width", "height" } as percentages (0.0 to 100.0) relative to image dimensions.

2. GRAMMAR & SPELLING CHECK (Hindi + English + Hinglish):
- Check all extracted poster text for real grammatical errors and genuine spelling typos in English, Hindi (Devanagari matras, anuswar, halant, ligatures), and Hinglish.
- Whitelist to NEVER flag as errors: ${JSON.stringify(whitelist.slice(0, 50))}.
- For each genuine error found, populate "spelling_issues":
  [ { "word": "misspelled_word", "suggestion": "correct_word", "script": "en" | "hi" | "hinglish", "reason": "concise explanation" } ]

3. BRAND RULES COMPLIANCE:
- Banned Words: Check if ANY of these banned words/phrases appear on the poster: ${JSON.stringify(banned)}. If found, list in "banned_words_found".
- Mandatory Phrases: Check if ALL required phrases appear on the poster: ${JSON.stringify(mandatory)}. If any are missing, list in "missing_mandatory_phrases".
- Brand Name Verification: Official brand name is "${brandName}". Check if it is spelled correctly or corrupted.
- Contact Number Verification: Official registered phones are: ${JSON.stringify(expectedPhones)}. Check if any phone number on the poster mismatches or has 1-2 digit typos.

4. BRAND LOGO CHECK:
${
  hasReferenceLogo
    ? `- The FIRST image provided is the official reference brand logo. The SECOND image is the social media poster creative to inspect.
- Search the ENTIRE poster canvas for this reference logo. The logo can be ANYWHERE in the image; do NOT assume position (it could be in top-left, top-right, bottom-left, bottom-right, or center).
- Determine:
  * "found": boolean (true if the reference logo is clearly present, else false).
  * "score": match confidence score between 0.0 and 1.0 (>= 0.85 means genuine match).
  * "location": "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center" | "unknown"
  * "location_hindi": "Upar Left corner me" | "Upar Right corner me" | "Neeche Left corner me" | "Neeche Right corner me" | "Beech me (Center)" | "Kahin nahi mila"
  * "size_percent": integer percentage of poster width occupied by logo (e.g. 5, 10, 15).
  * "reason": one of "CORRECT" | "MISSING" | "WRONG_LOGO" | "TOO_SMALL" | "HIDDEN" | "COLOR_CHANGED"
  * "status": "PASS" (if found is true AND score >= 0.85 AND reason is CORRECT), otherwise "FAIL".
  * "suggestion": actionable designer suggestion in Hindi/Hinglish following these exact rules:
      MISSING => "Logo post me kahin nahi mila. Logo ko post me lagayein."
      WRONG_LOGO => "Ye galat / purana logo hai. Brand Guidelines se naya logo download karke wahi lagayein."
      TOO_SMALL => "Logo bahut chhota hai. Logo ko kam se kam 10% bada karein."
      HIDDEN => "Logo text ke peeche chhup gaya hai. Logo ko khali jagah pe le jayein."
      COLOR_CHANGED => "Logo ka rang badal gaya hai. Logo ka original rang wapas rakhein."
      CORRECT => "Logo bilkul sahi jagah aur size me laga hua hai."`
    : `- No reference logo is configured in Brand Guidelines.
- Set logo_check to:
  {
    "status": "SKIPPED",
    "found": false,
    "score": 0.0,
    "location": "unknown",
    "location_hindi": "Kahin nahi mila",
    "size_percent": 0,
    "reason": "SKIPPED",
    "suggestion": "Logo Check Skipped - Logo upload nahi hai",
    "checked_by": "Gemini"
  }`
}

5. ACTIONABLE SUGGESTION (IN NEW LINE):
- Provide a clear, actionable summary recommendation in Hindi/Hinglish on a new line for the graphic designer addressing any identified flaws.

OUTPUT FORMAT:
Return STRICT JSON ONLY matching this exact structure:
{
  "ocr_text": "all extracted text separated by newlines",
  "ocr_boxes": [
    {
      "text": "line text",
      "confidence": 0.95,
      "rect": { "left": 10.0, "top": 12.5, "width": 45.0, "height": 6.0 }
    }
  ],
  "ocr_confidence_avg": 0.95,
  "ocr_reliable": true,
  "spelling_issues": [
    { "word": "example", "suggestion": "example", "script": "en", "reason": "spelling typo" }
  ],
  "banned_words_found": [],
  "missing_mandatory_phrases": [],
  "brand_identity_check": {
    "possible_brand_name_error": null,
    "phone_verification": []
  },
  "logo_check": {
    "status": "PASS" | "FAIL" | "SKIPPED",
    "found": boolean,
    "score": float,
    "location": "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center" | "unknown",
    "location_hindi": "Upar Left corner me" | "Upar Right corner me" | "Neeche Left corner me" | "Neeche Right corner me" | "Beech me (Center)" | "Kahin nahi mila",
    "size_percent": integer,
    "reason": "CORRECT" | "MISSING" | "WRONG_LOGO" | "TOO_SMALL" | "HIDDEN" | "COLOR_CHANGED" | "SKIPPED",
    "suggestion": "actionable suggestion string",
    "checked_by": "Gemini"
  },
  "suggestion": "actionable suggestion in Hindi/Hinglish in a new line"
}`;
}

module.exports = {
  buildPostCheckPrompt,
};
