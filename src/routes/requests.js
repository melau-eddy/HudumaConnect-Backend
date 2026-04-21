const express = require('express');
const router = express.Router();

// Import controllers
const {
  createRequest,
  getRequests,
  getRequest,
  updateRequestStatus,
  getAvailableRequests,
  finalizeRequest
} = require('../controllers/requestController');

// Import middleware
const { protect, authorize } = require('../middleware/auth');

// All routes are protected
router.use(protect);

// Routes accessible by all authenticated users
router.route('/')
  .post(authorize('customer'), createRequest)
  .get(getRequests);

router.get('/available', authorize('provider'), getAvailableRequests);

router.route('/:id')
  .get(getRequest);

router.patch('/:id/status', updateRequestStatus);
router.patch('/:id/finalize', authorize('provider'), finalizeRequest);

module.exports = router;
