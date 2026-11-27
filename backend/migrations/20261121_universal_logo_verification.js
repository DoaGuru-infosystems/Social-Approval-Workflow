const pool = require('../config/db');

async function runMigration() {
  console.log('[Migration] Starting universal logo verification schema migration...');

  // 1. client_brand_guidelines columns
  const [bgCols] = await pool.query('DESCRIBE client_brand_guidelines');
  const existingBgCols = bgCols.map((c) => c.Field);

  if (!existingBgCols.includes('official_logo_brand_name')) {
    await pool.query(
      'ALTER TABLE client_brand_guidelines ADD COLUMN official_logo_brand_name VARCHAR(255) NULL AFTER reference_logo_url'
    );
    console.log('[Migration] Added official_logo_brand_name to client_brand_guidelines');
  }

  if (!existingBgCols.includes('required_brand_tokens')) {
    await pool.query(
      'ALTER TABLE client_brand_guidelines ADD COLUMN required_brand_tokens LONGTEXT NULL AFTER official_logo_brand_name'
    );
    console.log('[Migration] Added required_brand_tokens to client_brand_guidelines');
  }

  if (!existingBgCols.includes('tagline_policy')) {
    await pool.query(
      "ALTER TABLE client_brand_guidelines ADD COLUMN tagline_policy ENUM('MANDATORY', 'OPTIONAL', 'NONE') NOT NULL DEFAULT 'NONE' AFTER required_brand_tokens"
    );
    console.log('[Migration] Added tagline_policy to client_brand_guidelines');
  }

  if (!existingBgCols.includes('tagline_text')) {
    await pool.query(
      'ALTER TABLE client_brand_guidelines ADD COLUMN tagline_text VARCHAR(255) NULL AFTER tagline_policy'
    );
    console.log('[Migration] Added tagline_text to client_brand_guidelines');
  }

  if (!existingBgCols.includes('logo_config_updated_at')) {
    await pool.query(
      'ALTER TABLE client_brand_guidelines ADD COLUMN logo_config_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER tagline_text'
    );
    console.log('[Migration] Added logo_config_updated_at to client_brand_guidelines');
  }

  // 2. posts table columns for verification freshness & integrity
  const [postCols] = await pool.query('DESCRIBE posts');
  const existingPostCols = postCols.map((c) => c.Field);

  if (!existingPostCols.includes('verified_image_hash')) {
    await pool.query(
      'ALTER TABLE posts ADD COLUMN verified_image_hash VARCHAR(64) NULL AFTER recheck_count'
    );
    console.log('[Migration] Added verified_image_hash to posts');
  }

  if (!existingPostCols.includes('verified_logo_config_hash')) {
    await pool.query(
      'ALTER TABLE posts ADD COLUMN verified_logo_config_hash VARCHAR(64) NULL AFTER verified_image_hash'
    );
    console.log('[Migration] Added verified_logo_config_hash to posts');
  }

  console.log('[Migration] Universal logo verification schema migration completed successfully!');
}

module.exports = { runMigration };

if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Migration] Failed:', err);
      process.exit(1);
    });
}
