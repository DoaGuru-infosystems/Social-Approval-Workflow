const express = require('express');
const router = express.Router({ mergeParams: true });
const pool = require('../config/db');
const { encrypt, decrypt } = require('../utils/encryption');
const metaService = require('../services/metaService');
const youtubeService = require('../services/youtubeService');
const linkedinService = require('../services/linkedinService');
const tokenRefreshService = require('../services/tokenRefreshService');
const authMiddleware = require('../middleware/authMiddleware');

const ALL_PLATFORMS = ['instagram', 'facebook', 'youtube', 'linkedin'];

/**
 * Helper to mask sensitive token
 */
const maskToken = (token) => {
  if (!token || typeof token !== 'string') return null;
  const trimmed = token.trim();
  if (trimmed.length <= 4) return '....' + trimmed;
  return '....' + trimmed.slice(-4);
};

/**
 * GET /api/clients/:id/social
 * List all 4 platforms with connection status, profile URL, masked token, expiry
 */
router.get('/:id/social', authMiddleware, async (req, res) => {
  try {
    const { id: clientId } = req.params;

    const [rows] = await pool.query(
      `SELECT id, client_id, platform, profile_url, platform_username, platform_id,
              access_token_encrypted, refresh_token_encrypted, token_expires_at,
              refresh_token_expires_at, connection_method, is_connected, last_tested_at, last_error
       FROM client_social_accounts
       WHERE client_id = ?`,
      [clientId]
    );

    const existingMap = new Map();
    rows.forEach((r) => existingMap.set(r.platform, r));

    const platformsData = ALL_PLATFORMS.map((platform) => {
      const record = existingMap.get(platform);
      if (!record) {
        return {
          platform,
          is_connected: false,
          profile_url: null,
          platform_username: null,
          platform_id: null,
          connection_method: null,
          token_expires_at: null,
          refresh_token_expires_at: null,
          last_tested_at: null,
          last_error: null,
          masked_access_token: null,
          has_refresh_token: false,
          masked_refresh_token: null,
        };
      }

      let maskedToken = null;
      let maskedRefreshToken = null;

      if (record.access_token_encrypted) {
        const decrypted = decrypt(record.access_token_encrypted);
        maskedToken = maskToken(decrypted);
      }

      if (record.refresh_token_encrypted) {
        const decryptedRefresh = decrypt(record.refresh_token_encrypted);
        maskedRefreshToken = maskToken(decryptedRefresh);
      }

      return {
        id: record.id,
        platform: record.platform,
        is_connected: Boolean(record.is_connected),
        profile_url: record.profile_url,
        platform_username: record.platform_username,
        platform_id: record.platform_id,
        connection_method: record.connection_method,
        token_expires_at: record.token_expires_at,
        refresh_token_expires_at: record.refresh_token_expires_at,
        last_tested_at: record.last_tested_at,
        last_error: record.last_error,
        masked_access_token: maskedToken,
        has_refresh_token: Boolean(record.refresh_token_encrypted),
        masked_refresh_token: maskedRefreshToken,
      };
    });

    return res.status(200).json({
      success: true,
      clientId: Number(clientId),
      platforms: platformsData,
    });
  } catch (error) {
    console.error('Error fetching social accounts:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch social accounts.',
      error: error.message,
    });
  }
});

/**
 * GET /api/clients/:id/social/:platform/connect
 * Return OAuth URL or OAUTH_KEY_NOT_FOUND error
 */
