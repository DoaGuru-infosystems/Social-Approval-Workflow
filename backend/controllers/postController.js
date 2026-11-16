const pool = require('../config/db');
const aiService = require('../services/aiService');

/**
 * Helper to fetch latest revision and AI check for a post
 */
const attachLatestDetails = async (posts) => {
  if (!posts || posts.length === 0) return [];

  const postIds = posts.map((p) => p.id);
  const placeholders = postIds.map(() => '?').join(',');

  // Fetch latest revisions
  const [revisions] = await pool.query(
    `SELECT r.* FROM post_revisions r
     INNER JOIN (
       SELECT post_id, MAX(revision_number) AS max_rev
       FROM post_revisions
       WHERE post_id IN (${placeholders})
       GROUP BY post_id
     ) m ON r.post_id = m.post_id AND r.revision_number = m.max_rev`,
    postIds
  );

  // Fetch latest AI results
  const [aiChecks] = await pool.query(
    `SELECT a.* FROM ai_check_results a
     INNER JOIN (
       SELECT post_id, MAX(id) AS max_id
       FROM ai_check_results
       WHERE post_id IN (${placeholders})
       GROUP BY post_id
     ) m ON a.post_id = m.post_id AND a.id = m.max_id`,
    postIds
  );

  const revMap = new Map();
  revisions.forEach((r) => revMap.set(r.post_id, r));

  const aiMap = new Map();
  aiChecks.forEach((a) => {
    aiMap.set(a.post_id, {
      ...a,
      spelling_issues: typeof a.spelling_issues === 'string' ? JSON.parse(a.spelling_issues) : a.spelling_issues || [],
      ocr_issues: typeof a.ocr_issues === 'string' ? JSON.parse(a.ocr_issues) : a.ocr_issues || [],
      ocr_unreliable: Boolean(Number(a.ocr_unreliable)),
      banned_words_found: typeof a.banned_words_found === 'string' ? JSON.parse(a.banned_words_found) : a.banned_words_found || [],
      missing_mandatory_phrases: typeof a.missing_mandatory_phrases === 'string' ? JSON.parse(a.missing_mandatory_phrases) : a.missing_mandatory_phrases || [],
      brand_identity_check: typeof a.brand_identity_check === 'string' ? JSON.parse(a.brand_identity_check) : a.brand_identity_check || null,
    });
  });

  return posts.map((post) => ({
    ...post,
    latest_revision: revMap.get(post.id) || null,
    latest_ai_check: aiMap.get(post.id) || null,
  }));
};

/**
 * POST /api/posts
 * SMO creates a new post with required client_id, title, caption, and image
 */
