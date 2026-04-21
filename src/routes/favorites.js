const express = require('express');
const router = express.Router();

// Import controllers
const {
  addFavorite,
  removeFavorite,
  getFavorites,
  checkFavorite
} = require('../controllers/favoriteController');

// Import middleware
const { protect, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// Protected routes for customers only
router.route('/')
  .get(authorize('customer'), getFavorites);

router.post('/:providerId', authorize('customer'), addFavorite);
router.delete('/:providerId', authorize('customer'), removeFavorite);
router.get('/:providerId/status', authorize('customer'), checkFavorite);

module.exports = router;
