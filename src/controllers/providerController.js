const Provider = require('../models/Provider');
const User = require('../models/User');
const mongoose = require('mongoose');
const { makeSafeRegex } = require('../utils/security');

/**
 * @desc    Get all providers
 * @route   GET /api/providers
 * @access  Public
 */
const getProviders = async (req, res, next) => {
  try {
    const {
      serviceType,
      location,
      radius = 10,
      rating,
      sortBy = 'rating',
      page = 1,
      limit = 10
    } = req.query;

    const query = { approvalStatus: 'approved', isAcceptingJobs: true };

    // Filter by service type
    if (serviceType) {
      query.services = { $in: [serviceType] };
    }

    // Filter by minimum rating
    if (rating) {
      query.rating = { $gte: parseFloat(rating) };
    }

    // Location-based filtering would need geospatial queries
    // For now, we'll filter by location string using safe regex
    if (location) {
      const locationRegex = makeSafeRegex(location);
      if (locationRegex) {
        query.location = locationRegex;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Sort options
    let sortOptions = {};
    switch (sortBy) {
      case 'rating':
        sortOptions = { rating: -1, reviewCount: -1 };
        break;
      case 'distance':
        // Would need geospatial sorting
        sortOptions = { createdAt: -1 };
        break;
      case 'availability':
        sortOptions = { isAcceptingJobs: -1, lastActiveAt: -1 };
        break;
      default:
        sortOptions = { rating: -1 };
    }

    const providers = await Provider.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Provider.countDocuments(query);

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
 * @desc    Get single provider
 * @route   GET /api/providers/:id
 * @access  Public
 */
const getProvider = async (req, res, next) => {
  try {
    const { id } = req.params;
    let provider = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      provider = await Provider.findById(id);
    }

    // Support lookups by provider userId too (used by service search cards)
    if (!provider && mongoose.Types.ObjectId.isValid(id)) {
      provider = await Provider.findOne({ userId: id });
    }

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found'
      });
    }

    res.status(200).json({
      success: true,
      provider
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update provider profile
 * @route   PUT /api/providers/profile
 * @access  Private (Provider only)
 */
const updateProvider = async (req, res, next) => {
  try {
    const {
      bio,
      services,
      priceRange,
      location,
      latitude,
      longitude,
      availability
    } = req.body;

    const fieldsToUpdate = {};
    if (bio !== undefined) fieldsToUpdate.bio = bio;
    if (services !== undefined) fieldsToUpdate.services = services;
    if (priceRange !== undefined) fieldsToUpdate.priceRange = priceRange;
    if (location !== undefined) fieldsToUpdate.location = location;
    if (latitude !== undefined) fieldsToUpdate.latitude = latitude;
    if (longitude !== undefined) fieldsToUpdate.longitude = longitude;
    if (availability !== undefined) fieldsToUpdate.availability = availability;

    const provider = await Provider.findOneAndUpdate(
      { userId: req.user.id },
      fieldsToUpdate,
      { new: true, runValidators: true }
    );

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Provider profile updated successfully',
      provider
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get provider dashboard stats
 * @route   GET /api/providers/dashboard/stats
 * @access  Private (Provider only)
 */
const getProviderDashboard = async (req, res, next) => {
  try {
    const provider = await Provider.findOne({ userId: req.user.id });

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    // Get recent service requests for this provider
    const ServiceRequest = require('../models/ServiceRequest');
    const recentRequests = await ServiceRequest.find({
      providerId: req.user.id
    })
      .populate('customerId', 'name email')
      .sort({ createdAt: -1 })
      .limit(5);

    // Get request statistics
    const requestStats = await ServiceRequest.aggregate([
      { $match: { providerId: new mongoose.Types.ObjectId(req.user.id) } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Convert request stats to object
    const requestStatsObj = {
      total: 0,
      pending: 0,
      accepted: 0,
      completed: 0,
      rejected: 0
    };

    requestStats.forEach(stat => {
      requestStatsObj[stat._id] = stat.count;
      requestStatsObj.total += stat.count;
    });

    const stats = {
      totalJobs: provider.completedJobs,
      rating: provider.rating,
      reviewCount: provider.reviewCount,
      responseRate: provider.responseRate,
      isAcceptingJobs: provider.isAcceptingJobs,
      approvalStatus: provider.approvalStatus,
      requestStats: requestStatsObj
    };

    res.status(200).json({
      success: true,
      stats,
      provider,
      recentRequests: recentRequests || []
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Toggle job acceptance status
 * @route   PATCH /api/providers/toggle-availability
 * @access  Private (Provider only)
 */
const toggleAvailability = async (req, res, next) => {
  try {
    const provider = await Provider.findOne({ userId: req.user.id });

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    provider.isAcceptingJobs = !provider.isAcceptingJobs;
    await provider.save();

    res.status(200).json({
      success: true,
      message: `Job acceptance ${provider.isAcceptingJobs ? 'enabled' : 'disabled'}`,
      isAcceptingJobs: provider.isAcceptingJobs
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Search providers by service type and location
 * @route   GET /api/providers/search
 * @access  Public
 */
const searchProviders = async (req, res, next) => {
  try {
    const { q, serviceType, location, lat, lng, radius = 10 } = req.query;

    const query = {
      approvalStatus: 'approved',
      isAcceptingJobs: true
    };

    // Text search in name, bio, location - use safe regex patterns
    if (q) {
      const qRegex = makeSafeRegex(q);
      const user = await User.find({
        $or: [
          { name: qRegex },
          { email: qRegex }
        ]
      }).select('_id');

      const userIds = user.map(u => u._id);
      if (qRegex) {
        query.$or = [
          { userId: { $in: userIds } },
          { bio: qRegex },
          { location: qRegex }
        ];
      }
    }

    // Filter by service type
    if (serviceType) {
      query.services = { $in: [serviceType] };
    }

    // Location filter - use safe regex pattern
    if (location) {
      const locationRegex = makeSafeRegex(location);
      if (locationRegex) {
        query.location = locationRegex;
      }
    }

    const providers = await Provider.find(query)
      .sort({ rating: -1, reviewCount: -1 })
      .limit(20);

    res.status(200).json({
      success: true,
      count: providers.length,
      providers
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProviders,
  getProvider,
  updateProvider,
  getProviderDashboard,
  toggleAvailability,
  searchProviders
};
