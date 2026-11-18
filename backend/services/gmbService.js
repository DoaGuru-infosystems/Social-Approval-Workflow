const pool = require('../config/db');

const STOPWORDS = new Set([
  'the', 'and', 'of', 'near', 'in', 'at', 'to', 'for', 'on', 'a', 'an', 'by',
  'with', 'from', 'is', 'as', 'or', 'road', 'street', 'nagar', 'colony', 'area',
  'behind', 'opposite', 'beside', 'floor', 'plot', 'shop', 'no'
]);

/**
 * Extract Google Place ID from GMB / Maps URL if present.
 * Looks for standard 'ChIJ...' 27-character place IDs.
 * @param {string} gmbUrl
 * @returns {string|null}
 */
const extractPlaceId = (gmbUrl) => {
  if (!gmbUrl || typeof gmbUrl !== 'string') return null;

  // Look for standard 'ChIJ...' place IDs (typically 27 characters total)
  const chijMatch = gmbUrl.match(/(ChIJ[a-zA-Z0-9_-]{20,40})/);
  if (chijMatch) return chijMatch[1];

  // Also check query param or key like place_id=... or place_id:...
  const paramMatch = gmbUrl.match(/place_id[:=]([a-zA-Z0-9_-]+)/i);
  if (paramMatch) return paramMatch[1];

  const dataMatch = gmbUrl.match(/!1s(ChIJ[a-zA-Z0-9_-]+)/);
  if (dataMatch) return dataMatch[1];

  return null;
};

/**
 * Check Google Places API key status in environment.
 * Free Mode: Missing or DUMMY_REPLACE_LATER means manual mode is active.
 * @returns {{ status: 'MISSING' | 'PRESENT', code?: string }}
 */
const getKeyStatus = () => {
  const apiKey = (process.env.GOOGLE_PLACES_API_KEY || '').trim();
  if (!apiKey || apiKey === 'DUMMY_REPLACE_LATER') {
    return { status: 'MISSING', code: 'GMB_KEY_NOT_FOUND' };
  }
  return { status: 'PRESENT' };
};

/**
 * Resolve Place ID via URL extraction or Places API Search Text.
 * If key is DUMMY or empty, returns null safely without throwing.
 * @param {string} gmbUrl
 * @param {string} clientName
 * @param {string} clientAddress
 * @returns {Promise<{ placeId: string|null, keyMissing?: boolean, keyInvalid?: boolean, error?: string }>}
 */
const resolvePlaceId = async (gmbUrl, clientName = '', clientAddress = '') => {
  const extracted = extractPlaceId(gmbUrl);
  if (extracted) {
    return { placeId: extracted };
  }

  const keyStatus = getKeyStatus();
  if (keyStatus.status === 'MISSING') {
    console.log('[gmbService] Places API key not configured, skipping GMB search');
    return { placeId: null, keyMissing: true };
  }

  const apiKey = (process.env.GOOGLE_PLACES_API_KEY || '').trim();
  const queryText = `${clientName || ''} ${clientAddress || ''}`.trim();
  if (!queryText) return { placeId: null };

  try {
    const url = 'https://places.googleapis.com/v1/places:searchText';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName',
      },
      body: JSON.stringify({ textQuery: queryText }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[gmbService] Places searchText returned status ${res.status}: ${errText.slice(0, 150)}`);
      const isKeyInvalid =
        res.status === 400 ||
        res.status === 401 ||
        res.status === 403 ||
        /API key not valid|keyInvalid|PERMISSION_DENIED|UNAUTHENTICATED/i.test(errText);
      if (isKeyInvalid) {
        return { placeId: null, keyInvalid: true, error: errText };
      }
      return { placeId: null };
    }

    const data = await res.json();
    return { placeId: data.places?.[0]?.id || null };
  } catch (err) {
    console.warn(`[gmbService] resolvePlaceId error: ${err.message}`);
    return { placeId: null };
  }
};

/**
 * Fetch detailed place attributes from Google Places API (New).
 * @param {string} placeId
 * @returns {Promise<{ details: Object|null, keyMissing?: boolean, keyInvalid?: boolean, error?: string }>}
 */
const fetchGmbDetails = async (placeId) => {
  if (!placeId) return { details: null };

  const keyStatus = getKeyStatus();
  if (keyStatus.status === 'MISSING') {
    console.log('[gmbService] Places API key not configured, skipping GMB details fetch');
    return { details: null, keyMissing: true };
  }

  const apiKey = (process.env.GOOGLE_PLACES_API_KEY || '').trim();

  try {
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,types,editorialSummary',
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[gmbService] Places getDetails returned status ${res.status}: ${errText.slice(0, 150)}`);
      const isKeyInvalid =
        res.status === 400 ||
        res.status === 401 ||
        res.status === 403 ||
        /API key not valid|keyInvalid|PERMISSION_DENIED|UNAUTHENTICATED/i.test(errText);
      if (isKeyInvalid) {
        return { details: null, keyInvalid: true, error: errText };
      }
      return { details: null };
    }

    const data = await res.json();
    return {
      details: {
        officialName: data.displayName?.text || '',
        formattedAddress: data.formattedAddress || '',
        nationalPhoneNumber: data.nationalPhoneNumber || '',
        internationalPhoneNumber: data.internationalPhoneNumber || '',
        categories: Array.isArray(data.types) ? data.types : [],
        editorialSummary: data.editorialSummary?.text || '',
      },
    };
  } catch (err) {
    console.warn(`[gmbService] fetchGmbDetails error: ${err.message}`);
    return { details: null };
  }
};

