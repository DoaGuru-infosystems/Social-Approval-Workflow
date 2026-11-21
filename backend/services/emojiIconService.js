/**
 * Universal Emoji and Graphic Icon Detection Service
 *
 * Responsibilities:
 * 1. Text & Caption Analysis:
 *    - Accurately detects and classifies Unicode emojis across social media posts.
 *    - Categorizes emojis (strategy, creative, business, emotion, contact, etc.).
 *    - Protects emojis from being mangled or misclassified as spelling errors by spellcheckers.
 * 2. Poster Image & OCR Inspection:
 *    - Identifies graphic vector icons (globe, email, phone, location, lightbulb, bullets).
 *    - Recognizes OCR misreads of icons (e.g. '४ो' for globe, 'ञ' for envelope, '८ो' for bulb/phone).
 *    - Classifies them as valid graphic icons (GREEN = OK) instead of false errors.
 */

const fs = require('fs');
const path = require('path');

// Comprehensive Unicode Emoji pattern (supports standard pictographs, modifiers, and ZWJ sequences)
const EMOJI_REGEX = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;

// Load Persistent Emoji & Icon Dictionary
let emojiDictionary = {};
let posterIconRules = {};

try {
  const dictPath = path.resolve(__dirname, 'dictionaries', 'emoji_icon_dictionary.json');
  if (fs.existsSync(dictPath)) {
    const raw = fs.readFileSync(dictPath, 'utf8');
    const parsed = JSON.parse(raw);
    emojiDictionary = parsed.emojis || {};
    posterIconRules = parsed.poster_icons || {};
  }
} catch (err) {
  console.warn('[EmojiIconService] Dictionary load notice:', err.message);
}

// Fallback metadata if dictionary file is missing
const KNOWN_EMOJI_METADATA = {
  ...emojiDictionary,
  '🚀': { name: 'Rocket / Launch', category: 'action' },
  '💡': { name: 'Lightbulb / Idea / Strategy', category: 'creative' },
  '🎯': { name: 'Target / Goal', category: 'strategy' },
  '📊': { name: 'Bar Chart / Analytics', category: 'business' },
  '📱': { name: 'Mobile / Smartphone', category: 'contact' },
  '🔍': { name: 'Magnifying Glass / SEO', category: 'business' },
  '📈': { name: 'Upward Trend / Growth', category: 'business' },
  '💙': { name: 'Blue Heart / Brand Trust', category: 'emotion' },
  '📞': { name: 'Phone Receiver / Call', category: 'contact' },
  '📍': { name: 'Round Pushpin / Location', category: 'contact' },
  '🌐': { name: 'Globe with Meridians / Website', category: 'contact' },
  '✉': { name: 'Envelope / Mail', category: 'contact' },
  '📧': { name: 'E-Mail', category: 'contact' },
  '⭐': { name: 'Star / Featured', category: 'highlight' },
  '✅': { name: 'Checkmark Button', category: 'status' },
  '✔️': { name: 'Checkmark', category: 'status' },
  '•': { name: 'Bullet Point', category: 'typography' },
};

/**
 * Detect all emojis in title/caption text.
 * @param {string} text
 * @returns {Object}
 */
const detectTextEmojis = (text) => {
  if (!text || typeof text !== 'string') {
    return {
      has_emojis: false,
      total_count: 0,
      unique_count: 0,
      emojis: [],
      summary: 'No emojis detected in text',
    };
  }

  const rawMatches = [...text.matchAll(EMOJI_REGEX)].map((m) => m[0]);
  if (rawMatches.length === 0) {
    return {
      has_emojis: false,
      total_count: 0,
      unique_count: 0,
      emojis: [],
      summary: 'No emojis detected in text',
    };
  }

  const counts = {};
  for (const e of rawMatches) {
    counts[e] = (counts[e] || 0) + 1;
  }

  const uniqueList = Object.keys(counts).map((e) => {
    const meta = KNOWN_EMOJI_METADATA[e] || { name: 'Social Emoji', category: 'general' };
    return {
      symbol: e,
      name: meta.name,
      category: meta.category,
      count: counts[e],
    };
  });

  return {
    has_emojis: true,
    total_count: rawMatches.length,
    unique_count: uniqueList.length,
    emojis: uniqueList,
    summary: `${rawMatches.length} emoji(s) detected across ${uniqueList.length} unique symbol(s)`,
  };
};

/**
 * Inspect whether an OCR box/token on a poster is a vector icon, glyph, or emoji.
 * @param {string} boxText Text read inside the OCR region
 * @param {string} fullContext Surrounding line or poster text context
 * @returns {{ isIcon: boolean, iconType: string|null, iconName: string|null, iconSymbol: string|null }}
 */
