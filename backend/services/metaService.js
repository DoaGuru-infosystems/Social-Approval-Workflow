const pool = require('../config/db');
const { encrypt, decrypt } = require('../utils/encryption');
const { ensureJpegForInstagram } = require('../utils/imageConverter');

const GRAPH_API_VERSION = process.env.META_API_VERSION || 'v21.0';

const isFacebookKeyConfigured = () => {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return false;
  const cleanId = appId.trim();
  const cleanSecret = appSecret.trim();
  if (cleanId === '' || cleanSecret === '') return false;
  if (cleanId.startsWith('DUMMY') || cleanSecret.startsWith('DUMMY') || cleanId.startsWith('YOUR_')) return false;
  return true;
};

const isInstagramKeyConfigured = () => {
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appId || !appSecret) return false;
  const cleanId = appId.trim();
  const cleanSecret = appSecret.trim();
  if (cleanId === '' || cleanSecret === '') return false;
  if (cleanId.startsWith('DUMMY') || cleanSecret.startsWith('DUMMY') || cleanId.startsWith('YOUR_')) return false;
  return true;
};

const isKeyConfigured = (platform = 'facebook') => {
  if (platform === 'instagram') return isInstagramKeyConfigured();
  return isFacebookKeyConfigured();
};

/**
 * 1. Independent Facebook Flow:
 * Route: GET /api/auth/meta/facebook -> https://www.facebook.com/v21.0/dialog/oauth
 * Scope: pages_show_list,pages_read_engagement,pages_manage_posts
 */
const getFacebookAuthUrl = (clientId, frontendOrigin = null) => {
  if (!isFacebookKeyConfigured()) {
    return {
      success: false,
      code: 'OAUTH_KEY_NOT_FOUND',
      user_message: 'OAuth Key Nahi Mili - Manual wala use karo',
    };
  }

  const appId = process.env.META_APP_ID.trim();
  const redirectUri =
    process.env.META_FB_REDIRECT_URI ||
    process.env.META_REDIRECT_URI ||
    `http://localhost:${process.env.PORT || 5001}/api/auth/meta/facebook/callback`;

  const statePayload = Buffer.from(
    JSON.stringify({
      clientId,
      platform: 'facebook',
      redirectUri,
      frontendOrigin: frontendOrigin || process.env.CLIENT_REDIRECT_URL || 'http://localhost:5173',
      timestamp: Date.now(),
    })
  ).toString('base64');

  const scopes = [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
  ].join(',');

  const authUrl = `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&state=${statePayload}&scope=${encodeURIComponent(scopes)}`;

  return {
    success: true,
    authUrl,
    auth_url: authUrl,
  };
}; 

/**
 * 2. Independent Instagram Flow:
 * Route: GET /api/auth/meta/instagram -> https://www.instagram.com/oauth/authorize
 * Scope: instagram_business_basic,instagram_business_content_publish
 */
const getInstagramAuthUrl = (clientId, frontendOrigin = null) => {
  if (!isInstagramKeyConfigured()) {
    return {
      success: false,
      code: 'OAUTH_KEY_NOT_FOUND',
      user_message: 'Instagram OAuth Key Nahi Mili - Manual wala use karo',
    };
  }

  const appId = process.env.INSTAGRAM_APP_ID.trim();
  const redirectUri =
    process.env.META_IG_REDIRECT_URI ||
    process.env.META_REDIRECT_URI ||
    `http://localhost:${process.env.PORT || 5001}/api/auth/meta/instagram/callback`;

  const statePayload = Buffer.from(
    JSON.stringify({
      clientId,
      platform: 'instagram',
      redirectUri,
      frontendOrigin: frontendOrigin || process.env.CLIENT_REDIRECT_URL || 'http://localhost:5173',
      timestamp: Date.now(),
    })
  ).toString('base64');

  const scopes = [
    'instagram_business_basic',
    'instagram_business_content_publish',
  ].join(',');

  // Instagram API with Instagram Login authorize URL
  const authUrl = `https://www.instagram.com/oauth/authorize?enable_fb_login=0&force_authentication=1&client_id=${appId}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${statePayload}`;

  return {
    success: true,
    authUrl,
    auth_url: authUrl,
  };
};

/**
 * Unified entry point for backwards compatibility
 */
