const path = require('path');
const fs = require('fs');
const pool = require('../config/db');
const { encrypt } = require('../utils/encryption');
const gmbService = require('../services/gmbService');

/**
 * Helper to parse comma-separated string or array into clean string array
 */
const parseCleanList = (input) => {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((w) => String(w).trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(/[\n,]/)
      .map((w) => w.trim())
      .filter(Boolean);
  }
  return [];
};

/**
 * POST /api/clients
 * Create a new Client (Admin only)
 */
const createClient = async (req, res) => {
  try {
    const { name, primary_phone, alternate_phone, address, gmb_url } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Client name is required.',
      });
    }

    const trimmedName = name.trim();
    const cleanPrimaryPhone = primary_phone ? String(primary_phone).trim() : null;
    const cleanAlternatePhone = alternate_phone ? String(alternate_phone).trim() : null;
    const cleanAddress = address ? String(address).trim() : null;
    const cleanGmbUrl = gmb_url ? String(gmb_url).trim() : null;
    const adminId = req.user.id;

    const [result] = await pool.query(
      'INSERT INTO clients (name, primary_phone, alternate_phone, address, gmb_url, created_by_admin_id, is_active) VALUES (?, ?, ?, ?, ?, ?, TRUE)',
      [trimmedName, cleanPrimaryPhone, cleanAlternatePhone, cleanAddress, cleanGmbUrl, adminId]
    );

    const clientId = result.insertId;

    // Initialize blank brand guidelines
    await pool.query(
      `INSERT INTO client_brand_guidelines (client_id, whitelist_words, banned_words, mandatory_phrases)
       VALUES (?, JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY())`,
      [clientId]
    );

    const [created] = await pool.query('SELECT * FROM clients WHERE id = ?', [clientId]);
    const clientRecord = created[0];
    if (clientRecord) {
      if (clientRecord.gmb_snapshot && typeof clientRecord.gmb_snapshot === 'string') {
        try { clientRecord.gmb_snapshot = JSON.parse(clientRecord.gmb_snapshot); } catch (e) {}
      }
      if (clientRecord.gmb_auto_whitelist && typeof clientRecord.gmb_auto_whitelist === 'string') {
        try { clientRecord.gmb_auto_whitelist = JSON.parse(clientRecord.gmb_auto_whitelist); } catch (e) {}
      }
    }

    return res.status(201).json({
      success: true,
      message: `Client '${trimmedName}' created successfully.`,
      client: clientRecord,
    });
  } catch (error) {
    console.error('Error creating client:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create client.',
      error: error.message,
    });
  }
};

/**
 * GET /api/clients
 * List clients (all active by default, or all with ?all=true)
 */
const getClients = async (req, res) => {
  try {
    const includeInactive = req.query.all === 'true' && req.user.role === 'admin';
    const condition = includeInactive ? '' : 'WHERE c.is_active = TRUE';

    const [clients] = await pool.query(`
      SELECT 
        c.*,
        u.name AS created_by_name,
        (SELECT COUNT(*) FROM posts p WHERE p.client_id = c.id) AS post_count,
        (SELECT COUNT(*) FROM social_accounts sa WHERE sa.client_id = c.id AND sa.is_active = TRUE) AS social_account_count
      FROM clients c
      LEFT JOIN users u ON c.created_by_admin_id = u.id
      ${condition}
      ORDER BY c.created_at DESC
    `);

    // Parse JSON fields safely if stringified
    const formattedClients = clients.map((c) => {
      const copy = { ...c };
      if (copy.gmb_snapshot && typeof copy.gmb_snapshot === 'string') {
        try { copy.gmb_snapshot = JSON.parse(copy.gmb_snapshot); } catch (e) {}
      }
      if (copy.gmb_auto_whitelist && typeof copy.gmb_auto_whitelist === 'string') {
        try { copy.gmb_auto_whitelist = JSON.parse(copy.gmb_auto_whitelist); } catch (e) {}
      }
      return copy;
    });

    return res.status(200).json({
      success: true,
      clients: formattedClients,
    });
  } catch (error) {
    console.error('Error fetching clients:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch clients.',
      error: error.message,
    });
  }
};

