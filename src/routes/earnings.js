const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const earningsController = require('../controllers/earningsController');

// All routes require authentication
router.use(protect);

// Get earnings summary
router.get('/summary', earningsController.getEarningsSummary);

// Get earnings statistics
router.get('/stats', earningsController.getEarningsStats);

// Get earnings details for a period
router.get('/details', earningsController.getEarningsDetails);

// Get payout history
router.get('/payouts', earningsController.getPayoutHistory);

// Request a payout
router.post('/request-payout', earningsController.requestPayout);

module.exports = router;
