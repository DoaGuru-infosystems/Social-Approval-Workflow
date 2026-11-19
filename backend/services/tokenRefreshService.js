const pool = require('../config/db');
const { encrypt, decrypt } = require('../utils/encryption');

const TEN_MINUTES_MS = 10 * 60 * 1000;

/**
 * Checks if the platform token needs refresh and refreshes it if needed.
 * Safe to call repeatedly: does nothing if token is still valid (> 10 mins remaining).
 *
 * @param {number} clientId
 * @param {'instagram'|'facebook'|'youtube'|'linkedin'} platform
 * @returns {Promise<{ success: boolean, refreshed: boolean, code?: string, user_message?: string }>}
 */
const refreshIfNeeded = async (clientId, platform) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM client_social_accounts WHERE client_id = ? AND platform = ?',
      [clientId, platform]
    );

    if (rows.length === 0) {
      return {
        success: false,
        code: 'NOT_CONNECTED',
        user_message: 'Account record not found.',
      };
    }

    const account = rows[0];

    // If account is marked disconnected and has no tokens, cannot refresh
    if (!account.is_connected && !account.refresh_token_encrypted && !account.access_token_encrypted) {
      return {
        success: false,
        code: 'NOT_CONNECTED',
        user_message: `${platform} account is not connected.`,
      };
    }

    // Check expiration timestamp
    if (account.token_expires_at) {
      const expiresAt = new Date(account.token_expires_at).getTime();
      const timeRemaining = expiresAt - Date.now();
      if (timeRemaining > TEN_MINUTES_MS) {
        // Token is still fresh!
        return { success: true, refreshed: false };
      }
    }

    // Token is expiring soon (within 10 minutes) or has expired
    console.log(`[TokenRefresh] Token for client ${clientId} (${platform}) is expiring or expired. Refreshing...`);

    if (platform === 'youtube') {
      return await refreshYouTubeToken(account);
    } else if (platform === 'linkedin') {
      return await refreshLinkedInToken(account);
    } else if (platform === 'facebook') {
      return await refreshFacebookToken(account);
    } else if (platform === 'instagram') {
      return await refreshInstagramToken(account);
    }

    return { success: true, refreshed: false };
  } catch (error) {
    console.error(`[TokenRefresh] Unexpected error for client ${clientId} (${platform}):`, error);
    return {
      success: false,
      code: 'REFRESH_ERROR',
      user_message: error.message,
    };
  }
};

/**
 * Refresh YouTube OAuth Token via Google OAuth2
 */
const refreshYouTubeToken = async (account) => {
  const refreshToken = account.refresh_token_encrypted ? decrypt(account.refresh_token_encrypted) : null;

  if (!refreshToken) {
    await markRevoked(account, 'Refresh Token not found for YouTube');
    return {
      success: false,
      code: 'TOKEN_REVOKED',
      user_message: 'Token Expired - Dobara Connect Karo',
    };
  }

  // Handle mock / test tokens
  if (refreshToken.includes('revoked') || refreshToken.includes('invalid')) {
    await markRevoked(account, 'Mock YouTube refresh token revoked');
    return {
      success: false,
      code: 'TOKEN_REVOKED',
      user_message: 'Token Expired - Dobara Connect Karo',
    };
  }

  if (refreshToken.includes('valid_mock') || refreshToken.startsWith('valid_')) {
    const newAccessToken = `valid_mock_yt_access_${Date.now()}`;
    const encAccessToken = encrypt(newAccessToken);
    await pool.query(
      `UPDATE client_social_accounts 
       SET access_token_encrypted = ?, 
           token_expires_at = DATE_ADD(NOW(), INTERVAL 1 HOUR), 
           is_connected = TRUE, 
           last_tested_at = NOW(), 
           last_error = NULL 
       WHERE id = ?`,
      [encAccessToken, account.id]
    );
    return { success: true, refreshed: true };
  }

  // Real API call
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (!clientId || !clientSecret || clientId.startsWith('DUMMY')) {
    // If keys are dummy, fail gracefully with clear code
    await markRevoked(account, 'OAuth credentials missing or dummy in .env');
    return {
      success: false,
      code: 'TOKEN_REVOKED',
      user_message: 'Token Expired - Dobara Connect Karo',
    };
  }

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    const data = await res.json();
    if (data.error) {
      await markRevoked(account, data.error_description || data.error);
      return {
        success: false,
        code: 'TOKEN_REVOKED',
        user_message: 'Token Expired - Dobara Connect Karo',
      };
    }

    const newAccessToken = data.access_token;
    const expiresIn = data.expires_in || 3600;
    const encAccessToken = encrypt(newAccessToken);

    await pool.query(
      `UPDATE client_social_accounts 
       SET access_token_encrypted = ?, 
           token_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND), 
           is_connected = TRUE, 
           last_tested_at = NOW(), 
           last_error = NULL 
       WHERE id = ?`,
      [encAccessToken, expiresIn, account.id]
    );

    return { success: true, refreshed: true };
  } catch (err) {
    await markRevoked(account, err.message);
    return {
      success: false,
      code: 'TOKEN_REVOKED',
      user_message: 'Token Expired - Dobara Connect Karo',
    };
  }
};

