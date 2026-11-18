const pool = require('../config/db');

async function migrateGmbColumns() {
  const connection = await pool.getConnection();
  try {
    console.log('🚀 Running Client GMB Columns Migration...');

    // 1. Check existing columns in `clients`
    const [clientCols] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients'
    `);
    const clientColNames = clientCols.map((c) => c.COLUMN_NAME);

    if (!clientColNames.includes('gmb_url')) {
      await connection.query('ALTER TABLE `clients` ADD COLUMN `gmb_url` VARCHAR(500) NULL AFTER `address`');
      console.log('✓ Added `gmb_url` to `clients` table.');
    } else {
      console.log('• `gmb_url` already exists in `clients`.');
    }

    if (!clientColNames.includes('gmb_place_id')) {
      await connection.query('ALTER TABLE `clients` ADD COLUMN `gmb_place_id` VARCHAR(200) NULL AFTER `gmb_url`');
      console.log('✓ Added `gmb_place_id` to `clients` table.');
    } else {
      console.log('• `gmb_place_id` already exists in `clients`.');
    }

    if (!clientColNames.includes('gmb_snapshot')) {
      await connection.query('ALTER TABLE `clients` ADD COLUMN `gmb_snapshot` JSON NULL AFTER `gmb_place_id`');
      console.log('✓ Added `gmb_snapshot` to `clients` table.');
    } else {
      console.log('• `gmb_snapshot` already exists in `clients`.');
    }

    if (!clientColNames.includes('gmb_last_synced_at')) {
      await connection.query('ALTER TABLE `clients` ADD COLUMN `gmb_last_synced_at` DATETIME NULL AFTER `gmb_snapshot`');
      console.log('✓ Added `gmb_last_synced_at` to `clients` table.');
    } else {
      console.log('• `gmb_last_synced_at` already exists in `clients`.');
    }

    if (!clientColNames.includes('gmb_auto_whitelist')) {
      await connection.query('ALTER TABLE `clients` ADD COLUMN `gmb_auto_whitelist` JSON NULL AFTER `gmb_last_synced_at`');
      console.log('✓ Added `gmb_auto_whitelist` to `clients` table.');
    } else {
      console.log('• `gmb_auto_whitelist` already exists in `clients`.');
    }

    console.log('🎉 Client GMB Migration Completed Successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    connection.release();
    process.exit(0);
  }
}

migrateGmbColumns();