const getAuthUrl = (clientId, platform = 'facebook', frontendOrigin = null) => {
  const cleanPlatform = String(platform).toLowerCase().trim();
  if (cleanPlatform === 'instagram') {
    return getInstagramAuthUrl(clientId, frontendOrigin);
  }
  return getFacebookAuthUrl(clientId, frontendOrigin);
};

/**
 * Handle Facebook OAuth callback
 * Saves ONLY in facebook row, does NOT touch instagram row.
 */
const handleFacebookCallback = async (code, state, req = null) => {
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
  } catch (e) {
    throw new Error('Invalid OAuth state');
  }

  const { clientId } = decoded;
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  let redirectUri =
    decoded.redirectUri ||
    (req?.headers?.host ? `http://${req.headers.host}/api/auth/meta/facebook/callback` : null) ||
    process.env.META_FB_REDIRECT_URI ||
    process.env.META_REDIRECT_URI ||
    `http://localhost:${process.env.PORT || 5001}/api/auth/meta/facebook/callback`;

  // Exchange code for short-lived token
  let tokenUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&client_secret=${appSecret}&code=${code}`;

  let tokenRes = await fetch(tokenUrl);
  let tokenData = await tokenRes.json();

  // Handle port or redirect URI variations gracefully
  if (tokenData.error && tokenData.error.message && (tokenData.error.message.includes('redirect_uri') || tokenData.error.code === 100)) {
    const altUris = [];
    if (redirectUri.includes('5001')) altUris.push(redirectUri.replace('5001', '5000'));
    if (redirectUri.includes('5000')) altUris.push(redirectUri.replace('5000', '5001'));
    if (redirectUri.includes('/facebook/callback')) altUris.push(redirectUri.replace('/facebook/callback', '/callback'));

    for (const altUri of altUris) {
      console.log(`[Facebook OAuth] Retrying token exchange with URI: ${altUri}`);
      const retryUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(
        altUri
      )}&client_secret=${appSecret}&code=${code}`;
      const retryRes = await fetch(retryUrl);
      const retryData = await retryRes.json();
      if (!retryData.error) {
        tokenData = retryData;
        redirectUri = altUri;
        break;
      }
    }
  }

  if (tokenData.error) {
    throw new Error(`Facebook token exchange failed: ${tokenData.error.message}`);
  }

  const shortToken = tokenData.access_token;

  // Exchange for long-lived (60 day) token
  const longLivedUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`;
  const longLivedRes = await fetch(longLivedUrl);
  const longLivedData = await longLivedRes.json();
  const longToken = longLivedData.access_token || shortToken;

  // Fetch accounts (Pages)
  const accountsUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/me/accounts?fields=id,name,access_token&access_token=${longToken}`;
  const accountsRes = await fetch(accountsUrl);
  const accountsData = await accountsRes.json();

  const pages = accountsData.data || [];
  if (pages.length === 0) {
    // If no page, save generic token for Facebook
    const encToken = encrypt(longToken);
    await pool.query(
      `INSERT INTO client_social_accounts (client_id, platform, access_token_encrypted, token_expires_at, connection_method, is_connected, last_tested_at)
       VALUES (?, 'facebook', ?, DATE_ADD(NOW(), INTERVAL 60 DAY), 'oauth', TRUE, NOW())
       ON DUPLICATE KEY UPDATE access_token_encrypted = VALUES(access_token_encrypted), token_expires_at = VALUES(token_expires_at), connection_method = 'oauth', is_connected = TRUE, last_tested_at = NOW(), last_error = NULL`,
      [clientId, encToken]
    );
    return {
      clientId,
      platform: 'facebook',
      frontendOrigin: decoded.frontendOrigin || null,
    };
  }

  // Look for best matching page if client has existing record
  let selectedPage = pages[0];
  try {
    const [existingFbRows] = await pool.query(
      'SELECT platform_id, platform_username, profile_url FROM client_social_accounts WHERE client_id = ? AND platform = "facebook"',
      [clientId]
    );
    const existingFb = existingFbRows[0] || {};

    if (existingFb.platform_id) {
      const match = pages.find((p) => String(p.id) === String(existingFb.platform_id));
      if (match) selectedPage = match;
    } else if (existingFb.profile_url || existingFb.platform_username) {
      const target = (existingFb.platform_username || existingFb.profile_url || '').toLowerCase();
      const match = pages.find((p) => {
        const pName = (p.name || '').toLowerCase();
        return target.includes(pName) || pName.includes(target);
      });
      if (match) selectedPage = match;
    }
  } catch (err) {
    console.warn('[Facebook OAuth] Could not match existing page:', err.message);
  }

  const pageToken = selectedPage.access_token || longToken;
  const encPageToken = encrypt(pageToken);

  // Save ONLY Facebook Page row - DO NOT TOUCH INSTAGRAM!
  await pool.query(
    `INSERT INTO client_social_accounts (client_id, platform, platform_id, platform_username, access_token_encrypted, token_expires_at, connection_method, is_connected, last_tested_at)
     VALUES (?, 'facebook', ?, ?, ?, DATE_ADD(NOW(), INTERVAL 60 DAY), 'oauth', TRUE, NOW())
     ON DUPLICATE KEY UPDATE platform_id = VALUES(platform_id), platform_username = VALUES(platform_username), access_token_encrypted = VALUES(access_token_encrypted), token_expires_at = VALUES(token_expires_at), connection_method = 'oauth', is_connected = TRUE, last_tested_at = NOW(), last_error = NULL`,
    [clientId, selectedPage.id, selectedPage.name, encPageToken]
  );

  return {
    clientId,
    platform: 'facebook',
    frontendOrigin: decoded.frontendOrigin || null,
  };
};

