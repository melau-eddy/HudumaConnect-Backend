const mongoose = require('mongoose');

const serviceRequestSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  providerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  serviceType: {
    type: String,
    required: [true, 'Service type is required'],
    enum: ['Electricians', 'Plumbers', 'Mechanics', 'Cleaners', 'Phone Repair', 'Painters', 'Carpenters', 'Landscapers']
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    minlength: [10, 'Description must be at least 10 characters'],
    maxlength: [500, 'Description cannot be longer than 500 characters']
  },
  location: {
    type: String,
    required: [true, 'Location is required']
  },
  latitude: {
    type: Number,
    min: -90,
    max: 90
  },
  longitude: {
    type: Number,
    min: -180,
    max: 180
  },
  dateTime: {
    type: Date,
    required: [true, 'Date and time is required']
  },
  urgency: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  budget: {
    type: Number,
    min: 0
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'in_progress', 'completed', 'rejected', 'cancelled'],
    default: 'pending'
  },
  statusHistory: [{
    status: {
      type: String,
      enum: ['pending', 'accepted', 'in_progress', 'completed', 'rejected', 'cancelled']
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
  acceptedAt: Date,
  startedAt: Date,
  completedAt: Date,
  cancelledAt: Date,
  rejectionReason: String,
  cancellationReason: String,
  customerNotes: String,
  providerNotes: String,
  estimatedCost: {
    type: Number,
    min: 0
  },
  finalCost: {
    type: Number,
    min: 0
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'refunded'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'mpesa', 'bank_transfer', 'card']
  },
  images: [{
    filename: String,
    originalName: String,
    url: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  isReviewed: {
    type: Boolean,
    default: false
  },
  priority: {
    type: Number,
    default: 1,
    min: 1,
    max: 10
  }
}, {
  timestamps: true
});

// Indexes for performance
serviceRequestSchema.index({ customerId: 1, status: 1 });
serviceRequestSchema.index({ providerId: 1, status: 1 });
serviceRequestSchema.index({ serviceType: 1, status: 1 });
serviceRequestSchema.index({ status: 1, dateTime: -1 });
serviceRequestSchema.index({ createdAt: -1 });

// Geospatial index for location-based searches
serviceRequestSchema.index({
  latitude: 1,
  longitude: 1
}, {
  sparse: true
});

// Pre-save middleware to add status history
serviceRequestSchema.pre('save', function() {
  if (this.isModified('status') && !this.isNew) {
    this.statusHistory.push({
      status: this.status,
      timestamp: new Date()
    });

    // Set timestamp fields based on status
    switch (this.status) {
      case 'accepted':
        this.acceptedAt = new Date();
        break;
      case 'in_progress':
        this.startedAt = new Date();
        break;
      case 'completed':
        this.completedAt = new Date();
        break;
      case 'cancelled':
        this.cancelledAt = new Date();
        break;
    }
  }
});

// Populate customer and provider data when querying
serviceRequestSchema.pre(/^find/, function() {
  this.populate({
    path: 'customerId',
    select: 'name email phone avatar'
  }).populate({
    path: 'providerId',
    select: 'name email phone avatar'
  });
});

// Instance method to update status with history
serviceRequestSchema.methods.updateStatus = function(newStatus, updatedBy, comment) {
  this.status = newStatus;
  this.statusHistory.push({
    status: newStatus,
    timestamp: new Date(),
    updatedBy,
    comment
  });

  // Set appropriate timestamp fields
  switch (newStatus) {
    case 'accepted':
      this.acceptedAt = new Date();
      break;
    case 'in_progress':
      this.startedAt = new Date();
      break;
    case 'completed':
      this.completedAt = new Date();
      break;
    case 'cancelled':
      this.cancelledAt = new Date();
      break;
  }

  return this.save();
};

// Instance method to check if request can be cancelled
serviceRequestSchema.methods.canBeCancelled = function() {
  return ['pending'].includes(this.status);
};

// Instance method to check if request can be accepted
serviceRequestSchema.methods.canBeAccepted = function() {
  return this.status === 'pending';
};

// Instance method to check if request can be started
serviceRequestSchema.methods.canBeStarted = function() {
  return this.status === 'accepted';
};

// Instance method to check if request can be completed
serviceRequestSchema.methods.canBeCompleted = function() {
  return this.status === 'in_progress';
};

// Instance method to calculate duration
serviceRequestSchema.methods.getDuration = function() {
  if (this.startedAt && this.completedAt) {
    return this.completedAt - this.startedAt;
  }
  return null;
};

// Static method to find requests by status
serviceRequestSchema.statics.findByStatus = function(status, filter = {}) {
  return this.find({
    ...filter,
    status
  }).sort({ createdAt: -1 });
};

// Static method to find pending requests for a service type
serviceRequestSchema.statics.findPendingByService = function(serviceType, location, radius = 10) {
  const query = {
    status: 'pending',
    serviceType
  };

  if (location && location.latitude && location.longitude) {
    query.location = {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [location.longitude, location.latitude]
        },
        $maxDistance: radius * 1000 // Convert km to meters
      }
    };
  }

  return this.find(query).sort({ urgency: -1, createdAt: 1 });
};

// Static method to get request statistics
serviceRequestSchema.statics.getStats = function(filter = {}) {
  return this.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$count' },
        statusBreakdown: {
          $push: {
            status: '$_id',
            count: '$count'
          }
        }
      }
    }
  ]);
};

// Virtual for request age
serviceRequestSchema.virtual('age').get(function() {
  return Date.now() - this.createdAt.getTime();
});

module.exports = mongoose.model('ServiceRequest', serviceRequestSchema);