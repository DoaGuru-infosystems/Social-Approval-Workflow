const path = require('path');
const { runAiCheck } = require('./services/aiService');

async function run() {
  const cases = [
    {
      name: 'Simple Hindi image',
      imagePath: path.join('test-assets', 'hindi-simple.png'),
      title: 'Hindi OCR test',
      caption: 'नमस्ते दोस्तों',
    },
    {
      name: 'Complex poster',
      imagePath: path.join('uploads', 'post-1794641616395-780099445.jpeg'),
      title: 'Poster OCR test',
      caption: '',
    },
  ];

  for (const testCase of cases) {
    const start = Date.now();
    const result = await runAiCheck(testCase);
    console.log(
      JSON.stringify(
        {
          test: testCase.name,
          duration_seconds: Number(((Date.now() - start) / 1000).toFixed(2)),
          ocr_text: result.ocr_extracted_text,
          ocr_confidence_avg: result.ocr_confidence_avg,
          ocr_reliable: !result.ocr_unreliable,
          spelling_issues: result.spelling_issues,
          banned_words_found: result.banned_words_found,
          missing_mandatory_phrases: result.missing_mandatory_phrases,
          summary: result.summary,
        },
        null,
        2
      )
    );
  }
}

run().catch((error) => {
  console.error('Python AI integration test failed:', error);
  process.exitCode = 1;
});