/**
 * Strictly query Meta's Instagram Graph API to retrieve verified user identity.
 * Primary documented endpoint for Instagram Login:
 *   GET https://graph.instagram.com/v21.0/me?fields=id,username,account_type
 * Documented node endpoint using actual user_id from OAuth code exchange:
 *   GET https://graph.instagram.com/v21.0/{user_id}?fields=id,username,account_type
 *
 * Logs exact hostname, API version, endpoint, HTTP status, and full Meta error JSON. Never logs access token.
 * Never invents, guesses, or infers usernames from client business names.
 */
const fetchInstagramIdentity = async (accessToken, fallbackUserId = null) => {
  if (!accessToken) {
    return { id: null, username: null, account_type: null, error: 'Access token missing' };
  }

  const apiVersion = process.env.META_API_VERSION?.trim() || 'v21.0';
  const cleanUserId = fallbackUserId ? String(fallbackUserId).trim() : null;

  // Documented candidates:
  // 1. Primary: GET https://graph.instagram.com/{version}/me?fields=id,username,account_type (minimal supported fields only)
  // 2. User Node: GET https://graph.instagram.com/{version}/{user_id}?fields=id,username,account_type
  const candidateRequests = [
    {
      hostname: 'graph.instagram.com',
      apiVersion,
      endpoint: '/me',
      fields: 'id,username,account_type',
      url: `https://graph.instagram.com/${apiVersion}/me?fields=id,username,account_type&access_token=${encodeURIComponent(accessToken)}`,
    },
  ];

  if (cleanUserId) {
    candidateRequests.push({
      hostname: 'graph.instagram.com',
      apiVersion,
      endpoint: `/${cleanUserId}`,
      fields: 'id,username,account_type',
      url: `https://graph.instagram.com/${apiVersion}/${encodeURIComponent(cleanUserId)}?fields=id,username,account_type&access_token=${encodeURIComponent(accessToken)}`,
    });
  }

  // Unversioned fallbacks
  candidateRequests.push({
    hostname: 'graph.instagram.com',
    apiVersion: 'unversioned',
    endpoint: '/me',
    fields: 'id,username,account_type',
    url: `https://graph.instagram.com/me?fields=id,username,account_type&access_token=${encodeURIComponent(accessToken)}`,
  });

  if (cleanUserId) {
    candidateRequests.push({
      hostname: 'graph.instagram.com',
      apiVersion: 'unversioned',
      endpoint: `/${cleanUserId}`,
      fields: 'id,username,account_type',
      url: `https://graph.instagram.com/${encodeURIComponent(cleanUserId)}?fields=id,username,account_type&access_token=${encodeURIComponent(accessToken)}`,
    });
  }

  let lastError = null;
  let errorDetails = null;

  for (const req of candidateRequests) {
    try {
      const res = await fetch(req.url);
      const data = await res.json();

      // STRICT VALIDATION: Code 100 or data.error must NEVER be interpreted as success
      if (data && !data.error && (data.username || data.id || data.user_id)) {
        const verifiedId = String(data.id || data.user_id || cleanUserId);
        const verifiedUsername = data.username ? String(data.username).trim() : null;

        console.log(`[Instagram Identity] Verified via ${req.hostname} ${req.apiVersion}${req.endpoint} (HTTP ${res.status}): ID=${verifiedId}, username=${verifiedUsername}`);
        return {
          id: verifiedId,
          username: verifiedUsername,
          account_type: data.account_type || null,
          name: data.name || null,
          raw: data,
          error: null,
        };
      }

      if (data?.error) {
        lastError = data.error.message || `Meta API Error ${data.error.code}`;
        errorDetails = data.error;
        console.warn(`[Instagram Identity] Diagnostic Log: hostname=${req.hostname}, apiVersion=${req.apiVersion}, endpoint=${req.endpoint}, fields=${req.fields}, HTTP=${res.status}, error=${JSON.stringify(data.error)}`);
      }
    } catch (err) {
      lastError = err.message;
      console.warn(`[Instagram Identity] Network failure on ${req.hostname} ${req.endpoint}:`, err.message);
    }
  }

  return {
    id: cleanUserId,
    username: null,
    account_type: null,
    name: null,
    error: lastError || 'Meta did not return a valid profile for this token',
    errorDetails,
  };
};

