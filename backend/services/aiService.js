const { spawn } = require('child_process');
const path = require('path');
const pool = require('../config/db');

const AI_CHECK_TIMEOUT_MS = 120_000;
const backendRoot = path.resolve(__dirname, '..');
const pythonThreadEnv = {
  OPENBLAS_NUM_THREADS: '1',
  OMP_NUM_THREADS: '1',
  MKL_NUM_THREADS: '1',
  NUMEXPR_NUM_THREADS: '1',
  OPENCV_NUM_THREADS: '1',
  VECLIB_MAXIMUM_THREADS: '1',
  BLIS_NUM_THREADS: '1',
};

/**
 * Fetch Brand Guidelines for a specific Client
 * @param {number} clientId
 * @returns {Promise<{whitelist: string[], banned: string[], mandatory: string[]}>}
 */
const getClientGuidelines = async (clientId) => {
  if (!clientId) {
    return { whitelist: [], banned: [], mandatory: [] };
  }

  const [rows] = await pool.query(
    'SELECT whitelist_words, banned_words, mandatory_phrases FROM client_brand_guidelines WHERE client_id = ?',
    [clientId]
  );

  if (rows.length === 0) {
    return { whitelist: [], banned: [], mandatory: [] };
  }

  const g = rows[0];
  const parseList = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        return val.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    return [];
  };

  return {
    whitelist: parseList(g.whitelist_words),
    banned: parseList(g.banned_words),
    mandatory: parseList(g.mandatory_phrases),
  };
};

/**
 * Run the per-request Python OCR and spelling check.
 * @param {Object} inputData
 * @returns {Promise<Object>}
 */
const runPythonAICheck = (inputData) =>
  new Promise((resolve, reject) => {
    const pythonExecutable =
      process.platform === 'win32'
        ? path.join(backendRoot, 'python-ai', 'venv', 'Scripts', 'python.exe')
        : path.join(backendRoot, 'python-ai', 'venv', 'bin', 'python');
    const scriptPath = path.join(backendRoot, 'python-ai', 'process_post.py');
    const child = spawn(pythonExecutable, [scriptPath], {
      cwd: backendRoot,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...pythonThreadEnv },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    let errorOutput = '';
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finishWithError(new Error(`AI check timeout after ${AI_CHECK_TIMEOUT_MS / 1000} seconds`));
    }, AI_CHECK_TIMEOUT_MS);

    const finishWithError = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };

    child.stdout.on('data', (data) => {
      output += data.toString('utf8');
    });
    child.stderr.on('data', (data) => {
      errorOutput += data.toString('utf8');
      process.stderr.write(data);
    });
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') {
        finishWithError(new Error(`Failed to send input to Python AI check: ${error.message}`));
      }
    });
    child.on('error', (error) => {
      finishWithError(new Error(`Unable to start Python AI check: ${error.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      clearTimeout(timeout);
      if (code !== 0) {
        finishWithError(new Error(`Python AI check failed: ${errorOutput.trim() || `exit code ${code}`}`));
        return;
      }

      try {
        const result = JSON.parse(output);
        if (result.error) {
          finishWithError(new Error(`Python AI check failed: ${result.error}`));
          return;
        }
        if (
          !result ||
          typeof result !== 'object' ||
          Array.isArray(result) ||
          typeof result.ocr_text !== 'string' ||
          typeof result.ocr_reliable !== 'boolean' ||
          !Number.isFinite(result.ocr_confidence_avg) ||
          !Array.isArray(result.spelling_issues) ||
          !Array.isArray(result.ocr_issues) ||
          !Array.isArray(result.banned_words_found) ||
          !Array.isArray(result.missing_mandatory_phrases)
        ) {
          throw new Error('Unexpected response shape');
        }
        settled = true;
        resolve(result);
      } catch (error) {
        finishWithError(
          new Error(`Invalid JSON from Python AI check${errorOutput ? `: ${errorOutput.trim()}` : ''}`)
        );
      }
    });

    child.stdin.end(JSON.stringify(inputData));
  });

const resolveImagePath = (imagePath) => {
  if (!imagePath) return null;
  return path.resolve(path.isAbsolute(imagePath) ? imagePath : path.join(backendRoot, imagePath));
};

/**
 * Comprehensive AI Quality Check for a Post with Multi-Client Brand Guidelines
 * @param {Object} params
 * @param {number} [params.clientId]
 * @param {string} [params.title]
 * @param {string} [params.caption]
 * @param {string} [params.imagePath]
 */
const runAiCheck = async ({ clientId = null, title = '', caption = '', imagePath = null }) => {
  const guidelines = await getClientGuidelines(clientId);
  const resolvedImagePath = resolveImagePath(imagePath);
  const result = await runPythonAICheck({
    image_path: resolvedImagePath,
    caption: caption || '',
    title: title || '',
    whitelist_words: guidelines.whitelist,
    banned_words: guidelines.banned,
    mandatory_phrases: guidelines.mandatory,
  });

  const ocrExtractedText = result.ocr_text;
  const ocrConfidenceAverage = result.ocr_confidence_avg;
  const ocrUnreliable = Boolean(resolvedImagePath && !result.ocr_reliable);
  const spellingIssues = result.spelling_issues;
  const ocrIssues = result.ocr_issues;
  const bannedWordsFound = result.banned_words_found;
  const missingMandatoryPhrases = result.missing_mandatory_phrases;

  const hasSpellingIssues = spellingIssues.length > 0;
  const hasBannedWords = bannedWordsFound.length > 0;
  const hasMissingMandatory = missingMandatoryPhrases.length > 0;
  const passed = !hasSpellingIssues && !hasBannedWords && !hasMissingMandatory && !ocrUnreliable;

  let summary = 'Verified Clean';
  if (ocrUnreliable) {
    summary = `Image text could not be read clearly (OCR confidence ${Math.round(
      ocrConfidenceAverage * 100
    )}%). Please verify it manually.`;
  } else if (hasBannedWords) {
    summary = `Flagged: Banned brand terms found (${bannedWordsFound.join(', ')})`;
  } else if (hasMissingMandatory) {
    summary = `Warning: Missing mandatory phrase (${missingMandatoryPhrases.join(', ')})`;
  } else if (hasSpellingIssues) {
    summary = `Spelling: ${spellingIssues.length} issue(s) detected`;
  }

  return {
    passed,
    summary,
    engine: 'PaddleOCR (English/Hindi) + Hunspell (spylls)',
    spelling_issues: spellingIssues,
    ocr_extracted_text: ocrExtractedText,
    ocr_issues: ocrIssues,
    ocr_confidence: Math.round(ocrConfidenceAverage * 10000) / 100,
    ocr_confidence_avg: ocrConfidenceAverage,
    ocr_reliable: Boolean(result.ocr_reliable),
    ocr_unreliable: ocrUnreliable,
    banned_words_found: bannedWordsFound,
    missing_mandatory_phrases: missingMandatoryPhrases,
    brand_rules_applied: {
      client_id: clientId,
      whitelist_count: guidelines.whitelist.length,
      banned_words_checked: guidelines.banned.length,
      mandatory_phrases_checked: guidelines.mandatory.length,
    },
  };
};

module.exports = {
  getClientGuidelines,
  runPythonAICheck,
  runAiCheck,
};
