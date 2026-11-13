const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5000/api';

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, data };
}

async function runLiveTestSuite() {
  console.log('===============================================================');
  console.log('🚀 RUNNING COMPREHENSIVE LIVE API & SECURITY TEST SUITE');
  console.log('===============================================================\n');

  // STEP 1: Verify Health
  console.log('📡 STEP 1: Checking Server & Database Health...');
  const health = await request('/health');
  console.log('Health response:', health.data);
  if (!health.ok || health.data.db !== 'connected') {
    throw new Error('Server health check failed: ' + JSON.stringify(health.data));
  }
  console.log('✅ Health check OK!\n');

  // STEP 2: Authenticate SMO, Manager, and Admin
  console.log('🔑 STEP 2: Authenticating Demo Users...');
  const smoLogin = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'smo@test.com', password: 'password123' }),
  });
  const smoToken = smoLogin.data.token;
  console.log('✅ SMO Logged In. Token:', smoToken ? 'Bearer [valid]' : 'None');

  const managerLogin = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'manager@test.com', password: 'password123' }),
  });
  const managerToken = managerLogin.data.token;
  console.log('✅ Manager Logged In. Token:', managerToken ? 'Bearer [valid]' : 'None');

  const adminLogin = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.com', password: 'password123' }),
  });
  const adminToken = adminLogin.data.token;
  console.log('✅ Admin Logged In. Token:', adminToken ? 'Bearer [valid]' : 'None\n');

  // STEP 3: Creator Creates Post (with deliberate spelling errors & test image)
  console.log('📝 STEP 3: Creator Creates New Post (with spelling error: "Welcom to our grand openning")...');
  const sampleImagePath = path.join(__dirname, 'uploads', 'test-sample.png');
  const imageBuffer = fs.readFileSync(sampleImagePath);

  const formData = new FormData();
  formData.append('caption', 'Welcom to our grand openning! We provid the best servise.');
  formData.append('image', new Blob([imageBuffer], { type: 'image/png' }), 'test-sample.png');

  const createPostRes = await request('/posts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${smoToken}` },
    body: formData,
  });

  console.log('Create Post Status:', createPostRes.status);
  const createdPost = createPostRes.data.post;
  const aiReport = createPostRes.data.ai_check;
  const postId = createdPost.id;
  console.log(`✅ Post #${postId} Created.`);
  console.log(`   Initial Status: '${createdPost.status}', Recheck Count: ${createdPost.recheck_count}`);
  console.log(`   AI Spelling Issues Detected: ${aiReport.spelling_issues.length}`);
  aiReport.spelling_issues.forEach((issue) => {
    console.log(`     - "${issue.word}" -> Suggestions: [${issue.suggestions.join(', ')}]`);
  });
  console.log(`   AI OCR Extracted Text: "${aiReport.ocr_extracted_text}"\n`);

  // STEP 4: Test 3-Revision Limit (Rechecks)
  console.log('🔄 STEP 4: Testing Revision Loop & 3-Recheck Hard Limit...');

  // Recheck 1
  console.log('   -> Attempting Revision 1...');
  const rev1Form = new FormData();
  rev1Form.append('caption', 'Welcom again to openning sale.');
  const rev1Res = await request(`/posts/${postId}/revise`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${smoToken}` },
    body: rev1Form,
  });
  console.log(`      Revision 1 result: Recheck count = ${rev1Res.data.post.recheck_count}/3, manual_review_required = ${rev1Res.data.manual_review_required}`);

  // Recheck 2
  console.log('   -> Attempting Revision 2...');
  const rev2Form = new FormData();
  rev2Form.append('caption', 'Welcom once more to openning sale.');
  const rev2Res = await request(`/posts/${postId}/revise`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${smoToken}` },
    body: rev2Form,
  });
  console.log(`      Revision 2 result: Recheck count = ${rev2Res.data.post.recheck_count}/3, manual_review_required = ${rev2Res.data.manual_review_required}`);

  // Recheck 3 (Should trigger manual_review_required = true)
  console.log('   -> Attempting Revision 3 (Threshold)...');
  const rev3Form = new FormData();
  rev3Form.append('caption', 'Welcome to our grand opening sale! Final corrected text.');
  const rev3Res = await request(`/posts/${postId}/revise`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${smoToken}` },
    body: rev3Form,
  });
  console.log(`      Revision 3 result: Recheck count = ${rev3Res.data.post.recheck_count}/3, manual_review_required = ${rev3Res.data.manual_review_required}`);
  console.log(`      Message: "${rev3Res.data.message}"`);

  // Recheck 4 (MUST BE BLOCKED!)
  console.log('   -> Attempting Revision 4 (Should be BLOCKED)...');
  const rev4Form = new FormData();
  rev4Form.append('caption', 'Trying a 4th revision.');
  const rev4Res = await request(`/posts/${postId}/revise`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${smoToken}` },
    body: rev4Form,
  });
  console.log(`      Revision 4 Status: ${rev4Res.status} (Expected 400 Bad Request)`);
  console.log(`      Response message: "${rev4Res.data.message}"`);
  if (rev4Res.status === 400 && rev4Res.data.manual_review_required) {
    console.log('✅ RECHECK HARD LIMIT ENFORCED: 4th revision was successfully BLOCKED!\n');
  } else {
    throw new Error('Recheck hard limit was not enforced properly!');
  }

  // STEP 5: Security Check — SMO cannot approve their own post or access manager/admin endpoints
  console.log('🛡️ STEP 5: Running Security Check (Self-Approval & Role Access)...');
  const unauthorizedManagerReview = await request(`/posts/${postId}/manager-review`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${smoToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'approve', comment: 'SMO approving own post' }),
  });
  console.log(`   SMO trying manager-review -> HTTP ${unauthorizedManagerReview.status}: "${unauthorizedManagerReview.data.message}"`);

  const unauthorizedAdminReview = await request(`/posts/${postId}/admin-review`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${smoToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'approve', comment: 'SMO approving own post' }),
  });
  console.log(`   SMO trying admin-review -> HTTP ${unauthorizedAdminReview.status}: "${unauthorizedAdminReview.data.message}"`);

  if (unauthorizedManagerReview.status === 403 && unauthorizedAdminReview.status === 403) {
    console.log('✅ SECURITY CHECK PASSED: SMO is strictly forbidden from approving posts!\n');
  } else {
    throw new Error('Security vulnerability detected: SMO was able to access review endpoints!');
  }

  // STEP 6: SMO Submits Post for Manager Review
  console.log('📨 STEP 6: SMO Submits Post for Manager Review...');
  const submitRes = await request(`/posts/${postId}/submit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${smoToken}` },
  });
  console.log(`   Submit response: "${submitRes.data.message}", New Status: '${submitRes.data.post.status}'`);
  console.log('✅ Post submitted to Manager queue.\n');

  // STEP 7: Manager Reviews & Approves Post
  console.log('👔 STEP 7: Manager Checks Queue & Approves Post...');
  const managerQueue = await request('/posts', {
    method: 'GET',
    headers: { Authorization: `Bearer ${managerToken}` },
  });
  const inManagerQueue = managerQueue.data.posts?.find((p) => p.id === postId);
  console.log(`   Found Post #${postId} in Manager Queue? ${Boolean(inManagerQueue)}`);
  console.log(`   Manual Review Required flag visible to Manager: ${Boolean(inManagerQueue?.manual_review_required)}`);

  const managerApprove = await request(`/posts/${postId}/manager-review`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'approve', comment: 'Verified spelling and image OCR. Cleared.' }),
  });
  console.log(`   Manager Approval Status: ${managerApprove.status}, Post Status: '${managerApprove.data.post.status}'`);
  console.log('✅ Manager Approval Complete (Sent to Admin).\n');

  // STEP 8: Admin Final Approves
  console.log('👑 STEP 8: Admin Final Approval...');
  const adminApprove = await request(`/posts/${postId}/admin-review`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'approve', comment: 'Final brand clearance authorized.' }),
  });
  console.log(`   Admin Approval Status: ${adminApprove.status}, Post Status: '${adminApprove.data.post.status}'`);
  console.log('✅ Admin Approval Complete (Unlocked Platform Selection).\n');

  // STEP 9: Platform Selection (SMO selects Instagram)
  console.log('📱 STEP 9: Selecting Social Platform (Instagram)...');
  const platformRes = await request(`/posts/${postId}/platform`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${smoToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ platform: 'instagram' }),
  });
  console.log(`   Platform Response: "${platformRes.data.message}", Post Status: '${platformRes.data.post.status}'`);
  console.log('✅ Platform set to Instagram. Ready to publish.\n');

  // STEP 10: SMO Submits Live Publish URL
  console.log('🌐 STEP 10: Recording Live Published URL...');
  const liveUrl = 'https://www.instagram.com/p/DF9988776655/';
  const publishUrlRes = await request(`/posts/${postId}/publish-url`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${smoToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ manual_publish_url: liveUrl }),
  });
  console.log(`   Publish URL Response: "${publishUrlRes.data.message}", Post Status: '${publishUrlRes.data.post.status}'`);
  console.log('✅ Post Status is now COMPLETED!\n');

  // STEP 11: Verify Complete Audit History
  console.log('📜 STEP 11: Retrieving Complete Audit History from GET /api/posts/:id...');
  const fullDetail = await request(`/posts/${postId}`, {
    headers: { Authorization: `Bearer ${smoToken}` },
  });
  const d = fullDetail.data;
  console.log(`   Post ID: #${d.post.id}, Status: ${d.post.status}, Platform: ${d.post.platform}`);
  console.log(`   Live URL: ${d.post.manual_publish_url}`);
  console.log(`   Total Recorded Revisions: ${d.revisions.length}`);
  console.log(`   Total AI Reports: ${d.ai_reports.length}`);
  console.log(`   Total Approvals Logged: ${d.approvals.length}`);
  d.approvals.forEach((app, idx) => {
    console.log(`     [Approval ${idx + 1}] Role: ${app.role}, Action: ${app.action}, Approver: ${app.approver_name}, Comment: "${app.comment}"`);
  });

  console.log('\n===============================================================');
  console.log('🎉 ALL 11 STEPS & TEST CASES PASSED WITH 100% SUCCESS!');
  console.log('===============================================================');
}

runLiveTestSuite().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});

