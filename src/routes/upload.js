const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const multerErrorHandler = require('../middleware/multerErrorHandler');
const {
  upload,
  uploadAvatar,
  uploadPortfolio,
  deletePortfolioImage,
  getPortfolio
} = require('../controllers/uploadController');

/**
 * @route   POST /api/upload/avatar
 * @desc    Upload user avatar
 * @access  Private
 */
router.post('/avatar', protect, upload.single('avatar'), multerErrorHandler, uploadAvatar);

/**
 * @route   POST /api/upload/portfolio
 * @desc    Upload portfolio images (providers only)
 * @access  Private (Provider)
 */
router.post('/portfolio', protect, upload.array('portfolio', 8), multerErrorHandler, uploadPortfolio);

/**
 * @route   GET /api/upload/portfolio
 * @desc    Get provider portfolio images
 * @access  Private (Provider)
 */
router.get('/portfolio', protect, getPortfolio);

/**
 * @route   DELETE /api/upload/portfolio/:imageId
 * @desc    Delete portfolio image
 * @access  Private (Provider)
 */
router.delete('/portfolio/:imageId', protect, deletePortfolioImage);

module.exports = router;