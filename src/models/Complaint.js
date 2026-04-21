const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  providerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  requestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceRequest'
  },
  type: {
    type: String,
    required: [true, 'Complaint type is required'],
    enum: ['service_quality', 'pricing', 'behavior', 'no_show', 'technical_issue', 'other']
  },
  subject: {
    type: String,
    required: [true, 'Complaint subject is required'],
    maxlength: [100, 'Subject cannot be longer than 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Complaint description is required'],
    minlength: [10, 'Description must be at least 10 characters'],
    maxlength: [500, 'Description cannot be longer than 500 characters']
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['open', 'in_review', 'resolved', 'closed'],
    default: 'open'
  },
  statusHistory: [{
    status: {
      type: String,
      enum: ['open', 'in_review', 'resolved', 'closed']
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    comment: String
  }],
  adminResponse: String,
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  adminName: String,
  resolvedAt: Date,
  resolutionNotes: String,
  attachments: [{
    filename: String,
    originalName: String,
    url: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  internalNotes: [{
    note: String,
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  escalationLevel: {
    type: Number,
    default: 1,
    min: 1,
    max: 3
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  dueDate: Date,
  tags: [String],
  isAnonymous: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes for performance
complaintSchema.index({ customerId: 1, status: 1 });
complaintSchema.index({ providerId: 1, status: 1 });
complaintSchema.index({ type: 1, status: 1 });
complaintSchema.index({ status: 1, priority: 1, createdAt: -1 });
complaintSchema.index({ assignedTo: 1, status: 1 });

// Populate related data
complaintSchema.pre(/^find/, function() {
  this.populate({
    path: 'customerId',
    select: 'name email phone avatar'
  }).populate({
    path: 'providerId',
    select: 'name email phone avatar'
  }).populate({
    path: 'requestId',
    select: 'serviceType description dateTime status'
  }).populate({
    path: 'assignedTo',
    select: 'name email'
  });
});

// Pre-save middleware to add status history
complaintSchema.pre('save', function() {
  if (this.isModified('status') && !this.isNew) {
    this.statusHistory.push({
      status: this.status,
      timestamp: new Date()
    });

    // Set resolved timestamp
    if (this.status === 'resolved') {
      this.resolvedAt = new Date();
    }
  }

  // Set due date based on priority if not set
  if (this.isNew && !this.dueDate) {
    const now = new Date();
    switch (this.priority) {
      case 'urgent':
        this.dueDate = new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4 hours
        break;
      case 'high':
        this.dueDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 1 day
        break;
      case 'medium':
        this.dueDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days
        break;
      case 'low':
        this.dueDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
        break;
    }
  }
});

// Instance method to update status with history
complaintSchema.methods.updateStatus = function(newStatus, updatedBy, comment, resolutionNotes) {
  this.status = newStatus;
  this.statusHistory.push({
    status: newStatus,
    timestamp: new Date(),
    updatedBy,
    comment
  });

  if (newStatus === 'resolved') {
    this.resolvedAt = new Date();
    if (resolutionNotes) {
      this.resolutionNotes = resolutionNotes;
    }
  }

  return this.save();
};

// Instance method to add internal note
complaintSchema.methods.addInternalNote = function(note, addedBy) {
  this.internalNotes.push({
    note,
    addedBy,
    addedAt: new Date()
  });
  return this.save();
};

// Instance method to escalate complaint
complaintSchema.methods.escalate = function() {
  if (this.escalationLevel < 3) {
    this.escalationLevel += 1;

    // Adjust due date for escalated complaints
    const now = new Date();
    switch (this.escalationLevel) {
      case 2:
        this.dueDate = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours
        break;
      case 3:
        this.dueDate = new Date(now.getTime() + 1 * 60 * 60 * 1000); // 1 hour
        break;
    }
  }
  return this.save();
};

// Instance method to check if overdue
complaintSchema.methods.isOverdue = function() {
  return this.dueDate && this.dueDate < new Date() && !['resolved', 'closed'].includes(this.status);
};

// Static method to find complaints by status
complaintSchema.statics.findByStatus = function(status, filter = {}) {
  return this.find({
    ...filter,
    status
  }).sort({ priority: 1, createdAt: -1 });
};

// Static method to find overdue complaints
complaintSchema.statics.findOverdue = function() {
  return this.find({
    status: { $nin: ['resolved', 'closed'] },
    dueDate: { $lt: new Date() }
  }).sort({ dueDate: 1 });
};

// Static method to get complaint statistics
complaintSchema.statics.getStats = function(filter = {}) {
  return this.aggregate([
    { $match: filter },
    {
      $group: {
        _id: {
          status: '$status',
          priority: '$priority',
          type: '$type'
        },
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$count' },
        byStatus: {
          $push: {
            status: '$_id.status',
            count: '$count'
          }
        },
        byPriority: {
          $push: {
            priority: '$_id.priority',
            count: '$count'
          }
        },
        byType: {
          $push: {
            type: '$_id.type',
            count: '$count'
          }
        }
      }
    }
  ]);
};

// Static method to get urgent complaints
complaintSchema.statics.findUrgent = function() {
  return this.find({
    priority: 'urgent',
    status: { $nin: ['resolved', 'closed'] }
  }).sort({ createdAt: -1 });
};

// Virtual for time since creation
complaintSchema.virtual('age').get(function() {
  return Date.now() - this.createdAt.getTime();
});

// Virtual for time until due
complaintSchema.virtual('timeUntilDue').get(function() {
  if (!this.dueDate) return null;
  return this.dueDate.getTime() - Date.now();
});

module.exports = mongoose.model('Complaint', complaintSchema);