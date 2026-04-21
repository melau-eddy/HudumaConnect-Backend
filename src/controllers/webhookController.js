const Payment = require('../models/Payment');
const Payout = require('../models/Payout');
const ServiceRequest = require('../models/ServiceRequest');
const Notification = require('../models/Notification');
const stripeService = require('../services/stripeService');

/**
 * Handle Stripe webhook events
 * @route   POST /api/payments/webhooks/stripe
 * @access  Public (but signature verified)
 */
const handleStripeWebhook = async (req, res, next) => {
  try {
    const event = stripeService.verifyWebhookSignature(
      req.rawBody,
      req.headers['stripe-signature']
    );

    if (!event) {
      return res.status(400).json({
        success: false,
        message: 'Invalid webhook signature'
      });
    }

    // Handle specific event types
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object, req);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object, req);
        break;

      case 'charge.refunded':
        await handleChargeRefunded(event.data.object, req);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    next(error);
  }
};

/**
 * Process successful payment intent
 */
const handlePaymentIntentSucceeded = async (paymentIntent, req) => {
  try {
    // Find payment by Stripe intent ID
    const payment = await Payment.findOne({
      stripePaymentIntentId: paymentIntent.id
    });

    if (!payment) {
      console.warn(`Payment not found for intent: ${paymentIntent.id}`);
      return;
    }

    // Update payment status
    payment.status = 'completed';
    payment.stripeChargeId = paymentIntent.charges.data[0]?.id || null;
    payment.completedAt = new Date();
    await payment.save();

    // Update service request status to "paid"
    try {
      const serviceRequest = await ServiceRequest.findById(payment.serviceRequestId);
      if (serviceRequest) {
        serviceRequest.status = 'paid';
        await serviceRequest.save();

        // Emit real-time update to customer
        const io = req?.app?.get('io');
        if (io) {
          const requestObj = serviceRequest.toObject();
          io.to(payment.customerId.toString()).emit('request_status_updated', {
            id: requestObj._id,
            ...requestObj
          });
        }
      }
    } catch (requestError) {
      console.error('Error updating service request after payment:', requestError);
    }

    // Create payout for provider
    const payout = await Payout.create({
      providerId: payment.providerId,
      amount: payment.amount * 0.85,
      status: 'pending',
      payoutMethod: 'bank_transfer',
      period: new Date().toISOString().split('T')[0],
      breakdown: {
        totalEarnings: payment.amount,
        platformCommission: 15,
        netAmount: payment.amount * 0.85
      }
    });

    // Send notifications
    await Notification.notifyPaymentReceived(payment.customerId, payment);
    await Notification.notifyPaymentSettlement(payment.providerId, payout);

    console.log(`Payment ${payment._id} completed via webhook`);
  } catch (error) {
    console.error('Error processing payment_intent.succeeded:', error);
  }
};

/**
 * Process failed payment intent
 */
const handlePaymentIntentFailed = async (paymentIntent) => {
  try {
    const payment = await Payment.findOne({
      stripePaymentIntentId: paymentIntent.id
    });

    if (!payment) {
      console.warn(`Payment not found for intent: ${paymentIntent.id}`);
      return;
    }

    // Update payment status
    payment.status = 'failed';
    payment.failureReason = paymentIntent.last_payment_error?.message || 'Payment failed';
    payment.failureCode = paymentIntent.last_payment_error?.code || 'UNKNOWN';
    await payment.save();

    // Notify customer of failure
    await Notification.create({
      userId: payment.customerId,
      type: 'payment_failed',
      title: 'Payment Failed',
      message: `Your payment of KES ${payment.amount} failed: ${payment.failureReason}`,
      relatedId: payment._id
    });

    console.log(`Payment ${payment._id} failed via webhook`);
  } catch (error) {
    console.error('Error processing payment_intent.payment_failed:', error);
  }
};

/**
 * Process refunded charge
 */
