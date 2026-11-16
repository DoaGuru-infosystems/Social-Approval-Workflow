const pool = require('../config/db');

async function migrate() {
  const connection = await pool.getConnection();
  try {
    console.log('🚀 Running AI Status Columns Migration...');

    const [cols] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_check_results'
    `);
    const colNames = cols.map((c) => c.COLUMN_NAME);

    if (!colNames.includes('image_status')) {
      await connection.query("ALTER TABLE `ai_check_results` ADD COLUMN `image_status` VARCHAR(20) NOT NULL DEFAULT 'completed' AFTER `ocr_unreliable`");
      console.log('✓ Added `image_status` to `ai_check_results`.');
    } else {
      console.log('• `image_status` already exists in `ai_check_results`.');
    }

    if (!colNames.includes('text_status')) {
      await connection.query("ALTER TABLE `ai_check_results` ADD COLUMN `text_status` VARCHAR(20) NOT NULL DEFAULT 'completed' AFTER `image_status`");
      console.log('✓ Added `text_status` to `ai_check_results`.');
    } else {
      console.log('• `text_status` already exists in `ai_check_results`.');
    }

    if (!colNames.includes('image_error')) {
      await connection.query("ALTER TABLE `ai_check_results` ADD COLUMN `image_error` TEXT NULL AFTER `text_status`");
      console.log('✓ Added `image_error` to `ai_check_results`.');
    } else {
      console.log('• `image_error` already exists in `ai_check_results`.');
    }

    console.log('🎉 AI Status Columns Migration Succeeded!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    connection.release();
    process.exit(0);
  }
}

migrate();
