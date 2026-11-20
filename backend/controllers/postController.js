const fs = require('fs');
const path = require('path');
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
      grammar_suggestions: typeof a.grammar_suggestions === 'string' ? JSON.parse(a.grammar_suggestions) : a.grammar_suggestions || [],
      key_error: typeof a.key_error === 'string' ? JSON.parse(a.key_error) : a.key_error || null,
      ocr_issues: typeof a.ocr_issues === 'string' ? JSON.parse(a.ocr_issues) : a.ocr_issues || [],
      ocr_unreliable: Boolean(Number(a.ocr_unreliable)),
      banned_words_found: typeof a.banned_words_found === 'string' ? JSON.parse(a.banned_words_found) : a.banned_words_found || [],
      missing_mandatory_phrases: typeof a.missing_mandatory_phrases === 'string' ? JSON.parse(a.missing_mandatory_phrases) : a.missing_mandatory_phrases || [],
      brand_identity_check: typeof a.brand_identity_check === 'string' ? JSON.parse(a.brand_identity_check) : a.brand_identity_check || null,
      image_status: a.image_status || 'completed',
      text_status: a.text_status || 'completed',
      image_error: a.image_error || null,
    });
  });

  return posts.map((post) => ({
    ...post,
    latest_revision: revMap.get(post.id) || null,
    latest_ai_check: aiMap.get(post.id) || null,
  }));
};

/**
 * Background worker for asynchronous Image Quality & Brand Rules Check.
 */
const executeBackgroundImageCheck = async ({
  postId,
  revisionId,
  clientId,
  imagePath,
  caption,
  textResult,
}) => {
  try {
    const imageResult = await aiService.runImageCheck({
      clientId,
      imagePath,
      caption: caption || '',
    });

    const combinedResult = aiService.mergeAiCheckResults(textResult, imageResult);

    await pool.query(
      `UPDATE ai_check_results
       SET spelling_issues = ?,
           grammar_suggestions = ?,
           key_error = ?,
           ocr_extracted_text = ?,
           ocr_issues = ?,
           ocr_confidence = ?,
           ocr_unreliable = ?,
           image_status = ?,
           text_status = 'completed',
           image_error = ?,
           banned_words_found = ?,
           missing_mandatory_phrases = ?,
           brand_identity_check = ?,
           logo_check = ?,
           ai_provider = ?,
           fallback_used = ?,
           fallback_reason = ?
       WHERE post_id = ? AND revision_id = ?`,
      [
        JSON.stringify(combinedResult.spelling_issues),
        JSON.stringify(combinedResult.grammar_suggestions || []),
        JSON.stringify(combinedResult.key_error || null),
        combinedResult.ocr_extracted_text || null,
        JSON.stringify(combinedResult.ocr_issues || []),
        combinedResult.ocr_confidence,
        combinedResult.ocr_unreliable,
        imageResult.image_status,
        imageResult.image_error || null,
        JSON.stringify(combinedResult.banned_words_found),
        JSON.stringify(combinedResult.missing_mandatory_phrases),
        JSON.stringify(combinedResult.brand_identity_check || null),
        JSON.stringify(combinedResult.logo_check || null),
        combinedResult.ai_provider || 'gemini',
        combinedResult.fallback_used ? 1 : 0,
        combinedResult.fallback_reason || 'none',
        postId,
        revisionId,
      ]
    );
  } catch (err) {
    console.error(`Background image check error for post ${postId}:`, err);
    await pool.query(
      `UPDATE ai_check_results
       SET image_status = 'failed',
           image_error = ?
       WHERE post_id = ? AND revision_id = ?`,
      [err.message || 'Image processing failed', postId, revisionId]
    );
  }
};

