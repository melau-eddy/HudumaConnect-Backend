const Provider = require('../models/Provider');
const User = require('../models/User');
const ServiceRequest = require('../models/ServiceRequest');
const Notification = require('../models/Notification');
const mongoose = require('mongoose');
const { makeSafeRegex } = require('../utils/security');

/**
 * @desc    Get dashboard statistics
 * @route   GET /api/admin/dashboard
 * @access  Private (Admin only)
 */
const getDashboardStats = async (req, res, next) => {
  try {
    // Parallel queries for efficiency
    const [
      totalUsers,
      totalCustomers,
      totalProviders,
      approvedProviders,
      pendingProviders,
      rejectedProviders,
      totalRequests,
      requestStats,
      completedJobs,
      totalRevenue
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'customer' }),
      Provider.countDocuments(),
      Provider.countDocuments({ approvalStatus: 'approved', isActive: true }),
      Provider.countDocuments({ approvalStatus: 'pending' }),
      Provider.countDocuments({ approvalStatus: 'rejected' }),
      ServiceRequest.countDocuments(),
      ServiceRequest.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),
      ServiceRequest.countDocuments({ status: 'completed' }),
      ServiceRequest.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$finalCost', 0] } } } }
      ])
    ]);

    // Convert request stats to object
    const requestStatsObj = {
      pending: 0,
      accepted: 0,
      in_progress: 0,
      completed: 0,
      rejected: 0,
      cancelled: 0
    };

    requestStats.forEach(stat => {
      if (requestStatsObj.hasOwnProperty(stat._id)) {
        requestStatsObj[stat._id] = stat.count;
      }
    });

    const revenue = totalRevenue.length > 0 ? totalRevenue[0].total : 0;

    const stats = {
      totalUsers,
      totalCustomers,
      totalProviders,
      approvedProviders,
      pendingProviders,
      rejectedProviders,
      totalRequests,
      requestStats: requestStatsObj,
      completedJobs,
      totalRevenue: revenue
    };

    res.status(200).json({
      success: true,
      stats
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all providers with filters
 * @route   GET /api/admin/providers
 * @access  Private (Admin only)
 */
const getProviders = async (req, res, next) => {
  try {
    const { approvalStatus, search, page = 1, limit = 10 } = req.query;

    const query = {};
    if (approvalStatus) {
      query.approvalStatus = approvalStatus;
    }

    // Search by provider name or email - use safe regex pattern
    if (search) {
      const searchRegex = makeSafeRegex(search);
      if (searchRegex) {
        query.$or = [
          { 'userId.name': searchRegex },
          { 'userId.email': searchRegex },
          { bio: searchRegex }
        ];
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [providers, total] = await Promise.all([
      Provider.find(query)
        .populate('userId', 'name email phone avatar')
        .populate('approvedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Provider.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      count: providers.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      providers
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Approve a provider
 * @route   POST /api/admin/providers/:id/approve
 * @access  Private (Admin only)
 */
const approveProvider = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid provider ID' });
    }

    const provider = await Provider.findByIdAndUpdate(
      id,
      {
        approvalStatus: 'approved',
        approvedBy: req.user.id,
        approvalDate: new Date(),
        isActive: true
      },
      { new: true }
    ).populate('userId', 'name email');

    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    // Send notification to provider via Socket.IO
    const io = req.app.get('io');
    const notificationMessage = 'Your provider account has been approved! You can now accept service requests.';

    try {
      const notification = await Notification.createNotification({
        userId: provider.userId._id,
        type: 'provider_approved',
        title: 'Account Approved',
        message: notificationMessage,
        relatedId: provider._id,
        category: 'success'
      });

      // Emit via Socket.IO
      io.to(provider.userId._id.toString()).emit('notification', {
        _id: notification._id,
        type: 'provider_approved',
        title: 'Account Approved',
        message: notificationMessage,
        category: 'success'
      });
    } catch (notifError) {
      console.error('Error creating notification:', notifError);
      // Don't fail the approval if notification fails
    }

    res.status(200).json({
      success: true,
      message: 'Provider approved successfully',
      provider
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Reject a provider
 * @route   POST /api/admin/providers/:id/reject
 * @access  Private (Admin only)
 */
const rejectProvider = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    if (!rejectionReason || rejectionReason.trim() === '') {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid provider ID' });
    }

    const provider = await Provider.findByIdAndUpdate(
      id,
      {
        approvalStatus: 'rejected',
        rejectionReason,
        isActive: false
      },
      { new: true }
    ).populate('userId', 'name email');

    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider not found' });
    }

    // Send notification to provider via Socket.IO
    const io = req.app.get('io');
    const notificationMessage = `Your provider account has been rejected. Reason: ${rejectionReason}`;

    try {
      const notification = await Notification.createNotification({
        userId: provider.userId._id,
        type: 'provider_rejected',
        title: 'Account Rejected',
        message: notificationMessage,
        relatedId: provider._id,
        category: 'error'
      });

      // Emit via Socket.IO
      io.to(provider.userId._id.toString()).emit('notification', {
        _id: notification._id,
        type: 'provider_rejected',
        title: 'Account Rejected',
        message: notificationMessage,
        category: 'error'
      });
    } catch (notifError) {
      console.error('Error creating notification:', notifError);
      // Don't fail the rejection if notification fails
    }

    res.status(200).json({
      success: true,
      message: 'Provider rejected successfully',
      provider
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all users
 * @route   GET /api/admin/users
 * @access  Private (Admin only)
 */
const getUsers = async (req, res, next) => {
  try {
    const { role, search, page = 1, limit = 10 } = req.query;

    const query = {};
    if (role) {
      query.role = role;
    }

    // Search by name or email - use safe regex pattern
    if (search) {
      const searchRegex = makeSafeRegex(search);
      if (searchRegex) {
        query.$or = [
          { name: searchRegex },
          { email: searchRegex },
          { phone: searchRegex }
        ];
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      count: users.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      users
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Ban a user
 * @route   POST /api/admin/users/:id/ban
 * @access  Private (Admin only)
 */
const banUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    // Prevent banning self
    if (id === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot ban yourself' });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({
      success: true,
      message: 'User banned successfully',
      user
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Unban a user
 * @route   POST /api/admin/users/:id/unban
 * @access  Private (Admin only)
 */
const unbanUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { isActive: true },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({
      success: true,
      message: 'User unbanned successfully',
      user
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all service requests
 * @route   GET /api/admin/requests
 * @access  Private (Admin only)
 */
const getServiceRequests = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;

    const query = {};
    if (status) {
      query.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [requests, total] = await Promise.all([
      ServiceRequest.find(query)
        .populate('customerId', 'name email phone')
        .populate('providerId', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      ServiceRequest.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      count: requests.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      requests
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get complaints
 * @route   GET /api/admin/complaints
 * @access  Private (Admin only)
 */
const getComplaints = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    // For now, return empty list if Complaint model doesn't exist
    // This can be expanded when complaint system is implemented
    res.status(200).json({
      success: true,
      count: 0,
      total: 0,
      page: parseInt(page),
      pages: 0,
      complaints: []
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all admins
 * @route   GET /api/admin/admins
 * @access  Private (Admin only)
 */
const getAdmins = async (req, res, next) => {
  try {
    const admins = await User.find({ role: 'admin' })
      .select('-password')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: admins.length,
      admins
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboardStats,
  getProviders,
  approveProvider,
  rejectProvider,
  getUsers,
  banUser,
  unbanUser,
  getServiceRequests,
  getComplaints,
  getAdmins
};
