const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  serviceRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceRequest',
    required: [true, 'Service request is required for messaging'],
    index: true
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Sender is required']
  },
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Recipient is required']
  },
  content: {
    type: String,
    required: [true, 'Message content is required'],
    maxlength: [2000, 'Message cannot be longer than 2000 characters'],
    trim: true
  },
  attachments: [{
    filename: String,
    fileUrl: String,
    mimeType: String,
    size: Number
  }],
  isRead: {
    type: Boolean,
    default: false,
    index: true
  },
  readAt: Date,
  deletedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: Date
}, {
  timestamps: true
});

// Indexes for performance
messageSchema.index({ serviceRequestId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, recipientId: 1 });
messageSchema.index({ serviceRequestId: 1, isRead: 1 });

// Populate sender and recipient data
messageSchema.pre(/^find/, function() {
  this.populate({
    path: 'senderId',
    select: 'name avatar email'
  }).populate({
    path: 'recipientId',
    select: 'name avatar email'
  });
});

// Instance method to mark as read
messageSchema.methods.markAsRead = function() {
  this.isRead = true;
  this.readAt = new Date();
  return this.save();
};

// Instance method to check if user has deleted the message
messageSchema.methods.isDeletedBy = function(userId) {
  return this.deletedBy.some(id => id.toString() === userId.toString());
};

// Static method to get conversation between two users for a service request
messageSchema.statics.getConversation = function(serviceRequestId, options = {}) {
  const {
    page = 1,
    limit = 20
  } = options;

  const skip = (page - 1) * limit;

  return this.find({ serviceRequestId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('senderId', 'name avatar email')
    .populate('recipientId', 'name avatar email')
    .lean();
};

// Static method to get unread message count for a user
messageSchema.statics.getUnreadCount = function(userId) {
  return this.countDocuments({
    recipientId: userId,
    isRead: false
  });
};

// Static method to get unread count per conversation
messageSchema.statics.getUnreadCountByConversation = function(userId) {
  return this.aggregate([
    {
      $match: {
        recipientId: new mongoose.Types.ObjectId(userId),
        isRead: false
      }
    },
    {
      $group: {
        _id: '$serviceRequestId',
        unreadCount: { $sum: 1 }
      }
    }
  ]);
};

// Static method to get all conversations for a user
messageSchema.statics.getConversations = function(userId, options = {}) {
  const {
    page = 1,
    limit = 20
  } = options;

  const skip = (page - 1) * limit;

  return this.aggregate([
    {
      $match: {
        $or: [
          { senderId: new mongoose.Types.ObjectId(userId) },
          { recipientId: new mongoose.Types.ObjectId(userId) }
        ]
      }
    },
    {
      $sort: { createdAt: -1 }
    },
    {
      $group: {
        _id: '$serviceRequestId',
        lastMessage: { $first: '$$ROOT' },
        unreadCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$recipientId', new mongoose.Types.ObjectId(userId)] },
                  { $eq: ['$isRead', false] }
                ]
              },
              1,
              0
            ]
          }
        }
      }
    },
    {
      $sort: { 'lastMessage.createdAt': -1 }
    },
    {
      $skip: skip
    },
    {
      $limit: limit
    },
    {
      $lookup: {
        from: 'servicerequests',
        localField: '_id',
        foreignField: '_id',
        as: 'serviceRequest'
      }
    },
    {
      $unwind: '$serviceRequest'
    },
    {
      $lookup: {
        from: 'users',
        localField: 'lastMessage.senderId',
        foreignField: '_id',
        as: 'sender'
      }
    },
    {
      $unwind: '$sender'
    },
    {
      $lookup: {
        from: 'users',
        localField: 'lastMessage.recipientId',
        foreignField: '_id',
        as: 'recipient'
      }
    },
    {
      $unwind: '$recipient'
    }
  ]);
};

// Static method to soft delete a message (mark as deleted by user)
messageSchema.statics.softDelete = function(messageId, userId) {
  return this.findByIdAndUpdate(
    messageId,
    {
      $addToSet: { deletedBy: userId }
    },
    { new: true }
  );
};

// Static method to get messages stats for a service request
messageSchema.statics.getConversationStats = function(serviceRequestId) {
  return this.aggregate([
    {
      $match: { serviceRequestId: new mongoose.Types.ObjectId(serviceRequestId) }
    },
    {
      $group: {
        _id: null,
        totalMessages: { $sum: 1 },
        readMessages: {
          $sum: { $cond: [{ $eq: ['$isRead', true] }, 1, 0] }
        },
        unreadMessages: {
          $sum: { $cond: [{ $eq: ['$isRead', false] }, 1, 0] }
        },
        messagesWithAttachments: {
          $sum: { $cond: [{ $gt: [{ $size: '$attachments' }, 0] }, 1, 0] }
        }
      }
    }
  ]);
};

module.exports = mongoose.model('Message', messageSchema);
