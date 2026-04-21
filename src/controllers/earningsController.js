const Payment = require('../models/Payment');
const Payout = require('../models/Payout');
const User = require('../models/User');
const ServiceRequest = require('../models/ServiceRequest');
const mongoose = require('mongoose');

// Get provider earnings summary
exports.getEarningsSummary = async (req, res) => {
  try {
    const providerId = req.user.id;

    // Get all completed payments for this provider
    const completedPayments = await Payment.find({
      providerId,
      status: 'completed'
    });

    // Calculate total earnings
    const totalEarnings = completedPayments.reduce((sum, p) => sum + p.amount, 0);

    // Get total completed jobs (from completed service requests)
    const completedJobs = await ServiceRequest.countDocuments({
      providerId,
      status: 'completed'
    });

    // Calculate commission (platform fee: 15%)
    const platformCommissionPercent = 15;
    const platformCommission = totalEarnings * (platformCommissionPercent / 100);

    // Get payouts processed
    const processedPayouts = await Payout.find({
      providerId,
      status: 'completed'
    });

    const totalPaidOut = processedPayouts.reduce((sum, p) => sum + (p.breakdown?.netAmount || 0), 0);

    // Calculate available balance
    const availableBalance = totalEarnings - platformCommission - totalPaidOut;

    // Get pending payments (not yet in payout)
    const pendingBalance = totalEarnings - totalPaidOut;

    // Get earnings by month for the last 12 months
    const earningsByMonth = await getEarningsByMonth(providerId);

    // Get average rating
    const provider = await User.findById(providerId);
    const averageRating = provider?.rating || 0;

    res.status(200).json({
      success: true,
      summary: {
        totalEarnings: parseFloat(totalEarnings.toFixed(2)),
        platformCommission: parseFloat(platformCommission.toFixed(2)),
        totalPaidOut: parseFloat(totalPaidOut.toFixed(2)),
        availableBalance: parseFloat(Math.max(availableBalance, 0).toFixed(2)),
        pendingBalance: parseFloat(pendingBalance.toFixed(2)),
        completedJobs,
        averageRating: parseFloat(averageRating.toFixed(2))
      },
      earningsByMonth,
      lastUpdated: new Date()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch earnings summary',
      error: error.message
    });
  }
};

