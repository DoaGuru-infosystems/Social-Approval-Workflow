const pool = require('../config/db');
const publishService = require('../services/publishService');

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Check and execute any scheduled posts that have reached or passed their scheduled_at time.
 */
const checkAndRunScheduledPosts = async () => {
  try {
    const [scheduledPosts] = await pool.query(
      `SELECT id, client_id, scheduled_at, platform, target_platforms 
       FROM posts 
       WHERE status = 'scheduled' 
         AND scheduled_at IS NOT NULL 
         AND scheduled_at <= NOW()`
    );

    if (scheduledPosts.length === 0) {
      return { processed: 0 };
    }

    console.log(`[SchedulerJob] Found ${scheduledPosts.length} post(s) ready to publish.`);

    for (const post of scheduledPosts) {
      try {
        console.log(`[SchedulerJob] Publishing scheduled post ID: ${post.id}...`);
        const result = await publishService.publishPost(post.id);
        console.log(
          `[SchedulerJob] Post ${post.id} completed with status: ${result.status} (Success: ${result.success})`
        );
      } catch (postErr) {
        console.error(`[SchedulerJob] Error executing post ${post.id}:`, postErr);
        await pool.query(
          `UPDATE posts 
           SET status = 'failed', 
               publish_results = ? 
           WHERE id = ?`,
          [JSON.stringify([{ error: postErr.message, user_message: 'Scheduler publish failed' }]), post.id]
        );
      }
    }

    return { processed: scheduledPosts.length };
  } catch (err) {
    console.error('[SchedulerJob] Error checking scheduled posts:', err);
    return { error: err.message };
  }
};

/**
 * Initialize background interval for scheduled posts
 */
const initSchedulerJob = () => {
  // Run first check 5 seconds after server startup
  setTimeout(checkAndRunScheduledPosts, 5000);

  // Repeat every 5 minutes
  setInterval(checkAndRunScheduledPosts, FIVE_MINUTES_MS);
  console.log('✅ Background post scheduler job initialized (checks every 5 minutes).');
};

module.exports = {
  checkAndRunScheduledPosts,
  initSchedulerJob,
};