/**
 * Refresh LinkedIn OAuth Token
 */
const refreshLinkedInToken = async (account) => {
  const refreshToken = account.refresh_token_encrypted ? decrypt(account.refresh_token_encrypted) : null;

  if (!refreshToken) {
    await markRevoked(account, 'No refresh token available for LinkedIn');
    return {
      success: false,
      code: 'TOKEN_REVOKED',
      user_message: 'Token Expired - Dobara Connect Karo',
    };
  }

  if (refreshToken.includes('revoked') || refreshToken.includes('invalid')) {
    await markRevoked(account, 'Mock LinkedIn refresh token revoked');
    return {
      success: false,
      code: 'TOKEN_REVOKED',
      user_message: 'Token Expired - Dobara Connect Karo',
    };
  }

  if (refreshToken.includes('valid_mock') || refreshToken.startsWith('valid_')) {
    const newAccessToken = `valid_mock_li_access_${Date.now()}`;
    const encAccessToken = encrypt(newAccessToken);
    await pool.query(
      `UPDATE client_social_accounts 
       SET access_token_encrypted = ?, 
           token_expires_at = DATE_ADD(NOW(), INTERVAL 60 DAY), 
           is_connected = TRUE, 
           last_tested_at = NOW(), 
           last_error = NULL 
       WHERE id = ?`,
      [encAccessToken, account.id]
    );
    return { success: true, refreshed: true };
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

  if (!clientId || !clientSecret || clientId.startsWith('DUMMY')) {
    await markRevoked(account, 'LinkedIn credentials missing in .env');
    return {
      success: false,
      code: 'TOKEN_REVOKED',
      user_message: 'Token Expired - Dobara Connect Karo',
    };
  }

  try {
    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    const data = await res.json();
    if (data.error) {
      await markRevoked(account, data.error_description || data.error);
      return {
        success: false,
        code: 'TOKEN_REVOKED',
        user_message: 'Token Expired - Dobara Connect Karo',
      };
    }

    const newAccessToken = data.access_token;
    const expiresIn = data.expires_in || 5184000;
    const encAccessToken = encrypt(newAccessToken);

    await pool.query(
      `UPDATE client_social_accounts 
       SET access_token_encrypted = ?, 
           token_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND), 
           is_connected = TRUE, 
           last_tested_at = NOW(), 
           last_error = NULL 
       WHERE id = ?`,
      [encAccessToken, expiresIn, account.id]
    );

    return { success: true, refreshed: true };
  } catch (err) {
    await markRevoked(account, err.message);
    return {
      success: false,
      code: 'TOKEN_REVOKED',
      user_message: 'Token Expired - Dobara Connect Karo',
    };
  }
};

/**
 * Refresh Facebook Token
 */
const refreshFacebookToken = async (account) => {
  const currentToken = account.access_token_encrypted ? decrypt(account.access_token_encrypted) : null;

  if (!currentToken) {
    await markRevoked(account, 'Facebook token missing');
    return {
      success: false,
      code: 'TOKEN_REVOKED',
      user_message: 'Token Expired - Dobara Connect Karo',
    };
  }

  if (currentToken.includes('revoked') || currentToken.includes('invalid')) {
    await markRevoked(account, 'Mock Facebook token revoked');
    return {
      success: false,
      code: 'TOKEN_REVOKED',
      user_message: 'Token Expired - Dobara Connect Karo',
    };
  }

  if (currentToken.includes('valid_mock') || currentToken.startsWith('valid_')) {
    const newAccessToken = `valid_mock_fb_access_${Date.now()}`;
    const encAccessToken = encrypt(newAccessToken);
    await pool.query(
      `UPDATE client_social_accounts 
       SET access_token_encrypted = ?, 
           token_expires_at = DATE_ADD(NOW(), INTERVAL 60 DAY), 
           is_connected = TRUE, 
           last_tested_at = NOW(), 
           last_error = NULL 
       WHERE id = ?`,
      [encAccessToken, account.id]
    );
    return { success: true, refreshed: true };
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!appId || !appSecret || appId.startsWith('DUMMY')) {
    await markRevoked(account, 'Meta credentials missing in .env');
    return {
      success: false,
      code: 'TOKEN_REVOKED',
      user_message: 'Token Expired - Dobara Connect Karo',
    };
  }

  try {
    const apiVer = process.env.META_API_VERSION || 'v21.0';
    const url = `https://graph.facebook.com/${apiVer}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${currentToken}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      await markRevoked(account, data.error.message);
      return {
        success: false,
        code: 'TOKEN_REVOKED',
        user_message: 'Token Expired - Dobara Connect Karo',
      };
    }

    const newAccessToken = data.access_token;
    const expiresIn = data.expires_in || 5184000;
    const encAccessToken = encrypt(newAccessToken);

    await pool.query(
      `UPDATE client_social_accounts 
       SET access_token_encrypted = ?, 
           token_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND), 
           is_connected = TRUE, 
           last_tested_at = NOW(), 
           last_error = NULL 
       WHERE id = ?`,
      [encAccessToken, expiresIn, account.id]
    );

    return { success: true, refreshed: true };
  } catch (err) {
    await markRevoked(account, err.message);
    return {
      success: false,
      code: 'TOKEN_REVOKED',
      user_message: 'Token Expired - Dobara Connect Karo',
    };
  }
};

/**
 * Refresh Instagram Token (via Instagram Graph API refresh_access_token)
 */
const refreshInstagramToken = async (account) => {
  const currentToken = account.access_token_encrypted ? decrypt(account.access_token_encrypted) : null;

  if (!currentToken) {
    await markRevoked(account, 'Instagram token missing');
    return {
      success: false,
      code: 'TOKEN_REVOKED',
      user_message: 'Token Expired - Dobara Connect Karo',
    };
  }

  if (currentToken.includes('revoked') || currentToken.includes('invalid')) {
    await markRevoked(account, 'Mock Instagram token revoked');
    return {
      success: false,
      code: 'TOKEN_REVOKED',
      user_message: 'Token Expired - Dobara Connect Karo',
    };
  }

  if (currentToken.includes('valid_mock') || currentToken.startsWith('valid_')) {
    const newAccessToken = `valid_mock_ig_access_${Date.now()}`;
    const encAccessToken = encrypt(newAccessToken);
    await pool.query(
      `UPDATE client_social_accounts 
       SET access_token_encrypted = ?, 
           token_expires_at = DATE_ADD(NOW(), INTERVAL 60 DAY), 
           is_connected = TRUE, 
           last_tested_at = NOW(), 
           last_error = NULL 
       WHERE id = ?`,
      [encAccessToken, account.id]
    );
    return { success: true, refreshed: true };
  }

  try {
    // 1. Try Instagram Graph API refresh endpoint (for Instagram Login tokens)
    const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${currentToken}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.access_token) {
      const newAccessToken = data.access_token;
      const expiresIn = data.expires_in || 5184000;
      const encAccessToken = encrypt(newAccessToken);

      await pool.query(
        `UPDATE client_social_accounts 
         SET access_token_encrypted = ?, 
             token_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND), 
             is_connected = TRUE, 
             last_tested_at = NOW(), 
             last_error = NULL 
         WHERE id = ?`,
        [encAccessToken, expiresIn, account.id]
      );

      return { success: true, refreshed: true };
    }

    // 2. If it failed, try fb_exchange_token fallback (in case token is a Facebook User/Page token)
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (appId && appSecret) {
      const apiVer = process.env.META_API_VERSION || 'v21.0';
      const fbUrl = `https://graph.facebook.com/${apiVer}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${currentToken}`;
      const fbRes = await fetch(fbUrl);
      const fbData = await fbRes.json();
      if (fbData.access_token) {
        const encAccessToken = encrypt(fbData.access_token);
        const expiresIn = fbData.expires_in || 5184000;
        await pool.query(
          `UPDATE client_social_accounts 
           SET access_token_encrypted = ?, 
               token_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND), 
               is_connected = TRUE, 
               last_tested_at = NOW(), 
               last_error = NULL 
           WHERE id = ?`,
          [encAccessToken, expiresIn, account.id]
        );
        return { success: true, refreshed: true };
      }
    }

    const errMsg = data.error?.message || 'Instagram refresh failed';
    await markRevoked(account, errMsg);
    return {
      success: false,
      code: 'TOKEN_REVOKED',
      user_message: 'Token Expired - Dobara Connect Karo',
    };
  } catch (err) {
    await markRevoked(account, err.message);
    return {
      success: false,
      code: 'TOKEN_REVOKED',
      user_message: 'Token Expired - Dobara Connect Karo',
    };
  }
};

