const mongoose = require('mongoose');

const providerSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  bio: {
    type: String,
    default: '',
    maxlength: [500, 'Bio cannot be longer than 500 characters']
  },
  services: [{
    type: String,
    enum: ['Electricians', 'Plumbers', 'Mechanics', 'Cleaners', 'Phone Repair', 'Painters', 'Carpenters', 'Landscapers']
  }],
  priceRange: {
    type: String,
    default: ''
  },
  location: {
    type: String,
    default: ''
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
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  reviewCount: {
    type: Number,
    default: 0
  },
  completedJobs: {
    type: Number,
    default: 0
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  approvalStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  approvalDate: Date,
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectionReason: String,
  documents: [{
    type: {
      type: String,
      enum: ['id_card', 'certificate', 'license', 'other']
    },
    filename: String,
    originalName: String,
    url: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  portfolio: [{
    filename: String,
    originalName: String,
    url: String,
    description: {
      type: String,
      maxlength: [200, 'Image description cannot be longer than 200 characters']
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  availability: {
    monday: {
      isAvailable: { type: Boolean, default: true },
      startTime: { type: String, default: '08:00' },
      endTime: { type: String, default: '18:00' }
    },
    tuesday: {
      isAvailable: { type: Boolean, default: true },
      startTime: { type: String, default: '08:00' },
      endTime: { type: String, default: '18:00' }
    },
    wednesday: {
      isAvailable: { type: Boolean, default: true },
      startTime: { type: String, default: '08:00' },
      endTime: { type: String, default: '18:00' }
    },
    thursday: {
      isAvailable: { type: Boolean, default: true },
      startTime: { type: String, default: '08:00' },
      endTime: { type: String, default: '18:00' }
    },
    friday: {
      isAvailable: { type: Boolean, default: true },
      startTime: { type: String, default: '08:00' },
      endTime: { type: String, default: '18:00' }
    },
    saturday: {
      isAvailable: { type: Boolean, default: true },
      startTime: { type: String, default: '08:00' },
      endTime: { type: String, default: '18:00' }
    },
    sunday: {
      isAvailable: { type: Boolean, default: false },
      startTime: { type: String, default: '08:00' },
      endTime: { type: String, default: '18:00' }
    }
  },
  socialMedia: {
    facebook: String,
    instagram: String,
    twitter: String,
    whatsapp: String
  },
  bankDetails: {
    bankName: String,
    accountNumber: String,
    accountName: String,
    branch: String
  },
  isAcceptingJobs: {
    type: Boolean,
    default: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  responseRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  averageResponseTime: {
    type: Number, // in minutes
    default: 0
  }
}, {
  timestamps: true
});

// Indexes for performance
providerSchema.index({ userId: 1 });
providerSchema.index({ services: 1, approvalStatus: 1 });
providerSchema.index({ location: 'text' });
providerSchema.index({ rating: -1 });
providerSchema.index({ approvalStatus: 1, createdAt: -1 });

// Geospatial index for location-based searches
providerSchema.index({
  latitude: 1,
  longitude: 1
}, {
  sparse: true
});

// Populate user data when querying providers
providerSchema.pre(/^find/, function() {
  this.populate({
    path: 'userId',
    select: 'name email phone avatar isActive'
  });
});

// Instance method to calculate distance from a point
providerSchema.methods.calculateDistance = function(userLat, userLon) {
  if (!this.latitude || !this.longitude) return null;

  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(userLat - this.latitude);
  const dLon = toRadians(userLon - this.longitude);

  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(toRadians(this.latitude)) * Math.cos(toRadians(userLat)) *
    Math.sin(dLon/2) * Math.sin(dLon/2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;

  return Math.round(distance * 10) / 10; // Round to 1 decimal place
};

// Instance method to update rating
providerSchema.methods.updateRating = async function(newRating) {
  const totalRating = (this.rating * this.reviewCount) + newRating;
  this.reviewCount += 1;
  this.rating = Math.round((totalRating / this.reviewCount) * 10) / 10;

  return this.save();
};

// Static method to find approved providers
providerSchema.statics.findApproved = function(filter = {}) {
  return this.find({
    ...filter,
    approvalStatus: 'approved'
  }).populate('userId', 'name email phone avatar isActive');
};

// Static method to search providers
providerSchema.statics.searchProviders = function({
  query,
  category,
  latitude,
  longitude,
  radius = 10,
  minRating = 0,
  sortBy = 'rating',
  page = 1,
  limit = 20
}) {
  const aggregation = [];

  // Match approved providers
  const matchStage = {
    approvalStatus: 'approved'
  };

  // Add category filter
  if (category) {
    matchStage.services = category;
  }

  // Add rating filter
  if (minRating > 0) {
    matchStage.rating = { $gte: minRating };
  }

  // Add text search
  if (query) {
    matchStage.$text = { $search: query };
  }

  aggregation.push({ $match: matchStage });

  // Add distance calculation if coordinates provided
  if (latitude && longitude) {
    aggregation.push({
      $addFields: {
        distance: {
          $cond: {
            if: {
              $and: [
                { $ne: ['$latitude', null] },
                { $ne: ['$longitude', null] }
              ]
            },
            then: {
              $multiply: [
                6371,
                {
                  $acos: {
                    $add: [
                      {
                        $multiply: [
                          { $sin: { $multiply: [{ $degreesToRadians: latitude }, 1] } },
                          { $sin: { $multiply: [{ $degreesToRadians: '$latitude' }, 1] } }
                        ]
                      },
                      {
                        $multiply: [
                          { $cos: { $multiply: [{ $degreesToRadians: latitude }, 1] } },
                          { $cos: { $multiply: [{ $degreesToRadians: '$latitude' }, 1] } },
                          { $cos: { $multiply: [{ $degreesToRadians: { $subtract: [longitude, '$longitude'] } }, 1] } }
                        ]
                      }
                    ]
                  }
                }
              ]
            },
            else: null
          }
        }
      }
    });

    // Filter by radius if specified
    if (radius) {
      aggregation.push({
        $match: {
          $or: [
            { distance: { $lte: radius } },
            { distance: null }
          ]
        }
      });
    }
  }

  // Populate user data
  aggregation.push({
    $lookup: {
      from: 'users',
      localField: 'userId',
      foreignField: '_id',
      as: 'user'
    }
  });

  aggregation.push({
    $unwind: '$user'
  });

  // Sort
  const sortOptions = {};
  switch (sortBy) {
    case 'distance':
      if (latitude && longitude) {
        sortOptions.distance = 1;
      } else {
        sortOptions.rating = -1;
      }
      break;
    case 'rating':
      sortOptions.rating = -1;
      sortOptions.reviewCount = -1;
      break;
    case 'reviews':
      sortOptions.reviewCount = -1;
      sortOptions.rating = -1;
      break;
    case 'jobs':
      sortOptions.completedJobs = -1;
      sortOptions.rating = -1;
      break;
    default:
      sortOptions.rating = -1;
  }

  aggregation.push({ $sort: sortOptions });

  // Pagination
  const skip = (page - 1) * limit;
  aggregation.push({ $skip: skip });
  aggregation.push({ $limit: parseInt(limit) });

  return this.aggregate(aggregation);
};

// Helper function to convert degrees to radians
function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

module.exports = mongoose.model('Provider', providerSchema);