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
 * Scope: pages_show_list,pages_manage_posts,pages_read_engagement,business_management
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
   /*  */ 'pages_show_list',
    'pages_manage_posts',
    'pages_read_engagement',
    'business_management',
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

  // Retrieve Instagram account ID and username
  let igUsername = null;
  try {
    const meRes = await fetch(
      `https://graph.instagram.com/me?fields=id,username,account_type&access_token=${encodeURIComponent(igAccessToken)}`
    );
    const meData = await meRes.json();
    if (meData.username) igUsername = meData.username;
    if (meData.id || meData.user_id) igUserId = String(meData.id || meData.user_id);
  } catch (meErr) {
    console.warn('[Instagram OAuth] Could not fetch profile from graph.instagram.com:', meErr.message);
  }

  // Fallback: If username could not be fetched (e.g. dev mode restriction on /me),
  // preserve existing username from database or derive from client name / guidelines
  if (!igUsername) {
    try {
      const [existingRows] = await pool.query(
        'SELECT platform_username, profile_url FROM client_social_accounts WHERE client_id = ? AND platform = "instagram"',
        [clientId]
      );
      if (existingRows.length > 0 && existingRows[0].platform_username) {
        igUsername = existingRows[0].platform_username;
      } else {
        const [guideRows] = await pool.query(
          'SELECT whitelist_words FROM client_brand_guidelines WHERE client_id = ?',
          [clientId]
        );
        if (guideRows.length > 0 && guideRows[0].whitelist_words) {
          try {
            const words = JSON.parse(guideRows[0].whitelist_words);
            const igHandle = words.find((w) => w.includes('hospital') || w.includes('navjyoti') || w.includes('doaguru'));
            if (igHandle) igUsername = igHandle.toLowerCase().replace(/[^a-z0-9._]/g, '');
          } catch {}
        }
        if (!igUsername) {
          const [clientRows] = await pool.query('SELECT name FROM clients WHERE id = ?', [clientId]);
          if (clientRows.length > 0 && clientRows[0].name) {
            igUsername = clientRows[0].name.toLowerCase().replace(/[^a-z0-9._]/g, '');
          }
        }
      }
    } catch {}
  }

  const profileUrl = igUsername ? `https://instagram.com/${igUsername}` : null;
  const encToken = encrypt(igAccessToken);

  // Encrypt token and save ONLY the Instagram account record (never overwrite Facebook)
  await pool.query(
    `INSERT INTO client_social_accounts (
       client_id, platform, platform_id, platform_username, profile_url,
       access_token_encrypted, token_expires_at, connection_method, is_connected, last_tested_at, last_error
     )
     VALUES (?, 'instagram', ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), 'oauth', TRUE, NOW(), NULL)
     ON DUPLICATE KEY UPDATE 
       platform_id = VALUES(platform_id), 
       platform_username = COALESCE(VALUES(platform_username), platform_username), 
       profile_url = COALESCE(VALUES(profile_url), profile_url), 
       access_token_encrypted = VALUES(access_token_encrypted), 
       token_expires_at = VALUES(token_expires_at), 
       connection_method = 'oauth', 
       is_connected = TRUE, 
       last_tested_at = NOW(), 
       last_error = NULL`,
    [clientId, igUserId || null, igUsername || null, profileUrl, encToken, tokenExpiresIn]
  );

  return {
    clientId,
    platform: 'instagram',
    platformId: igUserId,
    username: igUsername,
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
      // 1. Test via graph.instagram.com/me with standard professional fields
      let igData = null;
      try {
        const igUrl = `https://graph.instagram.com/me?fields=id,username,account_type&access_token=${encodeURIComponent(rawToken)}`;
        const res = await fetch(igUrl);
        igData = await res.json();
      } catch (e) {
        console.warn('[Instagram Test] /me fetch warning:', e.message);
      }

      if (igData && !igData.error && (igData.username || igData.id)) {
        const accName = igData.username || account.platform_username || `Instagram User #${igData.id}`;
        return {
          valid: true,
          accountName: accName,
          platformId: igData.id || account.platform_id,
          profileUrl: igData.username ? `https://instagram.com/${igData.username}` : account.profile_url,
        };
      }

      // 2. Fallback for Page Token with Instagram platform_id on graph.facebook.com
      if (account.platform_id) {
        try {
          const fbUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(account.platform_id)}?fields=id,username,name&access_token=${encodeURIComponent(rawToken)}`;
          const fbRes = await fetch(fbUrl);
          const fbData = await fbRes.json();
          if (fbData && !fbData.error && (fbData.username || fbData.name || fbData.id)) {
            const accName = fbData.username || fbData.name || account.platform_username;
            return {
              valid: true,
              accountName: accName,
              platformId: fbData.id || account.platform_id,
              profileUrl: fbData.username ? `https://instagram.com/${fbData.username}` : account.profile_url,
            };
          }
        } catch (fbErr) {}
      }

      // 3. Inspect Meta error response:
      if (igData?.error) {
        return {
          valid: false,
          error: igData.error.message || `Meta API Error ${igData.error.code || 100}`,
          code: igData.error.code,
          type: igData.error.type,
          fbtrace_id: igData.error.fbtrace_id,
          accountName: account.platform_username || null,
          platformId: account.platform_id || null,
          profileUrl: account.profile_url || null,
        };
      }

      return { valid: false, error: 'Instagram token verification failed (No profile data returned)' };
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

  return {
    success: true,
    id: pData.id,
    url: `https://instagram.com/p/${pData.id}`,
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