const createPost = async (req, res) => {
  try {
    const { client_id, title, caption } = req.body;
    const imagePath = req.file ? `uploads/${req.file.filename}` : null;

    // 1. Validation: client_id
    if (!client_id) {
      return res.status(400).json({
        success: false,
        message: 'Client selection is required (client_id missing).',
      });
    }

    const [clients] = await pool.query('SELECT id, name, is_active FROM clients WHERE id = ?', [client_id]);
    if (clients.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Selected client does not exist.',
      });
    }

    if (!clients[0].is_active) {
      return res.status(400).json({
        success: false,
        message: 'Selected client is inactive. Cannot create posts for an inactive client.',
      });
    }

    const client = clients[0];

    // 2. Validation: title
    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Post title is required.',
      });
    }

    // 3. Validation: caption & image
    if (!caption && !imagePath) {
      return res.status(400).json({
        success: false,
        message: 'At least a caption or an image must be provided.',
      });
    }

    const cleanTitle = title.trim();
    const cleanCaption = caption ? caption.trim() : null;

    const aiResult = await aiService.runAiCheck({
      clientId: client.id,
      title: cleanTitle,
      caption: cleanCaption || '',
      imagePath: imagePath || null,
    });

    // Insert into posts table
    const [postResult] = await pool.query(
      `INSERT INTO posts (created_by, client_id, title, caption, image_path, status, recheck_count, manual_review_required)
       VALUES (?, ?, ?, ?, ?, 'ai_checking', 0, FALSE)`,
      [req.user.id, client.id, cleanTitle, cleanCaption, imagePath]
    );
    const postId = postResult.insertId;

    // Insert Revision 1
    const [revResult] = await pool.query(
      `INSERT INTO post_revisions (post_id, revision_number, title, caption, image_path)
       VALUES (?, 1, ?, ?, ?)`,
      [postId, cleanTitle, cleanCaption, imagePath]
    );
    const revisionId = revResult.insertId;

    // Save AI Check Result
    await pool.query(
      `INSERT INTO ai_check_results (
         post_id, revision_id, spelling_issues, ocr_extracted_text, ocr_issues, ocr_confidence, ocr_unreliable, banned_words_found, missing_mandatory_phrases, brand_identity_check
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        postId,
        revisionId,
        JSON.stringify(aiResult.spelling_issues),
        aiResult.ocr_extracted_text || null,
        JSON.stringify(aiResult.ocr_issues),
        aiResult.ocr_confidence,
        aiResult.ocr_unreliable,
        JSON.stringify(aiResult.banned_words_found),
        JSON.stringify(aiResult.missing_mandatory_phrases),
        JSON.stringify(aiResult.brand_identity_check || null),
      ]
    );

    // Fetch newly created post with client and user details
    const [createdPosts] = await pool.query(
      `SELECT p.*, c.name AS client_name, u.name AS smo_name 
       FROM posts p 
       JOIN clients c ON p.client_id = c.id
       JOIN users u ON p.created_by = u.id
       WHERE p.id = ?`,
      [postId]
    );

    return res.status(201).json({
      success: true,
      message: 'Post created and initial AI check completed.',
      post: createdPosts[0],
      revision: {
        id: revisionId,
        revision_number: 1,
        title: cleanTitle,
        caption: cleanCaption,
        image_path: imagePath,
      },
      ai_check: aiResult,
    });
  } catch (error) {
    console.error('Error creating post:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create post.',
      error: error.message,
    });
  }
};

/**
 * PUT /api/posts/:id/revise
 * SMO edits post in response to AI check results (Max 3 attempts)
 */
const revisePost = async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);

    const [posts] = await pool.query('SELECT * FROM posts WHERE id = ?', [postId]);
    if (posts.length === 0) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }

    const post = posts[0];

    // Ownership check
    if (post.created_by !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only revise your own posts.',
      });
    }

    // Finality checks
    if (post.status === 'rejected') {
      return res.status(400).json({
        success: false,
        message: 'This post has been rejected and closed. It cannot be revised further.',
      });
    }

    if (post.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'This post is already published and completed.',
      });
    }

    // Recheck limit check: max 3 attempts
    if (post.recheck_count >= 3 || post.manual_review_required) {
      return res.status(400).json({
        success: false,
        message: 'Manual review is required. This post cannot be edited further (maximum of 3 recheck attempts reached).',
        manual_review_required: true,
      });
    }

    const newTitle = req.body.title !== undefined ? req.body.title.trim() : post.title;
    const newCaption = req.body.caption !== undefined ? req.body.caption.trim() : post.caption;
    const newImagePath = req.file ? `uploads/${req.file.filename}` : post.image_path;

    const aiResult = await aiService.runAiCheck({
      clientId: post.client_id,
      title: newTitle,
      caption: newCaption || '',
      imagePath: newImagePath || null,
    });

    // Fetch current max revision number
    const [revRows] = await pool.query(
      'SELECT COALESCE(MAX(revision_number), 0) AS max_rev FROM post_revisions WHERE post_id = ?',
      [postId]
    );
    const nextRevisionNumber = revRows[0].max_rev + 1;

    // Insert new revision
    const [revResult] = await pool.query(
      `INSERT INTO post_revisions (post_id, revision_number, title, caption, image_path)
       VALUES (?, ?, ?, ?, ?)`,
      [postId, nextRevisionNumber, newTitle, newCaption, newImagePath]
    );
    const revisionId = revResult.insertId;

    // Increment recheck count
    const updatedRecheckCount = post.recheck_count + 1;
    const isManualReviewRequired = updatedRecheckCount >= 3;

    // Save AI Result
    await pool.query(
      `INSERT INTO ai_check_results (
         post_id, revision_id, spelling_issues, ocr_extracted_text, ocr_issues, ocr_confidence, ocr_unreliable, banned_words_found, missing_mandatory_phrases, brand_identity_check
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        postId,
        revisionId,
        JSON.stringify(aiResult.spelling_issues),
        aiResult.ocr_extracted_text || null,
        JSON.stringify(aiResult.ocr_issues),
        aiResult.ocr_confidence,
        aiResult.ocr_unreliable,
        JSON.stringify(aiResult.banned_words_found),
        JSON.stringify(aiResult.missing_mandatory_phrases),
        JSON.stringify(aiResult.brand_identity_check || null),
      ]
    );

    // Update Post
    await pool.query(
      `UPDATE posts
       SET title = ?, caption = ?, image_path = ?, recheck_count = ?, manual_review_required = ?, status = 'ai_checking'
       WHERE id = ?`,
      [newTitle, newCaption, newImagePath, updatedRecheckCount, isManualReviewRequired, postId]
    );

    const [updatedPosts] = await pool.query(
      `SELECT p.*, c.name AS client_name, u.name AS smo_name 
       FROM posts p 
       JOIN clients c ON p.client_id = c.id
       JOIN users u ON p.created_by = u.id
       WHERE p.id = ?`,
      [postId]
    );

    return res.status(200).json({
      success: true,
      message: isManualReviewRequired
        ? 'Revision saved. Max 3 rechecks reached: Manual review required flag set.'
        : `Revision ${nextRevisionNumber} saved and AI rechecked successfully.`,
      post: updatedPosts[0],
      revision: {
        id: revisionId,
        revision_number: nextRevisionNumber,
        title: newTitle,
        caption: newCaption,
        image_path: newImagePath,
      },
      ai_check: aiResult,
      manual_review_required: isManualReviewRequired,
    });
  } catch (error) {
    console.error('Error revising post:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to revise post.',
      error: error.message,
    });
  }
};

