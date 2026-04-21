/**
 * Middleware to handle multer file upload errors
 * Catches errors from file size limits, type validation, etc.
 */
const multerErrorHandler = (err, req, res, next) => {
  // Multer errors
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: `File too large. Maximum file size is 5MB`
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Maximum 8 files per upload'
      });
    }
    if (err.code === 'LIMIT_PART_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many parts in request'
      });
    }
  }

  // Custom error messages from fileFilter
  if (err && err.message) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }

  // Pass other errors to next handler
  next(err);
};

module.exports = multerErrorHandler;