/**
 * Handle Instagram OAuth callback
 * Saves ONLY in instagram row, does NOT touch facebook row.
 */
const handleInstagramCallback = async (code, state, req = null) => {
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
  } catch (e) {
    throw new Error('Invalid OAuth state');
  }

  const { clientId } = decoded;
  if (!clientId) {
    throw new Error('OAuth state missing clientId');
  }

  const appId = process.env.INSTAGRAM_APP_ID?.trim();
  const appSecret = process.env.INSTAGRAM_APP_SECRET?.trim();

  if (!appId || !appSecret) {
    throw new Error('INSTAGRAM_APP_ID or INSTAGRAM_APP_SECRET is not configured in .env');
  }

  // Instagram sometimes appends #_ to the code parameter
  const cleanCode = code ? String(code).replace(/#_$/, '').trim() : '';
  if (!cleanCode) {
    throw new Error('Missing authorization code from Instagram');
  }

  const redirectUri =
    decoded.redirectUri ||
    process.env.META_IG_REDIRECT_URI ||
    process.env.META_REDIRECT_URI ||
    (req?.headers?.host ? `http://${req.headers.host}/api/auth/meta/instagram/callback` : null) ||
    `http://localhost:${process.env.PORT || 5001}/api/auth/meta/instagram/callback`;

  // Exchange authorization code for short-lived token via api.instagram.com
  const params = new URLSearchParams();
  params.append('client_id', appId);
  params.append('client_secret', appSecret);
  params.append('grant_type', 'authorization_code');
  params.append('redirect_uri', redirectUri);
  params.append('code', cleanCode);

  let tokenRes;
  try {
    tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
  } catch (netErr) {
    throw new Error(`Failed to connect to Instagram token endpoint: ${netErr.message}`);
  }

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok || !tokenData.access_token) {
    const errorMsg =
      tokenData.error_message ||
      tokenData.error_description ||
      (typeof tokenData.error === 'string' ? tokenData.error : tokenData.error?.message) ||
      `Instagram token exchange failed with status ${tokenRes.status}`;
    console.error('[Instagram OAuth] Code exchange failed:', errorMsg);
    throw new Error(`Instagram token exchange failed: ${errorMsg}`);
  }

  const shortToken = tokenData.access_token;
  let igUserId = tokenData.user_id ? String(tokenData.user_id) : null;
  let igAccessToken = shortToken;
  let tokenExpiresIn = 5184000; // 60 days default

  // Exchange short-lived token for long-lived (60-day) token via graph.instagram.com
  try {
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(appSecret)}&access_token=${encodeURIComponent(shortToken)}`
    );
    const longData = await longRes.json();
    if (longData.access_token) {
      igAccessToken = longData.access_token;
      if (longData.expires_in) tokenExpiresIn = Number(longData.expires_in);
    } else if (longData.error) {
      console.warn('[Instagram OAuth] Long-lived token exchange warning:', longData.error.message || longData.error);
    }
  } catch (longErr) {
    console.warn('[Instagram OAuth] Long-lived token exchange request failed:', longErr.message);
  }

  // Retrieve Instagram account ID and username strictly from Meta API
  let identity = await fetchInstagramIdentity(igAccessToken, igUserId);

  // If long-lived token fails identity retrieval, attempt verification with short-lived token
  if (!identity.username && igAccessToken !== shortToken) {
    console.log('[Instagram OAuth] Attempting identity retrieval with short-lived token...');
    const shortIdentity = await fetchInstagramIdentity(shortToken, igUserId);
    if (shortIdentity.username) {
      identity = shortIdentity;
    }
  }

  const verifiedUsername = identity.username ? String(identity.username).trim() : null;
  const verifiedUserId = identity.id ? String(identity.id).trim() : (igUserId ? String(igUserId).trim() : null);
  const verifiedAccountType = identity.account_type || null;

  const encToken = encrypt(igAccessToken);

  // STRICT IDENTITY GATE: If Meta did not return a verified username or ID, reject connection
  // Never guess, synthesize, or infer usernames from client business names
  if (!verifiedUsername || !verifiedUserId) {
    const reasonMsg = identity.error || 'Meta authorized account but did not return a verified username';
    console.error('[Instagram OAuth] Strict Identity Verification Failed:', reasonMsg);

    // Save as UNCONNECTED record with NULL username/url to prevent false associations
    await pool.query(
      `INSERT INTO client_social_accounts (
         client_id, platform, platform_id, platform_username, profile_url,
         access_token_encrypted, token_expires_at, connection_method, is_connected, last_tested_at, last_error
       )
       VALUES (?, 'instagram', ?, NULL, NULL, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), 'oauth', FALSE, NOW(), ?)
       ON DUPLICATE KEY UPDATE 
         platform_id = VALUES(platform_id), 
         platform_username = NULL, 
         profile_url = NULL, 
         access_token_encrypted = VALUES(access_token_encrypted), 
         token_expires_at = VALUES(token_expires_at), 
         connection_method = 'oauth', 
         is_connected = FALSE, 
         last_tested_at = NOW(), 
         last_error = VALUES(last_error)`,
      [clientId, verifiedUserId || null, encToken, tokenExpiresIn, `Identity Verification Failed: ${reasonMsg}`]
    );

    throw new Error(`Instagram identity verification failed: ${reasonMsg}`);
  }

  // Cross-client conflict check: detect if this Instagram account is already connected to another client
  const [conflictRows] = await pool.query(
    `SELECT csa.client_id, c.name as client_name, csa.platform_username
     FROM client_social_accounts csa
     JOIN clients c ON csa.client_id = c.id
     WHERE csa.platform = 'instagram'
       AND (csa.platform_id = ? OR (csa.platform_username IS NOT NULL AND LOWER(csa.platform_username) = LOWER(?)))
       AND csa.client_id != ?
       AND csa.is_connected = TRUE`,
    [verifiedUserId, verifiedUsername, clientId]
  );

  let conflictWarning = null;
  if (conflictRows.length > 0) {
    const conflictingClient = conflictRows[0];
    conflictWarning = `Instagram account @${verifiedUsername} is already connected to client "${conflictingClient.client_name}" (ID: ${conflictingClient.client_id}).`;
    console.warn(`[Instagram OAuth] Multi-client conflict detected: @${verifiedUsername} (ID: ${verifiedUserId}) is already connected to Client ${conflictingClient.client_id} (${conflictingClient.client_name})`);
  }

  // Profile URL constructed ONLY from verified Meta username
  const profileUrl = `https://instagram.com/${verifiedUsername}`;

  // Encrypt token and save ONLY the verified Instagram account record
  await pool.query(
    `INSERT INTO client_social_accounts (
       client_id, platform, platform_id, platform_username, profile_url,
       access_token_encrypted, token_expires_at, connection_method, is_connected, last_tested_at, last_error
     )
     VALUES (?, 'instagram', ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), 'oauth', TRUE, NOW(), NULL)
     ON DUPLICATE KEY UPDATE 
       platform_id = VALUES(platform_id), 
       platform_username = VALUES(platform_username), 
       profile_url = VALUES(profile_url), 
       access_token_encrypted = VALUES(access_token_encrypted), 
       token_expires_at = VALUES(token_expires_at), 
       connection_method = 'oauth', 
       is_connected = TRUE, 
       last_tested_at = NOW(), 
       last_error = NULL`,
    [clientId, verifiedUserId, verifiedUsername, profileUrl, encToken, tokenExpiresIn]
  );

  return {
    clientId,
    platform: 'instagram',
    platformId: verifiedUserId,
    username: verifiedUsername,
    accountType: verifiedAccountType,
    profileUrl,
    warning: conflictWarning,
    frontendOrigin: decoded.frontendOrigin || null,
  };
};