/**
 * GET /api/clients/:id
 * Get single client with guidelines and connected accounts
 */
const getClientById = async (req, res) => {
  try {
    const { id } = req.params;

    const [clients] = await pool.query(
      `SELECT c.*, u.name AS created_by_name 
       FROM clients c 
       LEFT JOIN users u ON c.created_by_admin_id = u.id 
       WHERE c.id = ?`,
      [id]
    );

    if (clients.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Client not found.',
      });
    }

    const client = { ...clients[0] };
    if (client.gmb_snapshot && typeof client.gmb_snapshot === 'string') {
      try { client.gmb_snapshot = JSON.parse(client.gmb_snapshot); } catch (e) {}
    }
    if (client.gmb_auto_whitelist && typeof client.gmb_auto_whitelist === 'string') {
      try { client.gmb_auto_whitelist = JSON.parse(client.gmb_auto_whitelist); } catch (e) {}
    }

    // Fetch brand guidelines
    const [guidelines] = await pool.query(
      'SELECT * FROM client_brand_guidelines WHERE client_id = ?',
      [id]
    );

    let guidelineData = {
      whitelist_words: [],
      banned_words: [],
      mandatory_phrases: [],
    };

    if (guidelines.length > 0) {
      const g = guidelines[0];
      guidelineData = {
        ...g,
        whitelist_words: typeof g.whitelist_words === 'string' ? JSON.parse(g.whitelist_words) : g.whitelist_words || [],
        banned_words: typeof g.banned_words === 'string' ? JSON.parse(g.banned_words) : g.banned_words || [],
        mandatory_phrases: typeof g.mandatory_phrases === 'string' ? JSON.parse(g.mandatory_phrases) : g.mandatory_phrases || [],
        reference_logo_url: g.reference_logo_url || null,
      };
      client.reference_logo_url = g.reference_logo_url || null;
    }

    // Fetch connected social accounts (no tokens)
    const [socialAccounts] = await pool.query(
      `SELECT id, client_id, platform, account_name, platform_account_id, is_active, created_at
       FROM social_accounts 
       WHERE client_id = ? AND is_active = TRUE
       ORDER BY created_at DESC`,
      [id]
    );

    // Fetch 4-platform social connect accounts
    const ALL_PLATFORMS = ['instagram', 'facebook', 'youtube', 'linkedin'];
    const [socialPlatformRows] = await pool.query(
      `SELECT id, client_id, platform, profile_url, platform_username, platform_id,
              access_token_encrypted, refresh_token_encrypted, token_expires_at,
              refresh_token_expires_at, connection_method, is_connected, last_tested_at, last_error
       FROM client_social_accounts
       WHERE client_id = ?`,
      [id]
    );
    const existingPlatformMap = new Map();
    socialPlatformRows.forEach((r) => existingPlatformMap.set(r.platform, r));

    const { decrypt } = require('../utils/encryption');
    const socialPlatforms = ALL_PLATFORMS.map((platform) => {
      const rec = existingPlatformMap.get(platform);
      if (!rec) {
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
      if (rec.access_token_encrypted) {
        const dec = decrypt(rec.access_token_encrypted);
        if (dec) maskedToken = '....' + dec.slice(-4);
      }
      if (rec.refresh_token_encrypted) {
        const decR = decrypt(rec.refresh_token_encrypted);
        if (decR) maskedRefreshToken = '....' + decR.slice(-4);
      }
      return {
        id: rec.id,
        platform: rec.platform,
        is_connected: Boolean(rec.is_connected),
        profile_url: rec.profile_url,
        platform_username: rec.platform_username,
        platform_id: rec.platform_id,
        connection_method: rec.connection_method,
        token_expires_at: rec.token_expires_at,
        refresh_token_expires_at: rec.refresh_token_expires_at,
        last_tested_at: rec.last_tested_at,
        last_error: rec.last_error,
        masked_access_token: maskedToken,
        has_refresh_token: Boolean(rec.refresh_token_encrypted),
        masked_refresh_token: maskedRefreshToken,
      };
    });

    return res.status(200).json({
      success: true,
      client,
      brand_guidelines: guidelineData,
      social_accounts: socialAccounts,
      social_platforms: socialPlatforms,
    });
  } catch (error) {
    console.error('Error fetching client details:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch client details.',
      error: error.message,
    });
  }
};

