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
    } else if (platform === 'facebook' || platform === 'instagram') {
      return await refreshMetaToken(account);
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
 * Refresh Meta Token
 */
const refreshMetaToken = async (account) => {
  const currentToken = account.access_token_encrypted ? decrypt(account.access_token_encrypted) : null;

  if (!currentToken) {
    await markRevoked(account, 'Meta token missing');
    return {
      success: false,
      code: 'TOKEN_REVOKED',
      user_message: 'Token Expired - Dobara Connect Karo',
    };
  }

  if (currentToken.includes('revoked') || currentToken.includes('invalid')) {
    await markRevoked(account, 'Mock Meta token revoked');
    return {
      success: false,
      code: 'TOKEN_REVOKED',
      user_message: 'Token Expired - Dobara Connect Karo',
    };
  }

  if (currentToken.includes('valid_mock') || currentToken.startsWith('valid_')) {
    const newAccessToken = `valid_mock_meta_access_${Date.now()}`;
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
    const url = `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${currentToken}`;
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
};