const handleChargeRefunded = async (charge) => {
  try {
    const payment = await Payment.findOne({
      stripeChargeId: charge.id
    });

    if (!payment) {
      console.warn(`Payment not found for charge: ${charge.id}`);
      return;
    }

    // Update payment status
    payment.status = 'refunded';
    payment.refundedAt = new Date();
    await payment.save();

    // Find and cancel associated payout if exists
    await Payout.updateOne(
      { paymentId: payment._id },
      { status: 'cancelled' }
    );

    // Notify customer of refund
    await Notification.create({
      userId: payment.customerId,
      type: 'refund_processed',
      title: 'Refund Processed',
      message: `Your refund of KES ${charge.amount / 100} has been processed`,
      relatedId: payment._id
    });

    console.log(`Payment ${payment._id} refunded via webhook`);
  } catch (error) {
    console.error('Error processing charge.refunded:', error);
  }
};

/**
 * Handle M-Pesa payment callback
 * @route   POST /api/payments/mpesa/callback
 * @access  Public (M-Pesa callback)
 */
const handleMpesaCallback = async (req, res, next) => {
  try {
    const { Body } = req.body;

    // Log callback for debugging
    console.log('📱 M-Pesa callback received from IP:', req.ip);

    // M-Pesa callback structure varies by transaction type
    if (!Body || !Body.stkCallback) {
      console.warn('⚠️ Invalid M-Pesa callback structure');
      return res.status(200).json({ success: true }); // Always return 200 for M-Pesa
    }

    const callback = Body.stkCallback;
    const { CheckoutRequestID, ResultCode, ResultDesc } = callback;

    // Validate required fields
    if (!CheckoutRequestID || ResultCode === undefined) {
      console.warn('⚠️ Missing required M-Pesa callback fields');
      return res.status(200).json({ success: true });
    }

    // Find payment by M-Pesa checkout request ID
    const payment = await Payment.findOne({
      mpesaCheckoutRequestId: CheckoutRequestID
    });

    if (!payment) {
      console.warn(`Payment not found for checkout: ${CheckoutRequestID}`);
      return res.status(200).json({ success: true });
    }

    // Check result code (0 = success)
    if (ResultCode === 0) {
      const callbackMetadata = callback.CallbackMetadata?.Item || [];

      // Extract transaction details
      const mpesaReceiptNumber = callbackMetadata.find(
        item => item.Name === 'MpesaReceiptNumber'
      )?.Value;

      payment.status = 'completed';
      payment.mpesaTransactionId = mpesaReceiptNumber;
      payment.completedAt = new Date();
      await payment.save();

      // Update service request payment status
      try {
        const serviceRequest = await ServiceRequest.findById(payment.serviceRequestId);
        if (serviceRequest) {
          serviceRequest.paymentStatus = 'paid';
          serviceRequest.paymentMethod = 'mpesa';
          await serviceRequest.save();

          // Emit real-time events to customer
          const io = req.app.get('io');
          if (io) {
            // Emit dedicated payment_completed event for PaymentPage
            io.to(payment.customerId.toString()).emit('payment_completed', {
              paymentId: payment._id,
              status: 'completed',
              method: 'mpesa',
              amount: payment.amount,
              mpesaReceiptNumber
            });

            // Also emit request_status_updated for MyRequestsPage
            const requestObj = serviceRequest.toObject();
            io.to(payment.customerId.toString()).emit('request_status_updated', {
              id: requestObj._id,
              ...requestObj
            });
          }
        }
      } catch (requestError) {
        console.error('Error updating service request after M-Pesa payment:', requestError);
      }

      // Create payout for provider
      const payout = await Payout.create({
        providerId: payment.providerId,
        amount: payment.amount * 0.85,
        status: 'pending',
        payoutMethod: 'bank_transfer',
        period: new Date().toISOString().split('T')[0],
        breakdown: {
          totalEarnings: payment.amount,
          platformCommission: 15,
          netAmount: payment.amount * 0.85
        }
      });

      // Send notifications
      await Notification.notifyPaymentReceived(payment.customerId, payment);
      await Notification.notifyPaymentSettlement(payment.providerId, payout);

      console.log(`✅ M-Pesa payment ${payment._id} completed via callback`);
    } else {
      // Payment failed
      payment.status = 'failed';
      payment.failureReason = ResultDesc || 'M-Pesa payment failed';
      payment.failureCode = ResultCode.toString();
      await payment.save();

      // Emit failure event to customer
      const io = req.app.get('io');
      if (io) {
        io.to(payment.customerId.toString()).emit('payment_completed', {
          paymentId: payment._id,
          status: 'failed',
          method: 'mpesa',
          error: ResultDesc
        });
      }

      // Notify customer
      await Notification.create({
        userId: payment.customerId,
        type: 'payment_failed',
        title: 'M-Pesa Payment Failed',
        message: `Your M-Pesa payment failed: ${ResultDesc}`,
        relatedId: payment._id
      });

      console.log(`❌ M-Pesa payment ${payment._id} failed: ${ResultDesc}`);
    }

    // Always return 200 for M-Pesa callbacks
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('M-Pesa callback error:', error);
    // Still return 200 to acknowledge receipt
    res.status(200).json({ success: true });
  }
};

