const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
  providerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Provider ID is required']
  },
  name: {
    type: String,
    required: [true, 'Service name is required'],
    trim: true,
    maxlength: [100, 'Service name cannot be longer than 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Service description is required'],
    trim: true,
    maxlength: [500, 'Service description cannot be longer than 500 characters']
  },
  category: {
    type: String,
    required: [true, 'Service category is required'],
    enum: ['Electricians', 'Plumbers', 'Mechanics', 'Cleaners', 'Phone Repair', 'Painters', 'Carpenters', 'Landscapers']
  },
  priceType: {
    type: String,
    enum: ['fixed', 'range', 'hourly', 'negotiable'],
    default: 'fixed'
  },
  minPrice: {
    type: Number,
    required: function() {
      return this.priceType === 'fixed' || this.priceType === 'range' || this.priceType === 'hourly';
    },
    min: [0, 'Price cannot be negative']
  },
  maxPrice: {
    type: Number,
    required: function() {
      return this.priceType === 'range';
    },
    min: [0, 'Price cannot be negative'],
    validate: {
      validator: function(value) {
        return this.priceType !== 'range' || value > this.minPrice;
      },
      message: 'Maximum price must be greater than minimum price'
    }
  },
  currency: {
    type: String,
    default: 'KSh'
  },
  duration: {
    estimate: {
      type: Number, // in minutes
      min: [1, 'Duration must be at least 1 minute']
    },
    unit: {
      type: String,
      enum: ['minutes', 'hours', 'days'],
      default: 'hours'
    }
  },
  availability: {
    days: [{
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    }],
    hours: {
      start: {
        type: String,
        match: [/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (use HH:MM)']
      },
      end: {
        type: String,
        match: [/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (use HH:MM)']
      }
    }
  },
  images: [{
    type: String, // URLs to service images
    validate: {
      validator: function(url) {
        return /^https?:\/\/.+\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url);
      },
      message: 'Invalid image URL format'
    }
  }],
  tags: [{
    type: String,
    trim: true,
    maxlength: [50, 'Tag cannot be longer than 50 characters']
  }],
  features: [{
    type: String,
    trim: true,
    maxlength: [100, 'Feature description cannot be longer than 100 characters']
  }],
  requirements: [{
    type: String,
    trim: true,
    maxlength: [100, 'Requirement cannot be longer than 100 characters']
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  isPopular: {
    type: Boolean,
    default: false
  },
  bookingCount: {
    type: Number,
    default: 0,
    min: [0, 'Booking count cannot be negative']
  },
  averageRating: {
    type: Number,
    default: 0,
    min: [0, 'Rating cannot be negative'],
    max: [5, 'Rating cannot exceed 5']
  },
  reviewCount: {
    type: Number,
    default: 0,
    min: [0, 'Review count cannot be negative']
  },
  location: {
    address: String,
    city: String,
    region: String,
    coordinates: {
      latitude: {
        type: Number,
        min: [-90, 'Latitude must be between -90 and 90'],
        max: [90, 'Latitude must be between -90 and 90']
      },
      longitude: {
        type: Number,
        min: [-180, 'Longitude must be between -180 and 180'],
        max: [180, 'Longitude must be between -180 and 180']
      }
    }
  },
  metadata: {
    lastBooking: Date,
    totalEarnings: {
      type: Number,
      default: 0,
      min: [0, 'Earnings cannot be negative']
    },
    popularityScore: {
      type: Number,
      default: 0,
      min: [0, 'Popularity score cannot be negative']
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
serviceSchema.index({ providerId: 1, isActive: 1 });
serviceSchema.index({ category: 1, isActive: 1 });
serviceSchema.index({ isActive: 1, isPopular: 1, createdAt: -1 });
serviceSchema.index({ 'location.coordinates.latitude': 1, 'location.coordinates.longitude': 1 });
serviceSchema.index({
  name: 'text',
  description: 'text',
  tags: 'text',
  category: 'text'
}, {
  weights: {
    name: 10,
    category: 8,
    tags: 5,
    description: 1
  },
  name: 'service_search_index'
});

// Virtual for formatted price
serviceSchema.virtual('formattedPrice').get(function() {
  if (this.priceType === 'negotiable') {
    return 'Negotiable';
  }

  if (this.priceType === 'range') {
    return `${this.currency} ${this.minPrice?.toLocaleString()} - ${this.maxPrice?.toLocaleString()}`;
  }

  if (this.priceType === 'hourly') {
    return `${this.currency} ${this.minPrice?.toLocaleString()}/hour`;
  }

  return `${this.currency} ${this.minPrice?.toLocaleString()}`;
});

// Virtual for provider info (populated)
serviceSchema.virtual('provider', {
  ref: 'User',
  localField: 'providerId',
  foreignField: '_id',
  justOne: true
});

// Pre-save middleware to validate price consistency
serviceSchema.pre('save', function() {
  // Ensure maxPrice is greater than minPrice for range pricing
  if (this.priceType === 'range' && this.maxPrice <= this.minPrice) {
    throw new Error('Maximum price must be greater than minimum price');
  }

  // Set default availability if not provided
  if (!this.availability.days || this.availability.days.length === 0) {
    this.availability.days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  }

  if (!this.availability.hours.start || !this.availability.hours.end) {
    this.availability.hours = {
      start: '08:00',
      end: '18:00'
    };
  }
});

// Populate provider info by default
serviceSchema.pre(/^find/, function() {
  this.populate({
    path: 'providerId',
    select: 'name email phone avatar'
  });
});

// Instance method to calculate popularity score
serviceSchema.methods.calculatePopularityScore = function() {
  const bookingWeight = 0.4;
  const ratingWeight = 0.3;
  const reviewWeight = 0.2;
  const recentWeight = 0.1;

  const normalizedBookings = Math.min(this.bookingCount / 100, 1); // Normalize to max 100 bookings
  const normalizedRating = this.averageRating / 5;
  const normalizedReviews = Math.min(this.reviewCount / 50, 1); // Normalize to max 50 reviews

  // Recent activity score (higher for services used in last 30 days)
  const daysSinceLastBooking = this.metadata.lastBooking
    ? (Date.now() - this.metadata.lastBooking.getTime()) / (1000 * 60 * 60 * 24)
    : 365;
  const recentScore = Math.max(0, 1 - (daysSinceLastBooking / 30));

  this.metadata.popularityScore = (
    (normalizedBookings * bookingWeight) +
    (normalizedRating * ratingWeight) +
    (normalizedReviews * reviewWeight) +
    (recentScore * recentWeight)
  );

  return this.metadata.popularityScore;
};

// Instance method to update ratings
serviceSchema.methods.updateRatings = async function(newRating) {
  // Recalculate average rating
  const totalRatingScore = (this.averageRating * this.reviewCount) + newRating;
  this.reviewCount += 1;
  this.averageRating = totalRatingScore / this.reviewCount;

  // Update popularity score
  this.calculatePopularityScore();

  return this.save();
};

// Static method to find services by category
serviceSchema.statics.findByCategory = function(category, options = {}) {
  const query = { isActive: true };
  if (category && category !== 'all') {
    query.category = category;
  }

  return this.find(query, null, options);
};

// Static method to search services (only from approved, active providers)
serviceSchema.statics.searchServices = function(searchQuery, options = {}) {
  const {
    category,
    minPrice,
    maxPrice,
    location,
    radius = 10, // km
    sortBy = 'popularity',
    limit = 20,
    page = 1
  } = options;

  let query = { isActive: true };

  // Text search
  if (searchQuery) {
    query.$text = { $search: searchQuery };
  }

  // Category filter
  if (category && category !== 'all') {
    query.category = category;
  }

  // Price range filter
  if (minPrice !== undefined || maxPrice !== undefined) {
    query.$and = query.$and || [];
    if (minPrice !== undefined) {
      query.$and.push({
        $or: [
          { minPrice: { $gte: minPrice } },
          { maxPrice: { $gte: minPrice } }
        ]
      });
    }
    if (maxPrice !== undefined) {
      query.$and.push({
        $or: [
          { minPrice: { $lte: maxPrice } },
          { maxPrice: { $lte: maxPrice } },
          { priceType: 'negotiable' }
        ]
      });
    }
  }

  // Location-based search
  if (location && location.latitude && location.longitude) {
    query['location.coordinates.latitude'] = {
      $gte: location.latitude - (radius / 111.32), // Rough conversion: 1 degree ≈ 111.32 km
      $lte: location.latitude + (radius / 111.32)
    };
    query['location.coordinates.longitude'] = {
      $gte: location.longitude - (radius / (111.32 * Math.cos(location.latitude * Math.PI / 180))),
      $lte: location.longitude + (radius / (111.32 * Math.cos(location.latitude * Math.PI / 180)))
    };
  }

  let sort = {};
  switch (sortBy) {
    case 'price_low':
      sort = { minPrice: 1 };
      break;
    case 'price_high':
      sort = { minPrice: -1 };
      break;
    case 'rating':
      sort = { averageRating: -1, reviewCount: -1 };
      break;
    case 'newest':
      sort = { createdAt: -1 };
      break;
    case 'popularity':
    default:
      sort = { 'metadata.popularityScore': -1, bookingCount: -1, averageRating: -1 };
      break;
  }

  const skip = (page - 1) * limit;

  return this.find(query)
    .sort(sort)
    .skip(skip)
    .limit(limit);
};

// Static method to get popular services by category
serviceSchema.statics.getPopularByCategory = function(limit = 5) {
  return this.aggregate([
    { $match: { isActive: true } },
    { $sort: { 'metadata.popularityScore': -1, bookingCount: -1 } },
    {
      $group: {
        _id: '$category',
        services: { $push: '$$ROOT' },
        count: { $sum: 1 }
      }
    },
    {
      $project: {
        _id: 1,
        services: { $slice: ['$services', limit] },
        count: 1
      }
    }
  ]);
};

module.exports = mongoose.model('Service', serviceSchema);