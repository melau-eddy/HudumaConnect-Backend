const Payment = require('../models/Payment');
const Payout = require('../models/Payout');
const ServiceRequest = require('../models/ServiceRequest');
const User = require('../models/User');
const Notification = require('../models/Notification');
const stripeService = require('../services/stripeService');
const mpesaService = require('../services/mpesaService');
const { formatPhoneNumber, isValidMpesaPhone } = require('../services/mpesaService');
const mongoose = require('mongoose');

/**
 * @desc    Initiate payment for a service request
 * @route   POST /api/payments/initiate
 * @access  Private (Customer)
 */
const initiatePayment = async (req, res, next) => {
  try {
    const { serviceRequestId, amount, method, phoneNumber } = req.body;

    // INPUT VALIDATION
    if (!serviceRequestId || !amount || !method) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: serviceRequestId, amount, method'
      });
    }

    // Validate payment method
    const validMethods = ['card', 'mpesa', 'cash'];
    if (!validMethods.includes(method)) {
      return res.status(400).json({
        success: false,
        message: `Invalid payment method. Must be one of: ${validMethods.join(', ')}`
      });
    }

    // Validate amount
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount < 10) {
      return res.status(400).json({
        success: false,
        message: 'Minimum payment amount is KES 10'
      });
    }

    if (parsedAmount > 500000) {
      return res.status(400).json({
        success: false,
        message: 'Maximum payment amount is KES 500,000'
      });
    }

    // Verify service request exists and is completed
    const serviceRequest = await ServiceRequest.findById(serviceRequestId);
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found'
      });
    }

    if (serviceRequest.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Payment can only be made for completed services'
      });
    }

    // customerId is auto-populated by Mongoose into a full user object
    const customerId = serviceRequest.customerId._id
      ? serviceRequest.customerId._id.toString()
      : serviceRequest.customerId.toString();

    if (customerId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only pay for your own service requests'
      });
    }

    // IDEMPOTENCY CHECK - Prevent duplicate payments
    const existingPayment = await Payment.findOne({
      serviceRequestId,
      customerId: req.user.id,
      status: { $in: ['pending', 'processing', 'completed'] }
    });

    if (existingPayment) {
      if (existingPayment.status === 'completed') {
        return res.status(400).json({
          success: false,
          message: 'Payment already completed for this service request'
        });
      }
      return res.status(400).json({
        success: false,
        message: 'Payment already in progress for this service request',
        payment: existingPayment._id
      });
    }

    // M-PESA: Validate and format phone number
    if (method === 'mpesa') {
      let phone = phoneNumber;
      if (!phone) {
        const customer = await User.findById(req.user.id);
        phone = customer?.phone;
      }

      if (!phone) {
        return res.status(400).json({
          success: false,
          message: 'Phone number required for M-Pesa payment'
        });
      }

      // Auto-format to 254xxx
      const formatted = formatPhoneNumber(phone);
      if (!isValidMpesaPhone(formatted)) {
        return res.status(400).json({
          success: false,
          message: `Invalid phone number: ${phone}. Use format 07xxxxxxxx or 254xxxxxxxxx`
        });
      }
    }

    // Create payment record (extract _id from populated references)
    const providerIdValue = serviceRequest.providerId._id
      ? serviceRequest.providerId._id
      : serviceRequest.providerId;

    const payment = await Payment.create({
      serviceRequestId,
      customerId: req.user.id,
      providerId: providerIdValue,
      amount: parsedAmount,
      method,
      status: 'pending'
    });

    // Process based on payment method
    let paymentResponse = {
      success: true,
      message: 'Payment initiated',
      payment: payment._id,
      method
    };

    if (method === 'card') {
      // Create Stripe payment intent
      const stripeResult = await stripeService.createPaymentIntent(
        amount * 100, // Convert to cents
        'kes',
        {
          paymentId: payment._id.toString(),
          serviceRequestId: serviceRequestId.toString(),
          customerId: req.user.id
        }
      );

      if (stripeResult.success) {
        payment.stripePaymentIntentId = stripeResult.intentId;
        await payment.save();
        paymentResponse.clientSecret = stripeResult.clientSecret;
        paymentResponse.message = 'Please complete payment using your card';
      } else {
        payment.status = 'failed';
        payment.failureReason = stripeResult.error;
        await payment.save();
        return res.status(400).json({
          success: false,
          message: 'Failed to initiate card payment',
          error: stripeResult.error
        });
      }
    } else if (method === 'mpesa') {
      // Get phone number — prioritize the one user explicitly provided
      let mpesaPhone = req.body.phoneNumber;
      if (!mpesaPhone) {
        const customer = await User.findById(req.user.id);
        mpesaPhone = customer?.phone;
      }

      if (!mpesaPhone) {
        return res.status(400).json({
          success: false,
          message: 'Phone number required for M-Pesa payment'
        });
      }

      // Format phone number (07xx -> 254xx)
      const formattedPhone = formatPhoneNumber(mpesaPhone);
      console.log(`📱 M-Pesa payment: ${mpesaPhone} -> ${formattedPhone}`);

      // Initiate M-Pesa STK push
      const mpesaResult = await mpesaService.initiateStkPush(
        formattedPhone,
        parsedAmount,
        payment._id.toString(),
        'HudumaConnect'
      );

      if (mpesaResult.success) {
        payment.mpesaCheckoutRequestId = mpesaResult.checkoutRequestId;
        payment.status = 'processing';
        await payment.save();
        paymentResponse.checkoutRequestId = mpesaResult.checkoutRequestId;
        paymentResponse.paymentId = payment._id;
        paymentResponse.message = mpesaResult.customerMessage || 'M-Pesa payment prompt sent to your phone';
      } else {
        payment.status = 'failed';
        payment.failureReason = mpesaResult.error;
        await payment.save();
        return res.status(400).json({
          success: false,
          message: 'Failed to initiate M-Pesa payment',
          error: mpesaResult.error
        });
      }
    } else if (method === 'cash') {
      // Mark as pending, provider can confirm receipt
      payment.status = 'processing';
      await payment.save();
      paymentResponse.message = 'Awaiting cash payment confirmation';
    }

    res.status(201).json(paymentResponse);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Verify and complete payment
 * @route   POST /api/payments/verify
 * @access  Private
 */
