const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const PYTHON_SCRIPT_PATH = path.resolve(__dirname, '..', 'a2-ocr-server', 'brand_logo_check.py');

/**
 * Check Brand Logo in Post Image.
 * Flow:
 * - If reference logo is not configured / not on disk: returns SKIPPED (not FAIL).
 * - If reference logo is configured: executes brand_logo_check.py (AI FIRST, PYTHON FALLBACK).
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
      suggestion: 'Logo Check skipped - Brand Guidelines me logo upload nahi hai',
    };
  }

  // Resolve reference logo path
  let resolvedLogoPath = path.isAbsolute(referenceLogoPath)
    ? referenceLogoPath
    : path.resolve(path.join(__dirname, '..', referenceLogoPath.replace(/^\/+/, '')));

  if (!fs.existsSync(resolvedLogoPath)) {
    return {
      status: 'SKIPPED',
      found: false,
      score: 0.0,
      location: 'unknown',
      location_hindi: 'Kahin nahi mila',
      size_percent: 0,
      reason: 'SKIPPED',
      suggestion: 'Logo Check skipped - Brand Guidelines me logo upload nahi hai',
    };
  }

  // Resolve post image path
  let resolvedPostPath = path.isAbsolute(postImagePath)
    ? postImagePath
    : path.resolve(path.join(__dirname, '..', postImagePath.replace(/^\/+/, '')));

  if (!fs.existsSync(resolvedPostPath)) {
    return {
      status: 'FAIL',
      found: false,
      score: 0.0,
      location: 'unknown',
      location_hindi: 'Kahin nahi mila',
      size_percent: 0,
      reason: 'MISSING',
      suggestion: 'Post image file not found on disk for logo inspection.',
    };
  }

  // 2. Execute Python brand_logo_check.py (AI First, Python Fallback)
  return new Promise((resolve) => {
    const pythonExe = process.platform === 'win32' ? 'python' : 'python3';
    execFile(
      pythonExe,
      [PYTHON_SCRIPT_PATH, resolvedPostPath, resolvedLogoPath],
      {
        timeout: 25000,
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
          suggestion: 'Logo post me kahin nahi mila. Logo ko neeche right corner me saaf jagah pe lagayein.',
        });
      }
    );
  });
};

module.exports = {
  checkBrandLogo,
};