/**
 * PUT /api/clients/:id
 * Update Client name or active status (Admin only)
 */
const updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, primary_phone, alternate_phone, address, gmb_url, is_active } = req.body;

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name.trim());
    }

    if (primary_phone !== undefined) {
      updates.push('primary_phone = ?');
      values.push(primary_phone ? String(primary_phone).trim() : null);
    }

    if (alternate_phone !== undefined) {
      updates.push('alternate_phone = ?');
      values.push(alternate_phone ? String(alternate_phone).trim() : null);
    }

    if (address !== undefined) {
      updates.push('address = ?');
      values.push(address ? String(address).trim() : null);
    }

    if (gmb_url !== undefined) {
      updates.push('gmb_url = ?');
      values.push(gmb_url ? String(gmb_url).trim() : null);
    }

    if (is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(Boolean(is_active));
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields provided for update.',
      });
    }

    values.push(id);
    await pool.query(`UPDATE clients SET ${updates.join(', ')} WHERE id = ?`, values);

    const [updated] = await pool.query('SELECT * FROM clients WHERE id = ?', [id]);
    const clientRecord = updated[0];
    if (clientRecord) {
      if (clientRecord.gmb_snapshot && typeof clientRecord.gmb_snapshot === 'string') {
        try { clientRecord.gmb_snapshot = JSON.parse(clientRecord.gmb_snapshot); } catch (e) {}
      }
      if (clientRecord.gmb_auto_whitelist && typeof clientRecord.gmb_auto_whitelist === 'string') {
        try { clientRecord.gmb_auto_whitelist = JSON.parse(clientRecord.gmb_auto_whitelist); } catch (e) {}
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Client updated successfully.',
      client: clientRecord,
    });
  } catch (error) {
    console.error('Error updating client:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update client.',
      error: error.message,
    });
  }
};

/**
 * DELETE /api/clients/:id
 * Permanent Delete Client (Admin only, Deactivated clients only)
 */
const deleteClient = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query('SELECT id, name, is_active FROM clients WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Client not found.',
      });
    }

    const client = rows[0];

    // Strict rule: Only deactivated clients can be permanently deleted
    if (Boolean(client.is_active)) {
      return res.status(400).json({
        success: false,
        message: 'Active clients cannot be deleted directly. Please deactivate the client first.',
      });
    }

    // Cascading delete removes guidelines, posts, revisions, and connected social accounts
    await pool.query('DELETE FROM clients WHERE id = ?', [id]);

    return res.status(200).json({
      success: true,
      message: `Client "${client.name}" and all associated records have been permanently deleted.`,
    });
  } catch (error) {
    console.error('Error deleting client:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to permanently delete client.',
      error: error.message,
    });
  }
};

/**
 * GET /api/clients/:id/brand-guidelines
 * Get Brand Guidelines for client
 */
const getBrandGuidelines = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      'SELECT * FROM client_brand_guidelines WHERE client_id = ?',
      [id]
    );

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        guidelines: {
          client_id: Number(id),
          whitelist_words: [],
          banned_words: [],
          mandatory_phrases: [],
        },
      });
    }

    const g = rows[0];
    return res.status(200).json({
      success: true,
      guidelines: {
        ...g,
        whitelist_words: typeof g.whitelist_words === 'string' ? JSON.parse(g.whitelist_words) : g.whitelist_words || [],
        banned_words: typeof g.banned_words === 'string' ? JSON.parse(g.banned_words) : g.banned_words || [],
        mandatory_phrases: typeof g.mandatory_phrases === 'string' ? JSON.parse(g.mandatory_phrases) : g.mandatory_phrases || [],
      },
    });
  } catch (error) {
    console.error('Error fetching brand guidelines:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch brand guidelines.',
      error: error.message,
    });
  }
};