/**
 * POST /api/posts/:id/submit
 * SMO submits post for Manager review
 */
const submitPost = async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);

    const [posts] = await pool.query('SELECT * FROM posts WHERE id = ?', [postId]);
    if (posts.length === 0) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }

    const post = posts[0];

    // Ownership check
    if (post.created_by !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You can only submit your own posts.',
      });
    }

    // Rejection / Completion check
    if (post.status === 'rejected') {
      return res.status(400).json({
        success: false,
        message: 'This post has been rejected and closed. It cannot be submitted.',
      });
    }

    if (post.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'This post is already published and completed.',
      });
    }

    // Update status to pending_manager
    await pool.query("UPDATE posts SET status = 'pending_manager' WHERE id = ?", [postId]);

    const [updatedPosts] = await pool.query(
      `SELECT p.*, c.name AS client_name FROM posts p JOIN clients c ON p.client_id = c.id WHERE p.id = ?`,
      [postId]
    );

    return res.status(200).json({
      success: true,
      message: 'Post successfully submitted for Manager review.',
      post: updatedPosts[0],
    });
  } catch (error) {
    console.error('Error submitting post:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit post.',
      error: error.message,
    });
  }
};

/**
 * POST /api/posts/:id/manager-review
 * Manager approves, rejects, or requests changes
 */
