const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/auth');

// Apply authentication and authorization to all admin routes
router.use(protect);
router.use(authorize('admin'));

/**
 * Dashboard & Statistics
 */
router.get('/dashboard', adminController.getDashboardStats);

/**
 * Provider Management
 */
router.get('/providers', adminController.getProviders);
router.post('/providers/:id/approve', adminController.approveProvider);
router.post('/providers/:id/reject', adminController.rejectProvider);

/**
 * User Management
 */
router.get('/users', adminController.getUsers);
router.post('/users/:id/ban', adminController.banUser);
router.post('/users/:id/unban', adminController.unbanUser);

/**
 * Service Request Management
 */
router.get('/requests', adminController.getServiceRequests);

/**
 * Complaints & Reports
 */
router.get('/complaints', adminController.getComplaints);

/**
 * Admin Management
 */
router.get('/admins', adminController.getAdmins);

module.exports = router;