/**
 * PUT /api/clients/:id/brand-guidelines
 * Update Brand Guidelines for client (Admin only)
 */
const updateBrandGuidelines = async (req, res) => {
  try {
    const { id } = req.params;
    const { whitelist_words, banned_words, mandatory_phrases } = req.body;

    const cleanWhitelist = parseCleanList(whitelist_words);
    const cleanBanned = parseCleanList(banned_words);
    const cleanMandatory = parseCleanList(mandatory_phrases);

    await pool.query(
      `INSERT INTO client_brand_guidelines (client_id, whitelist_words, banned_words, mandatory_phrases)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         whitelist_words = VALUES(whitelist_words),
         banned_words = VALUES(banned_words),
         mandatory_phrases = VALUES(mandatory_phrases)`,
      [
        id,
        JSON.stringify(cleanWhitelist),
        JSON.stringify(cleanBanned),
        JSON.stringify(cleanMandatory),
      ]
    );

    return res.status(200).json({
      success: true,
      message: 'Brand guidelines saved successfully.',
      guidelines: {
        client_id: Number(id),
        whitelist_words: cleanWhitelist,
        banned_words: cleanBanned,
        mandatory_phrases: cleanMandatory,
      },
    });
  } catch (error) {
    console.error('Error updating brand guidelines:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update brand guidelines.',
      error: error.message,
    });
  }
};

/**
 * POST /api/clients/:id/logo
 * Upload or Replace Client Reference Logo (Admin only)
 */
const uploadClientLogo = async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No logo file uploaded.',
      });
    }

    const relativeUrl = `/uploads/logos/${req.file.filename}`;

    await pool.query(
      `INSERT INTO client_brand_guidelines (client_id, whitelist_words, banned_words, mandatory_phrases, reference_logo_url)
       VALUES (?, JSON_ARRAY(), JSON_ARRAY(), JSON_ARRAY(), ?)
       ON DUPLICATE KEY UPDATE reference_logo_url = VALUES(reference_logo_url)`,
      [id, relativeUrl]
    );

    return res.status(200).json({
      success: true,
      message: 'Official brand logo uploaded successfully.',
      reference_logo_url: relativeUrl,
      filename: req.file.filename,
    });
  } catch (error) {
    console.error('Error uploading client logo:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to upload client logo.',
      error: error.message,
    });
  }
};

/**
 * DELETE /api/clients/:id/logo
 * Remove Client Reference Logo (Admin only)
 */
const deleteClientLogo = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      'SELECT reference_logo_url FROM client_brand_guidelines WHERE client_id = ?',
      [id]
    );

    if (rows.length > 0 && rows[0].reference_logo_url) {
      const logoUrl = rows[0].reference_logo_url;
      const filePath = path.join(__dirname, '..', logoUrl.replace(/^\/+/, ''));
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (_) {}
      }
    }

    await pool.query(
      'UPDATE client_brand_guidelines SET reference_logo_url = NULL WHERE client_id = ?',
      [id]
    );

    return res.status(200).json({
      success: true,
      message: 'Official brand logo removed successfully.',
    });
  } catch (error) {
    console.error('Error removing client logo:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to remove client logo.',
      error: error.message,
    });
  }
};

/**
 * GET /api/clients/:id/social-accounts
 * List connected accounts for client (Tokens excluded)
 */
const getClientSocialAccounts = async (req, res) => {
  try {
    const { id } = req.params;

    const [accounts] = await pool.query(
      `SELECT id, client_id, platform, account_name, platform_account_id, is_active, created_at
       FROM social_accounts
       WHERE client_id = ? AND is_active = TRUE
       ORDER BY created_at DESC`,
      [id]
    );

    return res.status(200).json({
      success: true,
      social_accounts: accounts,
    });
  } catch (error) {
    console.error('Error fetching social accounts:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch social accounts.',
      error: error.message,
    });
  }
};

/**
 * POST /api/clients/:id/social-accounts
 * Manual / Direct Connect Social Account (Admin only, instant testing)
 */
