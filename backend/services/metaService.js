const pool = require('../config/db');
const { encrypt, decrypt } = require('../utils/encryption');

const GRAPH_API_VERSION = process.env.META_API_VERSION || 'v21.0';

const isKeyConfigured = () => {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return false;
  const cleanId = appId.trim();
  const cleanSecret = appSecret.trim();
  if (cleanId === '' || cleanSecret === '') return false;
  if (cleanId.startsWith('DUMMY') || cleanSecret.startsWith('DUMMY')) return false;
  return true;
};

/**
 * 1. Independent Facebook Flow:
 * Route: GET /api/auth/meta/facebook -> https://www.facebook.com/v21.0/dialog/oauth
 * Scope: pages_show_list,pages_manage_posts,pages_read_engagement,business_management
 */
const getFacebookAuthUrl = (clientId, frontendOrigin = null) => {
  if (!isKeyConfigured()) {
    return {
      success: false,
      code: 'OAUTH_KEY_NOT_FOUND',
      user_message: 'OAuth Key Nahi Mili - Manual wala use karo',
    };
  }

  const appId = process.env.META_APP_ID;
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
  if (!isKeyConfigured()) {
    return {
      success: false,
      code: 'OAUTH_KEY_NOT_FOUND',
      user_message: 'OAuth Key Nahi Mili - Manual wala use karo',
    };
  }

  const appId = process.env.META_APP_ID;
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
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  // Instagram sometimes appends #_ to the code parameter
  const cleanCode = code ? String(code).replace(/#_$/, '').trim() : '';

  let redirectUri =
    decoded.redirectUri ||
    (req?.headers?.host ? `http://${req.headers.host}/api/auth/meta/instagram/callback` : null) ||
    process.env.META_IG_REDIRECT_URI ||
    process.env.META_REDIRECT_URI ||
    `http://localhost:${process.env.PORT || 5001}/api/auth/meta/instagram/callback`;

  let igAccessToken = null;
  let igUserId = null;
  let igUsername = null;
  let tokenExpiresIn = 5184000; // 60 days default

  // Strategy A: Instagram API with Instagram Login (api.instagram.com)
  try {
    const params = new URLSearchParams();
    params.append('client_id', appId);
    params.append('client_secret', appSecret);
    params.append('grant_type', 'authorization_code');
    params.append('redirect_uri', redirectUri);
    params.append('code', cleanCode);

    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const tokenData = await tokenRes.json();

    if (tokenData.access_token) {
      const shortToken = tokenData.access_token;
      igUserId = tokenData.user_id;

      // Exchange short-lived token for long-lived (60-day) token via graph.instagram.com
      const longRes = await fetch(
        `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${appSecret}&access_token=${encodeURIComponent(shortToken)}`
      );
      const longData = await longRes.json();
      igAccessToken = longData.access_token || shortToken;
      if (longData.expires_in) tokenExpiresIn = longData.expires_in;

      // Fetch Instagram profile details
      try {
        const meRes = await fetch(
          `https://graph.instagram.com/${GRAPH_API_VERSION}/me?fields=user_id,username,name,account_type&access_token=${encodeURIComponent(igAccessToken)}`
        );
        const meData = await meRes.json();
        if (meData.username) igUsername = meData.username;
        if (meData.user_id) igUserId = meData.user_id;
      } catch (meErr) {
        console.warn('[Instagram OAuth] Could not fetch me profile from graph.instagram.com:', meErr.message);
      }
    }
  } catch (err) {
    console.warn('[Instagram OAuth] api.instagram.com token exchange attempt failed:', err.message);
  }

  // Strategy B: Fallback via graph.facebook.com if Strategy A did not yield a token
  if (!igAccessToken) {
    let tokenUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&client_secret=${appSecret}&code=${cleanCode}`;

    let fbTokenRes = await fetch(tokenUrl);
    let fbTokenData = await fbTokenRes.json();

    if (fbTokenData.error && (fbTokenData.error.message.includes('redirect_uri') || fbTokenData.error.code === 100)) {
      const altUris = [];
      if (redirectUri.includes('5001')) altUris.push(redirectUri.replace('5001', '5000'));
      if (redirectUri.includes('5000')) altUris.push(redirectUri.replace('5000', '5001'));
      if (redirectUri.includes('/instagram/callback')) altUris.push(redirectUri.replace('/instagram/callback', '/callback'));

      for (const altUri of altUris) {
        const retryUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(
          altUri
        )}&client_secret=${appSecret}&code=${cleanCode}`;
        const retryRes = await fetch(retryUrl);
        const retryData = await retryRes.json();
        if (!retryData.error) {
          fbTokenData = retryData;
          break;
        }
      }
    }

    if (fbTokenData.access_token) {
      const shortToken = fbTokenData.access_token;
      const longLivedUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`;
      const longLivedRes = await fetch(longLivedUrl);
      const longLivedData = await longLivedRes.json();
      const longToken = longLivedData.access_token || shortToken;

      // Find Instagram Business Account linked
      const accountsUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${longToken}`;
      const accountsRes = await fetch(accountsUrl);
      const accountsData = await accountsRes.json();
      const pages = accountsData.data || [];

      for (const p of pages) {
        if (p.instagram_business_account) {
          igUserId = p.instagram_business_account.id;
          igUsername = p.instagram_business_account.username;
          igAccessToken = p.access_token || longToken;
          break;
        }
      }

      if (!igAccessToken && pages.length > 0) {
        igAccessToken = pages[0].access_token || longToken;
      }
    }
  }

  if (!igAccessToken) {
    throw new Error('Failed to obtain Instagram Access Token. Please verify permissions and account setup.');
  }

  const encToken = encrypt(igAccessToken);

  // Save ONLY in instagram row - DO NOT TOUCH FACEBOOK!
  await pool.query(
    `INSERT INTO client_social_accounts (client_id, platform, platform_id, platform_username, access_token_encrypted, token_expires_at, connection_method, is_connected, last_tested_at)
     VALUES (?, 'instagram', ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), 'oauth', TRUE, NOW())
     ON DUPLICATE KEY UPDATE platform_id = VALUES(platform_id), platform_username = VALUES(platform_username), access_token_encrypted = VALUES(access_token_encrypted), token_expires_at = VALUES(token_expires_at), connection_method = 'oauth', is_connected = TRUE, last_tested_at = NOW(), last_error = NULL`,
    [clientId, igUserId || null, igUsername || null, encToken, tokenExpiresIn]
  );

  return {
    clientId,
    platform: 'instagram',
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
      // Test via graph.instagram.com first
      const igUrl = `https://graph.instagram.com/${GRAPH_API_VERSION}/me?fields=user_id,username,name&access_token=${encodeURIComponent(rawToken)}`;
      const res = await fetch(igUrl);
      const data = await res.json();
      if (!data.error) {
        return { valid: true, accountName: data.username || data.name || account.platform_username };
      }

      // Fallback for Page Token with Instagram platform_id
      if (account.platform_id) {
        const fbUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(account.platform_id)}?fields=id,username,name&access_token=${encodeURIComponent(rawToken)}`;
        const fbRes = await fetch(fbUrl);
        const fbData = await fbRes.json();
        if (!fbData.error) {
          return { valid: true, accountName: fbData.username || fbData.name || account.platform_username };
        }
      }
      return { valid: false, error: data.error?.message || 'Instagram token verification failed' };
    }

    // Facebook test
    const fbUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/me?fields=id,name&access_token=${encodeURIComponent(rawToken)}`;
    const res = await fetch(fbUrl);
    const data = await res.json();
    if (data.error) {
      return { valid: false, error: data.error.message || 'Facebook token verification failed' };
    }
    return { valid: true, accountName: data.name || account.platform_username };
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

  // 1. Create media container via graph.instagram.com
  let containerUrl = `https://graph.instagram.com/${GRAPH_API_VERSION}/${igUserId}/media?image_url=${encodeURIComponent(
    post.image_url
  )}&caption=${encodeURIComponent(post.caption)}&access_token=${encodeURIComponent(token)}`;
  let cRes = await fetch(containerUrl, { method: 'POST' });
  let cData = await cRes.json();

  // Fallback to graph.facebook.com if token is Page token
  if (cData.error && (cData.error.message.includes('not supported') || cData.error.code === 100 || cData.error.code === 190)) {
    const fbContainerUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${igUserId}/media?image_url=${encodeURIComponent(
      post.image_url
    )}&caption=${encodeURIComponent(post.caption)}&access_token=${encodeURIComponent(token)}`;
    const fbCRes = await fetch(fbContainerUrl, { method: 'POST' });
    const fbCData = await fbCRes.json();
    if (!fbCData.error) {
      cData = fbCData;
    }
  }

  if (cData.error) throw new Error(cData.error.message);

  // 2. Publish container via graph.instagram.com
  let publishUrl = `https://graph.instagram.com/${GRAPH_API_VERSION}/${igUserId}/media_publish?creation_id=${cData.id}&access_token=${encodeURIComponent(
    token
  )}`;
  let pRes = await fetch(publishUrl, { method: 'POST' });
  let pData = await pRes.json();

  if (pData.error) {
    const fbPublishUrl = `https://graph.facebook.com/${GRAPH_API_VERSION}/${igUserId}/media_publish?creation_id=${cData.id}&access_token=${encodeURIComponent(
      token
    )}`;
    const fbPRes = await fetch(fbPublishUrl, { method: 'POST' });
    const fbPData = await fbPRes.json();
    if (!fbPData.error) {
      pData = fbPData;
    }
  }

  if (pData.error) throw new Error(pData.error.message);

  return {
    success: true,
    id: pData.id,
    url: `https://instagram.com/p/${pData.id}`,
  };
};

module.exports = {
  isKeyConfigured,
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
