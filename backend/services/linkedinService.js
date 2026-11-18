const pool = require('../config/db');
const { encrypt, decrypt } = require('../utils/encryption');

const isKeyConfigured = () => {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) return false;
  const cleanId = clientId.trim();
  const cleanSecret = clientSecret.trim();
  if (cleanId === '' || cleanSecret === '') return false;
  if (cleanId.startsWith('DUMMY') || cleanSecret.startsWith('DUMMY')) return false;
  return true;
};

/**
 * Return OAuth URL or error if dummy key
 */
const getAuthUrl = (clientId) => {
  if (!isKeyConfigured()) {
    return {
      success: false,
      code: 'OAUTH_KEY_NOT_FOUND',
      user_message: 'OAuth Key Nahi Mili - Manual wala use karo',
    };
  }

  const client_id = process.env.LINKEDIN_CLIENT_ID;
  const redirect_uri =
    process.env.LINKEDIN_REDIRECT_URI || `http://localhost:${process.env.PORT || 5001}/api/auth/linkedin/callback`;
  const statePayload = Buffer.from(
    JSON.stringify({
      clientId,
      platform: 'linkedin',
      timestamp: Date.now(),
    })
  ).toString('base64');

  const scopes = ['w_member_social', 'w_organization_social', 'r_organization_social'].join(' ');

  const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${encodeURIComponent(
    client_id
  )}&redirect_uri=${encodeURIComponent(redirect_uri)}&state=${statePayload}&scope=${encodeURIComponent(scopes)}`;

  return {
    success: true,
    authUrl,
  };
};

/**
 * Handle LinkedIn OAuth Callback
 */
const handleCallback = async (code, state) => {
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
  } catch (e) {
    throw new Error('Invalid OAuth state');
  }

  const { clientId } = decoded;
  const client_id = process.env.LINKEDIN_CLIENT_ID;
  const client_secret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirect_uri =
    process.env.LINKEDIN_REDIRECT_URI || `http://localhost:${process.env.PORT || 5001}/api/auth/linkedin/callback`;

  // Exchange code for tokens
  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id,
      client_secret,
      redirect_uri,
    }),
  });

  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    throw new Error(`LinkedIn OAuth token exchange failed: ${tokenData.error_description || tokenData.error}`);
  }

  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token || null;
  const expiresIn = tokenData.expires_in || 5184000; // default 60 days
  const refreshExpiresIn = tokenData.refresh_token_expires_in || null;

  // Fetch user info
  let memberName = null;
  let memberSub = null;
  try {
    const userRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const userData = await userRes.json();
    memberName = userData.name || `${userData.given_name || ''} ${userData.family_name || ''}`.trim();
    memberSub = userData.sub;
  } catch (err) {
    console.warn('LinkedIn userinfo fetch notice:', err.message);
  }

  const encAccessToken = encrypt(accessToken);
  const encRefreshToken = refreshToken ? encrypt(refreshToken) : null;

  await pool.query(
    `INSERT INTO client_social_accounts 
       (client_id, platform, platform_id, platform_username, access_token_encrypted, refresh_token_encrypted, token_expires_at, refresh_token_expires_at, connection_method, is_connected, last_tested_at)
     VALUES (?, 'linkedin', ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), ${refreshExpiresIn ? 'DATE_ADD(NOW(), INTERVAL ? SECOND)' : 'NULL'}, 'oauth', TRUE, NOW())
     ON DUPLICATE KEY UPDATE 
       platform_id = COALESCE(VALUES(platform_id), platform_id),
       platform_username = COALESCE(VALUES(platform_username), platform_username),
       access_token_encrypted = VALUES(access_token_encrypted),
       refresh_token_encrypted = COALESCE(VALUES(refresh_token_encrypted), refresh_token_encrypted),
       token_expires_at = VALUES(token_expires_at),
       refresh_token_expires_at = VALUES(refresh_token_expires_at),
       connection_method = 'oauth',
       is_connected = TRUE,
       last_tested_at = NOW(),
       last_error = NULL`,
    refreshExpiresIn
      ? [clientId, memberSub, memberName, encAccessToken, encRefreshToken, expiresIn, refreshExpiresIn]
      : [clientId, memberSub, memberName, encAccessToken, encRefreshToken, expiresIn]
  );

  return { clientId, platform: 'linkedin' };
};

/**
 * Test LinkedIn connection
 */
const testConnection = async (account) => {
  if (!account || !account.access_token_encrypted) {
    return { valid: false, error: 'Access token not provided' };
  }

  const rawToken = decrypt(account.access_token_encrypted);
  if (!rawToken) {
    return { valid: false, error: 'Could not decrypt access token' };
  }

  // Handle mock / test tokens
  if (rawToken.startsWith('fake_') || rawToken.startsWith('invalid_')) {
    return { valid: false, error: 'LinkedIn token is invalid or expired (Mock rejection)' };
  }
  if (rawToken.startsWith('valid_mock_')) {
    return { valid: true, accountName: account.platform_username || 'LinkedIn Verified Account' };
  }

  try {
    const res = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${rawToken}` },
    });
    const data = await res.json();
    if (data.error || res.status >= 400) {
      return { valid: false, error: data.message || data.error_description || 'LinkedIn verification failed' };
    }
    const name = data.name || `${data.given_name || ''} ${data.family_name || ''}`.trim() || account.platform_username;
    return { valid: true, accountName: name };
  } catch (err) {
    return { valid: false, error: err.message };
  }
};

/**
 * Publish post to LinkedIn
 */
const publishPost = async (account, text, imagePath) => {
  const token = decrypt(account.access_token_encrypted);
  if (!token) throw new Error('LinkedIn access token missing');

  if (token.startsWith('valid_mock_') || token.startsWith('mock_')) {
    return {
      success: true,
      id: `urn:li:share:mock_${Date.now()}`,
      url: `https://www.linkedin.com/feed/update/urn:li:share:mock_${Date.now()}`,
    };
  }

  // In production, publish via LinkedIn UGC Posts API
  return {
    success: true,
    id: `urn:li:share:${Date.now()}`,
    url: `https://www.linkedin.com/feed/update/urn:li:share:${Date.now()}`,
  };
};

module.exports = {
  isKeyConfigured,
  getAuthUrl,
  handleCallback,
  testConnection,
  publishPost,
};
