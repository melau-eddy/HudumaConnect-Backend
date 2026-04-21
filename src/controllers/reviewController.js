const Review = require('../models/Review');
const ServiceRequest = require('../models/ServiceRequest');
const Provider = require('../models/Provider');
const Notification = require('../models/Notification');
const { sanitizeInput } = require('../utils/sanitize');

/**
 * @desc    Create a review
 * @route   POST /api/reviews
 * @access  Private (Customer only)
 */
const createReview = async (req, res, next) => {
  try {
    const { requestId, providerId, rating, comment, images, isAnonymous } = req.body;

    // Check if the request exists and is completed
    const serviceRequest = await ServiceRequest.findById(requestId);

    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found'
      });
    }

    if (serviceRequest.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Can only review completed services'
      });
    }

    if (serviceRequest.customerId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only review your own service requests'
      });
    }

    if (serviceRequest.isReviewed) {
      return res.status(400).json({
        success: false,
        message: 'This service has already been reviewed'
      });
    }

    // Sanitize comment to prevent XSS attacks
    const sanitizedComment = sanitizeInput(comment);

    // Create the review
    const review = await Review.create({
      customerId: req.user.id,
      providerId,
      requestId,
      rating,
      comment: sanitizedComment,
      images: images || [],
      isAnonymous: isAnonymous || false
    });

    // Mark the service request as reviewed
    serviceRequest.isReviewed = true;
    await serviceRequest.save();

    // Notify provider about the new review
    try {
      await Notification.notifyNewReview(providerId, review);
    } catch (notificationError) {
      console.error('Failed to send new review notification:', notificationError);
    }

    res.status(201).json({
      success: true,
      message: 'Review created successfully',
      review
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get reviews for a provider
 * @route   GET /api/reviews/provider/:providerId
 * @access  Public
 */
const getProviderReviews = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, rating } = req.query;
    const query = {
      providerId: req.params.providerId,
      isHidden: false
    };

    // Filter by rating if specified
    if (rating) {
      query.rating = parseInt(rating);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const reviews = await Review.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Review.countDocuments(query);

    res.status(200).json({
      success: true,
      count: reviews.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      reviews
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all reviews (admin) or user's reviews
 * @route   GET /api/reviews
 * @access  Private
 */
const getReviews = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, rating, sortBy = 'createdAt' } = req.query;

    let query = {};

    // Role-based filtering
    if (req.user.role === 'customer') {
      query.customerId = req.user.id;
    } else if (req.user.role === 'provider') {
      query.providerId = req.user.id;
    }
    // Admin sees all reviews

    // Additional filters
    if (rating) query.rating = parseInt(rating);

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const sortOptions = {};
    sortOptions[sortBy] = sortBy === 'createdAt' ? -1 : 1;

    const reviews = await Review.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Review.countDocuments(query);

    res.status(200).json({
      success: true,
      count: reviews.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      reviews
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get single review
 * @route   GET /api/reviews/:id
 * @access  Public
 */
const getReview = async (req, res, next) => {
  try {
    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    if (review.isHidden) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    res.status(200).json({
      success: true,
      review
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark review as helpful
 * @route   PATCH /api/reviews/:id/helpful
 * @access  Private
 */
const markAsHelpful = async (req, res, next) => {
  try {
    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    await review.markAsHelpful();

    res.status(200).json({
      success: true,
      message: 'Review marked as helpful',
      helpfulVotes: review.helpfulVotes
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Report review
 * @route   PATCH /api/reviews/:id/report
 * @access  Private
 */
const reportReview = async (req, res, next) => {
  try {
    const { reason } = req.body;

    const review = await Review.findById(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    await review.report();

    // If report count exceeds threshold, hide the review
    if (review.reportCount >= 3) {
      review.isHidden = true;
      await review.save();
    }

    res.status(200).json({
      success: true,
      message: 'Review reported successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get recent reviews
 * @route   GET /api/reviews/recent
 * @access  Public
 */
const getRecentReviews = async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;

    const reviews = await Review.getRecentReviews(parseInt(limit));

    res.status(200).json({
      success: true,
      count: reviews.length,
      reviews
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get provider rating statistics
 * @route   GET /api/reviews/provider/:providerId/stats
 * @access  Public
 */
const getProviderStats = async (req, res, next) => {
  try {
    const stats = await Review.getProviderRating(req.params.providerId);

    if (!stats.length) {
      return res.status(200).json({
        success: true,
        stats: {
          averageRating: 0,
          totalReviews: 0,
          ratingDistribution: {
            5: 0, 4: 0, 3: 0, 2: 0, 1: 0
          }
        }
      });
    }

    const result = stats[0];
    const distribution = {};

    // Count rating distribution
    [5, 4, 3, 2, 1].forEach(rating => {
      distribution[rating] = result.ratingDistribution.filter(r => r === rating).length;
    });

    res.status(200).json({
      success: true,
      stats: {
        averageRating: Math.round(result.averageRating * 10) / 10,
        totalReviews: result.totalReviews,
        ratingDistribution: distribution
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createReview,
  getProviderReviews,
  getReviews,
  getReview,
  markAsHelpful,
  reportReview,
  getRecentReviews,
  getProviderStats
};