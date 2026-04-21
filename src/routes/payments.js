const express = require('express');
const router = express.Router();

// Import controllers
const {
  initiatePayment,
  verifyPayment,
  getPaymentHistory,
  processRefund,
  getPayouts,
  requestPayout,
  queryMpesaStatus
} = require('../controllers/paymentController');

// Import middleware
const { protect, authorize } = require('../middleware/auth');

// All payment routes require authentication
router.use(protect);

// Customer payment routes
router.post('/initiate', authorize('customer'), initiatePayment);
router.post('/verify', verifyPayment);
router.get('/history', getPaymentHistory);
router.post('/refund', authorize('admin'), processRefund);

// M-Pesa STK push status query (polling fallback)
router.get('/mpesa/query/:paymentId', authorize('customer'), queryMpesaStatus);

// Provider payout routes
router.get('/payouts', authorize('provider'), getPayouts);
router.post('/request-payout', authorize('provider'), requestPayout);

module.exports = router;

