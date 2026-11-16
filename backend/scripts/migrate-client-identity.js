const pool = require('../config/db');

async function migrate() {
  const connection = await pool.getConnection();
  try {
    console.log('🚀 Running Client Identity Migration...');

    // 1. Check existing columns in `clients`
    const [clientCols] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients'
    `);
    const clientColNames = clientCols.map((c) => c.COLUMN_NAME);

    if (!clientColNames.includes('primary_phone')) {
      await connection.query('ALTER TABLE `clients` ADD COLUMN `primary_phone` VARCHAR(30) NULL AFTER `name`');
      console.log('✓ Added `primary_phone` to `clients` table.');
    } else {
      console.log('• `primary_phone` already exists in `clients`.');
    }

    if (!clientColNames.includes('alternate_phone')) {
      await connection.query('ALTER TABLE `clients` ADD COLUMN `alternate_phone` VARCHAR(30) NULL AFTER `primary_phone`');
      console.log('✓ Added `alternate_phone` to `clients` table.');
    } else {
      console.log('• `alternate_phone` already exists in `clients`.');
    }

    if (!clientColNames.includes('address')) {
      await connection.query('ALTER TABLE `clients` ADD COLUMN `address` TEXT NULL AFTER `alternate_phone`');
      console.log('✓ Added `address` to `clients` table.');
    } else {
      console.log('• `address` already exists in `clients`.');
    }

    // 2. Check existing columns in `ai_check_results`
    const [aiCols] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_check_results'
    `);
    const aiColNames = aiCols.map((c) => c.COLUMN_NAME);

    if (!aiColNames.includes('brand_identity_check')) {
      await connection.query('ALTER TABLE `ai_check_results` ADD COLUMN `brand_identity_check` JSON NULL AFTER `missing_mandatory_phrases`');
      console.log('✓ Added `brand_identity_check` to `ai_check_results` table.');
    } else {
      console.log('• `brand_identity_check` already exists in `ai_check_results`.');
    }

    console.log('🎉 Client Identity Migration Completed Successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    connection.release();
    process.exit(0);
  }
}

migrate();
