#!/usr/bin/env node

/**
 * Standalone Remote OCR API Test Script
 * Tests the Python EasyOCR & Compliance Service on A2 Hosting.
 * 
 * Target: https://siarasystems.com/ocr-test
 * Endpoint: POST /check-post
 * Header: X-API-Key: <A2_OCR_API_KEY>
 * Timeout: 150000 ms (150 s)
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// 1. Load environment variables from backend/.env or root .env
const backendEnvPath = path.resolve(__dirname, '.env');
const rootEnvPath = path.resolve(__dirname, '..', '.env');

if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath });
} else if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

// 2. Parse command-line arguments
const args = process.argv.slice(2);

function printUsage() {
  console.log(`
======================================================================
  A2 Hosting Remote OCR API - Standalone Test Utility
======================================================================

Usage:
  node backend/test-remote-ocr.js <path-to-image>
  node backend/test-remote-ocr.js --health-only

Examples:
  node backend/test-remote-ocr.js backend/test-assets/hindi-simple.png
  node backend/test-remote-ocr.js backend/uploads/post-1794641616395-780099445.jpeg

Configuration:
  A2_OCR_API_KEY : Read from backend/.env or environment variable
  A2_OCR_API_URL : Defaults to https://siarasystems.com/ocr-test
  TIMEOUT        : 150000 ms (150 seconds)
======================================================================
`);
}

// 3. Resolve target URL & Timeout
const RAW_URL = process.env.A2_OCR_API_URL || 'https://siarasystems.com/ocr-test';
const BASE_URL = RAW_URL.replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 150000;

async function checkHealth() {
  const healthUrl = `${BASE_URL}/health`;
  console.log(`\n🔍 Checking Remote Service Health at: ${healthUrl}...`);

  const startTime = performance.now();
  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const durationMs = Math.round(performance.now() - startTime);
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const data = await response.json();
      console.log(`✅ Health check responded in ${durationMs} ms (HTTP ${response.status} ${response.statusText}):`);
      console.log(JSON.stringify(data, null, 2));
      return { ok: response.ok, status: response.status, data };
    } else {
      const text = await response.text();
      console.log(`⚠️ Health check returned non-JSON response in ${durationMs} ms (HTTP ${response.status}):`);
      console.log(text.slice(0, 300));
      return { ok: response.ok, status: response.status, text };
    }
  } catch (error) {
    const durationMs = Math.round(performance.now() - startTime);
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      console.error(`❌ Health check timed out after ${durationMs} ms.`);
    } else {
      console.error(`❌ Health check connection failed (${durationMs} ms): ${error.message}`);
    }
    return { ok: false, error: error.message };
  }
}

async function runRemoteCheck(imagePath) {
  // 4. Validate API Key
  const apiKey = (process.env.A2_OCR_API_KEY || '').trim();
  if (!apiKey) {
    console.error('\n❌ ERROR: A2_OCR_API_KEY is not defined in backend/.env or environment.');
    console.error('Please configure A2_OCR_API_KEY in backend/.env:');
    console.error('  A2_OCR_API_KEY=your_a2_secret_key_here\n');
    console.error('Or pass it inline:');
    console.error('  $env:A2_OCR_API_KEY="your_key"; node backend/test-remote-ocr.js <path>\n');
    process.exit(1);
  }

  // 5. Validate Image File
  const resolvedPath = path.resolve(process.cwd(), imagePath);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    console.error(`\n❌ ERROR: Image file does not exist at path:\n  ${resolvedPath}\n`);
    process.exit(1);
  }

  const fileStats = fs.statSync(resolvedPath);
  const fileSizeMb = (fileStats.size / (1024 * 1024)).toFixed(2);
  const filename = path.basename(resolvedPath);

  if (fileStats.size > 10 * 1024 * 1024) {
    console.error(`\n❌ ERROR: Image file size (${fileSizeMb} MB) exceeds maximum allowed limit of 10 MB.`);
    process.exit(1);
  }

  console.log(`\n======================================================================`);
  console.log(`🚀 Initiating Remote OCR Processing Request`);
  console.log(`======================================================================`);
  console.log(`  Endpoint     : ${BASE_URL}/check-post`);
  console.log(`  Target Image : ${filename} (${fileSizeMb} MB)`);
  console.log(`  Local Path   : ${resolvedPath}`);
  console.log(`  API Key      : [CONFIGURED - Length: ${apiKey.length}] (Never exposed)`);
  console.log(`  Timeout      : ${REQUEST_TIMEOUT_MS / 1000} seconds`);
  console.log(`======================================================================`);

  // 6. Read and Base64 encode image binary
  console.log(`\n📦 Reading and encoding image to Base64...`);
  const imageBuffer = fs.readFileSync(resolvedPath);
  const imageBase64 = imageBuffer.toString('base64');

  // 7. Construct Request Payload
  const payload = {
    title: process.env.OCR_TEST_TITLE || 'Remote OCR Integration Test',
    caption:
      process.env.OCR_TEST_CAPTION ||
      'Bilingual quality check for wellness campaign. Consult physician before starting #ApexHealth',
    image_base64: imageBase64,
    image_filename: filename,
    whitelist_words: ['Apex', 'ApexHealth', 'FitFam', 'नमस्ते', 'स्वास्थ्य'],
    banned_words: ['guaranteed', 'scam', 'fraud', 'cure-all', 'जाली'],
    mandatory_phrases: ['#ApexHealth'],
  };

  const startTime = performance.now();

  try {
    const endpointsToTry = [
      `${BASE_URL}/`,
      `${BASE_URL}/check-post`,
    ];

    let response = null;
    let activeEndpoint = endpointsToTry[0];
    let rawText = '';
    let durationMs = 0;
    let data = null;

    for (const endpoint of endpointsToTry) {
      activeEndpoint = endpoint;
      console.log(`📡 Sending HTTPS POST request to: ${endpoint}`);
      console.log(`⏳ Awaiting EasyOCR inference and dictionary validation (up to 150s)...`);

      const reqStartTime = performance.now();
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        durationMs = Math.round(performance.now() - reqStartTime);
        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
          const parsed = await response.json();
          // Check if server returned health check instead of OCR check
          if (parsed && parsed.service && parsed.status === 'ok' && !('ocr_reliable' in parsed)) {
            console.warn(`⚠️ Endpoint ${endpoint} returned Health Check instead of OCR check (status 200). Trying next endpoint...`);
            continue;
          }
          data = parsed;
          break; // Successfully got real OCR check JSON response
        }

        rawText = await response.text();
        console.warn(`⚠️ Endpoint ${endpoint} returned non-JSON (HTTP ${response.status}). Trying alternative...`);
      } catch (err) {
        console.warn(`⚠️ Request to ${endpoint} failed (${err.message}). Trying alternative...`);
      }
    }

    const durationSec = (durationMs / 1000).toFixed(2);
    const contentType = response?.headers.get('content-type') || '';

    console.log(`\n----------------------------------------------------------------------`);
    console.log(`📥 Server Response Received in ${durationMs} ms (${durationSec} s)`);
    console.log(`   HTTP Status: ${response?.status} ${response?.statusText}`);
    console.log(`   Active URL : ${activeEndpoint}`);
    console.log(`----------------------------------------------------------------------`);

    if (!data) {
      if (!rawText && response) rawText = await response.text();
      console.error(`\n❌ Failed to get OCR check response from server (HTTP ${response?.status}):`);
      console.error(rawText.slice(0, 500));
      console.error(`\n💡 Tip: Make sure app.py on A2 server has been edited to route POST on / to handle_check_post and Passenger restarted.`);
      process.exit(1);
    }

    if (!response.ok) {
      console.error(`\n❌ Remote API returned an error response (HTTP ${response.status}):`);
      console.error(JSON.stringify(data, null, 2));
      process.exit(1);
    }

    // 8. Display Formatted Results
    console.log(`\n📊 COMPREHENSIVE OCR & COMPLIANCE REPORT`);
    console.log(`======================================================================`);

    // OCR Metrics
    const ocrReliable = Boolean(data.ocr_reliable);
    const confidencePct =
      typeof data.ocr_confidence_avg === 'number'
        ? (data.ocr_confidence_avg * 100).toFixed(2)
        : 'N/A';

    console.log(`🔍 OCR Extracted Text:`);
    if (data.ocr_text && data.ocr_text.trim()) {
      const lines = data.ocr_text.trim().split('\n');
      lines.forEach((line) => console.log(`   │ ${line}`));
    } else {
      console.log(`   │ (No text detected in image)`);
    }

    console.log(`\n📈 OCR Performance & Reliability:`);
    console.log(`   • Average Confidence : ${confidencePct}%`);
    console.log(`   • Reliability Status : ${ocrReliable ? '✅ RELIABLE (>= 50%)' : '⚠️ UNRELIABLE (< 50% - manual review flagged)'}`);
    console.log(`   • Total Duration     : ${durationMs} ms (${durationSec} s)`);

    // Server-Side Timing Breakdown (if returned by remote server)
    if (data.timings && typeof data.timings === 'object') {
      const t = data.timings;
      console.log(`\n⏱️ Server-Side Timing Breakdown:`);
      console.log(`   • Total Server Processing    : ${t.total_ms} ms (${(t.total_ms / 1000).toFixed(2)} s)`);
      console.log(`   • Base64 Decoding            : ${t.base64_decode_ms} ms`);
      console.log(`   • Temporary File Creation    : ${t.temp_file_create_ms} ms`);
      console.log(`   • EasyOCR Reader Init        : ${t.reader_init_ms} ms (Cached: ${t.reader_cached ? 'YES' : 'NO - Cold Load'})`);
      console.log(`   • OCR Inference (readtext)   : ${t.ocr_inference_ms} ms (${(t.ocr_inference_ms / 1000).toFixed(2)} s)`);
      console.log(`   • Dictionary Init            : ${t.dictionaries_init_ms} ms (Cached: ${t.dictionaries_cached ? 'YES' : 'NO - Cold Load'})`);
      console.log(`   • Spelling Validation        : ${t.spelling_validation_ms} ms`);
      console.log(`   • Passenger Worker PID       : ${t.worker_pid} (Worker Request #${t.worker_requests_served})`);
    }

    // Spelling Issues
    const spellingIssues = Array.isArray(data.spelling_issues) ? data.spelling_issues : [];
    console.log(`\n📝 Spelling Verification (${spellingIssues.length} issue(s) detected):`);
    if (spellingIssues.length > 0) {
      spellingIssues.forEach((issue, idx) => {
        const suggestions = Array.isArray(issue.suggestions) ? issue.suggestions.join(', ') : 'none';
        console.log(`   ${idx + 1}. [${issue.script || 'text'}] "${issue.word}" → Suggestions: [${suggestions}]`);
      });
    } else {
      console.log(`   ✅ All detected words verified against English/Hindi Hunspell dictionaries.`);
    }

    // OCR Specific Issues
    const ocrIssues = Array.isArray(data.ocr_issues) ? data.ocr_issues : [];
    if (ocrIssues.length > 0) {
      console.log(`\n🖼️ Spelling Issues in Image Text: ${ocrIssues.length}`);
      ocrIssues.forEach((iss, idx) => {
        console.log(`   ${idx + 1}. "${iss.word}" (${iss.script})`);
      });
    }

    // Brand Guidelines Compliance
    const bannedFound = Array.isArray(data.banned_words_found) ? data.banned_words_found : [];
    const missingMandatory = Array.isArray(data.missing_mandatory_phrases) ? data.missing_mandatory_phrases : [];

    console.log(`\n🛡️ Brand Guidelines & Governance:`);
    if (bannedFound.length > 0) {
      console.log(`   ❌ Banned Words Detected : [${bannedFound.join(', ')}]`);
    } else {
      console.log(`   ✅ Banned Words          : Clean (0 banned terms found)`);
    }

    if (missingMandatory.length > 0) {
      console.log(`   ⚠️ Missing Mandatory     : [${missingMandatory.join(', ')}]`);
    } else {
      console.log(`   ✅ Mandatory Phrases     : Verified (all required phrases present)`);
    }

    // Summary verdict
    const isClean =
      spellingIssues.length === 0 &&
      bannedFound.length === 0 &&
      missingMandatory.length === 0 &&
      ocrReliable;

    console.log(`======================================================================`);
    console.log(`🏁 FINAL VERDICT: ${isClean ? '✅ PASS - Clean & Compliant' : '⚠️ ACTION REQUIRED - Issues Detected'}`);
    console.log(`======================================================================\n`);

  } catch (error) {
    const durationMs = Math.round(performance.now() - startTime);
    console.log(`\n----------------------------------------------------------------------`);
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      console.error(`❌ REQUEST TIMEOUT: Request exceeded timeout limit of ${REQUEST_TIMEOUT_MS / 1000} seconds (${durationMs} ms).`);
      console.error(`   Tip: Ensure EasyOCR models have been pre-warmed on A2 Hosting using prepare_models.py.`);
    } else {
      console.error(`❌ NETWORK / REQUEST ERROR (${durationMs} ms): ${error.message}`);
      console.error(`   Tip: Verify your internet connection and that A2 Hosting service is running.`);
    }
    console.log(`----------------------------------------------------------------------\n`);
    process.exit(1);
  }
}

async function main() {
  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  if (args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  if (args[0] === '--health-only') {
    const result = await checkHealth();
    process.exit(result.ok ? 0 : 1);
  }

  const imagePath = args[0];
  await runRemoteCheck(imagePath);
}

main();