/**
 * Universal callback dispatcher
 */
const handleCallback = async (code, state, req = null) => {
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
  } catch (e) {
    throw new Error('Invalid OAuth state');
  }

  if (decoded.platform === 'instagram') {
    return handleInstagramCallback(code, state, req);
  }
  return handleFacebookCallback(code, state, req);
};

/**
 * Test Meta token (Facebook or Instagram independently)
 */
const testConnection = async (account) => {
  if (!account || !account.access_token_encrypted) {
    return { valid: false, error: 'Access token not provided' };
  }

  const rawToken = decrypt(account.access_token_encrypted);
  if (!rawToken) {
    return { valid: false, error: 'Could not decrypt access token' };
  }

  // Handle mock / test tokens gracefully
  if (rawToken.startsWith('fake_') || rawToken.startsWith('invalid_')) {
    return { valid: false, error: 'Token is invalid or expired (Mock rejection)' };
  }

  try {
    if (account.platform === 'instagram') {
      // 1. Strictly test via fetchInstagramIdentity against Meta endpoints
      const identity = await fetchInstagramIdentity(rawToken, account.platform_id);
      if (identity.username) {
        return {
          valid: true,
          accountName: identity.username,
          platformId: identity.id || account.platform_id,
          profileUrl: `https://instagram.com/${identity.username}`,
          accountType: identity.account_type || null,
        };
      }

      // 2. Fallback for Page Token with Instagram platform_id on graph.facebook.com
      if (account.platform_id) {
        try {
          const fbUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(account.platform_id)}?fields=id,username,name&access_token=${encodeURIComponent(rawToken)}`;
          const fbRes = await fetch(fbUrl);
          const fbData = await fbRes.json();
          if (fbData && !fbData.error && fbData.username) {
            return {
              valid: true,
              accountName: fbData.username,
              platformId: fbData.id || account.platform_id,
              profileUrl: `https://instagram.com/${fbData.username}`,
            };
          }
        } catch (fbErr) {}
      }

      // 3. Token verification failed or expired - NEVER return guessed or existing DB username
      return {
        valid: false,
        error: identity.error || 'Instagram token verification failed (No verified profile data returned from Meta)',
        code: identity.errorDetails?.code,
        type: identity.errorDetails?.type,
        fbtrace_id: identity.errorDetails?.fbtrace_id,
        accountName: null,
        platformId: account.platform_id || null,
        profileUrl: null,
      };
    }

    // Facebook test
    const fbUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/me?fields=id,name&access_token=${encodeURIComponent(rawToken)}`;
    const res = await fetch(fbUrl);
    const data = await res.json();
    if (data.error) {
      return { valid: false, error: data.error.message || 'Facebook token verification failed' };
    }
    return {
      valid: true,
      accountName: data.name || account.platform_username,
      platformId: data.id || account.platform_id,
    };
  } catch (err) {
    return { valid: false, error: err.message };
  }
};

/**
 * Publish post to Facebook - uses ONLY Facebook Page Token
 */
const publishFacebook = async (account, post) => {
  const token = decrypt(account.access_token_encrypted);
  if (!token) throw new Error('Facebook access token missing');

  if (token.startsWith('valid_mock_') || token.startsWith('EAAB_mock_')) {
    return {
      success: true,
      id: `fb_post_${Date.now()}`,
      url: `https://facebook.com/post/mock_${Date.now()}`,
    };
  }

  const pageId = account.platform_id || 'me';
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/feed`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: post.caption,
      access_token: token,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return {
    success: true,
    id: data.id,
    url: `https://facebook.com/${data.id}`,
  };
};