/**
 * POST /api/posts
 * SMO creates a new post with required client_id, title, caption, and image.
 * Runs Node.js text check immediately (<1-2s) and kicks off Remote OCR in background.
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

    // 4. Fast Text Check (Title + Caption) in Node.js (<100ms)
    const textResult = await aiService.runTextCheck({
      clientId: client.id,
      title: cleanTitle,
      caption: cleanCaption || '',
    });

    const hasImage = Boolean(imagePath);
    const initialImageStatus = hasImage ? 'pending' : 'not_applicable';

    // Merged initial report for immediate frontend rendering
    const initialAiCheck = aiService.mergeAiCheckResults(textResult, {
      image_status: initialImageStatus,
      ocr_extracted_text: '',
      ocr_confidence: 0,
      ocr_confidence_avg: 0,
      ocr_reliable: true,
      ocr_unreliable: false,
      spelling_issues: [],
      noise_tokens: [],
      banned_words_found: [],
      brand_identity_check: null,
      logo_check: null,
      ai_provider: 'gemini',
      fallback_used: false,
      fallback_reason: 'none',
    });

    // 5. Insert into posts table
    const [postResult] = await pool.query(
      `INSERT INTO posts (created_by, client_id, title, caption, image_path, status, recheck_count, manual_review_required)
       VALUES (?, ?, ?, ?, ?, 'ai_checking', 0, FALSE)`,
      [req.user.id, client.id, cleanTitle, cleanCaption, imagePath]
    );
    const postId = postResult.insertId;

    // 6. Insert Revision 1
    const [revResult] = await pool.query(
      `INSERT INTO post_revisions (post_id, revision_number, title, caption, image_path)
       VALUES (?, 1, ?, ?, ?)`,
      [postId, cleanTitle, cleanCaption, imagePath]
    );
    const revisionId = revResult.insertId;

    // 7. Save initial AI Check Result
    await pool.query(
      `INSERT INTO ai_check_results (
         post_id, revision_id, spelling_issues, grammar_suggestions, key_error, ocr_extracted_text, ocr_issues, ocr_confidence, ocr_unreliable,
         image_status, text_status, image_error, banned_words_found, missing_mandatory_phrases, brand_identity_check, logo_check, ai_provider, fallback_used, fallback_reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        postId,
        revisionId,
        JSON.stringify(initialAiCheck.spelling_issues),
        JSON.stringify(initialAiCheck.grammar_suggestions || []),
        JSON.stringify(initialAiCheck.key_error || null),
        null,
        JSON.stringify([]),
        0.0,
        false,
        initialImageStatus,
        'completed',
        null,
        JSON.stringify(initialAiCheck.banned_words_found),
        JSON.stringify(initialAiCheck.missing_mandatory_phrases),
        JSON.stringify(initialAiCheck.brand_identity_check || null),
        JSON.stringify(initialAiCheck.logo_check || null),
        initialAiCheck.ai_provider || 'gemini',
        initialAiCheck.fallback_used ? 1 : 0,
        initialAiCheck.fallback_reason || 'none',
      ]
    );
    

    // 8. If image exists, kick off background image check immediately (non-blocking)
    if (hasImage) {
      setImmediate(() => {
        executeBackgroundImageCheck({
          postId,
          revisionId,
          clientId: client.id,
          imagePath,
          caption: cleanCaption || '',
          textResult,
        });
      });
    }

    // 9. Fetch newly created post with client and user details
    const [createdPosts] = await pool.query(
      `SELECT p.*, c.name AS client_name, u.name AS smo_name 
       FROM posts p 
       JOIN clients c ON p.client_id = c.id
       JOIN users u ON p.created_by = u.id
       WHERE p.id = ?`,
      [postId]
    );

    const createdPost = {
      ...createdPosts[0],
      latest_revision: {
        id: revisionId,
        revision_number: 1,
        title: cleanTitle,
        caption: cleanCaption,
        image_path: imagePath,
      },
      latest_ai_check: {
        ...initialAiCheck,
        image_status: initialImageStatus,
        text_status: 'completed',
        image_error: null,
      },
    };

    return res.status(201).json({
      success: true,
      message: hasImage
        ? 'Post created. Text check completed; image check running in background.'
        : 'Post created and AI check completed.',
      post: createdPost,
      revision: createdPost.latest_revision,
      text_result: textResult,
      image_status: initialImageStatus,
      poll_url: `/api/posts/${postId}/ai-status`,
      ai_check: createdPost.latest_ai_check,
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

    // Fast Node.js Text Check
    const textResult = await aiService.runTextCheck({
      clientId: post.client_id,
      title: newTitle,
      caption: newCaption || '',
    });

    const hasImage = Boolean(newImagePath);
    const initialImageStatus = hasImage ? 'pending' : 'not_applicable';

    const initialAiCheck = aiService.mergeAiCheckResults(textResult, {
      image_status: initialImageStatus,
      ocr_extracted_text: '',
      ocr_confidence: 0,
      ocr_confidence_avg: 0,
      ocr_reliable: true,
      ocr_unreliable: false,
      spelling_issues: [],
      noise_tokens: [],
      banned_words_found: [],
      brand_identity_check: null,
      logo_check: null,
      ai_provider: 'gemini',
      fallback_used: false,
      fallback_reason: 'none',
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

    // Save initial AI Result
    await pool.query(
      `INSERT INTO ai_check_results (
         post_id, revision_id, spelling_issues, grammar_suggestions, key_error, ocr_extracted_text, ocr_issues, ocr_confidence, ocr_unreliable,
         image_status, text_status, image_error, banned_words_found, missing_mandatory_phrases, brand_identity_check, logo_check, ai_provider, fallback_used, fallback_reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        postId,
        revisionId,
        JSON.stringify(initialAiCheck.spelling_issues),
        JSON.stringify(initialAiCheck.grammar_suggestions || []),
        JSON.stringify(initialAiCheck.key_error || null),
        null,
        JSON.stringify([]),
        0.0,
        false,
        initialImageStatus,
        'completed',
        null,
        JSON.stringify(initialAiCheck.banned_words_found),
        JSON.stringify(initialAiCheck.missing_mandatory_phrases),
        JSON.stringify(initialAiCheck.brand_identity_check || null),
        JSON.stringify(initialAiCheck.logo_check || null),
        initialAiCheck.ai_provider || 'gemini',
        initialAiCheck.fallback_used ? 1 : 0,
        initialAiCheck.fallback_reason || 'none',
      ]
    );

    // If image exists, run background image check asynchronously
    if (hasImage) {
      setImmediate(() => {
        executeBackgroundImageCheck({
          postId,
          revisionId,
          clientId: post.client_id,
          imagePath: newImagePath,
          caption: newCaption || '',
          textResult,
        });
      });
    }

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

    const updatedPost = {
      ...updatedPosts[0],
      latest_revision: {
        id: revisionId,
        revision_number: nextRevisionNumber,
        title: newTitle,
        caption: newCaption,
        image_path: newImagePath,
      },
      latest_ai_check: {
        ...initialAiCheck,
        image_status: initialImageStatus,
        text_status: 'completed',
        image_error: null,
      },
    };

    return res.status(200).json({
      success: true,
      message: isManualReviewRequired
        ? 'Revision saved. Max 3 rechecks reached: Manual review required flag set.'
        : `Revision ${nextRevisionNumber} saved. Text check completed; image check running in background.`,
      post: updatedPost,
      revision: updatedPost.latest_revision,
      text_result: textResult,
      image_status: initialImageStatus,
      poll_url: `/api/posts/${postId}/ai-status`,
      ai_check: updatedPost.latest_ai_check,
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
    const { platform, target_platforms } = req.body;

    const allowedPlatforms = ['instagram', 'facebook', 'youtube', 'linkedin'];
    if (!platform || !allowedPlatforms.includes(platform)) {
      return res.status(400).json({
        success: false,
        message: `Platform must be one of: ${allowedPlatforms.join(', ')}.`,
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
      `SELECT id, platform_username AS account_name FROM client_social_accounts 
       WHERE client_id = ? AND platform = ? AND is_connected = TRUE
       UNION
       SELECT id, account_name FROM social_accounts 
       WHERE client_id = ? AND platform = ? AND is_active = TRUE`,
      [post.client_id, platform, post.client_id, platform]
    );

    if (socialAccounts.length === 0) {
      return res.status(400).json({
        success: false,
        message: `This client has no connected ${platform.toUpperCase()} account. Ask an Admin or SMO to connect one first.`,
      });
    }

    const targetsJson = target_platforms && Array.isArray(target_platforms) ? JSON.stringify(target_platforms) : JSON.stringify([platform]);

    // Update platform and set status to ready_to_publish
    await pool.query(
      "UPDATE posts SET platform = ?, target_platforms = ?, status = 'ready_to_publish' WHERE id = ?",
      [platform, targetsJson, postId]
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
 * POST /api/posts/:id/publish-now
 * Immediately publish post to target platforms
 */
