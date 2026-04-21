const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const User = require('../models/User');
const Provider = require('../models/Provider');

// Ensure uploads directory exists
const ensureUploadDir = async (dir) => {
  try {
    await fs.access(dir);
  } catch (error) {
    await fs.mkdir(dir, { recursive: true });
  }
};

// Configure multer storage
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    let uploadPath = 'uploads/';

    if (file.fieldname === 'avatar') {
      uploadPath += 'avatars/';
    } else if (file.fieldname === 'portfolio') {
      uploadPath += 'portfolio/';
    } else {
      uploadPath += 'general/';
    }

    try {
      await ensureUploadDir(uploadPath);
      cb(null, uploadPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp and random string
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + extension);
  }
});

// Allowed MIME types (whitelist approach)
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// File filter for images only - strict whitelist
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  // Check MIME type (whitelist)
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(new Error(`File type not allowed. Accepted types: ${ALLOWED_MIME_TYPES.join(', ')}`), false);
  }

  // Check file extension (whitelist)
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error(`File extension not allowed. Accepted extensions: ${ALLOWED_EXTENSIONS.join(', ')}`), false);
  }

  cb(null, true);
};

// Create multer instance with strict configuration
const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_FILE_SIZE, // 5MB limit
    files: 8 // Maximum 8 files per request
  },
  fileFilter: fileFilter
});

/**
 * @desc    Upload avatar image
 * @route   POST /api/upload/avatar
 * @access  Private
 */
const uploadAvatar = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const avatarUrl = `/${req.file.path.replace(/\\/g, '/')}`;

    // Update user avatar
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { avatar: avatarUrl },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Avatar uploaded successfully',
      avatar: avatarUrl,
      user
    });
  } catch (error) {
    // Delete uploaded file if database update fails
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting uploaded file:', unlinkError);
      }
    }
    next(error);
  }
};

/**
 * @desc    Upload portfolio images
 * @route   POST /api/upload/portfolio
 * @access  Private (Provider only)
 */
const uploadPortfolio = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded'
      });
    }

    // Check if user is a provider
    if (req.user.role !== 'provider') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only providers can upload portfolio images'
      });
    }

    // Find provider profile
    const provider = await Provider.findOne({ userId: req.user.id });
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    // Check portfolio limit (max 8 images)
    if (provider.portfolio.length + req.files.length > 8) {
      return res.status(400).json({
        success: false,
        message: `Portfolio limit exceeded. Maximum 8 images allowed. You currently have ${provider.portfolio.length} images.`
      });
    }

    // Process uploaded files
    const portfolioImages = req.files.map(file => {
      const imageUrl = `/${file.path.replace(/\\/g, '/')}`;
      return {
        filename: file.filename,
        originalName: file.originalname,
        url: imageUrl,
        description: req.body.description || '',
        uploadedAt: new Date()
      };
    });

    // Add to provider portfolio
    provider.portfolio.push(...portfolioImages);
    await provider.save();

    res.status(200).json({
      success: true,
      message: `${portfolioImages.length} image(s) uploaded successfully`,
      images: portfolioImages,
      totalImages: provider.portfolio.length
    });
  } catch (error) {
    // Delete uploaded files if database update fails
    if (req.files) {
      for (const file of req.files) {
        try {
          await fs.unlink(file.path);
        } catch (unlinkError) {
          console.error('Error deleting uploaded file:', unlinkError);
        }
      }
    }
    next(error);
  }
};

/**
 * @desc    Delete portfolio image
 * @route   DELETE /api/upload/portfolio/:imageId
 * @access  Private (Provider only)
 */
const deletePortfolioImage = async (req, res, next) => {
  try {
    const { imageId } = req.params;

    // Check if user is a provider
    if (req.user.role !== 'provider') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only providers can delete portfolio images'
      });
    }

    // Find provider profile
    const provider = await Provider.findOne({ userId: req.user.id });
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    // Find image in portfolio
    const imageIndex = provider.portfolio.findIndex(img => img._id.toString() === imageId);
    if (imageIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Image not found in portfolio'
      });
    }

    const image = provider.portfolio[imageIndex];

    // Delete file from filesystem
    try {
      const filePath = path.join(process.cwd(), image.url.substring(1)); // Remove leading slash
      await fs.unlink(filePath);
    } catch (fileError) {
      console.error('Error deleting file:', fileError);
      // Continue even if file deletion fails
    }

    // Remove from portfolio array
    provider.portfolio.splice(imageIndex, 1);
    await provider.save();

    res.status(200).json({
      success: true,
      message: 'Image deleted successfully',
      remainingImages: provider.portfolio.length
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get provider portfolio
 * @route   GET /api/upload/portfolio
 * @access  Private (Provider only)
 */
const getPortfolio = async (req, res, next) => {
  try {
    // Check if user is a provider
    if (req.user.role !== 'provider') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only providers can view portfolio'
      });
    }

    // Find provider profile
    const provider = await Provider.findOne({ userId: req.user.id }).select('portfolio');
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    res.status(200).json({
      success: true,
      portfolio: provider.portfolio,
      totalImages: provider.portfolio.length
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  upload,
  uploadAvatar,
  uploadPortfolio,
  deletePortfolioImage,
  getPortfolio
};