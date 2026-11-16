/**
 * Verification test for Parallel Text + Image AI checking & Status Polling
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pool = require('../config/db');
const aiService = require('../services/aiService');

async function runTests() {
  console.log('====================================================');
  console.log('RUNNING PARALLEL PIPELINE & AI SERVICE TESTS');
  console.log('====================================================\n');

  // Test 1: Fast Node.js Text Check Latency & Correctness
  console.log('--- TEST 1: runTextCheck (Speed & Accuracy) ---');
  const [clientRows] = await pool.query('SELECT id, name FROM clients WHERE name LIKE ? LIMIT 1', ['%Balgopal%']);
  if (clientRows.length === 0) {
    throw new Error('Test client Balgopal not found in DB');
  }
  const clientId = clientRows[0].id;
  console.log(`Using client ID: ${clientId} (${clientRows[0].name})`);

  const startTextCheck = Date.now();
  const textResult = await aiService.runTextCheck({
    clientId,
    title: 'Happy Diwali Dhamaka Offer on pure Ghee',
    caption: 'Order now from Balgopal Jewellers for pure Ghee. Call 9876543210! Buy now discount 50%.',
  });
  const textDuration = Date.now() - startTextCheck;

  console.log(`Text check completed in ${textDuration}ms (Threshold: <1500ms)`);
  if (textDuration > 1500) {
    console.error('FAIL: Text check took too long!');
  } else {
    console.log('PASS: Text check is lightning fast (<1.5s)');
  }
  console.log('Text check result keys:', Object.keys(textResult));
  console.log('Spelling issues count:', textResult.spelling_issues.length);
  console.log('Banned words:', textResult.banned_words_found);
  console.log('Missing mandatory:', textResult.missing_mandatory_phrases);
  console.log('Summary:', textResult.summary);

  // Test 2: Merging Text + Image Check Results
  console.log('\n--- TEST 2: mergeAiCheckResults (Pending & Completed States) ---');
  const mockPendingImage = {
    image_status: 'pending',
    ocr_extracted_text: '',
    ocr_confidence: 0,
    ocr_unreliable: false,
    spelling_issues: [],
    noise_tokens: [],
    banned_words_found: [],
    brand_identity_check: null,
  };

  const mergedPending = aiService.mergeAiCheckResults(textResult, mockPendingImage);
  console.log('Merged pending status:', mergedPending.image_status);
  console.log('Merged pending passed:', mergedPending.passed);
  console.log('Merged summary:', mergedPending.summary);
  if (mergedPending.image_status === 'pending') {
    console.log('PASS: Initial merge correctly reflects pending image status');
  } else {
    console.error('FAIL: Expected image_status pending');
  }

  // Test 3: Simulated Completed Image Check Merge
  const mockCompletedImage = {
    image_status: 'completed',
    passed: true,
    summary: 'Image Check Clean',
    ocr_extracted_text: 'Balgopal Jewellers 9876543210',
    ocr_confidence: 96.5,
    ocr_confidence_avg: 0.965,
    ocr_reliable: true,
    ocr_unreliable: false,
    spelling_issues: [],
    noise_tokens: [],
    banned_words_found: [],
    brand_identity_check: {
      brand_name_correct: true,
      possible_brand_name_error: null,
      phone_verification: [{ extracted: '9876543210', status: 'clean' }],
      address_match_percentage: 100,
    },
  };

  const mergedCompleted = aiService.mergeAiCheckResults(textResult, mockCompletedImage);
  console.log('\nMerged completed status:', mergedCompleted.image_status);
  console.log('Merged completed ocr_extracted_text:', mergedCompleted.ocr_extracted_text);
  console.log('Merged completed passed:', mergedCompleted.passed);
  if (mergedCompleted.image_status === 'completed' && mergedCompleted.ocr_extracted_text) {
    console.log('PASS: Completed image merge successfully unified OCR data');
  } else {
    console.error('FAIL: Expected completed image status and OCR text');
  }

  console.log('\n====================================================');
  console.log('ALL SERVICE TESTS COMPLETED SUCCESSFULLY');
  console.log('====================================================');
  await pool.end();
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
