const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  serviceRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceRequest',
    required: true
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  providerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: [0, 'Amount cannot be negative']
  },
  currency: {
    type: String,
    default: 'KES',
    enum: ['KES', 'USD', 'EUR']
  },
  method: {
    type: String,
    enum: ['card', 'mpesa', 'bank_transfer', 'cash'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  // Stripe integration fields
  stripePaymentIntentId: String,
  stripeChargeId: String,

  // M-Pesa integration fields
  mpesaTransactionId: String,
  mpesaCheckoutRequestId: String,

  // Bank transfer fields
  bankTransferId: String,
  bankReference: String,

  // Metadata
  metadata: {
    description: String,
    notes: String,
    source: String // 'web' or 'mobile'
  },

  // Error handling
  failureReason: String,
  failureCode: String,
  retryCount: {
    type: Number,
    default: 0
  },

  // Timestamps
  initiatedAt: {
    type: Date,
    default: Date.now
  },
  processedAt: Date,
  completedAt: Date,
  refundedAt: Date
}, {
  timestamps: true
});

// Indexes for efficient querying
paymentSchema.index({ customerId: 1, status: 1 });
paymentSchema.index({ providerId: 1, status: 1 });
paymentSchema.index({ serviceRequestId: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ stripePaymentIntentId: 1, sparse: true });
paymentSchema.index({ mpesaTransactionId: 1, sparse: true });

// Pre-save validation
paymentSchema.pre('save', function(next) {
  // Ensure amount is valid
  if (this.amount <= 0) {
    next(new Error('Payment amount must be greater than 0'));
  }

  // If payment is completed, set completedAt timestamp
  if (this.status === 'completed' && !this.completedAt) {
    this.completedAt = new Date();
  }

  next();
});

module.exports = mongoose.model('Payment', paymentSchema);
