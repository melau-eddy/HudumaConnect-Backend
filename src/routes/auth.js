const express = require('express');
const router = express.Router();

// Import controllers
const {
  register,
  login,
  logout,
  getMe,
  updateDetails,
  updatePassword,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  deleteAccount
} = require('../controllers/authController');

// Import middleware
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const { authRateLimiter, forgotPasswordLimiter } = require('../middleware/rateLimiter');
const { sendCsrfToken } = require('../middleware/csrf');

// Apply rate limiting to auth routes
router.use(authRateLimiter);

// CSRF token endpoint (public, no authentication required)
router.get('/csrf-token', sendCsrfToken);

// Public routes
router.post('/register', validate(schemas.registerUser), register);
router.post('/login', validate(schemas.loginUser), login);
router.post('/forgotpassword', forgotPasswordLimiter, forgotPassword);
router.put('/resetpassword/:resettoken', validate(schemas.resetPassword), resetPassword);
router.get('/verifyemail/:token', verifyEmail);

// Protected routes
router.use(protect); // All routes after this middleware are protected

router.get('/me', getMe);
router.post('/logout', logout);
router.put('/updatedetails', validate(schemas.updateProfile), updateDetails);
router.put('/updatepassword', validate(schemas.changePassword), updatePassword);
router.post('/resendverification', resendVerification);
router.delete('/deleteaccount', deleteAccount);

module.exports = router;