const Favorite = require('../models/Favorite');
const Provider = require('../models/Provider');

/**
 * @desc    Add a provider to favorites
 * @route   POST /api/favorites/:providerId
 * @access  Private (Customer only)
 */
const addFavorite = async (req, res, next) => {
  try {
    const { providerId } = req.params;
    const customerId = req.user.id;

    // Check if provider exists and is approved
    const provider = await Provider.findOne({ userId: providerId });

    if (!provider || provider.approvalStatus !== 'approved') {
      return res.status(404).json({
        success: false,
        message: 'Provider not found or not approved'
      });
    }

    // Check if already favorited
    const existingFavorite = await Favorite.findOne({
      customerId,
      providerId
    });

    if (existingFavorite) {
      return res.status(409).json({
        success: false,
        message: 'Provider is already in your favorites'
      });
    }

    // Create favorite
    const favorite = await Favorite.create({
      customerId,
      providerId
    });

    const populatedFavorite = await Favorite.findById(favorite._id).populate({
      path: 'providerId',
      select: 'name avatar email'
    });

    res.status(201).json({
      success: true,
      message: 'Provider added to favorites',
      favorite: populatedFavorite
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Remove a provider from favorites
 * @route   DELETE /api/favorites/:providerId
 * @access  Private (Customer only)
 */
const removeFavorite = async (req, res, next) => {
  try {
    const { providerId } = req.params;
    const customerId = req.user.id;

    const favorite = await Favorite.findOneAndDelete({
      customerId,
      providerId
    });

    if (!favorite) {
      return res.status(404).json({
        success: false,
        message: 'Favorite not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Provider removed from favorites'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all favorites for a customer
 * @route   GET /api/favorites
 * @access  Private (Customer only)
 */
const getFavorites = async (req, res, next) => {
  try {
    const customerId = req.user.id;
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const favorites = await Favorite.find({ customerId })
      .sort({ lastAccessedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate({
        path: 'providerId',
        select: 'name avatar email rating reviewCount'
      });

    const total = await Favorite.countDocuments({ customerId });

    res.status(200).json({
      success: true,
      msg: 'Favorites retrieved successfully',
      data: {
        favorites,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Check if a provider is favorited
 * @route   GET /api/favorites/:providerId/status
 * @access  Private (Customer only)
 */
const checkFavorite = async (req, res, next) => {
  try {
    const { providerId } = req.params;
    const customerId = req.user.id;

    const favorite = await Favorite.findOne({
      customerId,
      providerId
    });

    res.status(200).json({
      success: true,
      isFavorited: !!favorite
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addFavorite,
  removeFavorite,
  getFavorites,
  checkFavorite
};