const detectPosterIcon = (boxText, fullContext = '') => {
  if (!boxText || typeof boxText !== 'string') {
    return { isIcon: false, iconType: null, iconName: null, iconSymbol: null };
  }

  const clean = boxText.trim();
  const ctxLower = (clean + ' ' + (fullContext || '')).toLowerCase();

  // 1. Direct Unicode Emoji inside the box
  if (EMOJI_REGEX.test(clean)) {
    const match = clean.match(EMOJI_REGEX)[0];
    const meta = KNOWN_EMOJI_METADATA[match] || { name: 'Graphic Emoji' };
    return {
      isIcon: true,
      iconType: 'unicode_emoji',
      iconName: meta.name,
      iconSymbol: match,
    };
  }

  // 2. Globe / Website Icon:
  // OCR reads vector globe as '४ो', '⊙', '⨁', or single letter beside URLs
  if (
    /^(४ो|[•·⊙⨁\u25CF\u25CB\u25A0\u25A1\u25C9])$/.test(clean) ||
    (/(^|\s)४ो(\s|$)/.test(clean) && /(www\.|doaguru|\.com|\.in|\.org|\.net)/i.test(ctxLower)) ||
    (clean.length <= 3 && /(www\.|doaguru|\.com|\.in|\.org|\.net)/i.test(ctxLower) && !/www/i.test(clean))
  ) {
    return {
      isIcon: true,
      iconType: 'globe_website_icon',
      iconName: 'Globe / Website Vector Icon',
      iconSymbol: '🌐',
    };
  }

  // 3. Email / Mail Envelope Icon:
  // OCR reads envelope flap as 'ञ', 'ऋ', '✉', '📧' beside email addresses
  if (
    /^(ञ|ऋ|✉|📧|[•·\u2709\u2708\u2706])$/.test(clean) ||
    (/(^|\s)(ञ|ऋ)(\s|$)/.test(clean) && /(@|info|mail|gmail|yahoo|support)/i.test(ctxLower)) ||
    (clean.length <= 3 && /(@|info|mail|gmail|yahoo|support)/i.test(ctxLower) && !/@/.test(clean))
  ) {
    return {
      isIcon: true,
      iconType: 'email_envelope_icon',
      iconName: 'Email / Mail Envelope Icon',
      iconSymbol: '✉️',
    };
  }

  // 4. Phone / Call Icon:
  // OCR reads phone handset or +91 as '८ो', '९१', '४ो', '📞', '☎' beside phone numbers
  if (
    /^(८ो|९१|४ो|📞|☎|[•·\u260E\u260F\u2706])$/.test(clean) ||
    (/(^|\s)(८ो|९१)(\s|$)/.test(clean) && /(\+?91|\d{10}|contact|call|phone)/i.test(ctxLower)) ||
    ((clean === '९१' || clean === '+91') && /\d{10}/.test(ctxLower))
  ) {
    return {
      isIcon: true,
      iconType: 'phone_call_icon',
      iconName: 'Phone / Calling Vector Icon',
      iconSymbol: '📞',
    };
  }

  // 5. Lightbulb / Idea / Strategy Icon:
  // OCR reads lightbulb and rays as '८ो', '२', '💡', '☼', '☀' beside strategy/tips
  if (
    /^(८ो|२|💡|☼|☀|[•·\u2600-\u2603])$/.test(clean) ||
    (/(^|\s)(८ो|२)(\s|$)/.test(clean) && /(strategy|move|tip|idea|note|growth|smart|creative)/i.test(ctxLower))
  ) {
    return {
      isIcon: true,
      iconType: 'lightbulb_idea_icon',
      iconName: 'Lightbulb / Strategy Graphic Icon',
      iconSymbol: '💡',
    };
  }

  // 6. Typographic bullets & list markers
  if (/^[•·\u2022\u00B7\u25CF\u25CB\u25A0\u25A1\u2605\u2606&+\-%#@\/\\|:;,.!?'"()[\]{}~–—*★✓✔]+$/.test(clean)) {
    return {
      isIcon: true,
      iconType: 'bullet_marker',
      iconName: 'Typographic Bullet / Marker',
      iconSymbol: '•',
    };
  }

  // 7. Social Media Vector Icons (LinkedIn, Instagram, Facebook, YouTube, Meta Ads, WhatsApp, Twitter/X)
  if (
    /^(in|fb|ig|yt|x|∞|८०|co|00)$/i.test(clean) ||
    (/(^|\s)(in|fb|ig|yt)(\s|$)/i.test(clean) && /(linkedin|facebook|instagram|youtube|meta|social|share|follow)/i.test(ctxLower)) ||
    (/(^|\s)in(\s|$)/i.test(clean) && /linkedin/i.test(ctxLower)) ||
    (/(linkedin|facebook|instagram|youtube|meta ads|whatsapp|twitter)/i.test(ctxLower) && clean.length <= 8)
  ) {
    return {
      isIcon: true,
      iconType: 'social_media_icon',
      iconName: 'Social Media Vector Icon',
      iconSymbol: '📱',
    };
  }

  return { isIcon: false, iconType: null, iconName: null, iconSymbol: null };
};

module.exports = {
  EMOJI_REGEX,
  detectTextEmojis,
  detectPosterIcon,
};
