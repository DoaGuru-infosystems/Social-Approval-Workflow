const pool = require('../config/db');

async function migrateSocialConnect() {
  console.log('--- Starting Social Connect Database Migration ---');

  // 1. Create client_social_accounts table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_social_accounts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      client_id INT NOT NULL,
      platform ENUM('instagram', 'facebook', 'linkedin', 'youtube') NOT NULL,
      profile_url VARCHAR(500) NULL,
      platform_username VARCHAR(200) NULL,
      platform_id VARCHAR(200) NULL,
      access_token_encrypted TEXT NULL,
      refresh_token_encrypted TEXT NULL,
      token_expires_at DATETIME NULL,
      refresh_token_expires_at DATETIME NULL,
      connection_method ENUM('oauth', 'manual') NULL,
      is_connected BOOLEAN DEFAULT FALSE,
      last_tested_at DATETIME NULL,
      last_error TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_client_platform (client_id, platform),
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log('✓ client_social_accounts table verified/created.');

  // 2. Update posts table for scheduling & target platforms
  try {
    await pool.query(`
      ALTER TABLE posts
      ADD COLUMN IF NOT EXISTS scheduled_at DATETIME NULL AFTER image_path,
      ADD COLUMN IF NOT EXISTS target_platforms JSON NULL AFTER platform,
      ADD COLUMN IF NOT EXISTS publish_results JSON NULL AFTER manual_publish_url,
      ADD COLUMN IF NOT EXISTS published_at DATETIME NULL AFTER publish_results;
    `);
    console.log('✓ posts columns (scheduled_at, target_platforms, publish_results, published_at) verified/added.');
  } catch (err) {
    console.log('Notice adding posts columns:', err.message);
  }

  // Update posts status ENUM to include 'scheduled', 'posted', 'failed'
  try {
    await pool.query(`
      ALTER TABLE posts MODIFY COLUMN status ENUM(
        'draft',
        'ai_checking',
        'pending_manager',
        'pending_admin',
        'admin_approved',
        'ready_to_publish',
        'scheduled',
        'posted',
        'failed',
        'completed',
        'changes_requested',
        'rejected'
      ) NOT NULL DEFAULT 'ai_checking';
    `);
    console.log("✓ posts.status ENUM updated with 'scheduled', 'posted', 'failed'.");
  } catch (err) {
    console.log('Notice modifying posts status ENUM:', err.message);
  }

  // 3. Pre-fill DOAGuru Infosystems (id 11 or search by name) profile URLs for all 4 platforms
  const [doaguruRows] = await pool.query(
    "SELECT id, name FROM clients WHERE name LIKE '%DOAGuru%' LIMIT 1"
  );

  if (doaguruRows.length > 0) {
    const doaguruId = doaguruRows[0].id;
    console.log(`Found DOAGuru with ID ${doaguruId}. Pre-filling 4 platforms...`);

    const doaguruPlatforms = [
      {
        platform: 'instagram',
        profile_url: 'https://www.instagram.com/doaguru_infosystem/',
        platform_username: 'doaguru_infosystem',
      },
      {
        platform: 'facebook',
        profile_url: 'https://www.facebook.com/doaguruinfosystems/',
        platform_username: 'doaguruinfosystems',
      },
      {
        platform: 'youtube',
        profile_url: 'https://www.youtube.com/@doaguru4230',
        platform_username: '@doaguru4230',
      },
      {
        platform: 'linkedin',
        profile_url: 'https://in.linkedin.com/company/doaguru-infosystem',
        platform_username: 'doaguru-infosystem',
      },
    ];

    for (const p of doaguruPlatforms) {
      await pool.query(
        `INSERT INTO client_social_accounts (client_id, platform, profile_url, platform_username, is_connected)
         VALUES (?, ?, ?, ?, FALSE)
         ON DUPLICATE KEY UPDATE profile_url = VALUES(profile_url), platform_username = VALUES(platform_username)`,
        [doaguruId, p.platform, p.profile_url, p.platform_username]
      );
    }
    console.log('✓ DOAGuru profile URLs pre-filled for Instagram, Facebook, YouTube, LinkedIn.');
  } else {
    console.log('Note: DOAGuru client not found yet, will pre-fill when created.');
  }

  console.log('--- Migration Completed Successfully ---');
}

if (require.main === module) {
  migrateSocialConnect()
    .then(() => pool.end())
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = migrateSocialConnect;
