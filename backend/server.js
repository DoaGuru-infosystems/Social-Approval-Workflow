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
const clientController = require('./controllers/clientController');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(morgan('dev'));
app.use(
  cors({
    origin: true, // Allow any requesting origin (localhost:5173, localhost:5174, etc.)
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
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
app.get('/api/social/callback', clientController.handleSocialCallback);

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
  });

  return server;
};

if (require.main === module) {
  startServer();
}

module.exports = app;
app.startServer = startServer;

