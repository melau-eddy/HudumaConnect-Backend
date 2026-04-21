const express = require('express');
const router = express.Router();

// Import controllers
const {
  createReview,
  getProviderReviews,
  getReviews,
  getReview,
  markAsHelpful,
  reportReview,
  getRecentReviews,
  getProviderStats
} = require('../controllers/reviewController');

// Import middleware
const { protect, authorize } = require('../middleware/auth');

// Public routes
router.get('/recent', getRecentReviews);
router.get('/provider/:providerId', getProviderReviews);
router.get('/provider/:providerId/stats', getProviderStats);
router.get('/:id', getReview);

// Protected routes
router.use(protect);

router.route('/')
  .post(authorize('customer'), createReview)
  .get(getReviews);

router.patch('/:id/helpful', markAsHelpful);
router.patch('/:id/report', reportReview);

module.exports = router;
