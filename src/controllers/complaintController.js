const Complaint = require('../models/Complaint');
const ServiceRequest = require('../models/ServiceRequest');
const User = require('../models/User');
const Notification = require('../models/Notification');

/**
 * @desc    Create a complaint
 * @route   POST /api/complaints
 * @access  Private (Customer only)
 */
const createComplaint = async (req, res, next) => {
  try {
    const {
      providerId,
      requestId,
      type,
      subject,
      description,
      priority,
      isAnonymous,
      attachments
    } = req.body;

    // Validate that the service request exists and belongs to the customer
    if (requestId) {
      const serviceRequest = await ServiceRequest.findById(requestId);
      if (!serviceRequest) {
        return res.status(404).json({
          success: false,
          message: 'Service request not found'
        });
      }

      if (serviceRequest.customerId.toString() !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'You can only file complaints for your own service requests'
        });
      }
    }

    // Validate provider exists if provided
    if (providerId) {
      const provider = await User.findById(providerId);
      if (!provider || provider.role !== 'provider') {
        return res.status(404).json({
          success: false,
          message: 'Provider not found'
        });
      }
    }

    const complaint = await Complaint.create({
      customerId: req.user.id,
      providerId,
      requestId,
      type,
      subject,
      description,
      priority: priority || 'medium',
      isAnonymous: isAnonymous || false,
      attachments: attachments || []
    });

    res.status(201).json({
      success: true,
      message: 'Complaint submitted successfully',
      complaint
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get complaints
 * @route   GET /api/complaints
 * @access  Private
 */
const getComplaints = async (req, res, next) => {
  try {
    const {
      status,
      type,
      priority,
      assignedToMe,
      page = 1,
      limit = 10,
      sortBy = 'createdAt'
    } = req.query;

    let query = {};

    // Role-based filtering
    if (req.user.role === 'customer') {
      query.customerId = req.user.id;
    } else if (req.user.role === 'provider') {
      query.providerId = req.user.id;
    } else if (req.user.role === 'admin') {
      // Admin can see all complaints
      if (assignedToMe === 'true') {
        query.assignedTo = req.user.id;
      }
    }

    // Additional filters
    if (status) query.status = status;
    if (type) query.type = type;
    if (priority) query.priority = priority;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const sortOptions = {};
    sortOptions[sortBy] = sortBy === 'createdAt' ? -1 : 1;

    const complaints = await Complaint.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Complaint.countDocuments(query);

    res.status(200).json({
      success: true,
      count: complaints.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      complaints
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get single complaint
 * @route   GET /api/complaints/:id
 * @access  Private
 */
const getComplaint = async (req, res, next) => {
  try {
    const complaint = await Complaint.findById(req.params.id);

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    // Check access permissions
    const canAccess =
      req.user.role === 'admin' ||
      (req.user.role === 'customer' && complaint.customerId.toString() === req.user.id) ||
      (req.user.role === 'provider' && complaint.providerId && complaint.providerId.toString() === req.user.id) ||
      (complaint.assignedTo && complaint.assignedTo.toString() === req.user.id);

    if (!canAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.status(200).json({
      success: true,
      complaint
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update complaint status
 * @route   PATCH /api/complaints/:id/status
 * @access  Private (Admin only)
 */
const updateComplaintStatus = async (req, res, next) => {
  try {
    const { status, comment, resolutionNotes } = req.body;

    const complaint = await Complaint.findById(req.params.id);

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    await complaint.updateStatus(status, req.user.id, comment, resolutionNotes);

    // Notify customer about complaint status change
    try {
      await Notification.createNotification({
        userId: complaint.customerId,
        title: 'Complaint Status Update',
        message: `Your complaint "${complaint.subject}" has been updated to ${status}`,
        type: 'complaint',
        category: status === 'resolved' ? 'success' : 'info',
        priority: complaint.priority === 'urgent' ? 'high' : 'medium',
        data: {
          complaintId: complaint._id,
          status,
          comment: comment || null
        }
      });
    } catch (notificationError) {
      console.error('Failed to send complaint status update notification:', notificationError);
    }

    res.status(200).json({
      success: true,
      message: `Complaint status updated to ${status}`,
      complaint
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Add admin response to complaint
 * @route   PATCH /api/complaints/:id/respond
 * @access  Private (Admin only)
 */
const addAdminResponse = async (req, res, next) => {
  try {
    const { response } = req.body;

    const complaint = await Complaint.findByIdAndUpdate(
      req.params.id,
      {
        adminResponse: response,
        adminId: req.user.id,
        adminName: req.user.name
      },
      { new: true }
    );

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    // Send notification to customer about admin response
    try {
      await Notification.notifyComplaintResponse(complaint.customerId, complaint);
    } catch (notificationError) {
      console.error('Failed to send complaint response notification:', notificationError);
    }

    res.status(200).json({
      success: true,
      message: 'Admin response added successfully',
      complaint
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Add internal note to complaint
 * @route   POST /api/complaints/:id/notes
 * @access  Private (Admin only)
 */
const addInternalNote = async (req, res, next) => {
  try {
    const { note } = req.body;

    const complaint = await Complaint.findById(req.params.id);

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    await complaint.addInternalNote(note, req.user.id);

    res.status(200).json({
      success: true,
      message: 'Internal note added successfully',
      complaint
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Escalate complaint
 * @route   PATCH /api/complaints/:id/escalate
 * @access  Private (Admin only)
 */
const escalateComplaint = async (req, res, next) => {
  try {
    const complaint = await Complaint.findById(req.params.id);

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    if (complaint.escalationLevel >= 3) {
      return res.status(400).json({
        success: false,
        message: 'Complaint is already at maximum escalation level'
      });
    }

    await complaint.escalate();

    // Notify customer about complaint escalation
    try {
      await Notification.createNotification({
        userId: complaint.customerId,
        title: 'Complaint Escalated',
        message: `Your complaint "${complaint.subject}" has been escalated to level ${complaint.escalationLevel}`,
        type: 'complaint',
        category: 'warning',
        priority: 'high',
        data: {
          complaintId: complaint._id,
          escalationLevel: complaint.escalationLevel
        }
      });
    } catch (notificationError) {
      console.error('Failed to send complaint escalation notification:', notificationError);
    }

    res.status(200).json({
      success: true,
      message: `Complaint escalated to level ${complaint.escalationLevel}`,
      complaint
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Assign complaint to admin/staff
 * @route   PATCH /api/complaints/:id/assign
 * @access  Private (Admin only)
 */
const assignComplaint = async (req, res, next) => {
  try {
    const { assignedTo } = req.body;

    // Validate that the user exists and is admin/staff
    const user = await User.findById(assignedTo);
    if (!user || !['admin'].includes(user.role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user assignment'
      });
    }

    const complaint = await Complaint.findByIdAndUpdate(
      req.params.id,
      { assignedTo },
      { new: true }
    );

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Complaint assigned successfully',
      complaint
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get complaint statistics
 * @route   GET /api/complaints/stats
 * @access  Private (Admin only)
 */
const getComplaintStats = async (req, res, next) => {
  try {
    const { period = '30d' } = req.query;

    // Calculate date range
    let startDate;
    const now = new Date();

    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const stats = await Complaint.getStats({
      createdAt: { $gte: startDate }
    });

    // Get overdue complaints
    const overdueComplaints = await Complaint.findOverdue();

    // Get urgent complaints
    const urgentComplaints = await Complaint.findUrgent();

    res.status(200).json({
      success: true,
      stats: {
        period,
        overview: stats[0] || { total: 0, byStatus: [], byPriority: [], byType: [] },
        overdue: {
          count: overdueComplaints.length,
          complaints: overdueComplaints.slice(0, 5) // Latest 5
        },
        urgent: {
          count: urgentComplaints.length,
          complaints: urgentComplaints.slice(0, 5) // Latest 5
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get overdue complaints
 * @route   GET /api/complaints/overdue
 * @access  Private (Admin only)
 */
const getOverdueComplaints = async (req, res, next) => {
  try {
    const overdueComplaints = await Complaint.findOverdue();

    res.status(200).json({
      success: true,
      count: overdueComplaints.length,
      complaints: overdueComplaints
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get urgent complaints
 * @route   GET /api/complaints/urgent
 * @access  Private (Admin only)
 */
const getUrgentComplaints = async (req, res, next) => {
  try {
    const urgentComplaints = await Complaint.findUrgent();

    res.status(200).json({
      success: true,
      count: urgentComplaints.length,
      complaints: urgentComplaints
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
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
};