/**
 * Build auto-whitelist tokens from GMB Snapshot.
 * Splits officialName, formattedAddress, and categories into deduplicated clean lowercase tokens.
 * @param {Object} snapshot
 * @returns {string[]}
 */
const buildAutoWhitelist = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return [];

  const rawTokens = [];

  if (snapshot.officialName) {
    rawTokens.push(
      ...snapshot.officialName
        .toLowerCase()
        .split(/[\s,.\-\/()]+/)
        .filter(Boolean)
    );
  }

  if (snapshot.formattedAddress) {
    rawTokens.push(
      ...snapshot.formattedAddress
        .toLowerCase()
        .split(/[\s,.\-\/()]+/)
        .filter(Boolean)
    );
  }

  if (Array.isArray(snapshot.categories)) {
    for (const cat of snapshot.categories) {
      if (typeof cat === 'string') {
        rawTokens.push(...cat.toLowerCase().split(/[_\s\-]+/).filter(Boolean));
      }
    }
  }

  const tokenSet = new Set();
  for (const token of rawTokens) {
    const clean = token.replace(/[^\w\u0900-\u097f]/g, '').trim();
    if (clean.length >= 2 && !STOPWORDS.has(clean) && isNaN(clean)) {
      tokenSet.add(clean);
    }
  }

  return Array.from(tokenSet);
};

/**
 * Determine if client GMB should be synced.
 * Returns true ONLY if gmb_url is present AND (gmb_last_synced_at is null OR older than 7 days).
 * @param {Object} client
 * @returns {boolean}
 */
const shouldSync = (client) => {
  if (!client || !client.gmb_url) return false;
  if (!client.gmb_last_synced_at) return true;

  const lastSyncTime = new Date(client.gmb_last_synced_at).getTime();
  if (isNaN(lastSyncTime)) return true;

  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return Date.now() - lastSyncTime >= sevenDaysMs;
};

/**
 * Execute GMB sync for a single client with strict 7-day rate-limiting.
 * NEVER overwrites manual fields.
 * @param {number} clientId
 * @returns {Promise<Object>}
 */