const publishNow = async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    const { target_platforms } = req.body;

    const [posts] = await pool.query('SELECT * FROM posts WHERE id = ?', [postId]);
    if (posts.length === 0) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }

    const post = posts[0];
    if (
      post.status !== 'admin_approved' &&
      post.status !== 'ready_to_publish' &&
      post.status !== 'scheduled' &&
      post.status !== 'failed'
    ) {
      return res.status(400).json({
        success: false,
        message: `Post must be approved first (current status: ${post.status}).`,
      });
    }

    if (target_platforms && Array.isArray(target_platforms)) {
      await pool.query('UPDATE posts SET target_platforms = ? WHERE id = ?', [
        JSON.stringify(target_platforms),
        postId,
      ]);
    }

    const publishService = require('../services/publishService');
    const result = await publishService.publishPost(postId);

    const [updatedPosts] = await pool.query(
      `SELECT p.*, c.name AS client_name FROM posts p JOIN clients c ON p.client_id = c.id WHERE p.id = ?`,
      [postId]
    );

    return res.status(200).json({
      success: result.success,
      message: result.success ? 'Post published successfully!' : 'Publish completed with warnings/failures.',
      status: result.status,
      results: result.results,
      post: updatedPosts[0],
    });
  } catch (error) {
    console.error('Error publishing post:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to publish post.',
      error: error.message,
    });
  }
};