const verifyPayment = async (req, res, next) => {
  try {
    const { paymentId, transactionId } = req.body;

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Verify transaction based on method
    if (payment.method === 'card' && payment.stripePaymentIntentId) {
      // Verify with Stripe
      const verificationResult = await stripeService.retrievePaymentIntent(
        payment.stripePaymentIntentId
      );

      if (!verificationResult.success || verificationResult.status !== 'succeeded') {
        return res.status(400).json({
          success: false,
          message: 'Payment verification failed',
          status: verificationResult.status
        });
      }

      payment.stripeChargeId = verificationResult.chargeId;
    } else if (payment.method === 'mpesa' && transactionId) {
      // Store M-Pesa transaction ID
      payment.mpesaTransactionId = transactionId;

      // Optionally validate with M-Pesa API
      const validationResult = await mpesaService.validateTransaction(transactionId);
      if (!validationResult.success) {
        return res.status(400).json({
          success: false,
          message: 'M-Pesa transaction validation failed'
        });
      }
    } else if (payment.method === 'cash') {
      // Cash payment - mark as completed after provider confirms
      if (!req.body.providerConfirmed) {
        return res.status(400).json({
          success: false,
          message: 'Cash payment requires provider confirmation'
        });
      }
    }

    payment.status = 'completed';
    payment.completedAt = new Date();
    await payment.save();

    // Update service request status to "paid"
    try {
      const serviceRequest = await ServiceRequest.findById(payment.serviceRequestId);
      if (serviceRequest) {
        serviceRequest.status = 'paid';
        await serviceRequest.save();

        // Emit real-time update to customer
        const io = req.app.get('io');
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
      amount: payment.amount * 0.85, // 15% platform commission
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

    res.status(200).json({
      success: true,
      message: 'Payment verified and completed',
      payment: payment._id,
      payout: payout._id
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get payment history for user
 * @route   GET /api/payments/history
 * @access  Private
 */
const getPaymentHistory = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (page - 1) * limit;

    const query = {
      $or: [
        { customerId: req.user.id },
        { providerId: req.user.id }
      ]
    };

    if (status) {
      query.status = status;
    }

    const payments = await Payment.find(query)
      .populate('serviceRequestId', 'serviceType')
      .populate('customerId', 'name')
      .populate('providerId', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Payment.countDocuments(query);

    res.status(200).json({
      success: true,
      count: payments.length,
      total,
      pages: Math.ceil(total / limit),
      payments
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Process refund
 * @route   POST /api/payments/refund
 * @access  Private (Admin or involved party)
 */
const processRefund = async (req, res, next) => {
  try {
    const { paymentId, reason } = req.body;

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (payment.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Only completed payments can be refunded'
      });
    }

    // Process refund based on method
    if (payment.method === 'card' && payment.stripeChargeId) {
      // Call Stripe refund API
      const refundResult = await stripeService.createRefund(payment.stripeChargeId);

      if (!refundResult.success) {
        return res.status(400).json({
          success: false,
          message: 'Failed to process refund',
          error: refundResult.error
        });
      }
    } else if (payment.method === 'mpesa' && payment.mpesaTransactionId) {
      // M-Pesa refunds are handled differently - would need to contact Safaricom support
      // For now, just mark as refunded and notify
      console.log(`M-Pesa refund request for transaction: ${payment.mpesaTransactionId}`);
    }

    payment.status = 'refunded';
    payment.refundedAt = new Date();
    await payment.save();

    // Notify customer
    await Notification.notifyRefund(payment.customerId, payment, reason);

    res.status(200).json({
      success: true,
      message: 'Refund processed successfully',
      paymentId: payment._id
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get provider payouts
 * @route   GET /api/payments/payouts
 * @access  Private (Provider)
 */
const getPayouts = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (page - 1) * limit;

    if (req.user.role !== 'provider') {
      return res.status(403).json({
        success: false,
        message: 'Only providers can view payouts'
      });
    }

    const query = { providerId: req.user.id };
    if (status) {
      query.status = status;
    }

    const payouts = await Payout.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Payout.countDocuments(query);

    // Calculate totals
    const totals = await Payout.aggregate([
      { $match: { providerId: new mongoose.Types.ObjectId(req.user.id) } },
      {
        $group: {
          _id: null,
          totalEarned: { $sum: '$breakdown.totalEarnings' },
          totalPaid: {
            $sum: {
              $cond: [{ $eq: ['$status', 'completed'] }, '$breakdown.netAmount', 0]
            }
          },
          pending: {
            $sum: {
              $cond: [
                { $in: ['$status', ['pending', 'processing']] },
                '$amount',
                0
              ]
            }
          }
        }
      }
    ]);

    res.status(200).json({
      success: true,
      count: payouts.length,
      total,
      pages: Math.ceil(total / limit),
      totals: totals[0] || { totalEarned: 0, totalPaid: 0, pending: 0 },
      payouts
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Request payout
 * @route   POST /api/payments/request-payout
 * @access  Private (Provider)
 */
const requestPayout = async (req, res, next) => {
  try {
    const { amount, payoutMethod, bankDetails, mpesaPhone } = req.body;

    if (req.user.role !== 'provider') {
      return res.status(403).json({
        success: false,
        message: 'Only providers can request payouts'
      });
    }

    // Validate minimum payout
    if (amount < 100) {
      return res.status(400).json({
        success: false,
        message: 'Minimum payout amount is KES 100'
      });
    }

    // Validate payout method
    const validMethods = ['bank_transfer', 'mpesa', 'wallet'];
    if (!validMethods.includes(payoutMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payout method'
      });
    }

    // For M-Pesa payouts, require phone number
    if (payoutMethod === 'mpesa' && !mpesaPhone) {
      return res.status(400).json({
        success: false,
        message: 'M-Pesa phone number required for M-Pesa payout'
      });
    }

    // Create payout request
    const payoutData = {
      providerId: req.user.id,
      amount,
      status: 'pending',
      payoutMethod,
      period: new Date().toISOString().split('T')[0]
    };

    // Add method-specific details
    if (payoutMethod === 'bank_transfer' && bankDetails) {
      payoutData.bankDetails = bankDetails;
    } else if (payoutMethod === 'mpesa' && mpesaPhone) {
      payoutData.mpesaPhone = mpesaPhone;
    }

    const payout = await Payout.create(payoutData);

    // Optionally: Auto-process M-Pesa payouts immediately
    if (payoutMethod === 'mpesa' && process.env.AUTO_PROCESS_MPESA_PAYOUTS === 'true') {
      const result = await mpesaService.processB2CPayment(
        mpesaPhone,
        amount,
        'BusinessPayment',
        `HudumaConnect Provider Payout - Request ${payout._id}`
      );

      if (result.success) {
        payout.status = 'processing';
        payout.processedAt = new Date();
        // Store conversation ID for tracking in webhook callback
        if (result.conversationId) {
          payout.mpesaConversationId = result.conversationId;
        }
        await payout.save();
      } else {
        // Log B2C failure but don't fail the request - admin can retry manually
        console.warn(`⚠️ B2C payout auto-process failed: ${result.error}`);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Payout request submitted',
      payout
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Query M-Pesa STK push status (polling fallback)
 * @route   GET /api/payments/mpesa/query/:paymentId
 * @access  Private (Customer)
 */
const queryMpesaStatus = async (req, res, next) => {
  try {
    const { paymentId } = req.params;

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Only the customer who initiated the payment can query it
    if (payment.customerId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // If already completed or failed, return current status
    if (payment.status === 'completed' || payment.status === 'failed') {
      return res.status(200).json({
        success: true,
        paymentStatus: payment.status,
        message: payment.status === 'completed'
          ? 'Payment completed successfully'
          : `Payment failed: ${payment.failureReason || 'Unknown error'}`
      });
    }

    // Query Safaricom for the STK push status
    if (payment.mpesaCheckoutRequestId) {
      const queryResult = await mpesaService.querySTKPushStatus(
        payment.mpesaCheckoutRequestId
      );

      return res.status(200).json({
        success: true,
        paymentStatus: payment.status,
        mpesaQuery: queryResult
      });
    }

    return res.status(200).json({
      success: true,
      paymentStatus: payment.status,
      message: 'Payment is being processed'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  initiatePayment,
  verifyPayment,
  getPaymentHistory,
  processRefund,
  getPayouts,
  requestPayout,
  queryMpesaStatus
};
