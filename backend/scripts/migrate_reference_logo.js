const pool = require('../config/db');

async function migrate() {
  try {
    console.log('🚀 Running migration: Add reference_logo_url to client_brand_guidelines...');
    const [cols] = await pool.query("SHOW COLUMNS FROM client_brand_guidelines LIKE 'reference_logo_url'");
    if (cols.length === 0) {
      await pool.query('ALTER TABLE client_brand_guidelines ADD COLUMN reference_logo_url TEXT NULL AFTER mandatory_phrases');
      console.log('✓ Successfully added reference_logo_url column to client_brand_guidelines.');
    } else {
      console.log('✓ reference_logo_url column already exists.');
    }
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    process.exit(0);
  }
}

migrate();
