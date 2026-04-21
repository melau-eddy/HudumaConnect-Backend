const express = require('express');
const router = express.Router();

// Import controllers
const {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  createNotification,
  getNotificationStats,
  cleanupExpired,
  getAllNotifications,
  sendBulkNotifications
} = require('../controllers/notificationController');

// Import middleware
const { protect, authorize } = require('../middleware/auth');

// All routes are protected
router.use(protect);

// User notification routes
router.route('/')
  .get(getNotifications);

router.get('/unread-count', getUnreadCount);
router.patch('/mark-all-read', markAllAsRead);
router.delete('/all', deleteAllNotifications);

router.route('/:id')
  .delete(deleteNotification);

router.patch('/:id/read', markAsRead);

// Admin-only routes
router.post('/create', authorize('admin'), createNotification);
router.get('/stats', authorize('admin'), getNotificationStats);
router.delete('/cleanup', authorize('admin'), cleanupExpired);
router.get('/admin/all', authorize('admin'), getAllNotifications);
router.post('/admin/bulk', authorize('admin'), sendBulkNotifications);

module.exports = router;