/**
 * Auto-refresh background job to refresh tokens before 60-day expiry.
 * Runs on startup and periodically (every 12 hours).
 */
const runTokenAutoRefreshBatch = async () => {
  console.log('[TokenAutoRefresh] Checking for social tokens nearing expiration (< 15 days)...');
  try {
    const [accounts] = await pool.query(
      `SELECT id, client_id, platform, token_expires_at 
       FROM client_social_accounts 
       WHERE is_connected = TRUE 
         AND (access_token_encrypted IS NOT NULL OR refresh_token_encrypted IS NOT NULL)
         AND (token_expires_at IS NULL OR token_expires_at <= DATE_ADD(NOW(), INTERVAL 15 DAY))`
    );

    if (!accounts || accounts.length === 0) {
      console.log('[TokenAutoRefresh] No tokens need refresh right now.');
      return;
    }

    console.log(`[TokenAutoRefresh] Found ${accounts.length} account(s) to refresh.`);
    for (const acc of accounts) {
      try {
        console.log(`[TokenAutoRefresh] Refreshing ${acc.platform} token for client ${acc.client_id}...`);
        const result = await refreshIfNeeded(acc.client_id, acc.platform);
        console.log(`[TokenAutoRefresh] Result for ${acc.platform} (client ${acc.client_id}):`, result.success ? 'Success' : `Failed: ${result.user_message || result.code}`);
      } catch (err) {
        console.error(`[TokenAutoRefresh] Error refreshing account ${acc.id} (${acc.platform}):`, err.message);
      }
    }
  } catch (error) {
    console.error('[TokenAutoRefresh] Batch check failed:', error.message);
  }
};

const startTokenAutoRefreshJob = () => {
  // Initial check after 30 seconds
  setTimeout(() => {
    runTokenAutoRefreshBatch();
  }, 30000);

  // Run every 12 hours
  setInterval(() => {
    runTokenAutoRefreshBatch();
  }, 12 * 60 * 60 * 1000);

  console.log('[TokenAutoRefresh] Auto-refresh background job registered (runs every 12 hours).');
};

/**
 * Mark an account as revoked / invalid, but NEVER delete profile_url or platform_id
 */
const markRevoked = async (account, reason) => {
  try {
    await pool.query(
      `UPDATE client_social_accounts 
       SET is_connected = FALSE, 
           last_error = ? 
       WHERE id = ?`,
      [`Token Expired - Dobara Connect Karo (${reason})`, account.id]
    );
  } catch (err) {
    console.warn('[TokenRefresh] Error marking revoked:', err.message);
  }
};

module.exports = {
  refreshIfNeeded,
  refreshFacebookToken,
  refreshInstagramToken,
  startTokenAutoRefreshJob,
};