const syncClientGmb = async (clientId) => {
  const [rows] = await pool.query('SELECT * FROM clients WHERE id = ?', [clientId]);
  if (rows.length === 0) {
    return { success: false, message: 'Client not found.' };
  }

  const client = rows[0];

  if (!client.gmb_url) {
    return {
      success: false,
      skipped: true,
      reason: 'No GMB URL configured for this client.',
    };
  }

  // 1. Check API Key Status first - NEVER throw, NEVER update gmb_last_synced_at, NEVER touch manual fields
  const keyStatus = getKeyStatus();
  if (keyStatus.status === 'MISSING') {
    return {
      success: false,
      skipped: true,
      keyError: {
        service: 'google_places',
        code: 'GMB_KEY_NOT_FOUND',
        user_message:
          'GMB API Key Not Found - Manual data se kaam chal raha hai. Auto-sync ke liye .env me GOOGLE_PLACES_API_KEY dalo.',
      },
    };
  }

  // 2. Weekly rate-limit guard
  if (!shouldSync(client)) {
    return {
      success: true,
      skipped: true,
      reason: 'synced within 7 days',
      last_synced_at: client.gmb_last_synced_at,
      gmb_snapshot: typeof client.gmb_snapshot === 'string' ? JSON.parse(client.gmb_snapshot) : client.gmb_snapshot,
      gmb_auto_whitelist: typeof client.gmb_auto_whitelist === 'string' ? JSON.parse(client.gmb_auto_whitelist) : client.gmb_auto_whitelist,
    };
  }

  // 3. Resolve Place ID
  const resolveRes = await resolvePlaceId(client.gmb_url, client.name, client.address);
  if (resolveRes?.keyMissing) {
    return {
      success: false,
      skipped: true,
      keyError: {
        service: 'google_places',
        code: 'GMB_KEY_NOT_FOUND',
        user_message:
          'GMB API Key Not Found - Manual data se kaam chal raha hai. Auto-sync ke liye .env me GOOGLE_PLACES_API_KEY dalo.',
      },
    };
  }

  if (resolveRes?.keyInvalid) {
    return {
      success: false,
      keyError: {
        service: 'google_places',
        code: 'GMB_KEY_INVALID',
        user_message:
          'GMB API Key Invalid - Key check karo ya billing ON karo. Manual data se kaam chal raha hai.',
      },
    };
  }

  const placeId = resolveRes?.placeId || (typeof resolveRes === 'string' ? resolveRes : null);
  if (!placeId) {
    return {
      success: false,
      skipped: true,
      reason: 'Could not resolve GMB Place ID from URL or Name.',
      last_synced_at: client.gmb_last_synced_at,
    };
  }

  // 4. Fetch Details from Places API
  const detailsRes = await fetchGmbDetails(placeId);
  if (detailsRes?.keyMissing) {
    return {
      success: false,
      skipped: true,
      keyError: {
        service: 'google_places',
        code: 'GMB_KEY_NOT_FOUND',
        user_message:
          'GMB API Key Not Found - Manual data se kaam chal raha hai. Auto-sync ke liye .env me GOOGLE_PLACES_API_KEY dalo.',
      },
    };
  }

  if (detailsRes?.keyInvalid) {
    return {
      success: false,
      keyError: {
        service: 'google_places',
        code: 'GMB_KEY_INVALID',
        user_message:
          'GMB API Key Invalid - Key check karo ya billing ON karo. Manual data se kaam chal raha hai.',
      },
    };
  }

  const snapshot = detailsRes?.details;
  if (!snapshot || !snapshot.officialName) {
    return {
      success: false,
      skipped: true,
      reason: 'Failed to fetch GMB details from Google Places API.',
      last_synced_at: client.gmb_last_synced_at,
    };
  }

  const autoWhitelist = buildAutoWhitelist(snapshot);

  // Update ONLY GMB columns — NEVER overwrite manual fields (name, phone, address, whitelist, banned, mandatory)
  await pool.query(
    `UPDATE clients 
     SET gmb_place_id = ?,
         gmb_snapshot = ?,
         gmb_auto_whitelist = ?,
         gmb_last_synced_at = NOW()
     WHERE id = ?`,
    [placeId, JSON.stringify(snapshot), JSON.stringify(autoWhitelist), clientId]
  );

  return {
    success: true,
    skipped: false,
    gmb_snapshot: snapshot,
    gmb_auto_whitelist: autoWhitelist,
    gmb_last_synced_at: new Date().toISOString(),
  };
};

module.exports = {
  getKeyStatus,
  extractPlaceId,
  resolvePlaceId,
  fetchGmbDetails,
  buildAutoWhitelist,
  shouldSync,
  syncClientGmb,
};
