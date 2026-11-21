const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const metaService = require('../services/metaService');
const youtubeService = require('../services/youtubeService');
const linkedinService = require('../services/linkedinService');

// Public routes
router.post('/register', authController.register);
router.post('/login', authController.login);

// Protected routes
router.get('/me', authMiddleware, authController.getMe);

// OAuth Callbacks
const clientRedirectBase = process.env.CLIENT_REDIRECT_URL || 'http://localhost:5173';

// 1. Independent Facebook OAuth Routes
router.get('/meta/facebook', (req, res) => {
  const clientId = req.query.clientId || req.query.client_id || 11;
  const origin = req.query.origin || null;
  const authRes = metaService.getFacebookAuthUrl(clientId, origin);
  if (!authRes.success) {
    return res.status(400).json(authRes);
  }
  return res.redirect(authRes.authUrl);
});

router.get('/meta/facebook/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  let redirectBase = process.env.CLIENT_REDIRECT_URL || 'http://localhost:5173';
  let clientId = null;
  if (state) {
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
      if (decoded.frontendOrigin) redirectBase = decoded.frontendOrigin;
      if (decoded.clientId) clientId = decoded.clientId;
    } catch {}
  }
  const clientParam = clientId ? `&client=${clientId}` : '';

  if (error) {
    const errorMsg = error_description || req.query.error_reason || error || 'facebook_oauth_cancelled';
    return res.redirect(`${redirectBase}/admin?tab=clients${clientParam}&error=${encodeURIComponent(errorMsg)}`);
  }

  if (!code || !state) {
    return res.redirect(`${redirectBase}/admin?tab=clients${clientParam}&error=${encodeURIComponent('No code or state received for Facebook')}`);
  }

  try {
    const result = await metaService.handleFacebookCallback(code, state, req);
    const targetBase = result.frontendOrigin || redirectBase;
    return res.redirect(
      `${targetBase}/admin?tab=clients&client=${result.clientId}&connected=facebook&success=true`
    );
  } catch (err) {
    console.error('Facebook OAuth callback error:', err);
    return res.redirect(`${redirectBase}/admin?tab=clients${clientParam}&error=${encodeURIComponent(err.message)}`);
  }
});

// 2. Independent Instagram OAuth Routes
router.get('/meta/instagram', (req, res) => {
  const clientId = req.query.clientId || req.query.client_id || 11;
  const origin = req.query.origin || null;
  const authRes = metaService.getInstagramAuthUrl(clientId, origin);
  if (!authRes.success) {
    return res.status(400).json(authRes);
  }
  return res.redirect(authRes.authUrl);
});

router.get('/meta/instagram/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  let redirectBase = process.env.CLIENT_REDIRECT_URL || 'http://localhost:5173';
  let clientId = null;
  if (state) {
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
      if (decoded.frontendOrigin) redirectBase = decoded.frontendOrigin;
      if (decoded.clientId) clientId = decoded.clientId;
    } catch {}
  }
  const clientParam = clientId ? `&client=${clientId}` : '';

  if (error) {
    const errorMsg = error_description || req.query.error_reason || error || 'instagram_oauth_cancelled';
    return res.redirect(`${redirectBase}/admin?tab=clients${clientParam}&error=${encodeURIComponent(errorMsg)}`);
  }

  if (!code || !state) {
    return res.redirect(`${redirectBase}/admin?tab=clients${clientParam}&error=${encodeURIComponent('No code or state received for Instagram')}`);
  }

  try {
    const result = await metaService.handleInstagramCallback(code, state, req);
    const targetBase = result.frontendOrigin || redirectBase;
    const warningParam = result.warning ? `&warning=${encodeURIComponent(result.warning)}` : '';
    return res.redirect(
      `${targetBase}/admin?tab=clients&client=${result.clientId}&connected=instagram&success=true${warningParam}`
    );
  } catch (err) {
    console.error('Instagram OAuth callback error:', err);
    return res.redirect(`${redirectBase}/admin?tab=clients${clientParam}&error=${encodeURIComponent(err.message)}`);
  }
});

// 3. Unified Meta Callback fallback
router.get('/meta/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  let redirectBase = process.env.CLIENT_REDIRECT_URL || 'http://localhost:5173';
  let clientId = null;
  if (state) {
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
      if (decoded.frontendOrigin) redirectBase = decoded.frontendOrigin;
      if (decoded.clientId) clientId = decoded.clientId;
    } catch {}
  }
  const clientParam = clientId ? `&client=${clientId}` : '';

  if (error) {
    const errorMsg = error_description || req.query.error_reason || error || 'meta_oauth_cancelled';
    return res.redirect(`${redirectBase}/admin?tab=clients${clientParam}&error=${encodeURIComponent(errorMsg)}`);
  }

  if (!code || !state) {
    return res.redirect(`${redirectBase}/admin?tab=clients${clientParam}&error=${encodeURIComponent('No authorization code or state received from Meta')}`);
  }

  try {
    const result = await metaService.handleCallback(code, state, req);
    const targetBase = result.frontendOrigin || redirectBase;
    const warningParam = result.warning ? `&warning=${encodeURIComponent(result.warning)}` : '';
    return res.redirect(
      `${targetBase}/admin?tab=clients&client=${result.clientId}&connected=${result.platform}&success=true${warningParam}`
    );
  } catch (err) {
    console.error('Meta OAuth callback error:', err);
    return res.redirect(`${redirectBase}/admin?tab=clients${clientParam}&error=${encodeURIComponent(err.message)}`);
  }
});

router.get('/youtube/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.redirect(`${clientRedirectBase}/admin?tab=clients&error=youtube_oauth_cancelled`);
  }
  try {
    const result = await youtubeService.handleCallback(code, state);
    return res.redirect(
      `${clientRedirectBase}/admin?tab=clients&client=${result.clientId}&connected=youtube&success=true`
    );
  } catch (err) {
    console.error('YouTube OAuth callback error:', err);
    return res.redirect(`${clientRedirectBase}/admin?tab=clients&error=${encodeURIComponent(err.message)}`);
  }
});

router.get('/linkedin/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.redirect(`${clientRedirectBase}/admin?tab=clients&error=linkedin_oauth_cancelled`);
  }
  try {
    const result = await linkedinService.handleCallback(code, state);
    return res.redirect(
      `${clientRedirectBase}/admin?tab=clients&client=${result.clientId}&connected=linkedin&success=true`
    );
  } catch (err) {
    console.error('LinkedIn OAuth callback error:', err);
    return res.redirect(`${clientRedirectBase}/admin?tab=clients&error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;
