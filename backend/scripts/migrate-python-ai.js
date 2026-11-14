const pool = require('../config/db');

const columns = [
  ['ocr_issues', 'JSON NULL'],
  ['ocr_confidence', 'DECIMAL(5,2) NULL'],
  ['ocr_unreliable', 'BOOLEAN NOT NULL DEFAULT FALSE'],
  ['banned_words_found', 'JSON NULL'],
  ['missing_mandatory_phrases', 'JSON NULL'],
];

const migrate = async () => {
  const [existingColumns] = await pool.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_check_results'`
  );
  const existing = new Set(existingColumns.map((column) => column.COLUMN_NAME));

  for (const [name, definition] of columns) {
    if (existing.has(name)) continue;
    await pool.query(`ALTER TABLE ai_check_results ADD COLUMN \`${name}\` ${definition}`);
    console.log(`Added ai_check_results.${name}`);
  }
};

migrate()
  .catch((error) => {
    console.error('Python AI schema migration failed:', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