/**
 * POST /api/posts/:id/schedule
 * Schedule post to be published at scheduled_at
 */
const schedulePost = async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    const { scheduled_at, target_platforms } = req.body;

    if (!scheduled_at) {
      return res.status(400).json({
        success: false,
        message: 'scheduled_at datetime is required.',
      });
    }

    const [posts] = await pool.query('SELECT * FROM posts WHERE id = ?', [postId]);
    if (posts.length === 0) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }

    const post = posts[0];
    if (
      post.status !== 'admin_approved' &&
      post.status !== 'ready_to_publish' &&
      post.status !== 'scheduled'
    ) {
      return res.status(400).json({
        success: false,
        message: `Post must be approved first (current status: ${post.status}).`,
      });
    }

    const cleanTargets = Array.isArray(target_platforms) && target_platforms.length > 0
      ? target_platforms
      : [post.platform || 'instagram'];

    await pool.query(
      "UPDATE posts SET scheduled_at = ?, target_platforms = ?, status = 'scheduled' WHERE id = ?",
      [new Date(scheduled_at), JSON.stringify(cleanTargets), postId]
    );

    const [updatedPosts] = await pool.query(
      `SELECT p.*, c.name AS client_name FROM posts p JOIN clients c ON p.client_id = c.id WHERE p.id = ?`,
      [postId]
    );

    return res.status(200).json({
      success: true,
      message: `Post scheduled successfully for ${scheduled_at}.`,
      post: updatedPosts[0],
    });
  } catch (error) {
    console.error('Error scheduling post:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to schedule post.',
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
      grammar_suggestions: typeof r.grammar_suggestions === 'string' ? JSON.parse(r.grammar_suggestions) : r.grammar_suggestions || [],
      key_error: typeof r.key_error === 'string' ? JSON.parse(r.key_error) : r.key_error || null,
      ocr_issues: typeof r.ocr_issues === 'string' ? JSON.parse(r.ocr_issues) : r.ocr_issues || [],
      ocr_unreliable: Boolean(Number(r.ocr_unreliable)),
      banned_words_found: typeof r.banned_words_found === 'string' ? JSON.parse(r.banned_words_found) : r.banned_words_found || [],
      missing_mandatory_phrases: typeof r.missing_mandatory_phrases === 'string' ? JSON.parse(r.missing_mandatory_phrases) : r.missing_mandatory_phrases || [],
      brand_identity_check: typeof r.brand_identity_check === 'string' ? JSON.parse(r.brand_identity_check) : r.brand_identity_check || null,
      image_status: r.image_status || 'completed',
      text_status: r.text_status || 'completed',
      image_error: r.image_error || null,
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

/**
 * GET /api/posts/:id/ai-status
 * Status polling endpoint for background AI checks
 */
const getAiStatus = async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    if (!postId || isNaN(postId)) {
      return res.status(400).json({ success: false, message: 'Invalid post ID.' });
    }

    const [posts] = await pool.query('SELECT * FROM posts WHERE id = ?', [postId]);
    if (posts.length === 0) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }

    const [aiRows] = await pool.query(
      'SELECT * FROM ai_check_results WHERE post_id = ? ORDER BY id DESC LIMIT 1',
      [postId]
    );

    if (aiRows.length === 0) {
      return res.json({
        success: true,
        post_id: postId,
        text_status: 'completed',
        image_status: 'not_applicable',
        image_error: null,
        combined_ai_check: null,
      });
    }

    const ai = aiRows[0];
    const spellingIssues = typeof ai.spelling_issues === 'string' ? JSON.parse(ai.spelling_issues) : (ai.spelling_issues || []);
    const grammarSuggestions = typeof ai.grammar_suggestions === 'string' ? JSON.parse(ai.grammar_suggestions) : (ai.grammar_suggestions || []);
    const keyError = typeof ai.key_error === 'string' ? JSON.parse(ai.key_error) : (ai.key_error || null);
    const ocrIssues = typeof ai.ocr_issues === 'string' ? JSON.parse(ai.ocr_issues) : (ai.ocr_issues || []);
    const bannedWords = typeof ai.banned_words_found === 'string' ? JSON.parse(ai.banned_words_found) : (ai.banned_words_found || []);
    const missingMandatory = typeof ai.missing_mandatory_phrases === 'string' ? JSON.parse(ai.missing_mandatory_phrases) : (ai.missing_mandatory_phrases || []);
    const brandIdentity = typeof ai.brand_identity_check === 'string' ? JSON.parse(ai.brand_identity_check) : (ai.brand_identity_check || null);
    const logoCheck = typeof ai.logo_check === 'string' ? JSON.parse(ai.logo_check) : (ai.logo_check || null);
    const aiProvider = ai.ai_provider || 'gemini';
    const fallbackUsed = Boolean(Number(ai.fallback_used));
    const fallbackReason = ai.fallback_reason || 'none';
    const hasLogoError = Boolean(logoCheck && logoCheck.status === 'FAIL');

    const imageStatus = ai.image_status || 'completed';
    const textStatus = ai.text_status || 'completed';
    const isImageCompleted = imageStatus === 'completed';
    const isImagePending = imageStatus === 'pending';
    const isImageFailed = imageStatus === 'failed';
    const ocrUnreliable = Boolean(Number(ai.ocr_unreliable));

    const combinedAiCheck = {
      passed:
        (imageStatus === 'not_applicable' || (isImageCompleted && !ocrUnreliable)) &&
        spellingIssues.length === 0 &&
        bannedWords.length === 0 &&
        missingMandatory.length === 0 &&
        !hasLogoError &&
        !brandIdentity?.possible_brand_name_error &&
        !(brandIdentity?.phone_verification || []).some((p) => p.status === 'mismatch_warning' || p.status === 'unknown_phone'),
      spelling_issues: spellingIssues,
      grammar_suggestions: grammarSuggestions,
      key_error: keyError,
      ocr_extracted_text: ai.ocr_extracted_text || '',
      ocr_issues: ocrIssues,
      ocr_confidence: Number(ai.ocr_confidence) || 0,
      ocr_unreliable: ocrUnreliable,
      ocr_reliable: !ocrUnreliable,
      image_status: imageStatus,
      text_status: textStatus,
      image_error: ai.image_error || null,
      banned_words_found: bannedWords,
      missing_mandatory_phrases: missingMandatory,
      brand_identity_check: brandIdentity,
      logo_check: logoCheck,
      ai_provider: aiProvider,
      fallback_used: fallbackUsed,
      fallback_reason: fallbackReason,
    };

    return res.json({
      success: true,
      post_id: postId,
      text_status: textStatus,
      image_status: imageStatus,
      image_error: ai.image_error || null,
      ocr_extracted_text: ai.ocr_extracted_text || '',
      ocr_confidence: Number(ai.ocr_confidence) || 0,
      ocr_unreliable: ocrUnreliable,
      spelling_issues: spellingIssues,
      ocr_issues: ocrIssues,
      ocr_doubts: Array.isArray(ocrIssues) ? ocrIssues.filter((b) => b.status === 'yellow') : [],
      banned_words_found: bannedWords,
      missing_mandatory_phrases: missingMandatory,
      brand_identity_check: brandIdentity,
      logo_check: logoCheck,
      ai_provider: aiProvider,
      fallback_used: fallbackUsed,
      fallback_reason: fallbackReason,
      combined_ai_check: combinedAiCheck,
    });
  } catch (error) {
    console.error('Error fetching AI status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve AI check status.',
      error: error.message,
    });
  }
};

