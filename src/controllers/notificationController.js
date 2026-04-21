const Notification = require('../models/Notification');

/**
 * @desc    Get notifications for current user
 * @route   GET /api/notifications
 * @access  Private
 */
const getNotifications = async (req, res, next) => {
  try {
    const {
      type,
      isRead,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = -1
    } = req.query;

    // Parse boolean values
    const parsedIsRead = isRead !== undefined ? isRead === 'true' : undefined;

    const notifications = await Notification.getForUser(req.user.id, {
      type,
      isRead: parsedIsRead,
      page: parseInt(page),
      limit: parseInt(limit),
      sortBy,
      sortOrder: parseInt(sortOrder)
    });

    // Get total count for pagination
    const filter = { userId: req.user.id };
    if (type) filter.type = type;
    if (typeof parsedIsRead === 'boolean') filter.isRead = parsedIsRead;

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.getUnreadCount(req.user.id);

    res.status(200).json({
      success: true,
      count: notifications.length,
      total,
      unreadCount,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      notifications
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get unread notifications count
 * @route   GET /api/notifications/unread-count
 * @access  Private
 */
const getUnreadCount = async (req, res, next) => {
  try {
    const unreadCount = await Notification.getUnreadCount(req.user.id);

    res.status(200).json({
      success: true,
      unreadCount
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark notification as read
 * @route   PATCH /api/notifications/:id/read
 * @access  Private
 */
const markAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    await notification.markAsRead();

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      notification
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark all notifications as read
 * @route   PATCH /api/notifications/mark-all-read
 * @access  Private
 */
const markAllAsRead = async (req, res, next) => {
  try {
    await Notification.markAllAsRead(req.user.id);

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete notification
 * @route   DELETE /api/notifications/:id
 * @access  Private
 */
const deleteNotification = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete all notifications for user
 * @route   DELETE /api/notifications/all
 * @access  Private
 */
const deleteAllNotifications = async (req, res, next) => {
  try {
    const result = await Notification.deleteMany({
      userId: req.user.id
    });

    res.status(200).json({
      success: true,
      message: `${result.deletedCount} notifications deleted successfully`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create notification (Admin only)
 * @route   POST /api/notifications/create
 * @access  Private (Admin only)
 */
const createNotification = async (req, res, next) => {
  try {
    const {
      userId,
      title,
      message,
      type = 'system',
      category = 'info',
      priority = 'medium',
      data = {},
      expiresAt,
      sendVia = ['app']
    } = req.body;

    const notification = await Notification.createNotification({
      userId,
      title,
      message,
      type,
      category,
      priority,
      data,
      expiresAt,
      sendVia
    });

    res.status(201).json({
      success: true,
      message: 'Notification created successfully',
      notification
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get notification statistics (Admin only)
 * @route   GET /api/notifications/stats
 * @access  Private (Admin only)
 */
const getNotificationStats = async (req, res, next) => {
  try {
    const { period = '30d' } = req.query;

    // Calculate date range
    let startDate;
    const now = new Date();

    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const stats = await Notification.getStats({
      createdAt: { $gte: startDate }
    });

    // Get recent undelivered notifications
    const undelivered = await Notification.find({
      $or: [
        { 'deliveryStatus.app': false },
        { 'deliveryStatus.email': false },
        { 'deliveryStatus.sms': false },
        { 'deliveryStatus.push': false }
      ]
    })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate('userId', 'name email');

    res.status(200).json({
      success: true,
      stats: {
        period,
        overview: stats[0] || { total: 0, byType: [], byReadStatus: [], byPriority: [] },
        undelivered: {
          count: undelivered.length,
          notifications: undelivered
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Clean up expired notifications (Admin only)
 * @route   DELETE /api/notifications/cleanup
 * @access  Private (Admin only)
 */
const cleanupExpired = async (req, res, next) => {
  try {
    const result = await Notification.cleanupExpired();

    res.status(200).json({
      success: true,
      message: `${result.deletedCount} expired notifications cleaned up`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all notifications for admin management
 * @route   GET /api/notifications/admin/all
 * @access  Private (Admin only)
 */
const getAllNotifications = async (req, res, next) => {
  try {
    const {
      type,
      priority,
      isRead,
      userId,
      page = 1,
      limit = 50,
      sortBy = 'createdAt'
    } = req.query;

    let query = {};

    // Build query filters
    if (type) query.type = type;
    if (priority) query.priority = priority;
    if (typeof isRead === 'string') query.isRead = isRead === 'true';
    if (userId) query.userId = userId;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const sortOptions = {};
    sortOptions[sortBy] = sortBy === 'createdAt' ? -1 : 1;

    const notifications = await Notification.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('userId', 'name email role')
      .populate('data.requestId', 'serviceType status')
      .populate('data.providerId', 'name')
      .populate('data.customerId', 'name');

    const total = await Notification.countDocuments(query);

    res.status(200).json({
      success: true,
      count: notifications.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      notifications
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Send bulk notifications (Admin only)
 * @route   POST /api/notifications/admin/bulk
 * @access  Private (Admin only)
 */
const sendBulkNotifications = async (req, res, next) => {
  try {
    const {
      userIds,
      title,
      message,
      type = 'system',
      category = 'info',
      priority = 'medium',
      data = {},
      sendVia = ['app']
    } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'User IDs array is required'
      });
    }

    const notifications = [];

    for (const userId of userIds) {
      try {
        const notification = await Notification.createNotification({
          userId,
          title,
          message,
          type,
          category,
          priority,
          data,
          sendVia
        });
        notifications.push(notification);
      } catch (error) {
        console.error(`Failed to send notification to user ${userId}:`, error);
      }
    }

    res.status(201).json({
      success: true,
      message: `${notifications.length} notifications sent successfully`,
      count: notifications.length
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  createNotification,
  getNotificationStats,
  cleanupExpired,
  getAllNotifications,
  sendBulkNotifications
};