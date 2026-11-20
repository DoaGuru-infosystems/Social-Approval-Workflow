const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const fuzzball = require('fuzzball');

let cachedClientsIndex = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 30000; // 30 seconds cache

let cachedProfessionalTerms = null;

/**
 * Loads generic medical, healthcare, qualification, and business terms from professional_terms.json.
 * Completely client-agnostic.
 * @returns {Set<string>}
 */
const getProfessionalTermsSet = () => {
  if (cachedProfessionalTerms) return cachedProfessionalTerms;
  const terms = new Set();
  const candPaths = [
    path.resolve(__dirname, '..', 'dictionaries', 'professional_terms.json'),
    path.resolve(__dirname, '..', '..', 'professional_terms.json'),
    path.resolve(__dirname, 'professional_terms.json'),
  ];
  for (const p of candPaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        for (const cat of Object.values(raw)) {
          if (Array.isArray(cat)) {
            cat.forEach((t) => terms.add(String(t).toLowerCase().trim()));
          }
        }
        break;
      } catch (e) {
        console.warn('[crossClientService] Notice loading professional_terms.json:', e.message);
      }
    }
  }
  cachedProfessionalTerms = terms;
  return cachedProfessionalTerms;
};

/**
 * Check if a word/term is a generic professional, medical, or facility descriptor.
 * @param {string} term
 * @returns {boolean}
 */
const isProfessionalTerm = (term) => {
  if (!term || typeof term !== 'string') return false;
  const clean = term.toLowerCase().trim();
  const terms = getProfessionalTermsSet();
  if (terms.has(clean)) return true;
  const stripped = clean.replace(/[^\w\u0900-\u097f]/g, '');
  return terms.has(stripped);
};

/**
 * Normalizes text for brand matching: lowercases, removes non-alphanumeric except spaces.
 */
const normalizeText = (str) => {
  if (!str) return '';
  return String(str).toLowerCase().replace(/[^\w\u0900-\u097f\s]/g, ' ').replace(/\s+/g, ' ').trim();
};

/**
 * Extracts 10-digit phone numbers from text.
 */
const extractPhoneDigits = (str) => {
  if (!str) return [];
  const matches = String(str).match(/(?:\+?91[\s-]?)?[6-9]\d{9}/g) || [];
  return matches.map((m) => m.replace(/\D/g, '').slice(-10));
};

/**
 * Extracts web domains from text (e.g. doaguru.com).
 */
const extractDomains = (str) => {
  if (!str) return [];
  const matches = String(str).toLowerCase().match(/([a-z0-9-]+\.(?:com|in|org|net|co|io|biz|info))/gi) || [];
  return Array.from(new Set(matches));
};

/**
 * Builds or retrieves the indexed list of all registered clients.
 */