/**
 * POST /api/posts/:id/check-image
 * Retry / re-run only image check asynchronously
 */
const checkImage = async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    const [posts] = await pool.query('SELECT * FROM posts WHERE id = ?', [postId]);
    if (posts.length === 0) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }
    const post = posts[0];

    // Fetch latest revision
    const [revs] = await pool.query(
      'SELECT * FROM post_revisions WHERE post_id = ? ORDER BY revision_number DESC LIMIT 1',
      [postId]
    );
    const revision = revs.length > 0 ? revs[0] : null;
    const targetImagePath = revision?.image_path || post.image_path;
    const targetCaption = revision?.caption || post.caption || '';
    const targetTitle = revision?.title || post.title || '';

    if (!targetImagePath) {
      return res.status(400).json({ success: false, message: 'This post does not have an image to check.' });
    }

    // Set image_status to 'pending' in latest ai_check_results row
    const [aiRows] = await pool.query(
      'SELECT id, revision_id FROM ai_check_results WHERE post_id = ? ORDER BY id DESC LIMIT 1',
      [postId]
    );

    if (aiRows.length > 0) {
      await pool.query(
        'UPDATE ai_check_results SET image_status = ?, image_error = NULL WHERE id = ?',
        ['pending', aiRows[0].id]
      );
    }

    // Get current text check
    const textResult = await aiService.runTextCheck({
      clientId: post.client_id,
      title: targetTitle,
      caption: targetCaption,
    });

    // Spawn background image check
    setImmediate(() => {
      executeBackgroundImageCheck({
        postId,
        revisionId: revision ? revision.id : (aiRows[0]?.revision_id || 0),
        clientId: post.client_id,
        imagePath: targetImagePath,
        caption: targetCaption,
        textResult,
      });
    });

    return res.json({
      success: true,
      message: 'Image check restarted in background.',
      image_status: 'pending',
      poll_url: `/api/posts/${postId}/ai-status`,
    });
  } catch (error) {
    console.error('Error restarting image check:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to restart image check.',
      error: error.message,
    });
  }
};

