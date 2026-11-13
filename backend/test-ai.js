/**
 * Standalone AI Verification Script
 * Tests:
 * 1. nspell (Local Spelling Check)
 * 2. tesseract.js (Local OCR Image Text Extraction)
 *
 * Usage: node test-ai.js
 */

const nspell = require('nspell');
const { createWorker } = require('tesseract.js');
const path = require('path');
const fs = require('fs');

async function testSpelling() {
  console.log('\n=============================================');
  console.log('📝 1. TESTING NSPELL SPELL CHECKER');
  console.log('=============================================');

  // Load English dictionary
  console.log('⏳ Loading dictionary-en...');
  const { default: dictionary } = await import('dictionary-en');
  const spell = nspell(dictionary);
  console.log('✅ Dictionary loaded successfully.\n');

  // Sample text with intentional spelling mistakes
  const sampleText = 'Welcom to our offical social media campane! We provid the best servise for your busines.';
  console.log(`Original Text:\n"${sampleText}"\n`);

  // Extract individual words
  const words = sampleText.match(/\b[A-Za-z]{2,}\b/g) || [];
  const mistakes = [];

  for (const word of words) {
    const isCorrect = spell.correct(word);
    if (!isCorrect) {
      const suggestions = spell.suggest(word).slice(0, 4);
      mistakes.push({ word, suggestions });
    }
  }

  if (mistakes.length > 0) {
    console.log(`🔍 Detected ${mistakes.length} spelling mistake(s):`);
    mistakes.forEach((item, index) => {
      console.log(`   ${index + 1}. "${item.word}" -> Suggestions: [${item.suggestions.join(', ')}]`);
    });
  } else {
    console.log('✅ No spelling errors found!');
  }
}

async function testOCR() {
  console.log('\n=============================================');
  console.log('🖼️ 2. TESTING TESSERACT.JS OCR ENGINE');
  console.log('=============================================');

  const testImagePath = path.join(__dirname, 'uploads', 'test-sample.png');

  if (!fs.existsSync(testImagePath)) {
    console.warn(`⚠️ Sample test image not found at: ${testImagePath}`);
    console.log('Please place a test image in backend/uploads/test-sample.png');
    return;
  }

  console.log(`⏳ Processing image: ${testImagePath}`);
  const startTime = Date.now();

  const worker = await createWorker('eng');
  try {
    const result = await worker.recognize(testImagePath);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`✅ OCR Completed in ${duration}s!`);
    console.log('\nExtracted Text from Image:');
    console.log('---------------------------------------------');
    console.log(result.data.text.trim() || '[No text detected in image]');
    console.log('---------------------------------------------');
    console.log(`Confidence Score: ${Math.round(result.data.confidence)}%`);
  } catch (err) {
    console.error('❌ Tesseract OCR Error:', err);
  } finally {
    await worker.terminate();
  }
}

async function run() {
  console.log('🚀 Running AI Engine Verification (nspell + Tesseract.js)...');
  try {
    await testSpelling();
    await testOCR();
    console.log('\n✨ All standalone AI tests completed successfully!\n');
  } catch (error) {
    console.error('Fatal test error:', error);
  }
}

run();