const managerReview = async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    const { action, comment } = req.body;

    const validActions = ['approve', 'approved', 'reject', 'rejected', 'changes_requested'];
    if (!action || !validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        message: `Action must be one of: ['approve', 'reject', 'changes_requested']`,
      });
    }

    const [posts] = await pool.query('SELECT * FROM posts WHERE id = ?', [postId]);
    if (posts.length === 0) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }

    const post = posts[0];

    // Self-approval prevention rule
    if (post.created_by === req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You cannot review or approve your own post.',
      });
    }

    if (post.status !== 'pending_manager') {
      return res.status(400).json({
        success: false,
        message: `Post is not pending manager review (Current status: ${post.status}).`,
      });
    }

    let newStatus;
    let normalizedAction;

    if (action === 'approve' || action === 'approved') {
      newStatus = 'pending_admin';
      normalizedAction = 'approved';
    } else if (action === 'reject' || action === 'rejected') {
      newStatus = 'rejected';
      normalizedAction = 'rejected';
    } else {
      newStatus = 'changes_requested';
      normalizedAction = 'changes_requested';
    }

    const [revRows] = await pool.query(
      'SELECT id FROM post_revisions WHERE post_id = ? ORDER BY revision_number DESC LIMIT 1',
      [postId]
    );
    const revisionId = revRows.length > 0 ? revRows[0].id : null;

    await pool.query(
      `INSERT INTO post_approvals (post_id, revision_id, approver_id, role, action, comment)
       VALUES (?, ?, ?, 'manager', ?, ?)`,
      [postId, revisionId, req.user.id, normalizedAction, comment || null]
    );

    await pool.query('UPDATE posts SET status = ? WHERE id = ?', [newStatus, postId]);

    const [updatedPosts] = await pool.query(
      `SELECT p.*, c.name AS client_name FROM posts p JOIN clients c ON p.client_id = c.id WHERE p.id = ?`,
      [postId]
    );

    return res.status(200).json({
      success: true,
      message: `Manager review recorded: action '${normalizedAction}'. New status: '${newStatus}'.`,
      post: updatedPosts[0],
    });
  } catch (error) {
    console.error('Error during manager review:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process manager review.',
      error: error.message,
    });
  }
};

/**
 * POST /api/posts/:id/admin-review
 * Admin final review
 */
const adminReview = async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    const { action, comment } = req.body;

    const validActions = ['approve', 'approved', 'reject', 'rejected', 'changes_requested'];
    if (!action || !validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        message: `Action must be one of: ['approve', 'reject', 'changes_requested']`,
      });
    }

    const [posts] = await pool.query('SELECT * FROM posts WHERE id = ?', [postId]);
    if (posts.length === 0) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }

    const post = posts[0];

    // Self-approval prevention
    if (post.created_by === req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You cannot final-approve your own post.',
      });
    }

    if (post.status !== 'pending_admin') {
      return res.status(400).json({
        success: false,
        message: `Post is not pending admin review (Current status: ${post.status}).`,
      });
    }

    let newStatus;
    let normalizedAction;

    if (action === 'approve' || action === 'approved') {
      newStatus = 'admin_approved';
      normalizedAction = 'approved';
    } else if (action === 'reject' || action === 'rejected') {
      newStatus = 'rejected';
      normalizedAction = 'rejected';
    } else {
      newStatus = 'changes_requested';
      normalizedAction = 'changes_requested';
    }

    const [revRows] = await pool.query(
      'SELECT id FROM post_revisions WHERE post_id = ? ORDER BY revision_number DESC LIMIT 1',
      [postId]
    );
    const revisionId = revRows.length > 0 ? revRows[0].id : null;

    await pool.query(
      `INSERT INTO post_approvals (post_id, revision_id, approver_id, role, action, comment)
       VALUES (?, ?, ?, 'admin', ?, ?)`,
      [postId, revisionId, req.user.id, normalizedAction, comment || null]
    );

    await pool.query('UPDATE posts SET status = ? WHERE id = ?', [newStatus, postId]);

    const [updatedPosts] = await pool.query(
      `SELECT p.*, c.name AS client_name FROM posts p JOIN clients c ON p.client_id = c.id WHERE p.id = ?`,
      [postId]
    );

    return res.status(200).json({
      success: true,
      message: `Admin review recorded: action '${normalizedAction}'. New status: '${newStatus}'.`,
      post: updatedPosts[0],
    });
  } catch (error) {
    console.error('Error during admin review:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process admin review.',
      error: error.message,
    });
  }
};