/**
 * POST /api/posts/:id/check-text
 * Re-run text check on demand
 */
const checkText = async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    const [posts] = await pool.query('SELECT * FROM posts WHERE id = ?', [postId]);
    if (posts.length === 0) {
      return res.status(404).json({ success: false, message: 'Post not found.' });
    }
    const post = posts[0];

    const [revs] = await pool.query(
      'SELECT * FROM post_revisions WHERE post_id = ? ORDER BY revision_number DESC LIMIT 1',
      [postId]
    );
    const revision = revs.length > 0 ? revs[0] : null;
    const targetTitle = revision?.title || post.title || '';
    const targetCaption = revision?.caption || post.caption || '';

    const textResult = await aiService.runTextCheck({
      clientId: post.client_id,
      title: targetTitle,
      caption: targetCaption,
    });

    // Update latest ai_check_results with updated text results
    const [aiRows] = await pool.query(
      'SELECT id FROM ai_check_results WHERE post_id = ? ORDER BY id DESC LIMIT 1',
      [postId]
    );
    if (aiRows.length > 0) {
      await pool.query(
        `UPDATE ai_check_results 
         SET spelling_issues = ?, banned_words_found = ?, missing_mandatory_phrases = ?, text_status = 'completed'
         WHERE id = ?`,
        [
          JSON.stringify(textResult.spelling_issues),
          JSON.stringify(textResult.banned_words_found),
          JSON.stringify(textResult.missing_mandatory_phrases),
          aiRows[0].id,
        ]
      );
    }

    return res.json({
      success: true,
      message: 'Text check re-run successfully.',
      text_status: 'completed',
      text_result: textResult,
    });
  } catch (error) {
    console.error('Error running text check:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to execute text check.',
      error: error.message,
    });
  }
};

