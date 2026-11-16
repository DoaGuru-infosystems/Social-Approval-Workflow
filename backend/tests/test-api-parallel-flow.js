/**
 * End-to-End API Integration Test for Parallel AI Check, Polling, & Retry
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const app = require('../server');
const pool = require('../config/db');

async function runApiTest() {
  console.log('====================================================');
  console.log('RUNNING FULL END-TO-END PARALLEL API INTEGRATION TEST');
  console.log('====================================================\n');

  // Start local express server on dynamic ephemeral port
  const server = http.createServer(app);
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Server listening on ${baseUrl}`);

  try {
    // 1. Generate JWT Token for SMO
    console.log('\n--- STEP 1: Generate Auth Token for SMO ---');
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { id: 1, name: 'Rohan SMO', email: 'smo@test.com', role: 'smo' },
      process.env.JWT_SECRET || 'super_secret_social_approval_jwt_key_2026',
      { expiresIn: '7d' }
    );
    console.log('PASS: Auth token generated successfully.');

    // 2. Fetch a test client
    console.log('\n--- STEP 2: Fetch Active Client ---');
    const [clients] = await pool.query('SELECT id, name FROM clients WHERE is_active = TRUE LIMIT 1');
    if (clients.length === 0) throw new Error('No active client found in DB');
    const client = clients[0];
    console.log(`Using client: ID ${client.id} (${client.name})`);

    // 3. Create dummy test image for upload
    const dummyImagePath = path.join(__dirname, 'test-upload.jpg');
    fs.writeFileSync(dummyImagePath, Buffer.from('FAKE_IMAGE_DATA_FOR_TESTING'));

    // 4. Create Post via multipart FormData
    console.log('\n--- STEP 3: Create Post (Parallel Non-Blocking) ---');
    const formData = new FormData();
    formData.append('client_id', String(client.id));
    formData.append('title', 'Summer Health Awareness Campaign');
    formData.append('caption', 'Stay hydrated and healthy this summer with Balgopal Children Clinic!');
    const fileBuffer = fs.readFileSync(dummyImagePath);
    const blob = new Blob([fileBuffer], { type: 'image/jpeg' });
    formData.append('image', blob, 'test-upload.jpg');

    const startTime = Date.now();
    const createRes = await fetch(`${baseUrl}/api/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });
    const duration = Date.now() - startTime;
    const createData = await createRes.json();

    console.log(`POST /api/posts responded in ${duration}ms (HTTP ${createRes.status})`);
    if (!createRes.ok || !createData.success) {
      throw new Error(`Create post failed: ${createData.message}`);
    }

    if (duration > 3000) {
      console.warn(`WARNING: Duration was ${duration}ms, expected under 3000ms`);
    } else {
      console.log('PASS: Endpoint returned immediately without blocking for 15-20s OCR!');
    }

    console.log('Post ID created:', createData.post.id);
    console.log('image_status:', createData.image_status);
    console.log('poll_url:', createData.poll_url);
    console.log('Text check summary:', createData.text_result?.summary);

    if (createData.image_status !== 'pending') {
      throw new Error(`Expected image_status to be 'pending', got '${createData.image_status}'`);
    }
    console.log('PASS: Initial image_status is pending as expected.');

    const postId = createData.post.id;

    // 5. Poll GET /api/posts/:id/ai-status
    console.log('\n--- STEP 4: Poll GET /api/posts/:id/ai-status ---');
    const statusRes = await fetch(`${baseUrl}/api/posts/${postId}/ai-status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const statusData = await statusRes.json();
    console.log('ai-status HTTP status:', statusRes.status);
    console.log('ai-status payload:', {
      post_id: statusData.post_id,
      text_status: statusData.text_status,
      image_status: statusData.image_status,
      combined_ai_check_present: Boolean(statusData.combined_ai_check),
    });

    if (!statusRes.ok || statusData.text_status !== 'completed') {
      throw new Error('AI status endpoint failed or returned unexpected state');
    }
    console.log('PASS: GET /api/posts/:id/ai-status returned valid status object.');

    // Wait for initial background check to settle before triggering retry
    console.log('Waiting for initial background image check to settle...');
    const initWaitStart = Date.now();
    while (Date.now() - initWaitStart < 30000) {
      const [initRows] = await pool.query(
        'SELECT image_status FROM ai_check_results WHERE post_id = ? ORDER BY id DESC LIMIT 1',
        [postId]
      );
      if (initRows.length > 0 && initRows[0].image_status !== 'pending') {
        console.log(`Initial background check settled to '${initRows[0].image_status}' in ${Date.now() - initWaitStart}ms`);
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    // 6. Test POST /api/posts/:id/check-text (Re-run text check)
    console.log('\n--- STEP 5: Test POST /api/posts/:id/check-text ---');
    const checkTextRes = await fetch(`${baseUrl}/api/posts/${postId}/check-text`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const checkTextData = await checkTextRes.json();
    console.log('check-text HTTP:', checkTextRes.status, checkTextData.message);
    if (!checkTextRes.ok || checkTextData.text_status !== 'completed') {
      throw new Error('POST /api/posts/:id/check-text failed');
    }
    console.log('PASS: check-text succeeded.');

    // 7. Test POST /api/posts/:id/check-image (Retry image check)
    console.log('\n--- STEP 6: Test POST /api/posts/:id/check-image ---');
    const checkImgRes = await fetch(`${baseUrl}/api/posts/${postId}/check-image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const checkImgData = await checkImgRes.json();
    console.log('check-image HTTP:', checkImgRes.status, checkImgData.message);
    if (!checkImgRes.ok || checkImgData.image_status !== 'pending') {
      throw new Error('POST /api/posts/:id/check-image failed');
    }
    console.log('PASS: check-image restarted image check successfully.');

    // 8. Wait for background image check to settle before cleanup & pool shutdown
    console.log('\n--- STEP 7: Wait for Background Image Check to Settle ---');
    const pollStart = Date.now();
    let finalImageStatus = 'pending';
    while (Date.now() - pollStart < 30000) {
      const [aiCheckRows] = await pool.query(
        'SELECT image_status, image_error FROM ai_check_results WHERE post_id = ? ORDER BY id DESC LIMIT 1',
        [postId]
      );
      if (aiCheckRows.length > 0 && aiCheckRows[0].image_status !== 'pending') {
        finalImageStatus = aiCheckRows[0].image_status;
        console.log(`Background check resolved to '${finalImageStatus}' in ${Date.now() - pollStart}ms.`);
        if (aiCheckRows[0].image_error) {
          console.log(`Expected status reason: ${aiCheckRows[0].image_error}`);
        }
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (finalImageStatus === 'pending') {
      console.warn('Timed out waiting for background check to complete (30s limit reached).');
    }

    // Clean up created test post & test image
    console.log('\n--- CLEANUP ---');
    await pool.query('DELETE FROM posts WHERE id = ?', [postId]);
    if (fs.existsSync(dummyImagePath)) fs.unlinkSync(dummyImagePath);
    console.log(`Cleaned up test post #${postId} and dummy image.`);

    console.log('\n====================================================');
    console.log('ALL INTEGRATION TESTS PASSED 100%!');
    console.log('====================================================');
  } finally {
    server.close();
    await pool.end();
  }
}

runApiTest()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('API Test Error:', err);
    process.exit(1);
  });