/**
 * PUT /api/posts/:id/platform
 * Select destination platform ('instagram' / 'facebook')
 * ONLY allowed if status is 'admin_approved' AND client has a connected account for that platform!
 */
const selectPlatform = async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    const { platform } = req.body;

    const allowedPlatforms = ['instagram', 'facebook'];
    if (!platform || !allowedPlatforms.includes(platform)) {
      return res.status(400).json({
        success: false,
        message: `Platform must be either 'instagram' or 'facebook'.`,
      });
    }

    const [posts] = await pool.query('SELECT * FROM posts WHERE id = ?', [postId]);
    if (posts.length === 0) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }

    const post = posts[0];

    // Must be admin_approved
    if (post.status !== 'admin_approved') {
      return res.status(400).json({
        success: false,
        message: 'Admin approval is required first (current status: ' + post.status + ').',
      });
    }

    // Verify client has connected social account for this platform
    const [socialAccounts] = await pool.query(
      'SELECT id, account_name FROM social_accounts WHERE client_id = ? AND platform = ? AND is_active = TRUE',
      [post.client_id, platform]
    );

    if (socialAccounts.length === 0) {
      return res.status(400).json({
        success: false,
        message: `This client has no connected ${platform.toUpperCase()} account. Ask an Admin to connect one first.`,
      });
    }

    // Update platform and set status to ready_to_publish
    await pool.query(
      "UPDATE posts SET platform = ?, status = 'ready_to_publish' WHERE id = ?",
      [platform, postId]
    );

    const [updatedPosts] = await pool.query(
      `SELECT p.*, c.name AS client_name FROM posts p JOIN clients c ON p.client_id = c.id WHERE p.id = ?`,
      [postId]
    );

    return res.status(200).json({
      success: true,
      message: `Platform '${platform}' (${socialAccounts[0].account_name}) selected. Post is now 'ready_to_publish'.`,
      post: updatedPosts[0],
    });
  } catch (error) {
    console.error('Error selecting platform:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to select platform.',
      error: error.message,
    });
  }
};

/**
 * PUT /api/posts/:id/publish-url
 * Record live manual publish URL and mark post completed
 */
const updatePublishUrl = async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    const { manual_publish_url } = req.body;

    if (!manual_publish_url || typeof manual_publish_url !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid manual_publish_url.',
      });
    }

    const [posts] = await pool.query('SELECT * FROM posts WHERE id = ?', [postId]);
    if (posts.length === 0) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }

    const post = posts[0];

    if (post.status !== 'ready_to_publish' && post.status !== 'admin_approved') {
      return res.status(400).json({
        success: false,
        message: `Cannot publish post in '${post.status}' status. Post must be approved and platform selected first.`,
      });
    }

    await pool.query(
      "UPDATE posts SET manual_publish_url = ?, status = 'completed' WHERE id = ?",
      [manual_publish_url.trim(), postId]
    );

    const [updatedPosts] = await pool.query(
      `SELECT p.*, c.name AS client_name FROM posts p JOIN clients c ON p.client_id = c.id WHERE p.id = ?`,
      [postId]
    );

    return res.status(200).json({
      success: true,
      message: 'Post live URL recorded. Workflow completed successfully!',
      post: updatedPosts[0],
    });
  } catch (error) {
    console.error('Error updating publish URL:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update publish URL.',
      error: error.message,
    });
  }
};

/**
 * GET /api/posts
 * Role-based filtered list of posts with latest revision + latest AI report + client details
 */
