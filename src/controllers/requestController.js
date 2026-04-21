const ServiceRequest = require('../models/ServiceRequest');
const User = require('../models/User');
const Provider = require('../models/Provider');
const Notification = require('../models/Notification');
const mongoose = require('mongoose');

/**
 * @desc    Create a service request
 * @route   POST /api/requests
 * @access  Private (Customer only)
 */
const createRequest = async (req, res, next) => {
  try {
    const {
      providerId,
      serviceType,
      description,
      location,
      latitude,
      longitude,
      dateTime,
      urgency,
      budget,
      customerNotes
    } = req.body;

    let assignedProviderUserId = null;
    let targetedProvider = null;

    if (providerId) {
      if (!mongoose.Types.ObjectId.isValid(providerId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid provider ID'
        });
      }

      // Find provider and determine why it might not be available
      targetedProvider = await Provider.findOne({
        $or: [{ _id: providerId }, { userId: providerId }]
      });

      if (!targetedProvider) {
        return res.status(404).json({
          success: false,
          message: 'Selected provider not found'
        });
      }

      // Check specific conditions with detailed error messages
      if (targetedProvider.approvalStatus !== 'approved') {
        if (targetedProvider.approvalStatus === 'pending') {
          return res.status(400).json({
            success: false,
            message: 'Provider account is pending approval. Please try again later.',
            errorCode: 'PROVIDER_PENDING_APPROVAL'
          });
        } else if (targetedProvider.approvalStatus === 'rejected') {
          return res.status(400).json({
            success: false,
            message: 'Provider account has been rejected and cannot accept requests.',
            errorCode: 'PROVIDER_REJECTED'
          });
        }
      }

      if (!targetedProvider.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Provider account is currently inactive.',
          errorCode: 'PROVIDER_INACTIVE'
        });
      }

      if (!targetedProvider.isAcceptingJobs) {
        return res.status(400).json({
          success: false,
          message: 'Provider is not currently accepting jobs. Please try another provider.',
          errorCode: 'PROVIDER_NOT_ACCEPTING_JOBS'
        });
      }

      if (!targetedProvider.services.includes(serviceType)) {
        return res.status(400).json({
          success: false,
          message: 'Selected provider does not offer this service type',
          errorCode: 'PROVIDER_SERVICE_UNAVAILABLE'
        });
      }

      assignedProviderUserId = targetedProvider.userId;
    }

    const serviceRequest = await ServiceRequest.create({
      customerId: req.user.id,
      providerId: assignedProviderUserId,
      serviceType,
      description,
      location,
      latitude,
      longitude,
      dateTime,
      urgency: urgency || 'medium',
      budget,
      customerNotes
    });

    // Populate customer and provider names before emitting
    const populatedRequest = await serviceRequest.populate('customerId', 'name');
    await populatedRequest.populate('providerId', 'name');

    // Emit real-time update to customer
    try {
      const io = req.app.get('io');
      if (io) {
        const requestObj = populatedRequest.toObject();
        io.to(req.user.id).emit('request_created', {
          id: requestObj._id.toString(),
          customerId: typeof requestObj.customerId === 'object' ? requestObj.customerId._id.toString() : requestObj.customerId,
          customerName: typeof requestObj.customerId === 'object' ? requestObj.customerId.name : 'You',
          providerId: requestObj.providerId ? (typeof requestObj.providerId === 'object' ? requestObj.providerId._id.toString() : requestObj.providerId) : undefined,
          providerName: typeof requestObj.providerId === 'object' ? requestObj.providerId?.name : undefined,
          serviceType: requestObj.serviceType,
          description: requestObj.description,
          location: requestObj.location,
          dateTime: requestObj.dateTime,
          status: requestObj.status,
          urgency: requestObj.urgency,
          budget: requestObj.budget,
          createdAt: requestObj.createdAt
        });
      }
    } catch (socketError) {
      console.error('Failed to emit request creation via Socket.IO:', socketError);
      // Don't fail the request if Socket.IO fails - user can still see it via refresh
    }

    // Notify available providers about the new request
    try {
      const providers = targetedProvider
        ? [await targetedProvider.populate('userId', 'name')]
        : await Provider.find({
            services: serviceType,
            isActive: true,
            isAcceptingJobs: true,
            approvalStatus: 'approved'
          }).populate('userId', 'name');

      for (const provider of providers) {
        if (provider.userId) {
          await Notification.createNotification({
            userId: provider.userId._id,
            title: 'New Service Request Available',
            message: `A new ${serviceType} request is available in ${location}`,
            type: 'request',
            category: 'info',
            priority: urgency === 'high' ? 'high' : 'medium',
            data: {
              requestId: serviceRequest._id,
              customerId: req.user.id,
              serviceType,
              location,
              urgency
            }
          });
        }
      }
    } catch (notificationError) {
      console.error('Failed to send new request notifications:', notificationError);
    }

    res.status(201).json({
      success: true,
      message: 'Service request created successfully',
      request: {
        id: populatedRequest._id.toString(),
        customerName: populatedRequest.customerId?.name || 'You',
        providerName: populatedRequest.providerId?.name || undefined,
        ...populatedRequest.toObject()
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all service requests
 * @route   GET /api/requests
 * @access  Private
 */
const getRequests = async (req, res, next) => {
  try {
    const {
      status,
      serviceType,
      urgency,
      page = 1,
      limit = 10,
      sortBy = 'createdAt'
    } = req.query;

    let query = {};

    // Role-based filtering
    if (req.user.role === 'customer') {
      query.customerId = new mongoose.Types.ObjectId(req.user.id);
      console.log(`📋 Fetching requests for customer: ${req.user.id}`);
    } else if (req.user.role === 'provider') {
      // Provider sees requests assigned to them or pending requests for their services
      const provider = await Provider.findOne({ userId: req.user.id });
      if (provider) {
        query.$or = [
          { providerId: req.user.id },
          {
            status: 'pending',
            serviceType: { $in: provider.services },
            $or: [
              { providerId: { $exists: false } },
              { providerId: null },
              { providerId: req.user.id }
            ]
          }
        ];
      }
    }
    // Admin sees all requests (no additional filter)

    // Additional filters
    if (status) query.status = status;
    if (serviceType) query.serviceType = serviceType;
    if (urgency) query.urgency = urgency;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const sortOptions = {};
    sortOptions[sortBy] = sortBy === 'createdAt' ? -1 : 1;

    const requests = await ServiceRequest.find(query)
      .populate('customerId', 'name')
      .populate('providerId', 'name')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await ServiceRequest.countDocuments(query);

    console.log(`✅ Found ${requests.length} requests out of ${total} total in database`);

    // Transform requests properly - extract IDs from populated fields
    const transformedRequests = requests.map(req => {
      const requestObj = req.toObject();
      return {
        id: requestObj._id.toString(),
        customerId: typeof requestObj.customerId === 'object' ? requestObj.customerId._id.toString() : requestObj.customerId,
        customerName: typeof requestObj.customerId === 'object' ? requestObj.customerId.name : 'Unknown Customer',
        providerId: requestObj.providerId ? (typeof requestObj.providerId === 'object' ? requestObj.providerId._id.toString() : requestObj.providerId) : undefined,
        providerName: typeof requestObj.providerId === 'object' ? requestObj.providerId?.name : undefined,
        serviceType: requestObj.serviceType,
        description: requestObj.description,
        location: requestObj.location,
        latitude: requestObj.latitude,
        longitude: requestObj.longitude,
        dateTime: requestObj.dateTime,
        status: requestObj.status,
        urgency: requestObj.urgency,
        budget: requestObj.budget,
        createdAt: requestObj.createdAt,
        updatedAt: requestObj.updatedAt
      };
    });

    res.status(200).json({
      success: true,
      count: transformedRequests.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: transformedRequests
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get single service request
 * @route   GET /api/requests/:id
 * @access  Private
 */
const getRequest = async (req, res, next) => {
  try {
    const request = await ServiceRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found'
      });
    }

    // Check access permissions
    if (req.user.role === 'customer' && request.customerId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (req.user.role === 'provider') {
      // Provider can access if assigned to request or if request is pending and matches their services
      const isAssigned = request.providerId && request.providerId.toString() === req.user.id;
      const isPendingForServices = request.status === 'pending';

      if (!isAssigned && !isPendingForServices) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    res.status(200).json({
      success: true,
      request
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update service request status
 * @route   PATCH /api/requests/:id/status
 * @access  Private
 */
const updateRequestStatus = async (req, res, next) => {
  try {
    const { status, comment, estimatedCost, rejectionReason } = req.body;

    const request = await ServiceRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found'
      });
    }

    // Verify user is authorized to modify this request
    const isCustomer = request.customerId.toString() === req.user.id;
    const isProvider = request.providerId?.toString() === req.user.id;

    if (!isCustomer && !isProvider) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to modify this request'
      });
    }

    // Status transition validation based on user role
    if (req.user.role === 'provider') {
      if (status === 'accepted') {
        if (!request.canBeAccepted()) {
          return res.status(400).json({
            success: false,
            message: 'Request cannot be accepted in current status'
          });
        }
        request.providerId = req.user.id;
        if (estimatedCost) request.estimatedCost = estimatedCost;
      } else if (status === 'in_progress') {
        if (!request.canBeStarted()) {
          return res.status(400).json({
            success: false,
            message: 'Request cannot be started in current status'
          });
        }
      } else if (status === 'completed') {
        if (!request.canBeCompleted()) {
          return res.status(400).json({
            success: false,
            message: 'Request cannot be completed in current status'
          });
        }
      } else if (status === 'rejected') {
        request.rejectionReason = rejectionReason;
      }
    } else if (req.user.role === 'customer') {
      if (status === 'cancelled') {
        if (!request.canBeCancelled()) {
          return res.status(400).json({
            success: false,
            message: 'Request cannot be cancelled in current status'
          });
        }
        request.cancellationReason = comment;
      } else {
        return res.status(403).json({
          success: false,
          message: 'Customers can only cancel requests'
        });
      }
    }

    await request.updateStatus(status, req.user.id, comment);

    // Populate for proper response
    await request.populate('customerId', 'name');
    await request.populate('providerId', 'name');

    // Emit real-time update to customer
    try {
      const io = req.app.get('io');
      if (io) {
        const requestObj = request.toObject();
        io.to(request.customerId.toString()).emit('request_status_updated', {
          id: requestObj._id.toString(),
          customerId: typeof requestObj.customerId === 'object' ? requestObj.customerId._id.toString() : requestObj.customerId,
          customerName: typeof requestObj.customerId === 'object' ? requestObj.customerId.name : 'Unknown Customer',
          providerId: requestObj.providerId ? (typeof requestObj.providerId === 'object' ? requestObj.providerId._id.toString() : requestObj.providerId) : undefined,
          providerName: typeof requestObj.providerId === 'object' ? requestObj.providerId?.name : undefined,
          serviceType: requestObj.serviceType,
          description: requestObj.description,
          location: requestObj.location,
          dateTime: requestObj.dateTime,
          status: requestObj.status,
          urgency: requestObj.urgency,
          updatedAt: requestObj.updatedAt
        });
      }
    } catch (socketError) {
      console.error('Failed to emit request update via Socket.IO:', socketError);
    }

    // Send notification to customer about status change
    try {
      await Notification.notifyRequestStatus(request.customerId, request, status);
    } catch (notificationError) {
      console.error('Failed to send status update notification:', notificationError);
    }

    res.status(200).json({
      success: true,
      message: `Request ${status} successfully`,
      request
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get pending requests for provider's services
 * @route   GET /api/requests/available
 * @access  Private (Provider only)
 */
const getAvailableRequests = async (req, res, next) => {
  try {
    const provider = await Provider.findOne({ userId: req.user.id });

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    const { radius = 10 } = req.query;

    let query = {
      status: 'pending',
      serviceType: { $in: provider.services },
      $or: [
        { providerId: { $exists: false } },
        { providerId: null },
        { providerId: req.user.id }
      ]
    };

    // Add location-based filtering if provider has coordinates
    if (provider.latitude && provider.longitude) {
      query.latitude = { $exists: true };
      query.longitude = { $exists: true };
      // Additional geospatial filtering could be implemented here
    }

    const requests = await ServiceRequest.find(query)
      .sort({ urgency: -1, createdAt: 1 })
      .limit(20);

    res.status(200).json({
      success: true,
      count: requests.length,
      requests
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Add final cost to completed request
 * @route   PATCH /api/requests/:id/finalize
 * @access  Private (Provider only)
 */
const finalizeRequest = async (req, res, next) => {
  try {
    const { finalCost, providerNotes } = req.body;

    const request = await ServiceRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Service request not found'
      });
    }

    if (request.providerId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (request.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Request must be completed before finalizing'
      });
    }

    request.finalCost = finalCost;
    if (providerNotes) request.providerNotes = providerNotes;

    await request.save();

    // Populate for proper response
    await request.populate('customerId', 'name');
    await request.populate('providerId', 'name');

    // Emit real-time update to customer
    try {
      const io = req.app.get('io');
      if (io) {
        const requestObj = request.toObject();
        io.to(request.customerId.toString()).emit('request_status_updated', {
          id: requestObj._id,
          customerName: requestObj.customerId?.name || 'Unknown Customer',
          providerName: requestObj.providerId?.name || undefined,
          ...requestObj
        });
      }
    } catch (socketError) {
      console.error('Failed to emit request finalization via Socket.IO:', socketError);
    }

    // Update provider completed jobs count
    await Provider.findOneAndUpdate(
      { userId: req.user.id },
      { $inc: { completedJobs: 1 } }
    );

    // Notify customer about request finalization
    try {
      await Notification.createNotification({
        userId: request.customerId,
        title: 'Service Request Finalized',
        message: `Your ${request.serviceType} service has been finalized with a cost of ${finalCost ? `$${finalCost}` : 'TBD'}`,
        type: 'status',
        category: 'success',
        data: {
          requestId: request._id,
          providerId: req.user.id,
          finalCost,
          actionRequired: true
        }
      });
    } catch (notificationError) {
      console.error('Failed to send finalization notification:', notificationError);
    }

    res.status(200).json({
      success: true,
      message: 'Request finalized successfully',
      request
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createRequest,
  getRequests,
  getRequest,
  updateRequestStatus,
  getAvailableRequests,
  finalizeRequest
};