/**
 * DELETE /api/posts/:id
 * Delete post, cascade AI results/revisions, and remove disk images
 */
const deletePost = async (req, res) => {
  try {
    const postId = req.params.id;

    // 1. Fetch post
    const [posts] = await pool.query('SELECT * FROM posts WHERE id = ?', [postId]);
    if (posts.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Post not found.',
      });
    }

    const post = posts[0];

    // 2. Collect image paths to delete
    const [revisions] = await pool.query(
      'SELECT image_path FROM post_revisions WHERE post_id = ?',
      [postId]
    );

    const filesToDelete = new Set();
    if (post.image_path) filesToDelete.add(post.image_path);
    revisions.forEach((r) => {
      if (r.image_path) filesToDelete.add(r.image_path);
    });

    // 3. Delete post from DB (Foreign keys cascade to ai_check_results, post_revisions, post_approvals)
    await pool.query('DELETE FROM posts WHERE id = ?', [postId]);

    // 4. Safely delete image files from backend/uploads
    filesToDelete.forEach((relPath) => {
      try {
        const fullPath = path.resolve(__dirname, '..', relPath.replace(/^[/\\]+/, ''));
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      } catch (fileErr) {
        console.warn(`Failed to unlink file ${relPath}:`, fileErr.message);
      }
    });

    return res.status(200).json({
      success: true,
      message: `Post #${postId} deleted successfully.`,
      deleted_post_id: Number(postId),
    });
  } catch (error) {
    console.error('Error deleting post:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete post.',
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
  publishNow,
  schedulePost,
  updatePublishUrl,
  getPosts,
  getPostById,
  getAiStatus,
  checkImage,
  checkText,
  deletePost,
};
