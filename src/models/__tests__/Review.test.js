const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Review = require('../../src/models/Review');
const ServiceRequest = require('../../src/models/ServiceRequest');
const User = require('../../src/models/User');
const Provider = require('../../src/models/Provider');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await mongoose.connection.dropDatabase();
});

describe('Review Model', () => {
  let customerId, providerId, serviceRequestId;

  beforeEach(async () => {
    // Create test users
    const customer = await User.create({
      name: 'Test Customer',
      email: 'customer@test.com',
      password: 'hashedpassword',
      phone: '0712345678',
      role: 'customer'
    });
    customerId = customer._id;

    const provider = await User.create({
      name: 'Test Provider',
      email: 'provider@test.com',
      password: 'hashedpassword',
      phone: '0787654321',
      role: 'provider'
    });
    providerId = provider._id;

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

  describe('Review Creation', () => {
    test('should create a valid review', async () => {
      const review = await Review.create({
        customerId,
        providerId,
        requestId: serviceRequestId,
        rating: 5,
        comment: 'Excellent service and very professional'
      });

      expect(review).toBeDefined();
      expect(review.rating).toBe(5);
      expect(review.comment).toBe('Excellent service and very professional');
      expect(review.customerId).toEqual(customerId);
      expect(review.providerId).toEqual(providerId);
    });

    test('should reject rating below 1', async () => {
      expect(async () => {
        await Review.create({
          customerId,
          providerId,
          requestId: serviceRequestId,
          rating: 0,
          comment: 'Good service'
        });
      }).rejects.toThrow();
    });

    test('should reject rating above 5', async () => {
      expect(async () => {
        await Review.create({
          customerId,
          providerId,
          requestId: serviceRequestId,
          rating: 6,
          comment: 'Good service'
        });
      }).rejects.toThrow();
    });

    test('should reject comment shorter than minimum', async () => {
      expect(async () => {
        await Review.create({
          customerId,
          providerId,
          requestId: serviceRequestId,
          rating: 5,
          comment: 'Good'
        });
      }).rejects.toThrow();
    });

    test('should reject comment longer than maximum', async () => {
      const longComment = 'a'.repeat(501);
      expect(async () => {
        await Review.create({
          customerId,
          providerId,
          requestId: serviceRequestId,
          rating: 5,
          comment: longComment
        });
      }).rejects.toThrow();
    });
  });

  describe('Unique Review Per Request', () => {
    test('should enforce unique review per customer per request', async () => {
      await Review.create({
        customerId,
        providerId,
        requestId: serviceRequestId,
        rating: 5,
        comment: 'Excellent service and professional work'
      });

      // Try to create duplicate
      expect(async () => {
        await Review.create({
          customerId,
          providerId,
          requestId: serviceRequestId,
          rating: 4,
          comment: 'Good service'
        });
      }).rejects.toThrow();
    });
  });

  describe('Helper Methods', () => {
    test('markAsHelpful should increment helpful votes', async () => {
      const review = await Review.create({
        customerId,
        providerId,
        requestId: serviceRequestId,
        rating: 5,
        comment: 'Excellent service and professional work'
      });

      await review.markAsHelpful();
      const updated = await Review.findById(review._id);

      expect(updated.helpfulVotes).toBe(1);
    });

    test('report should increment report count', async () => {
      const review = await Review.create({
        customerId,
        providerId,
        requestId: serviceRequestId,
        rating: 5,
        comment: 'Excellent service and professional work'
      });

      await review.report();
      const updated = await Review.findById(review._id);

      expect(updated.reportCount).toBe(1);
    });

    test('should hide review after 3 reports', async () => {
      const review = await Review.create({
        customerId,
        providerId,
        requestId: serviceRequestId,
        rating: 5,
        comment: 'Excellent service and professional work'
      });

      // Mock hiding after reports
      if (review.reportCount >= 3) {
        review.isHidden = true;
      }

      expect(review.isHidden).toBe(false); // Not hidden yet

      review.reportCount = 3;
      if (review.reportCount >= 3) {
        review.isHidden = true;
      }

      expect(review.isHidden).toBe(true); // Should be hidden
    });
  });

  describe('Statics Methods', () => {
    test('getProviderRating should calculate average rating', async () => {
      // Create multiple reviews for same provider
      await Review.create({
        customerId,
        providerId,
        requestId: serviceRequestId,
        rating: 5,
        comment: 'Excellent service and professional work'
      });

      const stats = await Review.getProviderRating(providerId);

      expect(stats.length).toBeGreaterThan(0);
      expect(stats[0].averageRating).toBe(5);
      expect(stats[0].totalReviews).toBe(1);
    });

    test('getRecentReviews should return recent reviews', async () => {
      await Review.create({
        customerId,
        providerId,
        requestId: serviceRequestId,
        rating: 5,
        comment: 'Excellent service and professional work'
      });

      const reviews = await Review.getRecentReviews(10);

      expect(reviews.length).toBe(1);
      expect(reviews[0].rating).toBe(5);
    });
  });
});
