const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const PYTHON_SCRIPT_PATH = path.resolve(__dirname, '..', 'a2-ocr-server', 'brand_logo_check.py');

/**
 * Foolproof asset path resolver across Windows and POSIX environments.
 */
const resolveAssetPath = (rawPath) => {
  if (!rawPath || typeof rawPath !== 'string') return null;

  try {
    if (fs.existsSync(rawPath)) return path.resolve(rawPath);
  } catch (_) {}

  const clean = rawPath.replace(/^[/\\]+/, '');
  const candBackend = path.resolve(__dirname, '..', clean);
  if (fs.existsSync(candBackend)) return candBackend;

  const candCwd = path.resolve(process.cwd(), clean);
  if (fs.existsSync(candCwd)) return candCwd;

  const candCwdBackend = path.resolve(process.cwd(), 'backend', clean);
  if (fs.existsSync(candCwdBackend)) return candCwdBackend;

  const candDirname = path.resolve(__dirname, clean);
  if (fs.existsSync(candDirname)) return candDirname;

  return null;
};

/**
 * Check Brand Logo in Post Image.
 * Universal Zero-Trust Brand Logo Verification Engine.
 *
 * Rules:
 * - If reference logo is not configured / not on disk: returns FAIL (code: REFERENCE_LOGO_UNCONFIGURED).
 * - If official logo brand name is not configured: returns FAIL (code: LOGO_IDENTITY_UNCONFIGURED).
 * - Missing or unconfigured logos strictly block approval and publishing.
 *
 * @param {Object} params
 * @param {string} params.postImagePath Absolute or relative path to post image
 * @param {string} [params.referenceLogoPath] Absolute or relative path to client reference logo
 * @param {Object} [params.logoConfig] Client brand logo configuration
 * @returns {Promise<Object>}
 */
const checkBrandLogo = async ({ postImagePath, referenceLogoPath, logoConfig = {} }) => {
  // 1. Guard: Check if reference logo is configured
  if (!referenceLogoPath) {
    return {
      status: 'FAIL',
      code: 'REFERENCE_LOGO_UNCONFIGURED',
      found: false,
      score: 0.0,
      location: 'unknown',
      location_hindi: 'Kahin nahi mila',
      size_percent: 0,
      reason: 'REFERENCE_LOGO_UNCONFIGURED',
      suggestion: 'Client Brand Guidelines me official brand logo configure nahi hai. Pehle official logo upload karein.',
      checked_by: 'Python',
      enforcement_state: 'red_block',
    };
  }

  // Resolve reference logo path
  const resolvedLogoPath = resolveAssetPath(referenceLogoPath);

  if (!resolvedLogoPath || !fs.existsSync(resolvedLogoPath)) {
    return {
      status: 'FAIL',
      code: 'REFERENCE_LOGO_UNCONFIGURED',
      found: false,
      score: 0.0,
      location: 'unknown',
      location_hindi: 'Kahin nahi mila',
      size_percent: 0,
      reason: 'REFERENCE_LOGO_UNCONFIGURED',
      suggestion: 'Client Brand Guidelines me official brand logo disk par maujood nahi hai. Pehle official logo upload karein.',
      checked_by: 'Python',
      enforcement_state: 'red_block',
    };
  }

  // 2. Guard: Official Logo Identity configuration
  const officialBrandName = (logoConfig.official_logo_brand_name || '').trim();
  if (!officialBrandName) {
    return {
      status: 'FAIL',
      code: 'LOGO_IDENTITY_UNCONFIGURED',
      found: false,
      score: 0.0,
      location: 'unknown',
      location_hindi: 'Kahin nahi mila',
      size_percent: 0,
      reason: 'LOGO_IDENTITY_UNCONFIGURED',
      suggestion: 'Client Brand Guidelines me official logo identity (official_logo_brand_name) configure nahi hai. Pehle brand name configure karein.',
      checked_by: 'Python',
      enforcement_state: 'red_block',
    };
  }

  // Resolve post image path
  const resolvedPostPath = resolveAssetPath(postImagePath);

  if (!resolvedPostPath || !fs.existsSync(resolvedPostPath)) {
    return {
      status: 'FAIL',
      code: 'POST_IMAGE_MISSING',
      found: false,
      score: 0.0,
      location: 'unknown',
      location_hindi: 'Kahin nahi mila',
      size_percent: 0,
      reason: 'MISSING',
      suggestion: 'Post image disk par nahi mili.',
      checked_by: 'Python',
      enforcement_state: 'red_block',
    };
  }

  // 3. Execute Python brand_logo_check.py (Multi-component independent verification)
  const configPayload = JSON.stringify({
    official_logo_brand_name: officialBrandName,
    required_brand_tokens: logoConfig.required_brand_tokens || [],
    tagline_policy: logoConfig.tagline_policy || 'NONE',
    tagline_text: logoConfig.tagline_text || null,
    ocr_blocks: logoConfig.ocr_blocks || [],
  });

  return new Promise((resolve) => {
    const pythonExe = process.platform === 'win32' ? 'python' : 'python3';
    execFile(
      pythonExe,
      [PYTHON_SCRIPT_PATH, resolvedPostPath, resolvedLogoPath, configPayload],
      {
        timeout: 40000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env },
      },
      (error, stdout, stderr) => {
        if (error) {
          console.warn('[BrandLogoService] Python execution notice:', error.message);
          if (stderr) console.warn('[BrandLogoService] Stderr:', stderr);
        }

        if (stdout && stdout.trim()) {
          try {
            // Find JSON in stdout (in case python printed any warning)
            const jsonStart = stdout.indexOf('{');
            const jsonEnd = stdout.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
              const parsed = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
              if (!parsed.checked_by) {
                parsed.checked_by = 'Python';
              }
              if (parsed.reason === 'COLOR_CHANGED' || (parsed.status === 'PASS' && parsed.reason !== 'CORRECT')) {
                parsed.enforcement_state = 'yellow_alert';
                parsed.status = 'PASS';
              } else if (parsed.status === 'PASS') {
                parsed.enforcement_state = 'green_clean';
              } else {
                parsed.enforcement_state = 'red_block';
              }
              return resolve(parsed);
            }
          } catch (parseErr) {
            console.error('[BrandLogoService] JSON parse error from python output:', parseErr);
          }
        }

        // Safe Fallback if script failed completely
        return resolve({
          status: 'FAIL',
          found: false,
          score: 0.0,
          location: 'unknown',
          location_hindi: 'Kahin nahi mila',
          size_percent: 0,
          reason: 'MISSING',
          suggestion: 'Logo post me kahin nahi mila. Logo ko post me lagayein.',
          checked_by: 'Python',
          enforcement_state: 'red_block',
        });
      }
    );
  });
};

module.exports = {
  checkBrandLogo,
};
