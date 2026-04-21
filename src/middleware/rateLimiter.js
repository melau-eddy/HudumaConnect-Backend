const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

/**
 * General rate limiting middleware
 */
const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  }
});

/**
 * Strict rate limiting for authentication endpoints
 */
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 50 : 5, // More lenient in development
  message: {
    success: false,
    message: 'Too many authentication attempts from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit by both IP and email to prevent account enumeration
    const ipKey = ipKeyGenerator(req);
    return `${ipKey}-${req.body?.email || 'unknown'}`;
  }
});

/**
 * Moderate rate limiting for API endpoints
 */
const apiRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 requests per minute
  message: {
    success: false,
    message: 'Too many API requests from this IP, please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Per-user rate limiting for authenticated endpoints
 * Limits requests per authenticated user rather than IP
 */
const userRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // Limit each user to 60 requests per minute
  message: {
    success: false,
    message: 'Too many requests. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use user ID if authenticated, fallback to IP
    if (req.user && req.user.id) {
      return `user-${req.user.id}`;
    }
    return ipKeyGenerator(req);
  },
  skip: (req) => {
    // Skip rate limiting for admin users (optional)
    return req.user?.role === 'admin';
  }
});

/**
 * Strict rate limiting for sensitive operations (write operations)
 */
const strictUserRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each user to 10 write requests per minute
  message: {
    success: false,
    message: 'Too many requests. Please wait before making another request.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use user ID if authenticated
    if (req.user && req.user.id) {
      return `write-${req.user.id}`;
    }
    return ipKeyGenerator(req);
  }
});

/**
 * Strict rate limiting for password reset requests
 * Prevents account enumeration and password reset abuse
 */
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Max 5 password reset requests per email per 15 minutes
  message: {
    success: false,
    message: 'Too many password reset requests. Please try again in 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit by IP + email to prevent account enumeration
    const ipKey = ipKeyGenerator(req);
    return `${ipKey}-pw-reset-${req.body?.email || 'unknown'}`;
  }
});

module.exports = {
  rateLimiter,
  authRateLimiter,
  apiRateLimiter,
  userRateLimiter,
  strictUserRateLimiter,
  forgotPasswordLimiter
};