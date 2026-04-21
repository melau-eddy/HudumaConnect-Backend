const Joi = require('joi');

/**
 * Validation middleware factory
 * @param {Object} schema - Joi validation schema
 * @param {string} property - Request property to validate (body, query, params)
 */
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error } = schema.validate(req[property], { abortEarly: false });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors
      });
    }

    next();
  };
};

// Common validation schemas
const schemas = {
  // User registration
  registerUser: Joi.object({
    name: Joi.string().trim().min(2).max(50).required().messages({
      'string.empty': 'Name is required',
      'string.min': 'Name must be at least 2 characters',
      'string.max': 'Name must not exceed 50 characters'
    }),
    email: Joi.string().email().required().messages({
      'string.email': 'Valid email is required',
      'string.empty': 'Email is required'
    }),
    password: Joi.string().min(8).required().messages({
      'string.min': 'Password must be at least 8 characters',
      'string.empty': 'Password is required'
    }),
    phone: Joi.string().pattern(/^(\+254|0)[0-9]{9}$/).required().messages({
      'string.pattern.base': 'Valid Kenyan phone number required (format: +254XXXXXXXXX or 0XXXXXXXXX)',
      'string.empty': 'Phone number is required'
    }),
    role: Joi.string().valid('customer', 'provider', 'admin').required().messages({
      'any.only': 'Role must be customer, provider, or admin'
    })
  }),

  // User login
  loginUser: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
    expectedRole: Joi.string().valid('customer', 'provider', 'admin').optional()
  }),

  // Provider profile
  providerProfile: Joi.object({
    bio: Joi.string().max(500).required(),
    services: Joi.array().items(Joi.string()).min(1).required(),
    priceRange: Joi.string().required(),
    location: Joi.string().required(),
    latitude: Joi.number().min(-90).max(90),
    longitude: Joi.number().min(-180).max(180),
    availability: Joi.object({
      monday: Joi.object({
        isAvailable: Joi.boolean(),
        startTime: Joi.string(),
        endTime: Joi.string()
      }),
      tuesday: Joi.object({
        isAvailable: Joi.boolean(),
        startTime: Joi.string(),
        endTime: Joi.string()
      }),
      wednesday: Joi.object({
        isAvailable: Joi.boolean(),
        startTime: Joi.string(),
        endTime: Joi.string()
      }),
      thursday: Joi.object({
        isAvailable: Joi.boolean(),
        startTime: Joi.string(),
        endTime: Joi.string()
      }),
      friday: Joi.object({
        isAvailable: Joi.boolean(),
        startTime: Joi.string(),
        endTime: Joi.string()
      }),
      saturday: Joi.object({
        isAvailable: Joi.boolean(),
        startTime: Joi.string(),
        endTime: Joi.string()
      }),
      sunday: Joi.object({
        isAvailable: Joi.boolean(),
        startTime: Joi.string(),
        endTime: Joi.string()
      })
    })
  }),

  // Service request
  serviceRequest: Joi.object({
    providerId: Joi.string().required(),
    serviceType: Joi.string().required(),
    description: Joi.string().min(10).max(500).required(),
    location: Joi.string().required(),
    dateTime: Joi.date().iso().required(),
    urgency: Joi.string().valid('low', 'medium', 'high').default('medium'),
    budget: Joi.number().min(0)
  }),

  // Review submission
  review: Joi.object({
    requestId: Joi.string().required().messages({
      'string.empty': 'Request ID is required'
    }),
    providerId: Joi.string().required().messages({
      'string.empty': 'Provider ID is required'
    }),
    rating: Joi.number().min(1).max(5).required().messages({
      'number.min': 'Rating must be at least 1',
      'number.max': 'Rating cannot exceed 5',
      'any.required': 'Rating is required'
    }),
    comment: Joi.string().trim().min(10).max(500).required().messages({
      'string.min': 'Review must be at least 10 characters',
      'string.max': 'Review cannot exceed 500 characters',
      'string.empty': 'Review comment is required'
    }),
    isAnonymous: Joi.boolean().optional()
  }),

  // Complaint submission
  complaint: Joi.object({
    providerId: Joi.string(),
    requestId: Joi.string(),
    type: Joi.string().valid('service_quality', 'pricing', 'behavior', 'no_show', 'technical_issue', 'other').required(),
    subject: Joi.string().max(100).required(),
    description: Joi.string().min(10).max(500).required(),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent').default('medium')
  }),

  // Admin response to complaint
  complaintResponse: Joi.object({
    adminResponse: Joi.string().min(10).max(1000).required(),
    status: Joi.string().valid('in_review', 'resolved', 'closed').required()
  }),

  // Password change
  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().min(6).required()
  }),

  // Password reset
  resetPassword: Joi.object({
    token: Joi.string().required(),
    password: Joi.string().min(6).required()
  }),

  // Update profile
  updateProfile: Joi.object({
    name: Joi.string().min(2).max(50),
    phone: Joi.string().pattern(/^(?:\+254|0)?[17]\d{8}$/),
    avatar: Joi.string()
  }),

  // Search query
  searchProviders: Joi.object({
    q: Joi.string().allow(''),
    category: Joi.string(),
    latitude: Joi.number().min(-90).max(90),
    longitude: Joi.number().min(-180).max(180),
    radius: Joi.number().min(1).max(100).default(10),
    minRating: Joi.number().min(0).max(5),
    priceMin: Joi.number().min(0),
    priceMax: Joi.number().min(0),
    sortBy: Joi.string().valid('rating', 'distance', 'price', 'reviews').default('rating'),
    page: Joi.number().min(1).default(1),
    limit: Joi.number().min(1).max(50).default(20)
  })
};

module.exports = {
  validate,
  schemas
};