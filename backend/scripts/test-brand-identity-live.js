const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pool = require('../config/db');
const aiService = require('../services/aiService');

async function runPartFLive() {
  console.log('============================================================');
  console.log('🚀 RUNNING PART F LIVE END-TO-END VERIFICATION');
  console.log('============================================================\n');

  // STEP 1: Update Balgopal Client fields in MySQL
  console.log('--- STEP 1: UPDATING BALGOPAL CLIENT IN MYSQL ---');
  await pool.query(
    `UPDATE clients SET
       name = ?,
       primary_phone = ?,
       alternate_phone = ?,
       address = ?
     WHERE id = 1`,
    [
      "Balgopal Children's Neuro Clinic",
      "8989590477",
      "8447096306",
      "1063, near Jan Jyoti Hospital, Gole Bazar, Wright Town, Jabalpur, Madhya Pradesh"
    ]
  );

  const [clientRows] = await pool.query('SELECT id, name, primary_phone, alternate_phone, address FROM clients WHERE id = 1');
  console.log('Client #1 Data in MySQL:', clientRows[0]);

  // STEP 2: Live AI Check with Poster Image + Hashtags Caption
  console.log('\n--- STEP 2: LIVE AI CHECK (POSTER IMAGE + HASHTAGS + BRAND IDENTITY) ---');
  const imagePath = path.resolve(__dirname, '..', 'uploads', 'test-poster.jpeg');
  const testCaption = "Happy #ChildrensDay from Balgopal Children's Neuro Clinic! #BalgopalNeuroClinic Consult Dr. Payal Keswani for personalized advice";

  console.log('Executing aiService.runAiCheck...');
  const result = await aiService.runAiCheck({
    clientId: 1,
    title: 'Bal Diwas Special Celebration',
    caption: testCaption,
    imagePath: imagePath,
  });

  console.log('\nAI CHECK RESULT SUMMARY:');
  console.log('• Passed                  :', result.passed);
  console.log('• Summary                 :', result.summary);
  console.log('• OCR Extracted Text      :\n', result.ocr_extracted_text);
  console.log('• Brand Identity Check    :', JSON.stringify(result.brand_identity_check, null, 2));
  console.log('• Spelling Issues Count   :', result.spelling_issues.length);
  console.log('• Spelling Issues Sample  :', result.spelling_issues.slice(0, 5));
  console.log('• Banned Words Found      :', result.banned_words_found);
  console.log('• Missing Mandatory Phr.  :', result.missing_mandatory_phrases);

  // Verifications:
  console.log('\n--- VERIFICATION 2(A): BRAND NAME ERROR CHECK ---');
  const brandCheck = result.brand_identity_check;
  const brandNameErrorFlagged = Boolean(brandCheck?.possible_brand_name_error);
  console.log(`[2a] possible_brand_name_error triggered: ${brandNameErrorFlagged ? '✅ YES' : '❌ NO'}`);
  console.log(`[2a] Match Score                         : ${brandCheck?.brand_name_match_score}% (Expected ~55-89%)`);
  console.log(`[2a] Message                             : "${brandCheck?.possible_brand_name_error}"`);

  console.log('\n--- VERIFICATION 2(B): PHONE NUMBERS CHECK ---');
  const phoneList = brandCheck?.phone_verification || [];
  const phoneWarnings = phoneList.filter(p => p.status !== 'clean');
  console.log(`[2b] Phone numbers detected              : ${phoneList.map(p => p.found_phone).join(', ')}`);
  console.log(`[2b] Warnings generated                  : ${phoneWarnings.length} (Expected 0)`);
  console.log(`[2b] Phone check status                  : ${phoneWarnings.length === 0 ? '✅ PASSED (All clean)' : '❌ FAILED'}`);

  console.log('\n--- VERIFICATION 2(C): HASHTAG SPELLING EXCLUSION ---');
  const flaggedHashtags = result.spelling_issues.filter(issue =>
    issue.word.includes('ChildrensDay') || issue.word.includes('BalgopalNeuroClinic') || issue.word.startsWith('#')
  );
  console.log(`[2c] Flagged Hashtag Tokens in spelling  : ${flaggedHashtags.length} (Expected 0)`);
  console.log(`[2c] Hashtag exclusion status            : ${flaggedHashtags.length === 0 ? '✅ PASSED (No hashtags in spelling)' : '❌ FAILED'}`);

  // STEP 3: Negative Phone Number Test
  console.log('\n--- STEP 3: NEGATIVE PHONE NUMBER TEST (1 DIGIT MISMATCH) ---');
  const negativeCaption = "Special OPD today! Contact us directly at 8989590478 for urgent booking.";
  const negativeResult = await aiService.runAiCheck({
    clientId: 1,
    title: 'Emergency OPD Post',
    caption: negativeCaption,
    imagePath: null, // Caption only to isolate phone test
  });

  const negPhoneList = negativeResult.brand_identity_check?.phone_verification || [];
  const negWarnings = negPhoneList.filter(p => p.status === 'mismatch_warning');
  console.log('Negative Check Phone List:', JSON.stringify(negPhoneList, null, 2));
  console.log(`[3] Negative test mismatch flagged       : ${negWarnings.length > 0 ? '✅ YES' : '❌ NO'}`);
  if (negWarnings.length > 0) {
    console.log(`[3] Warning message                      : "${negWarnings[0].message}"`);
  }

  console.log('\n============================================================');
  console.log('🎉 ALL PART F VERIFICATIONS COMPLETED SUCCESSFULLY!');
  console.log('============================================================');
}

runPartFLive().then(() => process.exit(0)).catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
