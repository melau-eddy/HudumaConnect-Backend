const csrf = require('csurf');
const cookieParser = require('cookie-parser');

// CSRF protection middleware
// Tokens can be sent via:
// 1. _csrf field in request body
// 2. x-csrf-token header
// 3. x-xsrf-token header
const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'strict'
  }
});

/**
 * Middleware to handle CSRF token errors
 */
const csrfErrorHandler = (err, req, res, next) => {
  if (err.code !== 'EBADCSRFTOKEN') {
    return next(err);
  }

  // Handle CSRF token errors
  res.status(403).json({
    success: false,
    message: 'Invalid CSRF token. Please refresh and try again.'
  });
};

/**
 * Middleware to make CSRF token available in response
 */
const sendCsrfToken = (req, res, next) => {
  res.cookie('XSRF-TOKEN', req.csrfToken(), {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  });
  next();
};

module.exports = {
  csrfProtection,
  csrfErrorHandler,
  sendCsrfToken,
  cookieParser
};
