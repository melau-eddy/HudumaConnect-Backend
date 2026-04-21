const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
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
  requestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceRequest',
    required: true
  },
  rating: {
    type: Number,
    required: [true, 'Rating is required'],
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating cannot be more than 5']
  },
  comment: {
    type: String,
    required: [true, 'Review comment is required'],
    maxlength: [500, 'Review comment cannot be longer than 500 characters']
  },
  images: [{
    filename: String,
    originalName: String,
    url: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  isAnonymous: {
    type: Boolean,
    default: false
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  helpfulVotes: {
    type: Number,
    default: 0
  },
  reportCount: {
    type: Number,
    default: 0
  },
  isHidden: {
    type: Boolean,
    default: false
  },
  adminReview: {
    isReviewed: { type: Boolean, default: false },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    notes: String
  }
}, {
  timestamps: true
});

// Indexes for performance
reviewSchema.index({ providerId: 1, rating: -1 });
reviewSchema.index({ customerId: 1 });
reviewSchema.index({ requestId: 1 });
reviewSchema.index({ createdAt: -1 });
reviewSchema.index({ rating: -1, createdAt: -1 });

// Ensure one review per customer per request
reviewSchema.index({ customerId: 1, requestId: 1 }, { unique: true });

// Populate customer and provider data
reviewSchema.pre(/^find/, function() {
  this.populate({
    path: 'customerId',
    select: 'name avatar'
  }).populate({
    path: 'providerId',
    select: 'name'
  });
});

// Post-save middleware to update provider rating
reviewSchema.post('save', async function() {
  try {
    const Provider = mongoose.model('Provider');
    const provider = await Provider.findOne({ userId: this.providerId });

    if (provider) {
      // Recalculate provider rating
      const reviews = await this.constructor.find({ providerId: this.providerId });
      const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
      const averageRating = Math.round((totalRating / reviews.length) * 10) / 10;

      await Provider.findOneAndUpdate(
        { userId: this.providerId },
        {
          rating: averageRating,
          reviewCount: reviews.length
        }
      );
    }
  } catch (error) {
    console.error('Error updating provider rating:', error);
  }
});

// Instance method to mark as helpful
reviewSchema.methods.markAsHelpful = function() {
  this.helpfulVotes += 1;
  return this.save();
};

// Instance method to report review
reviewSchema.methods.report = function() {
  this.reportCount += 1;
  return this.save();
};

// Static method to get average rating for provider
reviewSchema.statics.getProviderRating = function(providerId) {
  return this.aggregate([
    { $match: { providerId: new mongoose.Types.ObjectId(providerId) } },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 },
        ratingDistribution: {
          $push: '$rating'
        }
      }
    }
  ]);
};

// Static method to get recent reviews
reviewSchema.statics.getRecentReviews = function(limit = 10) {
  return this.find({ isHidden: false })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('customerId', 'name avatar')
    .populate('providerId', 'name');
};

module.exports = mongoose.model('Review', reviewSchema);