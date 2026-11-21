const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mysql = require('mysql2/promise');
const aiService = require('../services/aiService');

async function testPost23() {
  console.log('=== TESTING POST 23 WITH COLOR-CHANGED YELLOW LOGO & NO-BLOCK SPELL CHECK ===\n');

  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'social_approval_db',
  });

  try {
    const [posts] = await pool.query('SELECT * FROM posts WHERE id = 23');
    if (posts.length === 0) {
      console.error('Post 23 not found');
      return;
    }
    const post = posts[0];
    console.log('Post:', { id: post.id, client_id: post.client_id, image_path: post.image_path });

    // Run Full Image Quality Check
    const result = await aiService.runImageCheck({
      clientId: post.client_id,
      imagePath: post.image_path,
      caption: post.caption || ''
    });

    console.log('\n--- 1. BRAND LOGO CHECK RESULT ---');
    console.log('Logo Check:', {
      status: result.logo_check?.status,
      found: result.logo_check?.found,
      score: result.logo_check?.score,
      location: result.logo_check?.location,
      reason: result.logo_check?.reason,
      suggestion: result.logo_check?.suggestion,
      symbol_score: result.logo_check?.symbol_score,
      enforcement_state: result.logo_check?.enforcement_state,
    });

    console.log('\n--- 2. ENFORCEMENT STATE ---');
    console.log('Image Enforcement State:', result.enforcement_state);
    console.log('Image Enforcement Reasons:', result.enforcement_reasons);

    console.log('\n--- 3. OCR BOXES & SPELL CHECK ISSUES ---');
    const redBoxes = (result.ocr_issues || []).filter(b => b.status === 'red');
    const yellowBoxes = (result.ocr_issues || []).filter(b => b.status === 'yellow');
    console.log(`Total Boxes: ${result.ocr_issues?.length}, Red Boxes (Errors): ${redBoxes.length}, Yellow Boxes (Doubts): ${yellowBoxes.length}`);

    for (const b of (result.ocr_issues || [])) {
      if (b.status === 'red' || b.status === 'yellow') {
        console.log(`[${b.status.toUpperCase()}] Box #${b.id}: "${(b.ocr_read || '').slice(0, 40)}..." (conf: ${b.confidence}%) -> ${b.reason}`);
      }
    }

    // Update database records for Post 23
    console.log('\n--- 4. UPDATING DATABASE WITH LATEST CHECK FOR POST 23 ---');
    const [aiRows] = await pool.query('SELECT id, revision_id FROM ai_check_results WHERE post_id = ? ORDER BY id DESC LIMIT 1', [post.id]);
    if (aiRows.length > 0) {
      await pool.query(
        `UPDATE ai_check_results
         SET ocr_issues = ?,
             logo_check = ?,
             enforcement_state = ?,
             image_status = 'completed'
         WHERE id = ?`,
        [
          JSON.stringify(result.ocr_issues || []),
          JSON.stringify(result.logo_check || null),
          result.enforcement_state,
          aiRows[0].id
        ]
      );
      console.log(`Updated ai_check_results id=${aiRows[0].id} with enforcement_state=${result.enforcement_state}`);
    }

    await pool.query(
      `UPDATE posts
       SET status = 'pending_manager_approval',
           manual_review_required = 0
       WHERE id = ?`,
      [post.id]
    );
    console.log(`Updated post #${post.id} status to 'pending_manager_approval'`);

    // Verify whether post can be approved / published
    const isRedBlock = result.enforcement_state === 'red_block';
    console.log('\n--- 5. APPROVAL & PUBLISHING GATE VERIFICATION ---');
    console.log('Is Blocked by RED BLOCK?', isRedBlock ? 'YES (BLOCKED)' : 'NO (ALLOWED - YELLOW/GREEN ZONE)');

    if (!isRedBlock && result.logo_check?.reason === 'COLOR_CHANGED') {
      console.log('SUCCESS: Logo color change is correctly treated as YELLOW ALERT (Warning), not RED BLOCK!');
    }
    if (redBoxes.length === 0) {
      console.log('SUCCESS: 0 Red boxes on poster! Spell checks / icons are classified as Yellow OCR Doubts.');
    }
  } finally {
    await pool.end();
  }
}

testPost23().catch(console.error);
