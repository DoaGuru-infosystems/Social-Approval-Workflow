const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const socialRoutes = require('./socialRoutes');
const logoUpload = require('../middleware/logoUploadMiddleware');

// Custom error wrapper for Logo upload
const handleLogoUpload = (req, res, next) => {
  logoUpload.single('logo')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'Logo file size exceeds the 2MB limit. Please upload a smaller image.',
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || 'Error uploading logo file.',
      });
    }
    next();
  });
};

// Client CRUD
router.post('/', authMiddleware, roleMiddleware('admin'), clientController.createClient);
router.get('/', authMiddleware, clientController.getClients);
router.get('/:id', authMiddleware, clientController.getClientById);
router.put('/:id', authMiddleware, roleMiddleware('admin'), clientController.updateClient);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), clientController.deleteClient);

// Brand Guidelines (Admin can edit, all can view)
router.get('/:id/brand-guidelines', authMiddleware, clientController.getBrandGuidelines);
router.put('/:id/brand-guidelines', authMiddleware, roleMiddleware('admin'), clientController.updateBrandGuidelines);

// Official Brand Logo (Admin can upload / delete)
router.post('/:id/logo', authMiddleware, roleMiddleware('admin'), handleLogoUpload, clientController.uploadClientLogo);
router.delete('/:id/logo', authMiddleware, roleMiddleware('admin'), clientController.deleteClientLogo);

// GMB Profile Sync (Admin only)
router.post('/:id/sync-gmb', authMiddleware, roleMiddleware('admin'), clientController.syncGmbClient);

// Social Connect Routes (SMO and Admin both have access)
router.use('/', socialRoutes);

// Legacy Social Accounts (for backwards compatibility)
router.get('/:id/social-accounts', authMiddleware, clientController.getClientSocialAccounts);
router.post('/:id/social-accounts', authMiddleware, roleMiddleware('admin'), clientController.connectSocialAccount);
router.delete('/:id/social-accounts/:accountId', authMiddleware, roleMiddleware('admin'), clientController.disconnectSocialAccount);

module.exports = router;
