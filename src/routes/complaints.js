const express = require('express');
const router = express.Router();

// Import controllers
const {
  createComplaint,
  getComplaints,
  getComplaint,
  updateComplaintStatus,
  addAdminResponse,
  addInternalNote,
  escalateComplaint,
  assignComplaint,
  getComplaintStats,
  getOverdueComplaints,
  getUrgentComplaints
} = require('../controllers/complaintController');

// Import middleware
const { protect, authorize } = require('../middleware/auth');

// All routes are protected
router.use(protect);

// General complaint routes
router.route('/')
  .post(authorize('customer'), createComplaint)
  .get(getComplaints);

// Admin-only statistics and management routes
router.get('/stats', authorize('admin'), getComplaintStats);
router.get('/overdue', authorize('admin'), getOverdueComplaints);
router.get('/urgent', authorize('admin'), getUrgentComplaints);

router.route('/:id')
  .get(getComplaint);

// Admin-only management routes
router.patch('/:id/status', authorize('admin'), updateComplaintStatus);
router.patch('/:id/respond', authorize('admin'), addAdminResponse);
router.post('/:id/notes', authorize('admin'), addInternalNote);
router.patch('/:id/escalate', authorize('admin'), escalateComplaint);
router.patch('/:id/assign', authorize('admin'), assignComplaint);

module.exports = router;
