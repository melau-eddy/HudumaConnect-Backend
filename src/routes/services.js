const express = require('express');
const router = express.Router();

// Import controllers
const {
  getServices,
  getServicesByCategory,
  getPopularServices,
  getService,
  getMyServices,
  createService,
  updateService,
  deleteService,
  toggleServiceStatus,
  getServiceStats,
  bulkUpdateStatus
} = require('../controllers/serviceController');

// Import middleware
const { protect, authorize } = require('../middleware/auth');

// Public routes (no auth required)
router.get('/', getServices);
router.get('/popular', getPopularServices);
router.get('/category/:category', getServicesByCategory);
router.get('/:id', getService);

// Protected routes (authentication required)
router.use(protect);

// Provider-only routes
router.get('/provider/my-services', authorize('provider'), getMyServices);
router.get('/provider/stats', authorize('provider'), getServiceStats);
router.patch('/provider/bulk-status', authorize('provider'), bulkUpdateStatus);

router.route('/create')
  .post(authorize('provider'), createService);

router.route('/:id/manage')
  .put(authorize('provider'), updateService)
  .delete(authorize('provider'), deleteService);

router.patch('/:id/toggle-status', authorize('provider'), toggleServiceStatus);

module.exports = router;
