const express = require('express');
const router = express.Router();

// Import controllers
const {
  handleStripeWebhook,
  handleMpesaCallback,
  handleMpesaTimeout,
  handleMpesaB2CCallback
} = require('../controllers/webhookController');

// Webhook routes - these should NOT have authentication middleware
// Raw body parser is needed for Stripe signature verification

// Stripe webhook endpoint
router.post('/stripe', express.raw({type: 'application/json'}), handleStripeWebhook);

// M-Pesa callback endpoints
router.post('/mpesa/callback', handleMpesaCallback);
router.post('/mpesa/timeout', handleMpesaTimeout);
router.post('/mpesa/b2c-callback', handleMpesaB2CCallback);

module.exports = router;