const connectSocialAccount = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { platform, account_name, platform_account_id, access_token } = req.body;

    if (!platform || !['instagram', 'facebook'].includes(platform)) {
      return res.status(400).json({
        success: false,
        message: "Platform must be 'instagram' or 'facebook'.",
      });
    }

    if (!account_name || !account_name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Account name is required.',
      });
    }

    const cleanAccountId = platform_account_id?.trim() || `${platform}_${Date.now()}`;
    const rawToken = access_token?.trim() || `token_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const encryptedToken = encrypt(rawToken);

    await connection.beginTransaction();

    const [accountResult] = await connection.query(
      `INSERT INTO social_accounts (client_id, platform, account_name, platform_account_id, connected_by_admin_id, is_active)
       VALUES (?, ?, ?, ?, ?, TRUE)`,
      [id, platform, account_name.trim(), cleanAccountId, req.user.id]
    );

    const socialAccountId = accountResult.insertId;

    await connection.query(
      `INSERT INTO social_account_tokens (social_account_id, access_token, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 60 DAY))`,
      [socialAccountId, encryptedToken]
    );

    await connection.commit();

    const [created] = await connection.query(
      `SELECT id, client_id, platform, account_name, platform_account_id, is_active, created_at
       FROM social_accounts WHERE id = ?`,
      [socialAccountId]
    );

    return res.status(201).json({
      success: true,
      message: `${platform.toUpperCase()} account '${account_name}' connected successfully!`,
      account: created[0],
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error connecting social account:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to connect social account.',
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

/**
 * GET /api/clients/:id/social/connect/:platform
 * Initiate Meta OAuth flow with client_id encoded in state
 */
const initiateSocialConnect = async (req, res) => {
  try {
    const { id, platform } = req.params;

    if (!['instagram', 'facebook'].includes(platform)) {
      return res.status(400).json({
        success: false,
        message: "Platform must be 'instagram' or 'facebook'.",
      });
    }

    const statePayload = Buffer.from(
      JSON.stringify({
        clientId: id,
        platform,
        adminId: req.user.id,
        nonce: Math.random().toString(36).substring(7),
      })
    ).toString('base64');

    const metaAppId = process.env.META_APP_ID;
    const redirectUri = process.env.META_REDIRECT_URI || 'http://localhost:5000/api/social/callback';

    // If Meta App ID is configured with real credentials, build the Meta Dialog URL
    const apiVer = process.env.META_API_VERSION || 'v21.0';
    const metaAuthUrl = `https://www.facebook.com/${apiVer}/dialog/oauth?client_id=${metaAppId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&state=${statePayload}&scope=pages_show_list,pages_manage_posts,pages_read_engagement,instagram_business_basic,instagram_business_content_publish,business_management`;

    // For interactive API clients or sandbox tests, return authUrl
    if (req.query.json === 'true' || req.headers.accept?.includes('application/json')) {
      return res.status(200).json({
        success: true,
        platform,
        clientId: id,
        authUrl: metaAuthUrl,
        state: statePayload,
        mockCallbackUrl: `/api/social/callback?code=mock_code_test&state=${statePayload}`,
      });
    }

    // Direct browser redirect
    return res.redirect(metaAuthUrl);
  } catch (error) {
    console.error('Error initiating social connect:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to initiate social connection.',
      error: error.message,
    });
  }
};

/**
 * GET /api/social/callback
 * Meta OAuth callback handler: exchanges code, encrypts token & saves under client_id
 */