router.get('/:id/social/:platform/connect', authMiddleware, async (req, res) => {
  try {
    const { id: clientId, platform } = req.params;
    const lowerPlatform = String(platform).toLowerCase().trim();

    if (!ALL_PLATFORMS.includes(lowerPlatform)) {
      return res.status(400).json({
        success: false,
        message: `Invalid platform. Must be one of: ${ALL_PLATFORMS.join(', ')}`,
      });
    }

    let authResult;
    if (lowerPlatform === 'instagram' || lowerPlatform === 'facebook') {
      authResult = metaService.getAuthUrl(clientId, lowerPlatform);
    } else if (lowerPlatform === 'youtube') {
      authResult = youtubeService.getAuthUrl(clientId);
    } else if (lowerPlatform === 'linkedin') {
      authResult = linkedinService.getAuthUrl(clientId);
    }

    if (!authResult || !authResult.success) {
      return res.status(200).json({
        success: false,
        code: authResult?.code || 'OAUTH_KEY_NOT_FOUND',
        user_message: authResult?.user_message || 'OAuth Key Nahi Mili - Manual wala use karo',
      });
    }

    return res.status(200).json({
      success: true,
      platform: lowerPlatform,
      clientId,
      authUrl: authResult.authUrl,
    });
  } catch (error) {
    console.error('Error initiating OAuth connect:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to initiate OAuth connect.',
      error: error.message,
    });
  }
});

/**
 * POST /api/clients/:id/social/manual-connect
 * Connect platform manually with tokens and immediately test
 */
router.post('/:id/social/manual-connect', authMiddleware, async (req, res) => {
  try {
    const { id: clientId } = req.params;
    const { platform, profile_url, platform_id, access_token, refresh_token } = req.body;

    const lowerPlatform = String(platform || '').toLowerCase().trim();
    if (!ALL_PLATFORMS.includes(lowerPlatform)) {
      return res.status(400).json({
        success: false,
        message: `Platform must be one of: ${ALL_PLATFORMS.join(', ')}`,
      });
    }

    // Platform validation rules:
    // YouTube: Do NOT show API Key. Requires Refresh Token!
    if (lowerPlatform === 'youtube') {
      if (!refresh_token || !refresh_token.trim()) {
        return res.status(400).json({
          success: false,
          code: 'YOUTUBE_REFRESH_TOKEN_REQUIRED',
          user_message:
            'YouTube ke liye Refresh Token chahiye, sirf Access Token 1 ghante me khatam ho jayega.',
        });
      }
    } else {
      // Instagram, Facebook, LinkedIn require access_token
      if (!access_token || !access_token.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Access Token is required.',
        });
      }
    }

    const cleanProfileUrl = profile_url ? String(profile_url).trim() : null;
    const cleanPlatformId = platform_id ? String(platform_id).trim() : null;
    const encAccessToken = access_token && access_token.trim() ? encrypt(access_token.trim()) : null;
    const encRefreshToken = refresh_token && refresh_token.trim() ? encrypt(refresh_token.trim()) : null;

    // Calculate default expiration
    const expiryInterval = lowerPlatform === 'linkedin' || lowerPlatform === 'facebook' || lowerPlatform === 'instagram' ? '60 DAY' : '1 HOUR';

    // Upsert account record
    await pool.query(
      `INSERT INTO client_social_accounts 
         (client_id, platform, profile_url, platform_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, connection_method, is_connected, last_error)
       VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ${expiryInterval}), 'manual', FALSE, NULL)
       ON DUPLICATE KEY UPDATE
         profile_url = COALESCE(VALUES(profile_url), profile_url),
         platform_id = COALESCE(VALUES(platform_id), platform_id),
         access_token_encrypted = VALUES(access_token_encrypted),
         refresh_token_encrypted = VALUES(refresh_token_encrypted),
         token_expires_at = VALUES(token_expires_at),
         connection_method = 'manual'`,
      [clientId, lowerPlatform, cleanProfileUrl, cleanPlatformId, encAccessToken, encRefreshToken]
    );

    // Retrieve saved account to test
    const [savedRows] = await pool.query(
      'SELECT * FROM client_social_accounts WHERE client_id = ? AND platform = ?',
      [clientId, lowerPlatform]
    );
    const account = savedRows[0];

    // Immediately test connection
    let testResult;
    if (lowerPlatform === 'instagram' || lowerPlatform === 'facebook') {
      testResult = await metaService.testConnection(account);
    } else if (lowerPlatform === 'youtube') {
      testResult = await youtubeService.testConnection(account);
    } else if (lowerPlatform === 'linkedin') {
      testResult = await linkedinService.testConnection(account);
    }

    if (testResult && testResult.valid) {
      await pool.query(
        `UPDATE client_social_accounts 
         SET is_connected = TRUE, 
             last_tested_at = NOW(), 
             last_error = NULL 
         WHERE id = ?`,
        [account.id]
      );

      return res.status(200).json({
        success: true,
        is_connected: true,
        message: 'Platform connected and verified successfully.',
        masked_access_token: maskToken(access_token),
        testResult,
      });
    } else {
      // Invalid token: Keep profile_url and platform_id, mark is_connected = false
      const errorMsg = testResult?.error || 'Token verification failed';
      await pool.query(
        `UPDATE client_social_accounts 
         SET is_connected = FALSE, 
             last_tested_at = NOW(), 
             last_error = ? 
         WHERE id = ?`,
        [errorMsg, account.id]
      );

      return res.status(200).json({
        success: false,
        is_connected: false,
        code: 'INVALID_TOKEN',
        user_message: 'Token Invalid Hai - Kripya dobara check karein',
        testResult,
      });
    }
  } catch (error) {
    console.error('Error in manual connect:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to connect platform manually.',
      error: error.message,
    });
  }
});

