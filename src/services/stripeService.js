const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * Create a Stripe payment intent for a service payment
 * @param {number} amount - Amount in cents (e.g., 5000 for 50.00 KES)
 * @param {string} currency - Currency code (default: 'kes')
 * @param {object} metadata - Additional metadata to attach to intent
 * @returns {Promise<object>} Stripe PaymentIntent object
 */
const createPaymentIntent = async (amount, currency = 'kes', metadata = {}) => {
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount), // Stripe requires amount in smallest currency unit
      currency: currency.toLowerCase(),
      metadata: {
        ...metadata,
        createdAt: new Date().toISOString()
      },
      payment_method_types: ['card']
    });

    return {
      success: true,
      clientSecret: paymentIntent.client_secret,
      intentId: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      status: paymentIntent.status
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      code: error.code
    };
  }
};

/**
 * Confirm a Stripe payment intent
 * @param {string} intentId - Payment intent ID
 * @param {string} paymentMethodId - Payment method ID
 * @returns {Promise<object>} Confirmation result
 */
const confirmPaymentIntent = async (intentId, paymentMethodId) => {
  try {
    const paymentIntent = await stripe.paymentIntents.confirm(intentId, {
      payment_method: paymentMethodId,
      return_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payments/return`
    });

    return {
      success: true,
      intentId: paymentIntent.id,
      status: paymentIntent.status,
      chargeId: paymentIntent.charges.data[0]?.id || null,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      code: error.code
    };
  }
};

/**
 * Retrieve a Stripe payment intent
 * @param {string} intentId - Payment intent ID
 * @returns {Promise<object>} Payment intent details
 */
const retrievePaymentIntent = async (intentId) => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(intentId);

    return {
      success: true,
      intentId: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      chargeId: paymentIntent.charges.data[0]?.id || null
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      code: error.code
    };
  }
};

/**
 * Create a refund for a charge
 * @param {string} chargeId - Charge ID to refund
 * @param {number} amount - Amount to refund (optional, defaults to full refund)
 * @returns {Promise<object>} Refund result
 */
const createRefund = async (chargeId, amount = null) => {
  try {
    const refundData = {
      charge: chargeId
    };

    if (amount) {
      refundData.amount = Math.round(amount);
    }

    const refund = await stripe.refunds.create(refundData);

    return {
      success: true,
      refundId: refund.id,
      chargeId: refund.charge,
      amount: refund.amount,
      status: refund.status,
      createdAt: new Date(refund.created * 1000)
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      code: error.code
    };
  }
};

/**
 * Verify a webhook signature
 * @param {string} body - Raw request body
 * @param {string} signature - Stripe signature header
 * @returns {object|null} Webhook event or null if invalid
 */
const verifyWebhookSignature = (body, signature) => {
  try {
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    return event;
  } catch (error) {
    console.error('Webhook signature verification failed:', error.message);
    return null;
  }
};

/**
 * Get stripe account balance
 * @returns {Promise<object>} Account balance details
 */
const getAccountBalance = async () => {
  try {
    const balance = await stripe.balance.retrieve();

    return {
      success: true,
      available: balance.available[0]?.amount || 0,
      pending: balance.pending[0]?.amount || 0,
      currency: balance.available[0]?.currency || 'kes'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      code: error.code
    };
  }
};

module.exports = {
  createPaymentIntent,
  confirmPaymentIntent,
  retrievePaymentIntent,
  createRefund,
  verifyWebhookSignature,
  getAccountBalance
};
