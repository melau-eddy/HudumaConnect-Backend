const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema({
  providerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: [true, 'Payout amount is required'],
    min: [0, 'Amount cannot be negative']
  },
  currency: {
    type: String,
    default: 'KES'
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  period: {
    type: String, // 'monthly', 'weekly', or custom period
    required: true
  },
  payoutMethod: {
    type: String,
    enum: ['bank_transfer', 'mpesa', 'wallet'],
    required: true
  },
  // Bank details for transfer
  bankDetails: {
    accountNumber: String,
    bankCode: String,
    accountName: String,
    bankName: String
  },
  // M-Pesa details
  mpesaPhone: String,
  mpesaConversationId: String, // For B2C payout tracking

  // Payout tracking
  bankTransferReference: String,
  mpesaTransactionId: String,

  // Breakdown
  breakdown: {
    totalEarnings: Number, // Sum of completed payments
    platformCommission: {
      type: Number,
      default: 0 // Percentage taken by platform
    },
    chargesFees: {
      type: Number,
      default: 0 // Third-party payment processing fees
    },
    tax: {
      type: Number,
      default: 0
    },
    netAmount: Number // Final amount paid to provider
  },

  // Period details
  periodStart: Date,
  periodEnd: Date,
  transactionCount: Number,

  // Status tracking
  failureReason: String,
  failureCode: String,
  notes: String,

  requestedAt: {
    type: Date,
    default: Date.now
  },
  processedAt: Date,
  completedAt: Date,
  failedAt: Date
}, {
  timestamps: true
});

// Indexes for efficient querying
payoutSchema.index({ providerId: 1, status: 1 });
payoutSchema.index({ status: 1, createdAt: -1 });
payoutSchema.index({ providerId: 1, createdAt: -1 });

// Pre-save validation and calculation
payoutSchema.pre('save', async function(next) {
  // Validate minimum payout amount
  if (this.amount > 0 && this.amount < 100) {
    return next(new Error('Minimum payout amount is KES 100'));
  }

  // Calculate net amount if not already set
  if (!this.breakdown.netAmount && this.breakdown.totalEarnings) {
    const total = this.breakdown.totalEarnings;
    const commission = total * (this.breakdown.platformCommission / 100);
    const net = total - commission - this.breakdown.chargesFees - this.breakdown.tax;
    this.breakdown.netAmount = Math.max(net, 0);
  }

  // Set completed timestamp when status changes to completed
  if (this.status === 'completed' && !this.completedAt) {
    this.completedAt = new Date();
  }

  // Set failed timestamp when status changes to failed
  if (this.status === 'failed' && !this.failedAt) {
    this.failedAt = new Date();
  }

  next();
});

// Static method to create payout from period's earnings
payoutSchema.statics.createPayoutFromEarnings = async function(providerId, periodStart, periodEnd, payoutMethod, bankDetails) {
  const Payment = mongoose.model('Payment');

  // Get all completed payments in the period
  const payments = await Payment.find({
    providerId,
    status: 'completed',
    completedAt: {
      $gte: periodStart,
      $lte: periodEnd
    }
  });

  if (payments.length === 0) {
    throw new Error('No completed payments found for this period');
  }

  const totalEarnings = payments.reduce((sum, p) => sum + p.amount, 0);
  const platformCommission = 15; // 15% platform fee
  const commission = totalEarnings * (platformCommission / 100);

  return this.create({
    providerId,
    amount: totalEarnings,
    status: 'pending',
    payoutMethod,
    bankDetails,
    period: `${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]}`,
    periodStart,
    periodEnd,
    transactionCount: payments.length,
    breakdown: {
      totalEarnings,
      platformCommission,
      chargesFees: 0, // Will be updated based on payment method
      tax: 0,
      netAmount: totalEarnings - commission
    }
  });
};

module.exports = mongoose.model('Payout', payoutSchema);