const handleSocialCallback = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { code, state, error: oauthError } = req.query;
    const clientRedirectBase = process.env.CLIENT_REDIRECT_URL || 'http://localhost:5173';

    if (oauthError) {
      console.warn('Meta OAuth rejected by user:', oauthError);
      return res.redirect(`${clientRedirectBase}/admin?tab=clients&error=oauth_rejected`);
    }

    if (!state) {
      return res.status(400).send('Invalid OAuth state parameter.');
    }

    let decodedState;
    try {
      decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
    } catch {
      return res.status(400).send('Malformed OAuth state parameter.');
    }

    const { clientId, platform, adminId } = decodedState;
    if (!clientId || !platform) {
      return res.status(400).send('Missing clientId or platform in state.');
    }

    // Simulated / live token exchange
    const dummyAccountName = `@${platform}_${clientId}_official`;
    const dummyPlatformId = `meta_${Date.now()}`;
    const rawAccessToken = `EAAB_meta_live_token_${Date.now()}_${code || 'auth_granted'}`;
    const encryptedToken = encrypt(rawAccessToken);

    await connection.beginTransaction();

    const [accountResult] = await connection.query(
      `INSERT INTO social_accounts (client_id, platform, account_name, platform_account_id, connected_by_admin_id, is_active)
       VALUES (?, ?, ?, ?, ?, TRUE)`,
      [clientId, platform, dummyAccountName, dummyPlatformId, adminId || 1]
    );

    const socialAccountId = accountResult.insertId;

    await connection.query(
      `INSERT INTO social_account_tokens (social_account_id, access_token, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 60 DAY))`,
      [socialAccountId, encryptedToken]
    );

    await connection.commit();

    return res.redirect(`${clientRedirectBase}/admin?tab=clients&client=${clientId}&connected=${platform}`);
  } catch (error) {
    await connection.rollback();
    console.error('Error handling social callback:', error);
    return res.status(500).send(`OAuth callback failed: ${error.message}`);
  } finally {
    connection.release();
  }
};

/**
 * DELETE /api/clients/:id/social-accounts/:accountId
 * Disconnect a social account (Admin only)
 */
const disconnectSocialAccount = async (req, res) => {
  try {
    const { id, accountId } = req.params;

    const [account] = await pool.query(
      'SELECT * FROM social_accounts WHERE id = ? AND client_id = ?',
      [accountId, id]
    );

    if (account.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Social account not found for this client.',
      });
    }

    await pool.query('DELETE FROM social_accounts WHERE id = ?', [accountId]);

    return res.status(200).json({
      success: true,
      message: 'Social account disconnected successfully.',
    });
  } catch (error) {
    console.error('Error disconnecting social account:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to disconnect social account.',
      error: error.message,
    });
  }
};

/**
 * POST /api/clients/:id/sync-gmb
 * Trigger manual sync for client GMB profile (Admin only)
 */
const syncGmbClient = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await gmbService.syncClientGmb(id);
    const [clients] = await pool.query('SELECT * FROM clients WHERE id = ?', [id]);
    if (clients.length === 0) {
      return res.status(404).json({ success: false, message: 'Client not found.' });
    }
    const client = { ...clients[0] };
    if (client.gmb_snapshot && typeof client.gmb_snapshot === 'string') {
      try { client.gmb_snapshot = JSON.parse(client.gmb_snapshot); } catch (e) {}
    }
    if (client.gmb_auto_whitelist && typeof client.gmb_auto_whitelist === 'string') {
      try { client.gmb_auto_whitelist = JSON.parse(client.gmb_auto_whitelist); } catch (e) {}
    }

    // Key missing or invalid returns HTTP 200 with { success: false, keyError } so frontend shows friendly banner/toast
    if (result.keyError) {
      return res.status(200).json({
        success: false,
        keyError: result.keyError,
        client,
      });
    }

    if (!result.success) {
      return res.status(200).json({
        success: false,
        message: result.reason || 'Sync failed',
        syncResult: result,
        client,
      });
    }

    return res.status(200).json({
      success: true,
      message: result.skipped ? `Sync skipped: ${result.reason}` : 'GMB profile synced successfully.',
      syncResult: result,
      client,
    });
  } catch (error) {
    console.error('Error syncing GMB for client:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to sync GMB for client.',
      error: error.message,
    });
  }
};

module.exports = {
  createClient,
  getClients,
  getClientById,
  updateClient,
  deleteClient,
  getBrandGuidelines,
  updateBrandGuidelines,
  getClientSocialAccounts,
  connectSocialAccount,
  initiateSocialConnect,
  handleSocialCallback,
  disconnectSocialAccount,
  syncGmbClient,
  uploadClientLogo,
  deleteClientLogo,
};

