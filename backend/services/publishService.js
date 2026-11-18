const pool = require('../config/db');
const metaService = require('./metaService');
const youtubeService = require('./youtubeService');
const linkedinService = require('./linkedinService');
const tokenRefreshService = require('./tokenRefreshService');

/**
 * Publish a post to its target platforms.
 * Handles single or multi-platform publishing with isolation:
 * Failure on one platform does not abort the others.
 *
 * @param {number} postId
 * @returns {Promise<{ success: boolean, status: string, results: Array }>}
 */
const publishPost = async (postId) => {
  const [posts] = await pool.query('SELECT * FROM posts WHERE id = ?', [postId]);
  if (posts.length === 0) {
    throw new Error(`Post ${postId} not found.`);
  }

  const post = posts[0];
  const clientId = post.client_id;

  // Determine target platforms
  let targets = [];
  if (post.target_platforms) {
    if (Array.isArray(post.target_platforms)) {
      targets = post.target_platforms;
    } else if (typeof post.target_platforms === 'string') {
      try {
        targets = JSON.parse(post.target_platforms);
      } catch (e) {
        targets = [post.target_platforms];
      }
    }
  }

  if (!targets || targets.length === 0) {
    if (post.platform) {
      targets = [post.platform];
    } else {
      targets = ['instagram'];
    }
  }

  // Detect whether media is video or image
  const isVideo = Boolean(post.image_path && /\.(mp4|mov|avi|webm|mkv|wmv)$/i.test(post.image_path));

  const results = [];
  let successCount = 0;

  for (const targetPlatform of targets) {
    const platform = String(targetPlatform).toLowerCase().trim();

    // 1. YouTube image restriction check
    if (!isVideo && platform === 'youtube') {
      results.push({
        platform: 'youtube',
        success: false,
        skipped: true,
        code: 'YOUTUBE_IMAGE_NOT_SUPPORTED',
        user_message: 'YouTube pe sirf Video/Shorts post hota hai, image poster nahi.',
      });
      continue;
    }

    // 2. Fetch account for client & platform
    const [accRows] = await pool.query(
      'SELECT * FROM client_social_accounts WHERE client_id = ? AND platform = ?',
      [clientId, platform]
    );

    if (accRows.length === 0 || !accRows[0].is_connected) {
      results.push({
        platform,
        success: false,
        code: 'NOT_CONNECTED',
        user_message: `${platform} account is not connected for this client.`,
      });
      continue;
    }

    const account = accRows[0];

    // 3. Proactive token refresh before publishing
    const refreshRes = await tokenRefreshService.refreshIfNeeded(clientId, platform);
    if (!refreshRes.success && refreshRes.code === 'TOKEN_REVOKED') {
      results.push({
        platform,
        success: false,
        code: 'TOKEN_REVOKED',
        user_message: refreshRes.user_message || 'Token Expired - Dobara Connect Karo',
      });
      continue;
    }

    // Re-fetch account if token was refreshed
    let activeAccount = account;
    if (refreshRes.refreshed) {
      const [refreshedRows] = await pool.query(
        'SELECT * FROM client_social_accounts WHERE client_id = ? AND platform = ?',
        [clientId, platform]
      );
      if (refreshedRows.length > 0) activeAccount = refreshedRows[0];
    }

    // 4. Platform-specific publish call
    try {
      let pubResult = null;
      if (platform === 'facebook') {
        pubResult = await metaService.publishFacebook(activeAccount, post);
      } else if (platform === 'instagram') {
        pubResult = await metaService.publishInstagram(activeAccount, post);
      } else if (platform === 'youtube') {
        pubResult = await youtubeService.publishVideo(
          activeAccount,
          post.image_path,
          post.caption,
          post.caption
        );
      } else if (platform === 'linkedin') {
        pubResult = await linkedinService.publishPost(activeAccount, post.caption, post.image_path);
      } else {
        results.push({
          platform,
          success: false,
          code: 'UNSUPPORTED_PLATFORM',
          user_message: `Platform '${platform}' is not supported.`,
        });
        continue;
      }

      if (pubResult && pubResult.success) {
        successCount++;
        results.push({
          platform,
          success: true,
          postId: pubResult.id,
          url: pubResult.url,
        });
      } else {
        results.push({
          platform,
          success: false,
          error: pubResult?.error || 'Publish returned unsuccessful',
          user_message: `Publish failed on ${platform}`,
        });
      }
    } catch (err) {
      console.warn(`[Publish] Failed publishing to ${platform}:`, err.message);
      results.push({
        platform,
        success: false,
        error: err.message,
        user_message: `Failed to publish to ${platform}: ${err.message}`,
      });
    }
  }

  // 5. Update post status
  // Note: If YouTube was skipped due to image, but other platforms succeeded, post is 'posted'
  const finalStatus = successCount > 0 ? 'posted' : 'failed';

  await pool.query(
    `UPDATE posts 
     SET status = ?, 
         publish_results = ?, 
         published_at = NOW() 
     WHERE id = ?`,
    [finalStatus, JSON.stringify(results), postId]
  );

  return {
    success: finalStatus === 'posted',
    status: finalStatus,
    results,
  };
};

module.exports = {
  publishPost,
};
