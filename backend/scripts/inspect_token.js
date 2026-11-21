const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const db = require('../config/db');
const { decrypt } = require('../utils/encryption');

async function debugMetaToken(token) {
  const appId = process.env.INSTAGRAM_APP_ID?.trim();
  const appSecret = process.env.INSTAGRAM_APP_SECRET?.trim();
  const metaAppId = process.env.META_APP_ID?.trim();
  const metaAppSecret = process.env.META_APP_SECRET?.trim();

  console.log('\n--- Debugging Token Metadata ---');
  if (metaAppId && metaAppSecret) {
    try {
      const res = await fetch(`https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(token)}&access_token=${metaAppId}|${metaAppSecret}`);
      const data = await res.json();
      console.log('graph.facebook.com debug_token (META_APP):', JSON.stringify(data));
    } catch (e) {
      console.log('debug_token META_APP error:', e.message);
    }
  }

  if (appId && appSecret) {
    try {
      const res = await fetch(`https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(token)}&access_token=${appId}|${appSecret}`);
      const data = await res.json();
      console.log('graph.facebook.com debug_token (IG_APP):', JSON.stringify(data));
    } catch (e) {
      console.log('debug_token IG_APP error:', e.message);
    }
  }
}

async function check() {
  const [rows] = await db.query(
    'SELECT client_id, platform_id, platform_username, access_token_encrypted, last_error FROM client_social_accounts WHERE platform = ?',
    ['instagram']
  );

  for (const row of rows) {
    console.log(`\n======================================================`);
    console.log(`Client ${row.client_id} | Platform ID: ${row.platform_id} | Username: ${row.platform_username}`);
    console.log(`Last Error: ${row.last_error}`);
    if (!row.access_token_encrypted) {
      console.log('No encrypted token');
      continue;
    }
    const token = decrypt(row.access_token_encrypted);
    console.log(`Token prefix: ${token.slice(0, 10)}...`);

    if (row.client_id === 11) {
      await debugMetaToken(token);
    }

    const tests = [
      // 1. GET /v21.0/me?fields=user_id,username
      { name: 'GET v21.0/me?fields=user_id,username', url: `https://graph.instagram.com/v21.0/me?fields=user_id,username&access_token=${encodeURIComponent(token)}` },
      // 2. GET /v21.0/me?fields=id,username
      { name: 'GET v21.0/me?fields=id,username', url: `https://graph.instagram.com/v21.0/me?fields=id,username&access_token=${encodeURIComponent(token)}` },
      // 3. GET /me?fields=user_id,username
      { name: 'GET me?fields=user_id,username', url: `https://graph.instagram.com/me?fields=user_id,username&access_token=${encodeURIComponent(token)}` },
      // 4. GET /me?fields=id,username
      { name: 'GET me?fields=id,username', url: `https://graph.instagram.com/me?fields=id,username&access_token=${encodeURIComponent(token)}` },
      // 5. GET /v21.0/me
      { name: 'GET v21.0/me (no fields)', url: `https://graph.instagram.com/v21.0/me?access_token=${encodeURIComponent(token)}` },
      // 6. GET /me
      { name: 'GET me (no fields)', url: `https://graph.instagram.com/me?access_token=${encodeURIComponent(token)}` },
    ];

    if (row.platform_id) {
      tests.push(
        { name: `GET v21.0/${row.platform_id}?fields=id,username`, url: `https://graph.instagram.com/v21.0/${row.platform_id}?fields=id,username&access_token=${encodeURIComponent(token)}` },
        { name: `GET ${row.platform_id}?fields=id,username`, url: `https://graph.instagram.com/${row.platform_id}?fields=id,username&access_token=${encodeURIComponent(token)}` },
        { name: `GET v21.0/${row.platform_id}?fields=user_id,username`, url: `https://graph.instagram.com/v21.0/${row.platform_id}?fields=user_id,username&access_token=${encodeURIComponent(token)}` },
        { name: `GET ${row.platform_id}?fields=user_id,username`, url: `https://graph.instagram.com/${row.platform_id}?fields=user_id,username&access_token=${encodeURIComponent(token)}` },
        { name: `GET v21.0/${row.platform_id} (no fields)`, url: `https://graph.instagram.com/v21.0/${row.platform_id}?access_token=${encodeURIComponent(token)}` },
        { name: `GET ${row.platform_id} (no fields)`, url: `https://graph.instagram.com/${row.platform_id}?access_token=${encodeURIComponent(token)}` }
      );
    }

    for (const test of tests) {
      try {
        const res = await fetch(test.url);
        const data = await res.json();
        console.log(`[${test.name}] HTTP ${res.status}:`, JSON.stringify(data));
      } catch (e) {
        console.log(`[${test.name}] Network error:`, e.message);
      }
    }
  }
  process.exit(0);
}

check();
