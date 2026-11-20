const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const pool = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const postRoutes = require('./routes/postRoutes');
const clientRoutes = require('./routes/clientRoutes');
const adminRoutes = require('./routes/adminRoutes');
const clientController = require('./controllers/clientController');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS Configuration: Support localhost and ngrok tunneling
const allowedOrigins = [
  'https://boaster-virtuous-pristine.ngrok-free.dev',
  'http://boaster-virtuous-pristine.ngrok-free.dev',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://localhost:5001',
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);

    const cleanOrigin = origin.replace(/\/+$/, '');
    if (
      allowedOrigins.includes(cleanOrigin) ||
      cleanOrigin.endsWith('.ngrok-free.dev') ||
      cleanOrigin.endsWith('.ngrok.io') ||
      cleanOrigin.includes('localhost') ||
      cleanOrigin.includes('127.0.0.1')
    ) {
      return callback(null, true);
    }
    // Fallback: reflect requesting origin so tunneling or custom ports don't break
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'ngrok-skip-browser-warning',
    'bypass-tunnel-reminder',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Headers',
    'Access-Control-Request-Method',
    'X-API-Key',
  ],
  exposedHeaders: ['ngrok-skip-browser-warning'],
};

// Middleware
app.use(morgan('dev'));
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health Check Route
app.get('/api/health', async (req, res) => {
  const dbStatus = await pool.testConnection();
  if (dbStatus.connected) {
    return res.status(200).json({
      status: 'ok',
      db: 'connected',
      message: 'Server and Database are fully operational.',
      timestamp: new Date().toISOString(),
    });
  } else {
    return res.status(503).json({
      status: 'degraded',
      db: 'disconnected',
      error: dbStatus.error,
      message: 'Server is running, but database connection failed. Verify MySQL service and .env credentials.',
      timestamp: new Date().toISOString(),
    });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/admin', adminRoutes);

// Human-in-the-Loop Global Whitelist Endpoint
app.post('/api/whitelist/add', (req, res) => {
  const { word } = req.body;
  if (!word || typeof word !== 'string' || !word.trim()) {
    return res.status(400).json({ error: 'Valid word is required' });
  }
  const hindiDictionaryService = require('./services/hindiDictionaryService');
  const added = hindiDictionaryService.addWordToGlobalWhitelist(word.trim());
  return res.status(200).json({
    success: true,
    word: word.trim(),
    message: added ? 'Word added to global whitelist' : 'Word already exists in whitelist',
  });
});

app.get('/api/whitelist', (req, res) => {
  const hindiDictionaryService = require('./services/hindiDictionaryService');
  return res.status(200).json({
    whitelist: hindiDictionaryService.getGlobalWhitelist(),
  });
});
// Legacy and alternative OAuth callback route
app.get('/api/social/callback', async (req, res) => {
  const metaService = require('./services/metaService');
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
    const errorMsg = error_description || req.query.error_reason || error || 'oauth_cancelled';
    return res.redirect(`${redirectBase}/admin?tab=clients${clientParam}&error=${encodeURIComponent(errorMsg)}`);
  }

  if (!code || !state) {
    return res.redirect(`${redirectBase}/admin?tab=clients${clientParam}&error=${encodeURIComponent('No authorization code or state received')}`);
  }

  try {
    const result = await metaService.handleCallback(code, state, req);
    const targetBase = result.frontendOrigin || redirectBase;
    const warningParam = result.warning ? `&warning=${encodeURIComponent(result.warning)}` : '';
    return res.redirect(
      `${targetBase}/admin?tab=clients&client=${result.clientId}&connected=${result.platform}&success=true${warningParam}`
    );
  } catch (err) {
    console.error('Callback error at /api/social/callback:', err);
    return res.redirect(`${redirectBase}/admin?tab=clients${clientParam}&error=${encodeURIComponent(err.message)}`);
  }
});

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Social Media Post Approval API (Basic MVP) is running.',
    healthCheck: '/api/health',
    endpoints: {
      auth: ['POST /api/auth/register', 'POST /api/auth/login', 'GET /api/auth/me'],
      posts: [
        'GET /api/posts',
        'GET /api/posts/:id',
        'POST /api/posts',
        'PUT /api/posts/:id/revise',
        'POST /api/posts/:id/submit',
        'POST /api/posts/:id/manager-review',
        'POST /api/posts/:id/admin-review',
        'PUT /api/posts/:id/platform',
        'PUT /api/posts/:id/publish-url',
      ],
    },
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'API route not found.' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error.',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Startup Recovery Hook & Server Startup
const startServer = async () => {
  // Reconcile orphaned pending AI checks from previous server run
  try {
    const [result] = await pool.query(
      "UPDATE ai_check_results SET image_status='failed', image_error='Processing interrupted by server restart. Please retry.' WHERE image_status='pending'"
    );
    if (result && result.affectedRows > 0) {
      console.log(`⚠️ Recovered ${result.affectedRows} pending AI check(s) interrupted by server restart.`);
    }
    // Auto-migration for logo_check and fallback tracking columns
    await pool.query('ALTER TABLE ai_check_results ADD COLUMN IF NOT EXISTS logo_check JSON NULL');
    await pool.query('ALTER TABLE ai_check_results ADD COLUMN IF NOT EXISTS ai_provider VARCHAR(20) DEFAULT "gemini"');
    await pool.query('ALTER TABLE ai_check_results ADD COLUMN IF NOT EXISTS fallback_used BOOLEAN DEFAULT FALSE');
    await pool.query('ALTER TABLE ai_check_results ADD COLUMN IF NOT EXISTS fallback_reason VARCHAR(50) DEFAULT "none"');
  } catch (err) {
    console.warn(`⚠️ Startup recovery query notice: ${err.message}`);
  }

  const server = app.listen(PORT, async () => {
    console.log(`===============================================`);
    console.log(`🚀 Backend server is running on http://localhost:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log(`===============================================`);

    // Check database connectivity on boot
    const dbStatus = await pool.testConnection();
    if (dbStatus.connected) {
      console.log(`✅ MySQL Database connected successfully.`);
    } else {
      console.warn(`⚠️ MySQL Database connection notice: ${dbStatus.error}`);
      console.warn(`👉 Please ensure MySQL is running and DB '${process.env.DB_NAME || 'social_approval_db'}' exists.`);
    }

    // Pre-warm Spellcheck Dictionaries (English nspell + Hindi hunspell-asm)
    try {
      const spellCheckService = require('./services/spellCheckService');
      const dictStatus = await spellCheckService.initDictionaries();
      console.log(`✅ Spellcheck dictionaries pre-warmed into memory (${dictStatus.durationMs} ms).`);
    } catch (err) {
      console.warn(`⚠️ Spellcheck dictionary pre-warming notice: ${err.message}`);
    }

    // Initialize Weekly GMB Background Sync Worker
    try {
      initWeeklyGmbSyncJob();
      console.log('✅ Weekly GMB background sync worker initialized (runs daily check for 7+ day stale profiles).');
    } catch (err) {
      console.warn(`⚠️ GMB sync job initialization notice: ${err.message}`);
    }

    // Initialize Post Scheduler Job
    try {
      const { initSchedulerJob } = require('./jobs/schedulerJob');
      initSchedulerJob();
    } catch (err) {
      console.warn(`⚠️ Post scheduler job initialization notice: ${err.message}`);
    }

    // Initialize Social Token Auto-Refresh Job
    try {
      const { startTokenAutoRefreshJob } = require('./services/tokenRefreshService');
      startTokenAutoRefreshJob();
      console.log('✅ Social token auto-refresh worker initialized (runs every 12 hours).');
    } catch (err) {
      console.warn(`⚠️ Token auto-refresh job initialization notice: ${err.message}`);
    }
  });

  return server;
};

/**
 * Background Weekly GMB Sync Worker
 * Checks for active clients with a GMB URL whose data has never been synced
 * or was synced more than 7 days ago.
 */
const runGmbWeeklySyncBatch = async () => {
  try {
    const gmbService = require('./services/gmbService');
    const keyStatus = gmbService.getKeyStatus();
    if (keyStatus.status === 'MISSING') {
      console.log('[GMB Weekly] Skipped - API Key Not Found, manual mode active');
      return;
    }

    const [eligibleClients] = await pool.query(
      `SELECT id, name, gmb_url, gmb_last_synced_at 
       FROM clients 
       WHERE gmb_url IS NOT NULL 
         AND is_active = TRUE 
         AND (gmb_last_synced_at IS NULL OR gmb_last_synced_at < DATE_SUB(NOW(), INTERVAL 7 DAY))`
    );

    if (eligibleClients.length === 0) {
      return;
    }

    console.log(`[GMB Background Worker] Found ${eligibleClients.length} client(s) due for weekly GMB sync.`);

    for (const client of eligibleClients) {
      try {
        const res = await gmbService.syncClientGmb(client.id);
        if (res.keyError) {
          console.log(`[GMB Weekly] Skipped - ${res.keyError.code}, manual mode active`);
          if (res.keyError.code === 'GMB_KEY_INVALID') {
            return; // Skip remaining to avoid API spam if key is invalid
          }
        } else if (res.skipped) {
          console.log(`[GMB Background Worker] Client ${client.id} (${client.name}) sync skipped: ${res.reason}`);
        } else {
          console.log(`[GMB Background Worker] Client ${client.id} (${client.name}) synced successfully.`);
        }
      } catch (clientErr) {
        console.warn(`[GMB Background Worker] Client sync notice for ${client.id}: ${clientErr.message}`);
      }
    }
  } catch (err) {
    console.warn(`[GMB Background Worker] Batch check notice: ${err.message}`);
  }
};

const initWeeklyGmbSyncJob = () => {
  // Defer first check 10 seconds after boot
  setTimeout(runGmbWeeklySyncBatch, 10000);

  // Repeat check every 24 hours
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  setInterval(runGmbWeeklySyncBatch, TWENTY_FOUR_HOURS);
};

if (require.main === module) {
  startServer();
}

module.exports = app;
app.startServer = startServer;

