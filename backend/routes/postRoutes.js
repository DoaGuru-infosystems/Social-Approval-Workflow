const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const upload = require('../middleware/uploadMiddleware');

// Custom Multer error wrapper for clean error responses
const handleUpload = (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File size too large. Maximum allowed size is 10MB.',
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || 'File upload failed.',
      });
    }
    next();
  });
};

// 1. GET /api/posts — Role-based filtered posts list
router.get('/', authMiddleware, postController.getPosts);

// 2. GET /api/posts/:id — Full post details with revisions, AI reports & approvals
router.get('/:id', authMiddleware, postController.getPostById);

// 3. POST /api/posts — SMO creates new post + initial AI check
router.post(
  '/',
  authMiddleware,
  roleMiddleware(['smo']),
  handleUpload,
  postController.createPost
);

// 4. PUT /api/posts/:id/revise — SMO revises post (max 3 recheck loop)
router.put(
  '/:id/revise',
  authMiddleware,
  roleMiddleware(['smo']),
  handleUpload,
  postController.revisePost
);

// 5. POST /api/posts/:id/submit — SMO submits post for Manager review
router.post(
  '/:id/submit',
  authMiddleware,
  roleMiddleware(['smo']),
  postController.submitPost
);

// 6. POST /api/posts/:id/manager-review — Manager approves / rejects / requests changes
router.post(
  '/:id/manager-review',
  authMiddleware,
  roleMiddleware(['manager']),
  postController.managerReview
);

// 7. POST /api/posts/:id/admin-review — Admin approves / rejects / requests changes
router.post(
  '/:id/admin-review',
  authMiddleware,
  roleMiddleware(['admin']),
  postController.adminReview
);

// 8. PUT /api/posts/:id/platform — Platform select (only after admin_approved)
router.put(
  '/:id/platform',
  authMiddleware,
  roleMiddleware(['smo', 'admin']),
  postController.selectPlatform
);

// 9. PUT /api/posts/:id/publish-url — Record live URL & mark completed
router.put(
  '/:id/publish-url',
  authMiddleware,
  roleMiddleware(['smo', 'admin']),
  postController.updatePublishUrl
);

module.exports = router;