const getClientsIndex = async (forceRefresh = false) => {
  const now = Date.now();
  if (!forceRefresh && cachedClientsIndex && now - lastCacheTime < CACHE_TTL_MS) {
    return cachedClientsIndex;
  }

  const [clientRows] = await pool.query(
    'SELECT id, name, primary_phone, alternate_phone, address, is_active FROM clients WHERE is_active = 1'
  );

  const [guidelineRows] = await pool.query(
    'SELECT client_id, whitelist_words, mandatory_phrases, reference_logo_url FROM client_brand_guidelines'
  );

  const guidelinesMap = new Map();
  for (const g of guidelineRows) {
    let whitelist = [];
    try {
      whitelist = typeof g.whitelist_words === 'string' ? JSON.parse(g.whitelist_words) : (g.whitelist_words || []);
    } catch {}
    guidelinesMap.set(g.client_id, {
      whitelist,
      logoPath: g.reference_logo_url,
    });
  }

  const genericStopWords = new Set([
    'hospital', 'clinic', 'speciality', 'multi', 'systems', 'infosystems',
    'organics', 'centre', 'center', 'doctor', 'dr', 'solutions', 'services',
    'pvt', 'ltd', 'limited', 'care', 'health', 'wellness', 'technologies',
    'technically', 'transforming', 'india', 'mp',
    ...getProfessionalTermsSet(),
  ]);

  const index = clientRows.map((c) => {
    const guide = guidelinesMap.get(c.id) || { whitelist: [], logoPath: null };
    const cleanName = normalizeText(c.name);

    // Prioritize client's own brand words:
    // First preserve all name tokens from the client's official name
    const rawTokens = cleanName.split(' ').filter((t) => t.length >= 3);
    // Generic stop words / professional terms only filter out generic terms AFTER checking client brand tokens
    const filteredTokens = rawTokens.filter((t) => !genericStopWords.has(t));
    const nameTokens = filteredTokens.length > 0 ? filteredTokens : rawTokens;

    // Extract distinctive whitelist roots ONLY if they contain or match the client's brand name tokens
    const whitelistRoots = (guide.whitelist || [])
      .map((w) => normalizeText(w))
      .filter((w) => {
        if (w.length < 3 || genericStopWords.has(w)) return false;
        // Must contain or match at least one nameToken or be a specific custom term
        return nameTokens.some((nt) => w.includes(nt) || nt.includes(w)) || w.length >= 5;
      });

    // Combine distinct roots: client's own brand tokens get priority
    const distinctRoots = Array.from(new Set([...nameTokens, ...whitelistRoots]));

    // Registered phones
    const phones = [];
    if (c.primary_phone) phones.push(...extractPhoneDigits(c.primary_phone));
    if (c.alternate_phone) phones.push(...extractPhoneDigits(c.alternate_phone));

    // Domains associated with this client from whitelist or name
    const domains = [];
    for (const w of guide.whitelist || []) {
      const found = extractDomains(w);
      if (found.length) domains.push(...found);
    }
    // Also derive domain root from distinct roots e.g. doaguru -> doaguru.com
    for (const r of distinctRoots) {
      if (r.length >= 5) {
        domains.push(`${r}.com`);
        domains.push(`${r}.in`);
      }
    }

    return {
      id: c.id,
      name: c.name,
      cleanName,
      distinctRoots,
      phones: Array.from(new Set(phones)),
      domains: Array.from(new Set(domains)),
      hasLogo: Boolean(guide.logoPath && guide.logoPath.trim()),
      logoPath: guide.logoPath,
    };
  });

  cachedClientsIndex = index;
  lastCacheTime = now;
  return index;
};

/**
 * Checks text or OCR boxes for collisions with any other client in the database.
 *
 * @param {Object} params
 * @param {number} params.currentClientId - Client ID being checked
 * @param {string} params.text - Combined text (caption + title + OCR)
 * @param {Array} params.ocrBoxes - Array of bounding boxes with { id, text }
 * @returns {Promise<Object>} Collision report
 */
