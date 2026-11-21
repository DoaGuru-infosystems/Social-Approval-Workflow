const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const db = require('../config/db');
const { decrypt } = require('../utils/encryption');
const metaService = require('../services/metaService');

async function testFix() {
  console.log('=== VERIFYING INSTAGRAM IDENTITY FIX ===\n');

  const [rows] = await db.query(
    'SELECT client_id, platform, platform_id, platform_username, access_token_encrypted, last_error FROM client_social_accounts WHERE client_id = 11 AND platform = ?',
    ['instagram']
  );

  if (rows.length === 0 || !rows[0].access_token_encrypted) {
    console.log('No Instagram record found for Client 11');
    process.exit(1);
  }

  const row = rows[0];
  const token = decrypt(row.access_token_encrypted);
  const userId = row.platform_id;

  console.log('1. Account Info:');
  console.log(`   Client ID: ${row.client_id}`);
  console.log(`   Platform ID (OAuth user_id): ${userId}`);
  console.log(`   Stored last_error: ${row.last_error}`);
  console.log(`   Token prefix: ${token.slice(0, 15)}... (length: ${token.length})`);

  console.log('\n2. Testing fetchInstagramIdentity() with updated minimal fields (user_id,username):');
  const result = await metaService.testConnection(row);
  console.log('\ntestConnection() Result:', {
    valid: result.valid,
    accountName: result.accountName,
    platformId: result.platformId,
    error: result.error,
    code: result.code,
    type: result.type,
    fbtrace_id: result.fbtrace_id,
  });

  process.exit(0);
}

testFix().catch(console.error);