// Get payout history
exports.getPayoutHistory = async (req, res) => {
  try {
    const providerId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Get payouts with pagination
    const payouts = await Payout.find({ providerId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Payout.countDocuments({ providerId });

    // Group by status
    const byStatus = await Payout.aggregate([
      { $match: { providerId: new mongoose.Types.ObjectId(providerId) } },
      { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$amount' } } }
    ]);

    const statusBreakdown = {};
    byStatus.forEach(item => {
      statusBreakdown[item._id] = {
        count: item.count,
        total: parseFloat(item.total.toFixed(2))
      };
    });

    res.status(200).json({
      success: true,
      payouts: payouts.map(p => ({
        id: p._id,
        amount: parseFloat(p.amount.toFixed(2)),
        status: p.status,
        method: p.payoutMethod,
        period: p.period,
        breakdown: {
          totalEarnings: parseFloat(p.breakdown?.totalEarnings?.toFixed(2) || 0),
          platformCommission: parseFloat(p.breakdown?.platformCommission?.toFixed(2) || 0),
          chargesFees: parseFloat(p.breakdown?.chargesFees?.toFixed(2) || 0),
          tax: parseFloat(p.breakdown?.tax?.toFixed(2) || 0),
          netAmount: parseFloat(p.breakdown?.netAmount?.toFixed(2) || 0)
        },
        transactionCount: p.transactionCount,
        requestedAt: p.requestedAt,
        processedAt: p.processedAt,
        completedAt: p.completedAt
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      },
      statusBreakdown
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payout history',
      error: error.message
    });
  }
};

// Get earnings details for a specific period
exports.getEarningsDetails = async (req, res) => {
  try {
    const providerId = req.user.id;
    const { startDate, endDate } = req.query;

    const start = new Date(startDate || new Date().getFullYear() + '-01-01');
    const end = new Date(endDate || new Date());

    // Get all payments in the period
    const payments = await Payment.find({
      providerId,
      status: 'completed',
      completedAt: {
        $gte: start,
        $lte: end
      }
    })
      .select('amount completedAt serviceRequestId')
      .sort({ completedAt: -1 });

    const totalEarnings = payments.reduce((sum, p) => sum + p.amount, 0);
    const platformCommission = totalEarnings * 0.15;
    const netEarnings = totalEarnings - platformCommission;

    // Get completed jobs count
    const completedJobs = await ServiceRequest.countDocuments({
      providerId,
      status: 'completed',
      completedAt: {
        $gte: start,
        $lte: end
      }
    });

    // Get payout for this period (if exists)
    const payout = await Payout.findOne({
      providerId,
      periodStart: { $gte: start },
      periodEnd: { $lte: end }
    });

    res.status(200).json({
      success: true,
      period: {
        start,
        end
      },
      earnings: {
        totalEarnings: parseFloat(totalEarnings.toFixed(2)),
        platformCommission: parseFloat(platformCommission.toFixed(2)),
        netEarnings: parseFloat(netEarnings.toFixed(2)),
        completedJobs,
        averagePerJob: completedJobs > 0 ? parseFloat((netEarnings / completedJobs).toFixed(2)) : 0
      },
      payout: payout ? {
        id: payout._id,
        status: payout.status,
        amount: parseFloat(payout.amount.toFixed(2)),
        method: payout.payoutMethod,
        createdAt: payout.createdAt
      } : null,
      transactionCount: payments.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch earnings details',
      error: error.message
    });
  }
};

// Request a payout
exports.requestPayout = async (req, res) => {
  try {
    const providerId = req.user.id;
    const { amount, payoutMethod, bankDetails, mpesaPhone } = req.body;

    // Validate amount
    if (!amount || amount < 100) {
      return res.status(400).json({
        success: false,
        message: 'Minimum payout amount is KES 100'
      });
    }

    // Get available balance
    const completedPayments = await Payment.find({
      providerId,
      status: 'completed'
    });

    const totalEarnings = completedPayments.reduce((sum, p) => sum + p.amount, 0);
    const platformCommission = totalEarnings * 0.15;

    // Get already paid out amount
    const processedPayouts = await Payout.find({
      providerId,
      status: 'completed'
    });

    const totalPaidOut = processedPayouts.reduce((sum, p) => sum + (p.breakdown?.netAmount || 0), 0);
    const availableBalance = totalEarnings - platformCommission - totalPaidOut;

    if (amount > availableBalance) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Available: KES ${availableBalance.toFixed(2)}`
      });
    }

    // Validate payout method
    if (!['bank_transfer', 'mpesa', 'wallet'].includes(payoutMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payout method'
      });
    }

    // Create payout request
    const payout = new Payout({
      providerId,
      amount,
      payoutMethod,
      bankDetails: payoutMethod === 'bank_transfer' ? bankDetails : undefined,
      mpesaPhone: payoutMethod === 'mpesa' ? mpesaPhone : undefined,
      status: 'pending',
      period: new Date().toISOString().split('T')[0],
      breakdown: {
        totalEarnings: amount,
        platformCommission: amount * 0.15,
        netAmount: amount * 0.85
      }
    });

    await payout.save();

    res.status(201).json({
      success: true,
      message: 'Payout request created successfully',
      payout: {
        id: payout._id,
        amount: parseFloat(payout.amount.toFixed(2)),
        status: payout.status,
        method: payout.payoutMethod,
        createdAt: payout.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create payout request',
      error: error.message
    });
  }
};

// Get earnings stats for dashboard
exports.getEarningsStats = async (req, res) => {
  try {
    const providerId = req.user.id;

    // This month's earnings
    const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const thisMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);

    const thisMonthPayments = await Payment.find({
      providerId,
      status: 'completed',
      completedAt: {
        $gte: thisMonthStart,
        $lte: thisMonthEnd
      }
    });

    const thisMonthEarnings = thisMonthPayments.reduce((sum, p) => sum + p.amount, 0);

    // Last month's earnings
    const lastMonthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    const lastMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth(), 0);

    const lastMonthPayments = await Payment.find({
      providerId,
      status: 'completed',
      completedAt: {
        $gte: lastMonthStart,
        $lte: lastMonthEnd
      }
    });

    const lastMonthEarnings = lastMonthPayments.reduce((sum, p) => sum + p.amount, 0);

    // Growth percentage
    const growthPercent = lastMonthEarnings > 0
      ? parseFloat((((thisMonthEarnings - lastMonthEarnings) / lastMonthEarnings) * 100).toFixed(2))
      : 0;

    // This month jobs
    const thisMonthJobs = await ServiceRequest.countDocuments({
      providerId,
      status: 'completed',
      completedAt: {
        $gte: thisMonthStart,
        $lte: thisMonthEnd
      }
    });

    res.status(200).json({
      success: true,
      stats: {
        thisMonth: {
          earnings: parseFloat(thisMonthEarnings.toFixed(2)),
          jobs: thisMonthJobs,
          avgPerJob: thisMonthJobs > 0 ? parseFloat((thisMonthEarnings / thisMonthJobs).toFixed(2)) : 0
        },
        lastMonth: {
          earnings: parseFloat(lastMonthEarnings.toFixed(2))
        },
        growth: growthPercent,
        currency: 'KES'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch earnings stats',
      error: error.message
    });
  }
};

// Helper function: Get earnings by month for last 12 months
async function getEarningsByMonth(providerId) {
  const months = [];
  const now = new Date();

  for (let i = 11; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);

    const payments = await Payment.find({
      providerId,
      status: 'completed',
      completedAt: {
        $gte: monthStart,
        $lte: monthEnd
      }
    });

    const earnings = payments.reduce((sum, p) => sum + p.amount, 0);

    months.push({
      month: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      earnings: parseFloat(earnings.toFixed(2)),
      jobs: payments.length
    });
  }

  return months;
}
