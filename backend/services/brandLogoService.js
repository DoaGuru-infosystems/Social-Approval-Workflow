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
 * Flow:
 * - If reference logo is not configured / not on disk: returns SKIPPED (not FAIL).
 * - If reference logo is configured: executes brand_logo_check.py (SIFT + ORB + Template Matching).
 *
 * @param {Object} params
 * @param {string} params.postImagePath Absolute or relative path to post image
 * @param {string} [params.referenceLogoPath] Absolute or relative path to client reference logo
 * @returns {Promise<Object>}
 */
const checkBrandLogo = async ({ postImagePath, referenceLogoPath }) => {
  // 1. Guard: Check if reference logo is configured
  if (!referenceLogoPath) {
    return {
      status: 'SKIPPED',
      found: false,
      score: 0.0,
      location: 'unknown',
      location_hindi: 'Kahin nahi mila',
      size_percent: 0,
      reason: 'SKIPPED',
      suggestion: 'Logo Check Skipped - Logo upload nahi hai',
      checked_by: 'Python',
    };
  }

  // Resolve reference logo path
  const resolvedLogoPath = resolveAssetPath(referenceLogoPath);

  if (!resolvedLogoPath || !fs.existsSync(resolvedLogoPath)) {
    return {
      status: 'SKIPPED',
      found: false,
      score: 0.0,
      location: 'unknown',
      location_hindi: 'Kahin nahi mila',
      size_percent: 0,
      reason: 'SKIPPED',
      suggestion: 'Logo Check Skipped - Logo upload nahi hai',
      checked_by: 'Python',
    };
  }

  // Resolve post image path
  const resolvedPostPath = resolveAssetPath(postImagePath);

  if (!resolvedPostPath || !fs.existsSync(resolvedPostPath)) {
    return {
      status: 'FAIL',
      found: false,
      score: 0.0,
      location: 'unknown',
      location_hindi: 'Kahin nahi mila',
      size_percent: 0,
      reason: 'MISSING',
      suggestion: 'Logo post me kahin nahi mila. Logo ko post me lagayein.',
      checked_by: 'Python',
    };
  }

  // 2. Execute Python brand_logo_check.py (SIFT + ORB + Multi-scale Template Matching)
  return new Promise((resolve) => {
    const pythonExe = process.platform === 'win32' ? 'python' : 'python3';
    execFile(
      pythonExe,
      [PYTHON_SCRIPT_PATH, resolvedPostPath, resolvedLogoPath],
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
        });
      }
    );
  });
};

module.exports = {
  checkBrandLogo,
};