const detectCrossClientCollisions = async ({
  currentClientId,
  text = '',
  ocrBoxes = [],
}) => {
  const allClients = await getClientsIndex();
  const currentClient = allClients.find((c) => c.id === Number(currentClientId));

  // If no client registered for this post (random poster / unauthorized brand): NEVER skip!
  if (!currentClientId || !currentClient) {
    const collisions = [];
    const collidingBoxIds = new Set();
    const combinedNormalized = normalizeText(text);
    const textPhones = extractPhoneDigits(text);
    const textDomains = extractDomains(text);

    for (const other of allClients) {
      let clientCollisionFound = false;
      const reasons = [];

      for (const root of other.distinctRoots) {
        if (!root || root.length < 4) continue;
        const regex = new RegExp(`\\b${root}\\b`, 'i');
        if (regex.test(combinedNormalized)) {
          clientCollisionFound = true;
          reasons.push(`Brand name token '${root}' belongs to registered client '${other.name}'`);
        }
      }

      for (const domain of other.domains) {
        if (textDomains.includes(domain.toLowerCase()) || text.toLowerCase().includes(domain.toLowerCase())) {
          clientCollisionFound = true;
          reasons.push(`Website domain '${domain}' belongs to registered client '${other.name}'`);
        }
      }

      for (const phone of other.phones) {
        if (textPhones.includes(phone)) {
          clientCollisionFound = true;
          reasons.push(`Registered phone number '${phone}' belongs to registered client '${other.name}'`);
        }
      }

      if (ocrBoxes && ocrBoxes.length > 0) {
        for (const box of ocrBoxes) {
          if (!box.text) continue;
          const boxNorm = normalizeText(box.text);
          for (const root of other.distinctRoots) {
            if (!root || root.length < 4) continue;
            const rRegex = new RegExp(`\\b${root}\\b`, 'i');
            const isFuzzy = root.length >= 6 && fuzzball.partial_ratio(boxNorm, root) >= 95;
            if (rRegex.test(boxNorm) || isFuzzy) {
              collidingBoxIds.add(box.id);
              clientCollisionFound = true;
              reasons.push(`Box #${box.id} contains brand '${root}' from '${other.name}'`);
            }
          }
        }
      }

      if (clientCollisionFound) {
        collisions.push({
          foreignClient: { id: other.id, name: other.name },
          reasons: Array.from(new Set(reasons)),
        });
      }
    }

    return {
      hasCollision: true,
      isUnauthorized: true,
      status: 'UNAUTHORIZED_BRAND',
      currentClientName: null,
      currentClientHasLogo: false,
      collisions,
      collidingBoxIds: Array.from(collidingBoxIds),
      message: collisions.length > 0
        ? `Unauthorized poster: Content matches registered client '${collisions[0].foreignClient.name}', but post has no authorized client.`
        : 'Unauthorized poster: No authorized client registered for this post.',
    };
  }

  const otherClients = allClients.filter((c) => c.id !== Number(currentClientId));

  const collisions = [];
  const collidingBoxIds = new Set();

  const combinedNormalized = normalizeText(text);
  const textPhones = extractPhoneDigits(text);
  const textDomains = extractDomains(text);

  for (const other of otherClients) {
    let clientCollisionFound = false;
    const reasons = [];

    // 1. Check Distinctive Brand Roots in text
    for (const root of other.distinctRoots) {
      if (!root || root.length < 4) continue;
      // Ensure root does NOT belong to current client's distinct roots
      if (currentClient && currentClient.distinctRoots.includes(root)) continue;

      // Word-boundary match in combined text
      const regex = new RegExp(`\\b${root}\\b`, 'i');
      if (regex.test(combinedNormalized)) {
        clientCollisionFound = true;
        reasons.push(`Brand name token '${root}' belongs to '${other.name}'`);
      }
    }

    // 2. Check Domains in text
    for (const domain of other.domains) {
      if (textDomains.includes(domain.toLowerCase()) || text.toLowerCase().includes(domain.toLowerCase())) {
        clientCollisionFound = true;
        reasons.push(`Website domain '${domain}' belongs to '${other.name}'`);
      }
    }

    // 3. Check Phone Numbers in text
    for (const phone of other.phones) {
      if (textPhones.includes(phone)) {
        clientCollisionFound = true;
        reasons.push(`Registered phone number '${phone}' belongs to '${other.name}'`);
      }
    }

    // 4. Check specific OCR boxes
    if (ocrBoxes && ocrBoxes.length > 0) {
      for (const box of ocrBoxes) {
        if (!box.text) continue;
        const boxNorm = normalizeText(box.text);
        const boxPhones = extractPhoneDigits(box.text);
        const boxDomains = extractDomains(box.text);

        for (const root of other.distinctRoots) {
          if (!root || root.length < 4) continue;
          if (currentClient && currentClient.distinctRoots.includes(root)) continue;
          const rRegex = new RegExp(`\\b${root}\\b`, 'i');
          const isFuzzyMatch = root.length >= 6 && fuzzball.partial_ratio(boxNorm, root) >= 95;
          if (rRegex.test(boxNorm) || isFuzzyMatch) {
            collidingBoxIds.add(box.id);
            clientCollisionFound = true;
            reasons.push(`Box #${box.id} contains brand '${root}' from '${other.name}'`);
          }
        }

        for (const domain of other.domains) {
          if (boxDomains.includes(domain.toLowerCase()) || box.text.toLowerCase().includes(domain.toLowerCase())) {
            collidingBoxIds.add(box.id);
            clientCollisionFound = true;
            reasons.push(`Box #${box.id} contains domain '${domain}' from '${other.name}'`);
          }
        }

        for (const phone of other.phones) {
          if (boxPhones.includes(phone)) {
            collidingBoxIds.add(box.id);
            clientCollisionFound = true;
            reasons.push(`Box #${box.id} contains phone '${phone}' from '${other.name}'`);
          }
        }
      }
    }

    if (clientCollisionFound) {
      collisions.push({
        foreignClient: { id: other.id, name: other.name },
        reasons: Array.from(new Set(reasons)),
      });
    }
  }

  return {
    hasCollision: collisions.length > 0,
    currentClientName: currentClient?.name || `Client #${currentClientId}`,
    currentClientHasLogo: Boolean(currentClient?.hasLogo),
    collisions,
    collidingBoxIds: Array.from(collidingBoxIds),
  };
};

module.exports = {
  normalizeText,
  extractPhoneDigits,
  extractDomains,
  getClientsIndex,
  detectCrossClientCollisions,
  getProfessionalTermsSet,
  isProfessionalTerm,
  // Backward compatibility alias populated strictly from professional_terms.json (no client hardcoding)
  get BRAND_STOP_WORDS() {
    return Array.from(getProfessionalTermsSet());
  },
};
