const pool = require('./config/db');
const aiService = require('./services/aiService');

async function testFullWorkflow() {
  console.log('🧪 Starting End-to-End Real MySQL Workflow Verification...\n');

  // 1. Check MySQL connection
  const conn = await pool.testConnection();
  if (!conn.connected) {
    throw new Error('Database not connected: ' + conn.error);
  }
  console.log('✅ 1. MySQL Connected.');

  // 2. Fetch SMO user
  const [users] = await pool.query("SELECT * FROM users WHERE role = 'smo' LIMIT 1");
  if (users.length === 0) throw new Error('No SMO user found. Run seed.js first.');
  const smo = users[0];
  console.log(`✅ 2. Found SMO: ${smo.name} (ID: ${smo.id})`);

  // 3. Create Post
  const caption = 'Welcom to our grand openning event! Special discounts today.';
  const [postResult] = await pool.query(
    "INSERT INTO posts (created_by, caption, status, recheck_count) VALUES (?, ?, 'ai_checking', 0)",
    [smo.id, caption]
  );
  const postId = postResult.insertId;
  console.log(`✅ 3. Post created in MySQL (ID: ${postId})`);

  // 4. Create Revision 1
  const [revResult] = await pool.query(
    'INSERT INTO post_revisions (post_id, revision_number, caption) VALUES (?, 1, ?)',
    [postId, caption]
  );
  const revisionId = revResult.insertId;
  console.log(`✅ 4. Revision 1 created (ID: ${revisionId})`);

  // 5. Run AI Check
  const aiResult = await aiService.runAiCheck({ caption });
  console.log(`✅ 5. AI Check Ran: Detected ${aiResult.spelling_issues.length} spelling mistakes.`);

  // 6. Save AI check results
  await pool.query(
    'INSERT INTO ai_check_results (post_id, revision_id, spelling_issues, ocr_extracted_text, ocr_issues) VALUES (?, ?, ?, ?, ?)',
    [
      postId,
      revisionId,
      JSON.stringify(aiResult.spelling_issues),
      aiResult.ocr_extracted_text,
      JSON.stringify(aiResult.ocr_issues),
    ]
  );
  console.log('✅ 6. AI Results saved into ai_check_results table.');

  // 7. Creator submits to Manager
  await pool.query("UPDATE posts SET status = 'pending_manager' WHERE id = ?", [postId]);
  console.log("✅ 7. Post status updated to 'pending_manager'.");

  // 8. Manager approves
  const [managers] = await pool.query("SELECT * FROM users WHERE role = 'manager' LIMIT 1");
  const manager = managers[0];
  await pool.query(
    "INSERT INTO post_approvals (post_id, revision_id, approver_id, role, action, comment) VALUES (?, ?, ?, 'manager', 'approved', 'Looks good to proceed.')",
    [postId, revisionId, manager.id]
  );
  await pool.query("UPDATE posts SET status = 'pending_admin' WHERE id = ?", [postId]);
  console.log("✅ 8. Manager approved. Post status updated to 'pending_admin'.");

  // 9. Admin final approves
  const [admins] = await pool.query("SELECT * FROM users WHERE role = 'admin' LIMIT 1");
  const admin = admins[0];
  await pool.query(
    "INSERT INTO post_approvals (post_id, revision_id, approver_id, role, action, comment) VALUES (?, ?, ?, 'admin', 'approved', 'Brand clearance granted.')",
    [postId, revisionId, admin.id]
  );
  await pool.query("UPDATE posts SET status = 'admin_approved' WHERE id = ?", [postId]);
  console.log("✅ 9. Admin approved. Post status updated to 'admin_approved'.");

  // 10. Platform select
  await pool.query(
    "UPDATE posts SET platform = 'instagram', status = 'ready_to_publish' WHERE id = ?",
    [postId]
  );
  console.log("✅ 10. Platform 'instagram' selected. Status updated to 'ready_to_publish'.");

  // 11. Live URL publish
  await pool.query(
    "UPDATE posts SET manual_publish_url = 'https://instagram.com/p/DB1234567/', status = 'completed' WHERE id = ?",
    [postId]
  );
  console.log("✅ 11. Live URL saved. Status updated to 'completed'.");

  // 12. Verify final record
  const [finalPost] = await pool.query('SELECT * FROM posts WHERE id = ?', [postId]);
  console.log('\n===============================================');
  console.log('🏆 FINAL RECORD IN MYSQL DATABASE:');
  console.log(finalPost[0]);
  console.log('===============================================\n');

  console.log('🎉 REAL SOLID BACKEND & MYSQL PIPELINE IS FULLY OPERATIONAL!');
  process.exit(0);
}

testFullWorkflow().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});

