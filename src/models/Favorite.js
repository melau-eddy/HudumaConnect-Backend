const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema({
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
  lastAccessedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound unique index to prevent duplicate favorites
favoriteSchema.index({ customerId: 1, providerId: 1 }, { unique: true });

// Index for sorting by access time
favoriteSchema.index({ customerId: 1, lastAccessedAt: -1 });

// Populate provider data
favoriteSchema.pre(/^find/, function() {
  this.populate({
    path: 'providerId',
    select: 'name avatar email'
  });
});

// Static method to get all favorites for a customer with pagination
favoriteSchema.statics.getFavorites = function(customerId, options = {}) {
  const { page = 1, limit = 10 } = options;
  const skip = (page - 1) * limit;

  return this.find({ customerId: new mongoose.Types.ObjectId(customerId) })
    .sort({ lastAccessedAt: -1 })
    .skip(skip)
    .limit(limit);
};

// Static method to check if provider is favorited by customer
favoriteSchema.statics.isFavorited = function(customerId, providerId) {
  return this.findOne({
    customerId: new mongoose.Types.ObjectId(customerId),
    providerId: new mongoose.Types.ObjectId(providerId)
  });
};

// Instance method to update last accessed time
favoriteSchema.methods.updateAccessTime = function() {
  this.lastAccessedAt = new Date();
  return this.save();
};

module.exports = mongoose.model('Favorite', favoriteSchema);