const getPosts = async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    const { all, client_id } = req.query;

    let query = `
      SELECT p.*, 
             c.name AS client_name, 
             c.is_active AS client_is_active,
             u.name AS smo_name, 
             u.email AS smo_email, 
             u.name AS creator_name, 
             u.email AS creator_email
      FROM posts p
      JOIN clients c ON p.client_id = c.id
      JOIN users u ON p.created_by = u.id
    `;
    const params = [];
    const whereClauses = [];

    if (client_id) {
      whereClauses.push('p.client_id = ?');
      params.push(client_id);
    }

    if (role === 'smo') {
      whereClauses.push('p.created_by = ?');
      params.push(userId);
    } else if (role === 'manager') {
      if (all !== 'true') {
        whereClauses.push("p.status = 'pending_manager'");
      }
    } else if (role === 'admin') {
      if (all !== 'true') {
        whereClauses.push("p.status = 'pending_admin'");
      }
    }

    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ');
    }

    query += ' ORDER BY p.created_at DESC';

    const [posts] = await pool.query(query, params);
    const enrichedPosts = await attachLatestDetails(posts);

    return res.status(200).json({
      success: true,
      count: enrichedPosts.length,
      posts: enrichedPosts,
    });
  } catch (error) {
    console.error('Error fetching posts:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve posts.',
      error: error.message,
    });
  }
};

/**
 * GET /api/posts/:id
 * Full detail with client, revisions, AI reports, and approvals
 */
const getPostById = async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);

    const [postRows] = await pool.query(
      `SELECT p.*, 
              c.name AS client_name, 
              c.is_active AS client_is_active,
              u.name AS creator_name, 
              u.email AS creator_email
       FROM posts p
       JOIN clients c ON p.client_id = c.id
       JOIN users u ON p.created_by = u.id
       WHERE p.id = ?`,
      [postId]
    );

    if (postRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }

    const post = postRows[0];

    const [revisions] = await pool.query(
      'SELECT * FROM post_revisions WHERE post_id = ? ORDER BY revision_number ASC',
      [postId]
    );

    const [aiReports] = await pool.query(
      'SELECT * FROM ai_check_results WHERE post_id = ? ORDER BY created_at ASC',
      [postId]
    );

    const parsedAiReports = aiReports.map((r) => ({
      ...r,
      spelling_issues: typeof r.spelling_issues === 'string' ? JSON.parse(r.spelling_issues) : r.spelling_issues || [],
      ocr_issues: typeof r.ocr_issues === 'string' ? JSON.parse(r.ocr_issues) : r.ocr_issues || [],
      ocr_unreliable: Boolean(Number(r.ocr_unreliable)),
      banned_words_found: typeof r.banned_words_found === 'string' ? JSON.parse(r.banned_words_found) : r.banned_words_found || [],
      missing_mandatory_phrases: typeof r.missing_mandatory_phrases === 'string' ? JSON.parse(r.missing_mandatory_phrases) : r.missing_mandatory_phrases || [],
    }));

    const [approvals] = await pool.query(
      `SELECT pa.*, u.name AS approver_name, u.email AS approver_email
       FROM post_approvals pa
       JOIN users u ON pa.approver_id = u.id
       WHERE pa.post_id = ?
       ORDER BY pa.created_at ASC`,
      [postId]
    );

    return res.status(200).json({
      success: true,
      post: {
        ...post,
        creator: {
          id: post.created_by,
          name: post.creator_name,
          email: post.creator_email,
        },
      },
      revisions,
      ai_reports: parsedAiReports,
      approvals,
    });
  } catch (error) {
    console.error('Error fetching post details:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve post details.',
      error: error.message,
    });
  }
};

module.exports = {
  createPost,
  revisePost,
  submitPost,
  managerReview,
  adminReview,
  selectPlatform,
  updatePublishUrl,
  getPosts,
  getPostById,
};
