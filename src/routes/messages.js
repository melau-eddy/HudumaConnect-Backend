const express = require('express');
const router = express.Router();

// Import controllers
const {
  sendMessage,
  getConversation,
  markAsRead,
  listConversations,
  deleteMessage,
  getUnreadCount
} = require('../controllers/messageController');

// Import middleware
const { protect } = require('../middleware/auth');

// All message routes require authentication
router.use(protect);

// Get unread count
router.get('/unread/count', getUnreadCount);

// Get all conversations for user
router.get('/conversations/list', listConversations);

// Send message
router.post('/', sendMessage);

// Get conversation for a service request
router.get('/:requestId', getConversation);

// Mark message as read
router.patch('/:messageId/read', markAsRead);

// Delete message
router.delete('/:messageId', deleteMessage);

module.exports = router;
