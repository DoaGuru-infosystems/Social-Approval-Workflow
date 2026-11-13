const pool = require('../config/db');

async function migrate() {
  const connection = await pool.getConnection();
  try {
    console.log('🚀 Starting Multi-Client Migration...');
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');

    // 1. Create `clients` table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        created_by_admin_id INT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_clients_is_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✓ `clients` table verified/created.');

    // 2. Ensure at least one default client exists
    const [existingClients] = await connection.query('SELECT id, name FROM clients LIMIT 1');
    let defaultClientId;
    if (existingClients.length === 0) {
      // Find an admin user
      const [admins] = await connection.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
      const adminId = admins.length > 0 ? admins[0].id : 1;

      const [res] = await connection.query(
        'INSERT INTO clients (name, created_by_admin_id, is_active) VALUES (?, ?, TRUE)',
        ['Apex Health & Fitness', adminId]
      );
      defaultClientId = res.insertId;
      console.log(`✓ Created default client 'Apex Health & Fitness' (ID: ${defaultClientId})`);
    } else {
      defaultClientId = existingClients[0].id;
      console.log(`✓ Using existing client '${existingClients[0].name}' (ID: ${defaultClientId})`);
    }

    // 3. Create `client_brand_guidelines` table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS client_brand_guidelines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_id INT NOT NULL UNIQUE,
        whitelist_words JSON NULL,
        banned_words JSON NULL,
        mandatory_phrases JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✓ `client_brand_guidelines` table verified/created.');

    // Seed default guidelines for default client if none exist
    const [existingGuidelines] = await connection.query(
      'SELECT id FROM client_brand_guidelines WHERE client_id = ?',
      [defaultClientId]
    );
    if (existingGuidelines.length === 0) {
      await connection.query(
        `INSERT INTO client_brand_guidelines (client_id, whitelist_words, banned_words, mandatory_phrases)
         VALUES (?, ?, ?, ?)`,
        [
          defaultClientId,
          JSON.stringify(['Apex', 'ApexHealth', 'Insta', 'FitFam', 'नमस्ते', 'स्वास्थ्य']),
          JSON.stringify(['guaranteed', 'scam', 'fraud', 'cure-all', 'जाली']),
          JSON.stringify(['#ApexHealth', 'Consult physician']),
        ]
      );
      console.log(`✓ Seeded default brand guidelines for client ID ${defaultClientId}.`);
    }

    // 4. Create `social_accounts` table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS social_accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        client_id INT NOT NULL,
        platform ENUM('instagram', 'facebook') NOT NULL,
        account_name VARCHAR(150) NOT NULL,
        platform_account_id VARCHAR(100) NOT NULL,
        connected_by_admin_id INT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
        FOREIGN KEY (connected_by_admin_id) REFERENCES users(id),
        INDEX idx_social_client (client_id, platform)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✓ `social_accounts` table verified/created.');

    // 5. Create `social_account_tokens` table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS social_account_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        social_account_id INT NOT NULL UNIQUE,
        access_token TEXT NOT NULL,
        expires_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('✓ `social_account_tokens` table verified/created.');

    // 6. Update `posts` table: add client_id & title columns if missing
    const [postCols] = await connection.query('DESCRIBE posts');
    const postColNames = postCols.map((c) => c.Field);

    if (!postColNames.includes('client_id')) {
      await connection.query(`
        ALTER TABLE posts
        ADD COLUMN client_id INT NOT NULL DEFAULT ${defaultClientId} AFTER created_by,
        ADD CONSTRAINT fk_posts_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
        ADD INDEX idx_posts_client (client_id);
      `);
      console.log('✓ Added `client_id` column to `posts` table.');
    } else {
      console.log('✓ `posts.client_id` column already exists.');
    }

    if (!postColNames.includes('title')) {
      await connection.query(`
        ALTER TABLE posts
        ADD COLUMN title VARCHAR(255) NOT NULL DEFAULT 'Untitled Campaign' AFTER client_id;
      `);
      console.log('✓ Added `title` column to `posts` table.');
    } else {
      console.log('✓ `posts.title` column already exists.');
    }

    // 7. Update `post_revisions` table: add title column if missing
    const [revCols] = await connection.query('DESCRIBE post_revisions');
    const revColNames = revCols.map((c) => c.Field);

    if (!revColNames.includes('title')) {
      await connection.query(`
        ALTER TABLE post_revisions
        ADD COLUMN title VARCHAR(255) NULL AFTER revision_number;
      `);
      console.log('✓ Added `title` column to `post_revisions` table.');
    } else {
      console.log('✓ `post_revisions.title` column already exists.');
    }

    // 8. Re-enable FOREIGN_KEY_CHECKS
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('🎉 Multi-Client Migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    connection.release();
    process.exit(0);
  }
}

migrate();

