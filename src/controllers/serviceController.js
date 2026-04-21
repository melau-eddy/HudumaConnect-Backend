const Service = require('../models/Service');
const Provider = require('../models/Provider');
const Notification = require('../models/Notification');
const mongoose = require('mongoose');

/**
 * @desc    Get all services (public - for search/browse)
 * @route   GET /api/services
 * @access  Public
 */
const getServices = async (req, res, next) => {
  try {
    const {
      q: searchQuery,
      category,
      minPrice,
      maxPrice,
      latitude,
      longitude,
      radius = 10,
      sortBy = 'popularity',
      page = 1,
      limit = 20
    } = req.query;

    // Build location object if coordinates provided
    const location = latitude && longitude ? {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude)
    } : null;

    const options = {
      category,
      minPrice: minPrice ? parseFloat(minPrice) : undefined,
      maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
      location,
      radius: parseFloat(radius),
      sortBy,
      page: parseInt(page),
      limit: parseInt(limit)
    };

    const services = await Service.searchServices(searchQuery, options);

    // Enhance services with provider data
    const enhancedServices = await Promise.all(services.map(async (service) => {
      const serviceObj = service.toObject();

      if (serviceObj.providerId && serviceObj.providerId._id) {
        const provider = await Provider.findOne({ userId: serviceObj.providerId._id });

        if (provider) {
          // Add provider-specific fields to the object
          serviceObj.providerId.rating = provider.rating || 0;
          serviceObj.providerId.reviewCount = provider.reviewCount || 0;
          serviceObj.providerId.completedJobs = provider.completedJobs || 0;
          serviceObj.providerId.isVerified = provider.isVerified || false;
          serviceObj.providerId.location = {
            address: provider.location || '',
            city: provider.location || '',
            region: provider.location || '',
            coordinates: {
              latitude: provider.latitude || 0,
              longitude: provider.longitude || 0
            }
          };
        }
      }
      return serviceObj;
    }));

    // Get total count for pagination
    let countQuery = { isActive: true };
    if (searchQuery) countQuery.$text = { $search: searchQuery };
    if (category && category !== 'all') countQuery.category = category;

    const total = await Service.countDocuments(countQuery);

    res.status(200).json({
      success: true,
      count: enhancedServices.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      services: enhancedServices
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get services by category (public)
 * @route   GET /api/services/category/:category
 * @access  Public
 */
const getServicesByCategory = async (req, res, next) => {
  try {
    const { category } = req.params;
    const { page = 1, limit = 20, sortBy = 'popularity' } = req.query;

    const services = await Service.findByCategory(category, {
      sort: sortBy === 'popularity' ? { 'metadata.popularityScore': -1 } : { createdAt: -1 },
      skip: (page - 1) * limit,
      limit: parseInt(limit)
    });

    const total = await Service.countDocuments({
      category: category === 'all' ? { $exists: true } : category,
      isActive: true
    });

    res.status(200).json({
      success: true,
      count: services.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      category,
      services
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get popular services by category (public)
 * @route   GET /api/services/popular
 * @access  Public
 */
const getPopularServices = async (req, res, next) => {
  try {
    const { limit = 5 } = req.query;

    const popularByCategory = await Service.getPopularByCategory(parseInt(limit));

    res.status(200).json({
      success: true,
      data: popularByCategory
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get single service (public)
 * @route   GET /api/services/:id
 * @access  Public
 */
const getService = async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Only show active services to public, but show all to service owner
    if (!service.isActive && (!req.user || req.user.id !== service.providerId.toString())) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    res.status(200).json({
      success: true,
      service
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get provider's services
 * @route   GET /api/services/provider/my-services
 * @access  Private (Provider only)
 */
const getMyServices = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, isActive } = req.query;

    let query = { providerId: req.user.id };

    // Filter by active status if specified
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const services = await Service.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Service.countDocuments(query);

    res.status(200).json({
      success: true,
      count: services.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      services
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a new service
 * @route   POST /api/services
 * @access  Private (Provider only)
 */
const createService = async (req, res, next) => {
  try {
    const {
      name,
      description,
      category,
      priceType,
      minPrice,
      maxPrice,
      currency = 'KSh',
      duration,
      availability,
      images = [],
      tags = [],
      features = [],
      requirements = [],
      location
    } = req.body;

    // Validate provider exists and is active
    // Due to auto-populate middleware, we need to find all providers for user then filter
    const allProvidersForUser = await Provider.find({ userId: req.user.id });
    const provider = allProvidersForUser.find(p => p.isActive === true);

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found or inactive'
      });
    }

    // Create service
    const service = await Service.create({
      providerId: req.user.id,
      name,
      description,
      category,
      priceType,
      minPrice,
      maxPrice,
      currency,
      duration,
      availability,
      images,
      tags,
      features,
      requirements,
      location: {
        ...location,
        coordinates: provider.latitude && provider.longitude ? {
          latitude: provider.latitude,
          longitude: provider.longitude
        } : location?.coordinates
      }
    });

    // Update provider's services array if not already included
    if (!provider.services.includes(category)) {
      provider.services.push(category);
      await provider.save();
    }

    res.status(201).json({
      success: true,
      message: 'Service created successfully',
      service
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update a service
 * @route   PUT /api/services/:id
 * @access  Private (Provider only - own services)
 */
const updateService = async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Check ownership - Handle both populated and non-populated providerId
    const serviceProviderId = service.providerId._id ? service.providerId._id.toString() : service.providerId.toString();
    if (serviceProviderId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only update your own services'
      });
    }

    // Update allowed fields
    const allowedFields = [
      'name', 'description', 'category', 'priceType', 'minPrice', 'maxPrice',
      'currency', 'duration', 'availability', 'images', 'tags', 'features',
      'requirements', 'location', 'isActive'
    ];

    const updates = {};
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const updatedService = await Service.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Service updated successfully',
      service: updatedService
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a service
 * @route   DELETE /api/services/:id
 * @access  Private (Provider only - own services)
 */
const deleteService = async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Check ownership - Handle both populated and non-populated providerId
    const serviceProviderId = service.providerId._id ? service.providerId._id.toString() : service.providerId.toString();
    if (serviceProviderId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only delete your own services'
      });
    }

    await Service.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Service deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Toggle service active status
 * @route   PATCH /api/services/:id/toggle-status
 * @access  Private (Provider only - own services)
 */
const toggleServiceStatus = async (req, res, next) => {
  try {
    const service = await Service.findById(req.params.id);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Check ownership - Handle both populated and non-populated providerId
    const serviceProviderId = service.providerId._id ? service.providerId._id.toString() : service.providerId.toString();
    if (serviceProviderId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    service.isActive = !service.isActive;
    await service.save();

    res.status(200).json({
      success: true,
      message: `Service ${service.isActive ? 'activated' : 'deactivated'} successfully`,
      service
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get service statistics for provider
 * @route   GET /api/services/provider/stats
 * @access  Private (Provider only)
 */
const getServiceStats = async (req, res, next) => {
  try {
    const providerId = req.user.id;

    const stats = await Service.aggregate([
      { $match: { providerId: new mongoose.Types.ObjectId(providerId) } },
      {
        $group: {
          _id: null,
          totalServices: { $sum: 1 },
          activeServices: {
            $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
          },
          totalBookings: { $sum: '$bookingCount' },
          totalEarnings: { $sum: '$metadata.totalEarnings' },
          averageRating: { $avg: '$averageRating' },
          totalReviews: { $sum: '$reviewCount' }
        }
      }
    ]);

    // Get services by category
    const servicesByCategory = await Service.aggregate([
      { $match: { providerId: new mongoose.Types.ObjectId(providerId) } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          activeCount: {
            $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
          },
          bookings: { $sum: '$bookingCount' },
          earnings: { $sum: '$metadata.totalEarnings' }
        }
      }
    ]);

    // Get top performing services
    const topServices = await Service.find({ providerId })
      .sort({ 'metadata.popularityScore': -1, bookingCount: -1 })
      .limit(5)
      .select('name bookingCount averageRating reviewCount metadata.totalEarnings');

    res.status(200).json({
      success: true,
      stats: {
        overview: stats[0] || {
          totalServices: 0,
          activeServices: 0,
          totalBookings: 0,
          totalEarnings: 0,
          averageRating: 0,
          totalReviews: 0
        },
        byCategory: servicesByCategory,
        topPerforming: topServices
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Bulk update service status
 * @route   PATCH /api/services/provider/bulk-status
 * @access  Private (Provider only)
 */
const bulkUpdateStatus = async (req, res, next) => {
  try {
    const { serviceIds, isActive } = req.body;

    if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Service IDs array is required'
      });
    }

    // Verify all services belong to the provider
    const services = await Service.find({
      _id: { $in: serviceIds },
      providerId: req.user.id
    });

    if (services.length !== serviceIds.length) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only update your own services'
      });
    }

    // Bulk update
    const result = await Service.updateMany(
      { _id: { $in: serviceIds }, providerId: req.user.id },
      { isActive }
    );

    res.status(200).json({
      success: true,
      message: `${result.modifiedCount} services updated successfully`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getServices,
  getServicesByCategory,
  getPopularServices,
  getService,
  getMyServices,
  createService,
  updateService,
  deleteService,
  toggleServiceStatus,
  getServiceStats,
  bulkUpdateStatus
};