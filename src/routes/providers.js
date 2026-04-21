const express = require('express');
const router = express.Router();

// Import controllers
const {
  getProviders,
  getProvider,
  updateProvider,
  getProviderDashboard,
  toggleAvailability,
  searchProviders
} = require('../controllers/providerController');

// Import middleware
const { protect, authorize } = require('../middleware/auth');

// Public routes
router.get('/', getProviders);
router.get('/search', searchProviders);
router.get('/:id', getProvider);

// Protected routes (Provider only)
router.use(protect);
router.use(authorize('provider'));

router.get('/dashboard/stats', getProviderDashboard);
router.put('/profile', updateProvider);
router.patch('/toggle-availability', toggleAvailability);

module.exports = router;
