const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const pool = require('../config/db');

/**
 * Perform a real-time system & API health check
 * Reads backend/.env directly on request so any edits/comment-outs in .env
 * are immediately reflected without needing a server restart.
 */
exports.getSystemHealth = async (req, res) => {
  try {
    const envPath = path.resolve(__dirname, '../.env');
    let env = {};
    if (fs.existsSync(envPath)) {
      try {
        env = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
      } catch {
        env = process.env;
      }
    } else {
      env = process.env;
    }

    const services = [];

    // Helper to test if value is empty or dummy
    const isDummyOrMissing = (val) => {
      if (!val) return true;
      const s = String(val).trim().toUpperCase();
      return s === '' || s.startsWith('DUMMY') || s.includes('REPLACE_LATER');
    };

    // 1. GEMINI / GOOGLE VISION AI
    const geminiKey = env.GEMINI_API_KEY || env.GOOGLE_VISION_API_KEY || '';
    if (!geminiKey || geminiKey.trim() === '') {
      services.push({
        id: 'gemini_ai',
        label: 'Google Gemini Multimodal AI',
        status: 'missing',
        severity: 'warning',
        message: 'GEMINI_API_KEY .env me commented out ya missing hai.',
        impact: 'Image Quality Check A2 PaddleOCR fallback par chalega, aur automated Grammar Check skip hoga.',
        action: 'backend/.env me GEMINI_API_KEY uncomment karein ya naya key dalein.',
      });
    } else if (isDummyOrMissing(geminiKey)) {
      services.push({
        id: 'gemini_ai',
        label: 'Google Gemini Multimodal AI',
        status: 'dummy',
        severity: 'warning',
        message: 'GEMINI_API_KEY DUMMY value par set hai.',
        impact: 'AI visual check fallback par chalega.',
        action: 'Google AI Studio se real API key lekar .env me dalein.',
      });
    } else {
      // Test the Gemini key with quick ping (timeout 2500ms)
      try {
        const pingRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey.trim()}`,
          { signal: AbortSignal.timeout(2500) }
        );
        if (pingRes.ok) {
          services.push({
            id: 'gemini_ai',
            label: 'Google Gemini Multimodal AI',
            status: 'active',
            severity: 'ok',
            message: 'Active & Verified (Google AI Studio / Gemini API connected).',
            impact: 'Full Multimodal Poster OCR + Hindi/English Grammar Check enabled.',
          });
        } else {
          const errData = await pingRes.json().catch(() => ({}));
          const errMsg = errData.error?.message || `HTTP ${pingRes.status}`;
          services.push({
            id: 'gemini_ai',
            label: 'Google Gemini Multimodal AI',
            status: 'expired_or_invalid',
            severity: 'critical',
            message: `GEMINI_API_KEY Google se reject ho gayi (${errMsg}). Key expire ya invalid hai.`,
            impact: 'AI OCR aur Grammar check band hai. System fallback PaddleOCR use kar raha hai.',
            action: 'Google AI Studio se naya Gemini API Key banakar .env me update karein.',
          });
        }
      } catch (err) {
        services.push({
          id: 'gemini_ai',
          label: 'Google Gemini Multimodal AI',
          status: 'network_timeout',
          severity: 'warning',
          message: `Gemini API ping timeout ya network error (${err.message}).`,
          impact: 'Check fallback may trigger if Google is unreachable.',
        });
      }
    }

    // 2. A2 REMOTE PADDLEOCR SERVER
    const a2Url = (env.A2_OCR_API_URL || '').trim();
    const a2Key = (env.A2_OCR_API_KEY || '').trim();
    if (!a2Url || !a2Key || isDummyOrMissing(a2Key)) {
      services.push({
        id: 'a2_paddleocr',
        label: 'A2 Remote PaddleOCR Server',
        status: 'missing',
        severity: 'critical',
        message: 'A2_OCR_API_URL ya A2_OCR_API_KEY .env me missing hai.',
        impact: 'Agar Gemini fail hoga to fallback OCR kaam nahi karega aur image scan fail ho jayega.',
        action: 'backend/.env me A2_OCR_API_URL aur A2_OCR_API_KEY add karein.',
      });
    } else {
      try {
        const cleanUrl = a2Url.replace(/\/+$/, '');
        const a2Res = await fetch(`${cleanUrl}/health`, {
          headers: { 'X-API-Key': a2Key },
          signal: AbortSignal.timeout(2500),
        });
        if (a2Res.ok) {
          services.push({
            id: 'a2_paddleocr',
            label: 'A2 Remote PaddleOCR Server',
            status: 'active',
            severity: 'ok',
            message: `Online & Healthy (${cleanUrl}).`,
            impact: 'PaddleOCR fallback service ready hai.',
          });
        } else {
          services.push({
            id: 'a2_paddleocr',
            label: 'A2 Remote PaddleOCR Server',
            status: 'degraded',
            severity: 'warning',
            message: `A2 OCR Server returned status HTTP ${a2Res.status}.`,
            impact: 'PaddleOCR fallback me issue aa sakta hai.',
          });
        }
      } catch (err) {
        services.push({
          id: 'a2_paddleocr',
          label: 'A2 Remote PaddleOCR Server',
          status: 'unreachable',
          severity: 'warning',
          message: `A2 Server ping timeout (${err.message}). Server temporarily unreachable.`,
          impact: 'Fallback requests may time out.',
        });
      }
    }

    // 3. GOOGLE PLACES API (GMB SYNC)
    const gmbKey = env.GOOGLE_PLACES_API_KEY || '';
    if (isDummyOrMissing(gmbKey)) {
      services.push({
        id: 'google_places',
        label: 'Google Places / GMB Auto-Sync',
        status: 'free_mode',
        severity: 'info',
        message: 'GMB Auto-Sync OFF — Free Mode active (DUMMY Key).',
        impact: 'Manual client name, phone aur address safely use ho raha hai. Google se auto-sync nahi hoga.',
        action: 'Weekly auto-sync chahiye to Google Places API Key .env me dalein.',
      });
    } else {
      services.push({
        id: 'google_places',
        label: 'Google Places / GMB Auto-Sync',
        status: 'active',
        severity: 'ok',
        message: 'Google Places API Key configured. Weekly auto-sync active.',
        impact: 'Official client verification via Google Maps enabled.',
      });
    }

    // 4. META DEVELOPER APP (INSTAGRAM + FACEBOOK)
    const metaId = env.META_APP_ID || '';
    const metaSecret = env.META_APP_SECRET || '';
    if (isDummyOrMissing(metaId) || isDummyOrMissing(metaSecret)) {
      services.push({
        id: 'meta_oauth',
        label: 'Meta Developer App (Instagram & Facebook)',
        status: 'dummy',
        severity: 'warning',
        message: 'META_APP_ID ya META_APP_SECRET .env me DUMMY hai.',
        impact: '1-Click OAuth popup kaam nahi karega ("OAuth Key Nahi Mili"). Lekin "Manual se Jodo" kaam karega.',
        action: 'Meta Developers Console se Agency App banakar credentials .env me dalein.',
      });
    } else {
      services.push({
        id: 'meta_oauth',
        label: 'Meta Developer App (Instagram & Facebook)',
        status: 'active',
        severity: 'ok',
        message: `App ID: ${metaId.substring(0, 6)}... configured.`,
        impact: '1-Click Meta OAuth ready for all clients.',
      });
    }

    // 5. GOOGLE CLOUD APP (YOUTUBE)
    const ytId = env.YOUTUBE_CLIENT_ID || '';
    const ytSecret = env.YOUTUBE_CLIENT_SECRET || '';
    if (isDummyOrMissing(ytId) || isDummyOrMissing(ytSecret)) {
      services.push({
        id: 'youtube_oauth',
        label: 'Google Cloud (YouTube Agency App)',
        status: 'dummy',
        severity: 'warning',
        message: 'YOUTUBE_CLIENT_ID ya YOUTUBE_CLIENT_SECRET .env me DUMMY hai.',
        impact: '1-Click YouTube OAuth kaam nahi karega. Manual Refresh Token mode use karein.',
        action: 'Google Cloud Console se OAuth 2.0 Client credentials .env me dalein.',
      });
    } else {
      services.push({
        id: 'youtube_oauth',
        label: 'Google Cloud (YouTube Agency App)',
        status: 'active',
        severity: 'ok',
        message: `Configured (Project: ${env.GOOGLE_PROJECT_ID || 'socel-workflow'}).`,
        impact: 'Testing Mode: Client ka Gmail Google Cloud me Test User hona zaroori hai.',
      });
    }

    // 6. LINKEDIN DEVELOPER APP
    const liId = env.LINKEDIN_CLIENT_ID || '';
    const liSecret = env.LINKEDIN_CLIENT_SECRET || '';
    if (isDummyOrMissing(liId) || isDummyOrMissing(liSecret)) {
      services.push({
        id: 'linkedin_oauth',
        label: 'LinkedIn Developer App',
        status: 'dummy',
        severity: 'warning',
        message: 'LINKEDIN_CLIENT_ID ya LINKEDIN_CLIENT_SECRET .env me DUMMY hai.',
        impact: '1-Click LinkedIn OAuth connect disabled hai. "Manual se Jodo" option use karein.',
        action: 'LinkedIn Developer Portal se App credentials .env me dalein.',
      });
    } else {
      services.push({
        id: 'linkedin_oauth',
        label: 'LinkedIn Developer App',
        status: 'active',
        severity: 'ok',
        message: `Configured (Client ID: ${liId.substring(0, 6)}...).`,
        impact: '1-Click LinkedIn OAuth ready for all clients.',
      });
    }

    // 7. AES-256 ENCRYPTION KEY
    const encKey = env.ENCRYPTION_KEY || '';
    if (!encKey || encKey.length !== 64) {
      services.push({
        id: 'encryption_key',
        label: 'AES-256 Token Encryption',
        status: 'invalid',
        severity: 'critical',
        message: 'ENCRYPTION_KEY .env me missing ya 32-byte hex (64 chars) nahi hai.',
        impact: 'Social account tokens encrypt/decrypt nahi ho payenge!',
        action: '32-byte hex key generate karke backend/.env me ENCRYPTION_KEY set karein.',
      });
    } else {
      services.push({
        id: 'encryption_key',
        label: 'AES-256 Token Encryption',
        status: 'active',
        severity: 'ok',
        message: 'AES-256-GCM secure token encryption active.',
      });
    }

    // 8. DATABASE CLIENT SOCIAL TOKENS CHECK
    const [tokenRows] = await pool.query(
      `SELECT csa.id, csa.client_id, c.name as client_name, csa.platform, 
              csa.is_connected, csa.token_expires_at, csa.connection_method, 
              csa.last_error, csa.last_tested_at
       FROM client_social_accounts csa
       JOIN clients c ON c.id = csa.client_id
       ORDER BY c.name ASC, csa.platform ASC`
    );

    const now = new Date();
    const in48Hours = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const expiredTokens = [];
    const expiringSoonTokens = [];
    const connectionErrors = [];

    for (const row of tokenRows) {
      const expDate = row.token_expires_at ? new Date(row.token_expires_at) : null;

      // Check if token is expired
      if (row.is_connected && expDate && expDate < now) {
        expiredTokens.push({
          client_id: row.client_id,
          client_name: row.client_name,
          platform: row.platform,
          token_expires_at: row.token_expires_at,
          connection_method: row.connection_method,
          message: `${row.client_name} ka ${row.platform.toUpperCase()} access token expire ho chuka hai (${expDate.toLocaleString()}).`,
        });
      }
      // Check if token is expiring within 48 hours
      else if (row.is_connected && expDate && expDate >= now && expDate <= in48Hours) {
        expiringSoonTokens.push({
          client_id: row.client_id,
          client_name: row.client_name,
          platform: row.platform,
          token_expires_at: row.token_expires_at,
          connection_method: row.connection_method,
          message: `${row.client_name} ka ${row.platform.toUpperCase()} token jald expire hone wala hai (${expDate.toLocaleString()}).`,
        });
      }

      // Check if disconnected with error
      if (!row.is_connected && row.last_error) {
        connectionErrors.push({
          client_id: row.client_id,
          client_name: row.client_name,
          platform: row.platform,
          last_error: row.last_error,
          message: `${row.client_name} (${row.platform.toUpperCase()}): ${row.last_error}`,
        });
      }
    }

    // Summary calculation
    const criticalCount =
      services.filter((s) => s.severity === 'critical').length + expiredTokens.length;
    const warningCount =
      services.filter((s) => s.severity === 'warning').length +
      expiringSoonTokens.length +
      connectionErrors.length;
    const infoCount = services.filter((s) => s.severity === 'info').length;

    const allHealthy = criticalCount === 0 && warningCount === 0;

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        all_healthy: allHealthy,
        critical_count: criticalCount,
        warning_count: warningCount,
        info_count: infoCount,
        total_alerts: criticalCount + warningCount,
      },
      services,
      client_tokens: {
        expired: expiredTokens,
        expiring_soon: expiringSoonTokens,
        connection_errors: connectionErrors,
      },
    });
  } catch (err) {
    console.error('[AdminController] Health check error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve system health status.',
      error: err.message,
    });
  }
};
