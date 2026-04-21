const Message = require('../models/Message');
const ServiceRequest = require('../models/ServiceRequest');
const User = require('../models/User');
const mongoose = require('mongoose');

/**
 * @desc    Send a message
 * @route   POST /api/messages
 * @access  Private
 */
const sendMessage = async (req, res, next) => {
  try {
    const { serviceRequestId, recipientId, content, attachments = [] } = req.body;

    // Validate input
    if (!serviceRequestId || !recipientId || !content) {
      return res.status(400).json({
        success: false,
        message: 'Service request ID, recipient ID, and message content are required'
      });
    }

    // Validate ObjectIds
    if (!mongoose.Types.ObjectId.isValid(serviceRequestId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid service request ID'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(recipientId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid recipient ID'
      });
    }

    // Check if service request exists
    const serviceRequest = await ServiceRequest.findById(serviceRequestId);
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found'
      });
    }

    // Verify user is participant in the service request
    const isParticipant =
      serviceRequest.customerId.toString() === req.user.id ||
      serviceRequest.providerId.toString() === req.user.id;

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to message in this service request'
      });
    }

    // Verify recipient is the other party in the service request
    const isValidRecipient =
      (serviceRequest.customerId.toString() === recipientId && serviceRequest.providerId.toString() === req.user.id) ||
      (serviceRequest.providerId.toString() === recipientId && serviceRequest.customerId.toString() === req.user.id);

    if (!isValidRecipient) {
      return res.status(403).json({
        success: false,
        message: 'Invalid recipient for this service request'
      });
    }

    // Prevent messaging if request is cancelled or completed without both parties accepting
    const restrictedStatuses = ['cancelled'];
    if (restrictedStatuses.includes(serviceRequest.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot message for cancelled service requests'
      });
    }

    // Create message
    const message = await Message.create({
      serviceRequestId,
      senderId: req.user.id,
      recipientId,
      content: content.trim(),
      attachments
    });

    // Populate sender and recipient data
    await message.populate('senderId', 'name avatar email');
    await message.populate('recipientId', 'name avatar email');

    // Emit real-time message via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(serviceRequestId.toString()).emit('new_message', {
        messageId: message._id,
        senderId: message.senderId,
        recipientId: message.recipientId,
        content: message.content,
        attachments: message.attachments,
        createdAt: message.createdAt,
        isRead: message.isRead
      });

      // Also send to specific recipient room for notification
      io.to(recipientId.toString()).emit('message_notification', {
        serviceRequestId,
        senderName: message.senderId.name,
        senderAvatar: message.senderId.avatar,
        preview: content.substring(0, 50) + (content.length > 50 ? '...' : ''),
        timestamp: message.createdAt
      });
    }

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: message
    });
  } catch (error) {
    console.error('Error sending message:', error);
    next(error);
  }
};

/**
 * @desc    Get all messages for a service request
 * @route   GET /api/messages/:requestId
 * @access  Private
 */
const getConversation = async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    // Validate requestId
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid service request ID'
      });
    }

    // Check if service request exists and user is participant
    const serviceRequest = await ServiceRequest.findById(requestId);
    if (!serviceRequest) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found'
      });
    }

    const isParticipant =
      serviceRequest.customerId.toString() === req.user.id ||
      serviceRequest.providerId.toString() === req.user.id;

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to view messages for this service request'
      });
    }

    // Fetch messages with pagination
    const messages = await Message.getConversation(requestId, { page, limit });

    // Mark messages as read if user is the recipient
    const unreadMessages = messages.filter(
      msg => msg.recipientId._id.toString() === req.user.id && !msg.isRead
    );

    if (unreadMessages.length > 0) {
      await Message.updateMany(
        {
          _id: { $in: unreadMessages.map(m => m._id) },
          recipientId: req.user.id,
          isRead: false
        },
        {
          isRead: true,
          readAt: new Date()
        }
      );

      // Emit read receipt via Socket.IO
      const io = req.app.get('io');
      if (io) {
        io.to(requestId.toString()).emit('message_read_receipts', {
          messageIds: unreadMessages.map(m => m._id),
          readBy: req.user.id,
          readAt: new Date()
        });
      }

      // Fetch messages again to get updated read status
      const updatedMessages = await Message.getConversation(requestId, { page, limit });
      return res.status(200).json({
        success: true,
        data: updatedMessages.reverse(),
        page,
        limit
      });
    }

    res.status(200).json({
      success: true,
      data: messages.reverse(),
      page,
      limit
    });
  } catch (error) {
    console.error('Error fetching conversation:', error);
    next(error);
  }
};