/**
 * POST /api/clients/:id/social/:platform/disconnect
 * Disconnect platform - Clears tokens but PRESERVES profile_url
 */
router.post('/:id/social/:platform/disconnect', authMiddleware, async (req, res) => {
  try {
    const { id: clientId, platform } = req.params;
    const lowerPlatform = String(platform).toLowerCase().trim();

    await pool.query(
      `UPDATE client_social_accounts 
       SET access_token_encrypted = NULL, 
           refresh_token_encrypted = NULL, 
           token_expires_at = NULL, 
           refresh_token_expires_at = NULL, 
           is_connected = FALSE, 
           connection_method = NULL, 
           last_error = NULL 
       WHERE client_id = ? AND platform = ?`,
      [clientId, lowerPlatform]
    );

    return res.status(200).json({
      success: true,
      message: `${lowerPlatform} disconnected successfully. Profile URL preserved.`,
    });
  } catch (error) {
    console.error('Error disconnecting social account:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to disconnect social account.',
      error: error.message,
    });
  }
});

/**
 * POST /api/clients/:id/social/:platform/test
 * Test existing connection
 */
router.post('/:id/social/:platform/test', authMiddleware, async (req, res) => {
  try {
    const { id: clientId, platform } = req.params;
    const lowerPlatform = String(platform).toLowerCase().trim();

    const [rows] = await pool.query(
      'SELECT * FROM client_social_accounts WHERE client_id = ? AND platform = ?',
      [clientId, lowerPlatform]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Account not found for this client.',
      });
    }

    const account = rows[0];
    let testResult;
    if (lowerPlatform === 'instagram' || lowerPlatform === 'facebook') {
      testResult = await metaService.testConnection(account);
    } else if (lowerPlatform === 'youtube') {
      testResult = await youtubeService.testConnection(account);
    } else if (lowerPlatform === 'linkedin') {
      testResult = await linkedinService.testConnection(account);
    }

    const isValid = Boolean(testResult?.valid);
    await pool.query(
      `UPDATE client_social_accounts 
       SET is_connected = ?, 
           last_tested_at = NOW(), 
           last_error = ? 
       WHERE id = ?`,
      [isValid, isValid ? null : testResult?.error || 'Test failed', account.id]
    );

    return res.status(200).json({
      success: true,
      valid: isValid,
      error: testResult?.error || null,
      accountName: testResult?.accountName || testResult?.channelTitle || account.platform_username,
      user_message: isValid ? 'Token Sahi Hai' : 'Token Invalid Hai',
    });
  } catch (error) {
    console.error('Error testing social connection:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to test social connection.',
      error: error.message,
    });
  }
});

module.exports = router;
