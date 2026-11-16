const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const aiService = require('../services/aiService');
const spellCheckService = require('../services/spellCheckService');
const garbageFilterService = require('../services/garbageFilterService');
const brandRulesService = require('../services/brandRulesService');
const textCorrectionService = require('../services/textCorrectionService');

async function runAllTests() {
  console.log('============================================================');
  console.log('🚀 COMPREHENSIVE NODE.JS AI COMPLIANCE PIPELINE VERIFICATION');
  console.log('============================================================\n');

  let allPassed = true;

  // -------------------------------------------------------------------------
  // TEST E: Performance & Single-Initialization Check
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------');
  console.log('TEST (E) PERFORMANCE & IN-MEMORY CACHING VERIFICATION');
  console.log('------------------------------------------------------------');
  const t0 = Date.now();
  const initResult1 = await spellCheckService.initDictionaries();
  const firstLoadTime = Date.now() - t0;
  console.log(`• First Call (Cold Load) : ${firstLoadTime} ms (Reported: ${initResult1.durationMs} ms)`);

  const t1 = Date.now();
  const initResult2 = await spellCheckService.initDictionaries();
  const secondLoadTime = Date.now() - t1;
  console.log(`• Second Call (Cached)   : ${secondLoadTime} ms (Reported: ${initResult2.durationMs} ms)`);

  const t2 = Date.now();
  const initResult3 = await spellCheckService.initDictionaries();
  const thirdLoadTime = Date.now() - t2;
  console.log(`• Third Call (Cached)    : ${thirdLoadTime} ms (Reported: ${initResult3.durationMs} ms)`);

  const isCachingWorking = secondLoadTime < 5 && thirdLoadTime < 5;
  console.log(`• In-Memory Cache Status : ${isCachingWorking ? '✅ VERIFIED (Zero Reloading)' : '⚠️ SLOW'}`);
  if (!isCachingWorking) allPassed = false;
  console.log();

  // -------------------------------------------------------------------------
  // TEST A: Standalone Test (Zenith Organics - Whitelist, Banned, Mandatory)
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------');
  console.log('TEST (A) STANDALONE BRAND RULES (ZENITH ORGANICS - NO IMAGE)');
  console.log('------------------------------------------------------------');
  // Client 2 (Zenith Organics):
  // Whitelist: Zenith, Organics, FitLife, शुद्ध
  // Banned: chemical, fake, guaranteed
  // Mandatory: #ZenithPure, 100% Organic
  const zenithCaption = "Zenith ka ye product guaranteed pure hai, chemical nahi hai";
  console.log(`• Caption : "${zenithCaption}"`);

  const startA = Date.now();
  const resultA = await aiService.runAiCheck({
    clientId: 2,
    title: 'Zenith Organic Health Care',
    caption: zenithCaption,
    imagePath: null,
  });
  const durationA = Date.now() - startA;

  console.log(`• Response Time : ${durationA} ms`);
  console.log(`• Engine        : ${resultA.engine}`);
  console.log(`• Banned Words  : ${JSON.stringify(resultA.banned_words_found)}`);
  console.log(`• Missing Phr.  : ${JSON.stringify(resultA.missing_mandatory_phrases)}`);
  console.log(`• Spelling Err. : ${JSON.stringify(resultA.spelling_issues.map((i) => i.word))}`);

  // Confirmations for Test A:
  const zenithWhitelisted = !resultA.spelling_issues.some((i) => i.word.toLowerCase() === 'zenith');
  const bannedCaught =
    resultA.banned_words_found.includes('guaranteed') &&
    resultA.banned_words_found.includes('chemical');
  const mandatoryMissing =
    resultA.missing_mandatory_phrases.includes('#ZenithPure') &&
    resultA.missing_mandatory_phrases.includes('100% Organic');

  console.log(`  [a1] 'Zenith' not flagged as spelling error : ${zenithWhitelisted ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`  [a2] 'guaranteed' & 'chemical' flagged      : ${bannedCaught ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`  [a3] Missing mandatory phrases warning      : ${mandatoryMissing ? '✅ PASSED' : '❌ FAILED'}`);

  if (!zenithWhitelisted || !bannedCaught || !mandatoryMissing) allPassed = false;
  console.log();

  // -------------------------------------------------------------------------
  // TEST B: Hindi + English Mixed Caption Test
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------');
  console.log('TEST (B) HINDI + ENGLISH MIXED SCRIPT CAPTION VERIFICATION');
  console.log('------------------------------------------------------------');
  const mixedCaption = "आज बाल दिवस पर हम Happy Children Day मना रहे हैं wrngspelling";
  console.log(`• Caption : "${mixedCaption}"`);

  const startB = Date.now();
  const mixedIssues = await spellCheckService.checkText(mixedCaption, new Set());
  const durationB = Date.now() - startB;

  console.log(`• Spellcheck Duration : ${durationB} ms`);
  console.log(`• Issues Detected     :`, mixedIssues);

  const hindiValid = !mixedIssues.some((i) => ['आज', 'बाल', 'दिवस', 'पर', 'हम', 'मना', 'रहे', 'हैं'].includes(i.word));
  const englishValid = !mixedIssues.some((i) => ['Happy', 'Children', 'Day'].includes(i.word));
  const caughtTypo = mixedIssues.some((i) => i.word === 'wrngspelling');

  console.log(`  [b1] Valid Hindi words recognized without errors   : ${hindiValid ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`  [b2] Valid English words recognized without errors : ${englishValid ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`  [b3] Intentional typo 'wrngspelling' flagged       : ${caughtTypo ? '✅ PASSED' : '❌ FAILED'}`);

  if (!hindiValid || !englishValid || !caughtTypo) allPassed = false;
  console.log();

  // -------------------------------------------------------------------------
  // TEST C: Fuzzy-Matching Whitelist Test (Keswani vs Kesvani)
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------');
  console.log('TEST (C) FUZZY-MATCHING BRAND WHITELIST VERIFICATION');
  console.log('------------------------------------------------------------');
  // Client 1 (Balgopal Childrens Neuroclinic) has "Keswani" in whitelist.
  // Caption has typo: "Kesvani"
  const fuzzyCaption = "Consult Dr. Payal Kesvani for expert neurology advice";
  console.log(`• Whitelist Entry : "Keswani"`);
  console.log(`• Candidate Word  : "Kesvani" (Spelling variation in caption)`);

  const startC = Date.now();
  const resultC = await aiService.runAiCheck({
    clientId: 1,
    title: 'Consultation Notice',
    caption: fuzzyCaption,
    imagePath: null,
  });
  const durationC = Date.now() - startC;

  console.log(`• Processing Time : ${durationC} ms`);
  console.log(`• Spelling Issues :`, resultC.spelling_issues.map((i) => i.word));

  const kesvaniForgiven = !resultC.spelling_issues.some((i) => i.word.toLowerCase() === 'kesvani');
  console.log(`  [c1] 'Kesvani' matched to 'Keswani' (>=80% fuzzy) and forgiven : ${kesvaniForgiven ? '✅ PASSED' : '❌ FAILED'}`);

  if (!kesvaniForgiven) allPassed = false;
  console.log();

  // -------------------------------------------------------------------------
  // TEST D: Garbage Filtering Verification
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------');
  console.log('TEST (D) OCR NOISE & GARBAGE-TOKEN FILTERING VERIFICATION');
  console.log('------------------------------------------------------------');
  const dummyOcrLines = [
    'बाल दिवस',
    'Joh!',
    'Pediatric Neurologist',
    'Iobh',
    'कI',
    'OPD 8989590477',
    '-hbb',
    'जबलपुर',
  ];
  console.log(`• Input OCR Tokens/Lines:`, dummyOcrLines);

  const filterResult = garbageFilterService.filterTokens(dummyOcrLines, ['Balgopal', 'Keswani']);
  console.log(`• Clean Tokens :`, filterResult.cleanTokens);
  console.log(`• Noise Tokens :`, filterResult.noiseTokens);

  const cleanContainsValid =
    filterResult.cleanTokens.includes('बाल दिवस') &&
    filterResult.cleanTokens.includes('Pediatric Neurologist') &&
    filterResult.cleanTokens.includes('OPD 8989590477') &&
    filterResult.cleanTokens.includes('जबलपुर');

  const noiseContainsGarbage =
    filterResult.noiseTokens.some((n) => n.token === 'Joh!') &&
    filterResult.noiseTokens.some((n) => n.token === 'Iobh') &&
    filterResult.noiseTokens.some((n) => n.token === 'कI') &&
    filterResult.noiseTokens.some((n) => n.token === '-hbb');

  console.log(`  [d1] Genuine text retained in clean tokens       : ${cleanContainsValid ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`  [d2] Garbage tokens ('Joh!', 'Iobh', 'कI', '-hbb') isolated into noise: ${noiseContainsGarbage ? '✅ PASSED' : '❌ FAILED'}`);

  if (!cleanContainsValid || !noiseContainsGarbage) allPassed = false;
  console.log();

  // -------------------------------------------------------------------------
  // OVERALL RESULT
  // -------------------------------------------------------------------------
  console.log('============================================================');
  if (allPassed) {
    console.log('🎉 ALL 5 TEST SUITES PASSED 100% SUCCESSFULLY IN NODE.JS!');
  } else {
    console.log('⚠️ SOME TESTS FAILED. PLEASE REVIEW LOGS ABOVE.');
  }
  console.log('============================================================');
}

runAllTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error running tests:', err);
    process.exit(1);
  });
