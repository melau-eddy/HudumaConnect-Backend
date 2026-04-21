const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: [true, 'Notification title is required'],
    maxlength: [100, 'Title cannot be longer than 100 characters']
  },
  message: {
    type: String,
    required: [true, 'Notification message is required'],
    maxlength: [500, 'Message cannot be longer than 500 characters']
  },
  type: {
    type: String,
    enum: ['request', 'status', 'review', 'system', 'payment', 'reminder', 'complaint'],
    default: 'system'
  },
  category: {
    type: String,
    enum: ['info', 'warning', 'success', 'error'],
    default: 'info'
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: Date,
  data: {
    // Additional data related to the notification
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceRequest' },
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    complaintId: { type: mongoose.Schema.Types.ObjectId, ref: 'Complaint' },
    reviewId: { type: mongoose.Schema.Types.ObjectId, ref: 'Review' },
    amount: Number,
    url: String,
    actionRequired: Boolean
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  expiresAt: Date,
  isSystem: {
    type: Boolean,
    default: false
  },
  sentVia: [{
    type: String,
    enum: ['app', 'email', 'sms', 'push']
  }],
  deliveryStatus: {
    app: { type: Boolean, default: false },
    email: { type: Boolean, default: false },
    sms: { type: Boolean, default: false },
    push: { type: Boolean, default: false }
  },
  metadata: {
    source: String,
    campaign: String,
    tags: [String]
  }
}, {
  timestamps: true
});

// Indexes for performance
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, type: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
notificationSchema.index({ priority: 1, createdAt: -1 });

// Populate related data
notificationSchema.pre(/^find/, function() {
  this.populate({
    path: 'data.requestId',
    select: 'serviceType status dateTime'
  }).populate({
    path: 'data.providerId',
    select: 'name avatar'
  }).populate({
    path: 'data.customerId',
    select: 'name avatar'
  });
});

// Instance method to mark as read
notificationSchema.methods.markAsRead = function() {
  this.isRead = true;
  this.readAt = new Date();
  return this.save();
};

// Instance method to check if expired
notificationSchema.methods.isExpired = function() {
  return this.expiresAt && this.expiresAt < new Date();
};

// Static method to create notification
notificationSchema.statics.createNotification = async function({
  userId,
  title,
  message,
  type = 'system',
  category = 'info',
  priority = 'medium',
  data = {},
  expiresAt = null,
  sendVia = ['app']
}) {
  const notification = new this({
    userId,
    title,
    message,
    type,
    category,
    priority,
    data,
    expiresAt,
    sentVia: sendVia
  });

  await notification.save();

  // Send real-time notification via Socket.IO
  const app = require('../app');
  const io = app.get('io');
  if (io) {
    io.to(userId.toString()).emit('notification', notification);
  }

  return notification;
};

// Static method to mark all as read for user
notificationSchema.statics.markAllAsRead = function(userId) {
  return this.updateMany(
    { userId, isRead: false },
    {
      isRead: true,
      readAt: new Date()
    }
  );
};

// Static method to get unread count
notificationSchema.statics.getUnreadCount = function(userId) {
  return this.countDocuments({ userId, isRead: false });
};

// Static method to get notifications for user
notificationSchema.statics.getForUser = function(userId, options = {}) {
  const {
    type,
    isRead,
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = -1
  } = options;

  const filter = { userId };

  if (type) filter.type = type;
  if (typeof isRead === 'boolean') filter.isRead = isRead;

  const skip = (page - 1) * limit;
  const sort = {};
  sort[sortBy] = sortOrder;

  return this.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .populate('data.requestId', 'serviceType status dateTime')
    .populate('data.providerId', 'name avatar')
    .populate('data.customerId', 'name avatar');
};

// Static method to clean up expired notifications
notificationSchema.statics.cleanupExpired = function() {
  return this.deleteMany({
    expiresAt: { $lt: new Date() }
  });
};

// Static method to get notification stats for admin
notificationSchema.statics.getStats = function(filter = {}) {
  return this.aggregate([
    { $match: filter },
    {
      $group: {
        _id: {
          type: '$type',
          isRead: '$isRead',
          priority: '$priority'
        },
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$count' },
        byType: {
          $push: {
            type: '$_id.type',
            count: '$count'
          }
        },
        byReadStatus: {
          $push: {
            isRead: '$_id.isRead',
            count: '$count'
          }
        },
        byPriority: {
          $push: {
            priority: '$_id.priority',
            count: '$count'
          }
        }
      }
    }
  ]);
};

// Helper methods for different notification types
notificationSchema.statics.notifyNewRequest = function(providerId, request) {
  return this.createNotification({
    userId: providerId,
    title: 'New Service Request',
    message: `You have a new ${request.serviceType} request from ${request.customerId.name}`,
    type: 'request',
    category: 'info',
    data: {
      requestId: request._id,
      customerId: request.customerId._id
    }
  });
};

notificationSchema.statics.notifyRequestStatus = function(customerId, request, status) {
  const statusMessages = {
    accepted: `Your ${request.serviceType} request has been accepted`,
    in_progress: `Your ${request.serviceType} service has started`,
    completed: `Your ${request.serviceType} service has been completed`,
    rejected: `Your ${request.serviceType} request has been declined`,
    cancelled: `Your ${request.serviceType} request has been cancelled`
  };

  return this.createNotification({
    userId: customerId,
    title: 'Request Status Update',
    message: statusMessages[status] || `Your request status has been updated to ${status}`,
    type: 'status',
    category: status === 'completed' ? 'success' : 'info',
    data: {
      requestId: request._id,
      providerId: request.providerId
    }
  });
};

notificationSchema.statics.notifyNewReview = function(providerId, review) {
  return this.createNotification({
    userId: providerId,
    title: 'New Review',
    message: `${review.customerId.name} left a ${review.rating}-star review for your service`,
    type: 'review',
    category: 'success',
    data: {
      reviewId: review._id,
      customerId: review.customerId._id,
      requestId: review.requestId
    }
  });
};

notificationSchema.statics.notifyComplaintResponse = function(customerId, complaint) {
  return this.createNotification({
    userId: customerId,
    title: 'Complaint Update',
    message: `We have responded to your complaint: ${complaint.subject}`,
    type: 'complaint',
    category: 'info',
    data: {
      complaintId: complaint._id
    }
  });
};

module.exports = mongoose.model('Notification', notificationSchema);