/**
 * Publish post to Instagram - uses ONLY Instagram Token via graph.instagram.com
 */
/**
 * Publish post to Instagram - uses ONLY Instagram Token via graph.instagram.com
 * Implements the documented 3-step Instagram Graph API Publishing Flow:
 * 1. POST /{IG_USER_ID}/media (creates media container with JPEG image)
 * 2. GET /{CONTAINER_ID}?fields=status_code (polls until container status is FINISHED)
 * 3. POST /{IG_USER_ID}/media_publish (publishes container to live Instagram profile)
 */
const publishInstagram = async (account, post) => {
  const token = decrypt(account.access_token_encrypted);
  if (!token) throw new Error('Instagram access token missing');

  if (token.startsWith('valid_mock_') || token.startsWith('EAAB_mock_')) {
    return {
      success: true,
      id: `ig_post_${Date.now()}`,
      url: `https://instagram.com/p/mock_${Date.now()}`,
    };
  }

  const igUserId = account.platform_id || 'me';
  const apiHost = 'graph.instagram.com';
  const apiVersion = GRAPH_API_VERSION;

  // 1. Ensure image is JPEG format (Meta Instagram API strictly rejects PNG images)
  let rawImagePath = post.image_path;
  if (rawImagePath && !rawImagePath.startsWith('http')) {
    rawImagePath = await ensureJpegForInstagram(rawImagePath);
  }

  // Resolve public image URL from post.image_url or converted post.image_path
  let imageUrl = post.image_url;
  if (!imageUrl && rawImagePath) {
    if (rawImagePath.startsWith('http://') || rawImagePath.startsWith('https://')) {
      imageUrl = rawImagePath;
    } else {
      let publicOrigin = process.env.PUBLIC_URL;
      if (!publicOrigin && process.env.META_REDIRECT_URI) {
        try {
          const parsed = new URL(process.env.META_REDIRECT_URI);
          publicOrigin = `${parsed.protocol}//${parsed.host}`;
        } catch {}
      }
      if (!publicOrigin) {
        publicOrigin = `http://localhost:${process.env.PORT || 5001}`;
      }
      const cleanPath = rawImagePath.replace(/^[\\/]+/, '').replace(/\\/g, '/');
      imageUrl = `${publicOrigin}/${cleanPath}`;
    }
  }

  if (!imageUrl) {
    throw new Error('Image URL is required for Instagram publication');
  }

  // STEP 1: POST /{IG_ID}/media - Create Media Container
  const containerEndpoint = `/${igUserId}/media`;
  console.log('[Instagram Publish - Step 1/3] Initiating media container creation:', {
    hostname: apiHost,
    version: apiVersion,
    endpoint: containerEndpoint,
    method: 'POST',
    paramNames: ['image_url', 'caption', 'access_token'],
    imageUrlHost: new URL(imageUrl).hostname,
    imageUrlPath: new URL(imageUrl).pathname,
    hasCaption: Boolean(post.caption),
  });

  const containerParams = new URLSearchParams({
    image_url: imageUrl,
    caption: post.caption || '',
    access_token: token,
  });

  let cRes;
  let cData;
  try {
    cRes = await fetch(`https://${apiHost}/${apiVersion}${containerEndpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: containerParams.toString(),
    });
    cData = await cRes.json();
  } catch (netErr) {
    console.error('[Instagram Publish - Step 1/3] Network failure contacting Meta API:', netErr.message);
    throw new Error(`Failed to contact Meta Instagram API: ${netErr.message}`);
  }

  console.log('[Instagram Publish - Step 1/3] Meta Container Response:', {
    status: cRes.status,
    hasError: Boolean(cData?.error),
    errorCode: cData?.error?.code || null,
    errorType: cData?.error?.type || null,
    errorMessage: cData?.error?.message || null,
    fbtrace_id: cData?.error?.fbtrace_id || null,
    containerId: cData?.id || null,
  });

  if (cData.error) {
    const errorMsg = cData.error.message || `Meta API Error ${cData.error.code || 100}`;
    throw new Error(`Instagram publishing failed at container creation (Step 1): ${errorMsg}`);
  }

  const containerId = cData.id;
  if (!containerId) {
    throw new Error('Failed to obtain creation_id container ID from Meta API');
  }

  // STEP 2: GET /{CONTAINER_ID}?fields=status_code - Verify Container Status
  const statusEndpoint = `/${containerId}`;
  console.log('[Instagram Publish - Step 2/3] Checking container status:', {
    hostname: apiHost,
    version: apiVersion,
    endpoint: statusEndpoint,
    method: 'GET',
    paramNames: ['fields', 'access_token'],
  });

  let isReady = false;
  let attempts = 0;
  const maxAttempts = 5;

  while (!isReady && attempts < maxAttempts) {
    attempts++;
    try {
      const sRes = await fetch(
        `https://${apiHost}/${apiVersion}${statusEndpoint}?fields=status_code&access_token=${encodeURIComponent(token)}`
      );
      const sData = await sRes.json();
      console.log(`[Instagram Publish - Step 2/3] Status attempt ${attempts}/${maxAttempts}:`, {
        status_code: sData.status_code || null,
        error: sData.error?.message || null,
      });

      if (sData.status_code === 'FINISHED') {
        isReady = true;
        break;
      } else if (sData.status_code === 'ERROR') {
        throw new Error(`Media container processing failed on Meta with status ERROR`);
      } else if (sData.status_code === 'IN_PROGRESS') {
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        // Instant container or endpoint without status_code
        isReady = true;
        break;
      }
    } catch (statusErr) {
      console.warn(`[Instagram Publish - Step 2/3] Status check warning: ${statusErr.message}`);
      break;
    }
  }

  // STEP 3: POST /{IG_ID}/media_publish - Publish Container
  const publishEndpoint = `/${igUserId}/media_publish`;
  console.log('[Instagram Publish - Step 3/3] Triggering media publication:', {
    hostname: apiHost,
    version: apiVersion,
    endpoint: publishEndpoint,
    method: 'POST',
    paramNames: ['creation_id', 'access_token'],
    containerId,
  });

  const publishParams = new URLSearchParams({
    creation_id: containerId,
    access_token: token,
  });

  let pRes;
  let pData;
  try {
    pRes = await fetch(`https://${apiHost}/${apiVersion}${publishEndpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: publishParams.toString(),
    });
    pData = await pRes.json();
  } catch (pubNetErr) {
    console.error('[Instagram Publish - Step 3/3] Network failure during publication:', pubNetErr.message);
    throw new Error(`Failed to contact Meta publish endpoint: ${pubNetErr.message}`);
  }

  console.log('[Instagram Publish - Step 3/3] Meta Publication Response:', {
    status: pRes.status,
    hasError: Boolean(pData?.error),
    errorCode: pData?.error?.code || null,
    errorType: pData?.error?.type || null,
    errorMessage: pData?.error?.message || null,
    fbtrace_id: pData?.error?.fbtrace_id || null,
    publishedPostId: pData?.id || null,
  });

  if (pData.error) {
    const errorMsg = pData.error.message || `Meta API Error ${pData.error.code || 100}`;
    throw new Error(`Instagram publishing failed at media_publish (Step 3): ${errorMsg}`);
  }

  // Fetch real Instagram permalink with alphanumeric shortcode (e.g. https://www.instagram.com/p/DgFYiQnn354/)
  // Using numeric media ID directly in URL results in Instagram "Post isn't available" error.
  let postUrl = `https://instagram.com/p/${pData.id}`;
  try {
    const permalinkRes = await fetch(
      `https://${apiHost}/${apiVersion}/${pData.id}?fields=permalink,shortcode,id&access_token=${encodeURIComponent(token)}`
    );
    const permalinkData = await permalinkRes.json();
    if (permalinkData && permalinkData.permalink) {
      postUrl = permalinkData.permalink;
      console.log('[Instagram Publish] Verified live permalink fetched:', postUrl);
    } else if (permalinkData && permalinkData.shortcode) {
      postUrl = `https://www.instagram.com/p/${permalinkData.shortcode}/`;
    }
  } catch (permalinkErr) {
    console.warn('[Instagram Publish] Could not fetch live permalink, falling back to ID URL:', permalinkErr.message);
  }

  return {
    success: true,
    id: pData.id,
    url: postUrl,
  };
};

module.exports = {
  isKeyConfigured,
  isFacebookKeyConfigured,
  isInstagramKeyConfigured,
  getAuthUrl,
  getFacebookAuthUrl,
  getInstagramAuthUrl,
  handleCallback,
  handleFacebookCallback,
  handleInstagramCallback,
  testConnection,
  publishFacebook,
  publishInstagram,
};