/**
 * Handle M-Pesa timeout callback
 * @route   POST /api/payments/mpesa/timeout
 * @access  Public (M-Pesa callback)
 */
const handleMpesaTimeout = async (req, res, next) => {
  try {
    console.log('M-Pesa timeout callback received:', req.body);
    // M-Pesa timeout - transaction pending, will be confirmed later
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('M-Pesa timeout error:', error);
    res.status(200).json({ success: true });
  }
};

/**
 * Handle M-Pesa B2C payment callback
 * @route   POST /api/payments/mpesa/b2c-callback
 * @access  Public (M-Pesa callback)
 */
const handleMpesaB2CCallback = async (req, res, next) => {
  try {
    const { Result } = req.body;

    if (!Result) {
      return res.status(200).json({ success: true });
    }

    const { ResultCode, ResultDesc, OriginatorConversationID } = Result;

    // Validate conversation ID exists
    if (!OriginatorConversationID) {
      console.warn('⚠️ Missing conversation ID in B2C callback');
      return res.status(200).json({ success: true });
    }

    // Find payout by conversation ID
    const payout = await Payout.findOne({
      mpesaConversationId: OriginatorConversationID
    });

    if (!payout) {
      console.warn(`⚠️ Payout not found for conversation: ${OriginatorConversationID}`);
      return res.status(200).json({ success: true });
    }

    // Update payout status based on result code (0 = success)
    if (ResultCode === 0) {
      payout.status = 'completed';
      payout.completedAt = new Date();
      console.log(`✅ B2C payout ${payout._id} completed`);

      // Notify provider
      await Notification.create({
        userId: payout.providerId,
        type: 'payout_completed',
        title: 'Payout Received',
        message: `Your payout of KES ${payout.amount} has been sent to your M-Pesa account`,
        relatedId: payout._id
      });
    } else {
      payout.status = 'failed';
      payout.failureReason = ResultDesc || 'B2C payout failed';
      payout.failureCode = ResultCode;
      payout.failedAt = new Date();
      console.log(`❌ B2C payout ${payout._id} failed: ${ResultDesc}`);

      // Notify provider of failure
      await Notification.create({
        userId: payout.providerId,
        type: 'payout_failed',
        title: 'Payout Failed',
        message: `Your payout request failed: ${ResultDesc}`,
        relatedId: payout._id
      });
    }

    await payout.save();
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ M-Pesa B2C callback error:', error);
    res.status(200).json({ success: true });
  }
};

module.exports = {
  handleStripeWebhook,
  handleMpesaCallback,
  handleMpesaTimeout,
  handleMpesaB2CCallback
};
