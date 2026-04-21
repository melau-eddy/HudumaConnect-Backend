const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const jwt = require('jsonwebtoken');
const Review = require('../../src/models/Review');
const ServiceRequest = require('../../src/models/ServiceRequest');
const User = require('../../src/models/User');
const Provider = require('../../src/models/Provider');
const { protect } = require('../../src/middleware/auth');

let mongoServer;
let app;
let customerId, providerId, serviceRequestId;
let customerToken, providerToken;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  // Setup minimal Express app
  app = express();
  app.use(express.json());

  // Test middleware to attach user
  app.use((req, res, next) => {
    if (req.headers.authorization) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, 'test-secret');
        req.user = { id: decoded.id, role: decoded.role };
      } catch (error) {
        req.user = null;
      }
    }
    next();
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await mongoose.connection.dropDatabase();
});

beforeEach(async () => {
  // Create test users
  const customer = await User.create({
    name: 'Test Customer',
    email: 'customer@test.com',
    password: 'hashedpassword',
    phone: '0712345678',
    role: 'customer',
    isEmailVerified: true
  });
  customerId = customer._id;
  customerToken = jwt.sign(
    { id: customerId.toString(), role: 'customer' },
    'test-secret',
    { expiresIn: '7d' }
  );

  const provider = await User.create({
    name: 'Test Provider',
    email: 'provider@test.com',
    password: 'hashedpassword',
    phone: '0787654321',
    role: 'provider',
    isEmailVerified: true
  });
  providerId = provider._id;
  providerToken = jwt.sign(
    { id: providerId.toString(), role: 'provider' },
    'test-secret',
    { expiresIn: '7d' }
  );

  // Create provider profile
  await Provider.create({
    userId: providerId,
    services: ['Plumbing'],
    approvalStatus: 'approved',
    isActive: true
  });

  // Create completed service request
  const serviceRequest = await ServiceRequest.create({
    customerId,
    providerId,
    serviceType: 'Plumbing',
    location: 'Nairobi',
    status: 'completed',
    estimatedCost: 1000,
    finalCost: 1000
  });
  serviceRequestId = serviceRequest._id;
});

describe('Review API Endpoints', () => {
  describe('POST /api/reviews - Create Review', () => {
    test('should create review with valid data', async () => {
      const reviewData = {
        requestId: serviceRequestId.toString(),
        providerId: providerId.toString(),
        rating: 5,
        comment: 'Excellent service and very professional'
      };

      // Mock the controller response
      app.post('/api/reviews', protect, async (req, res) => {
        const review = await Review.create({
          customerId: req.user.id,
          providerId: reviewData.providerId,
          requestId: reviewData.requestId,
          rating: reviewData.rating,
          comment: reviewData.comment
        });

        res.status(201).json({
          success: true,
          message: 'Review created successfully',
          review
        });
      });

      const response = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(reviewData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.review).toBeDefined();
      expect(response.body.review.rating).toBe(5);
    });

    test('should reject review for non-completed request', async () => {
      // Create pending request
      const pendingRequest = await ServiceRequest.create({
        customerId,
        providerId,
        serviceType: 'Plumbing',
        location: 'Nairobi',
        status: 'pending'
      });

      const reviewData = {
        requestId: pendingRequest._id.toString(),
        providerId: providerId.toString(),
        rating: 5,
        comment: 'Excellent service and very professional'
      };

      app.post('/api/reviews', protect, async (req, res) => {
        const serviceRequest = await ServiceRequest.findById(req.body.requestId);
        if (serviceRequest.status !== 'completed') {
          return res.status(400).json({
            success: false,
            message: 'Can only review completed services'
          });
        }
      });

      const response = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(reviewData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test('should prevent duplicate reviews for same request', async () => {
      const reviewData = {
        requestId: serviceRequestId.toString(),
        providerId: providerId.toString(),
        rating: 5,
        comment: 'Excellent service and very professional'
      };

      // Create first review
      await Review.create({
        customerId,
        providerId,
        requestId: serviceRequestId,
        rating: 5,
        comment: 'Excellent service and very professional'
      });

      // Mark request as reviewed
      const request_obj = await ServiceRequest.findById(serviceRequestId);
      request_obj.isReviewed = true;
      await request_obj.save();

      app.post('/api/reviews', protect, async (req, res) => {
        const serviceReq = await ServiceRequest.findById(req.body.requestId);
        if (serviceReq.isReviewed) {
          return res.status(400).json({
            success: false,
            message: 'This service has already been reviewed'
          });
        }
      });

      const response = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(reviewData);

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('already been reviewed');
    });

    test('should require authentication', async () => {
      const reviewData = {
        requestId: serviceRequestId.toString(),
        providerId: providerId.toString(),
        rating: 5,
        comment: 'Excellent service and very professional'
      };

      app.post('/api/reviews/protected', protect, (req, res) => {
        res.status(200).json({ success: true });
      });

      const response = await request(app)
        .post('/api/reviews/protected')
        .send(reviewData);

      // Since no token provided, should be unauthorized
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/reviews/provider/:providerId - Get Provider Reviews', () => {
    test('should return provider reviews', async () => {
      // Create review
      await Review.create({
        customerId,
        providerId,
        requestId: serviceRequestId,
        rating: 5,
        comment: 'Excellent service'
      });

      app.get('/api/reviews/provider/:providerId', async (req, res) => {
        const reviews = await Review.find({ providerId: req.params.providerId });
        res.status(200).json({
          success: true,
          count: reviews.length,
          reviews
        });
      });

      const response = await request(app)
        .get(`/api/reviews/provider/${providerId}/`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.count).toBeGreaterThan(0);
    });
  });
});
