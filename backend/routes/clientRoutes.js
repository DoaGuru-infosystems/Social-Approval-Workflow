const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const socialRoutes = require('./socialRoutes');

// Client CRUD
router.post('/', authMiddleware, roleMiddleware('admin'), clientController.createClient);
router.get('/', authMiddleware, clientController.getClients);
router.get('/:id', authMiddleware, clientController.getClientById);
router.put('/:id', authMiddleware, roleMiddleware('admin'), clientController.updateClient);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), clientController.deleteClient);

// Brand Guidelines (Admin can edit, all can view)
router.get('/:id/brand-guidelines', authMiddleware, clientController.getBrandGuidelines);
router.put('/:id/brand-guidelines', authMiddleware, roleMiddleware('admin'), clientController.updateBrandGuidelines);

// GMB Profile Sync (Admin only)
router.post('/:id/sync-gmb', authMiddleware, roleMiddleware('admin'), clientController.syncGmbClient);

// Social Connect Routes (SMO and Admin both have access)
router.use('/', socialRoutes);

// Legacy Social Accounts (for backwards compatibility)
router.get('/:id/social-accounts', authMiddleware, clientController.getClientSocialAccounts);
router.post('/:id/social-accounts', authMiddleware, roleMiddleware('admin'), clientController.connectSocialAccount);
router.delete('/:id/social-accounts/:accountId', authMiddleware, roleMiddleware('admin'), clientController.disconnectSocialAccount);

module.exports = router;
