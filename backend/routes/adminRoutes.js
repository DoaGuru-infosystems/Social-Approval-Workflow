const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

// System & API health check (Admin only)
router.get('/system-health', authMiddleware, roleMiddleware('admin'), adminController.getSystemHealth);

module.exports = router;