/**
 * @desc    Mark a specific message as read
 * @route   PATCH /api/messages/:messageId/read
 * @access  Private
 */
const markAsRead = async (req, res, next) => {
  try {
    const { messageId } = req.params;

    // Validate messageId
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid message ID'
      });
    }

    // Find message
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Verify user is the recipient
    if (message.recipientId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to mark this message as read'
      });
    }

    // Mark as read
    await message.markAsRead();

    // Emit read receipt via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(message.serviceRequestId.toString()).emit('message_read_receipt', {
        messageId: message._id,
        readBy: req.user.id,
        readAt: message.readAt
      });
    }

    res.status(200).json({
      success: true,
      message: 'Message marked as read',
      data: message
    });
  } catch (error) {
    console.error('Error marking message as read:', error);
    next(error);
  }
};

/**
 * @desc    Get all conversations (list of unique conversations for a user)
 * @route   GET /api/conversations
 * @access  Private
 */
const listConversations = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    // Get all conversations for the user
    const conversations = await Message.getConversations(req.user.id, { page, limit });

    // Get unread counts per conversation
    const unreadCounts = await Message.getUnreadCountByConversation(req.user.id);
    const unreadCountMap = {};
    unreadCounts.forEach(item => {
      unreadCountMap[item._id.toString()] = item.unreadCount;
    });

    // Add unread count to each conversation
    const conversationsWithUnread = conversations.map(conv => ({
      ...conv,
      unreadCount: unreadCountMap[conv._id.toString()] || 0
    }));

    res.status(200).json({
      success: true,
      data: conversationsWithUnread,
      page,
      limit
    });
  } catch (error) {
    console.error('Error listing conversations:', error);
    next(error);
  }
};

/**
 * @desc    Delete a message (soft delete - mark as deleted)
 * @route   DELETE /api/messages/:messageId
 * @access  Private
 */
const deleteMessage = async (req, res, next) => {
  try {
    const { messageId } = req.params;

    // Validate messageId
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid message ID'
      });
    }

    // Find message
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Verify user is the sender (only senders can delete their own messages)
    if (message.senderId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own messages'
      });
    }

    // Soft delete (add userId to deletedBy array)
    const deletedMessage = await Message.softDelete(messageId, req.user.id);

    // Emit deletion event via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(message.serviceRequestId.toString()).emit('message_deleted', {
        messageId: message._id,
        deletedBy: req.user.id
      });
    }

    res.status(200).json({
      success: true,
      message: 'Message deleted successfully',
      data: deletedMessage
    });
  } catch (error) {
    console.error('Error deleting message:', error);
    next(error);
  }
};

/**
 * @desc    Get unread message count for user
 * @route   GET /api/messages/unread/count
 * @access  Private
 */
const getUnreadCount = async (req, res, next) => {
  try {
    const unreadCount = await Message.getUnreadCount(req.user.id);

    res.status(200).json({
      success: true,
      unreadCount
    });
  } catch (error) {
    console.error('Error getting unread count:', error);
    next(error);
  }
};

module.exports = {
  sendMessage,
  getConversation,
  markAsRead,
  listConversations,
  deleteMessage,
  getUnreadCount
};
