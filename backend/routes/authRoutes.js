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

router.get('/meta/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.redirect(`${clientRedirectBase}/admin?tab=clients&error=meta_oauth_cancelled`);
  }
  try {
    const result = await metaService.handleCallback(code, state);
    return res.redirect(
      `${clientRedirectBase}/admin?tab=clients&client=${result.clientId}&connected=${result.platform}&success=true`
    );
  } catch (err) {
    console.error('Meta OAuth callback error:', err);
    return res.redirect(`${clientRedirectBase}/admin?tab=clients&error=${encodeURIComponent(err.message)}`);
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
