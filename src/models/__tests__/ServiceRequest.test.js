const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
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

describe('ServiceRequest Model', () => {
  let customerId, providerId;

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
  });

  describe('ServiceRequest Creation', () => {
    test('should create a valid service request', async () => {
      const request = await ServiceRequest.create({
        customerId,
        providerId,
        serviceType: 'Plumbing',
        location: 'Nairobi',
        status: 'pending',
        estimatedCost: 5000,
        description: 'Need to fix kitchen sink'
      });

      expect(request).toBeDefined();
      expect(request.serviceType).toBe('Plumbing');
      expect(request.status).toBe('pending');
      expect(request.estimatedCost).toBe(5000);
    });

    test('should require serviceType', async () => {
      expect(async () => {
        await ServiceRequest.create({
          customerId,
          providerId,
          location: 'Nairobi',
          status: 'pending'
        });
      }).rejects.toThrow();
    });

    test('should start with pending status', async () => {
      const request = await ServiceRequest.create({
        customerId,
        providerId,
        serviceType: 'Plumbing',
        location: 'Nairobi',
        status: 'pending'
      });

      expect(request.status).toBe('pending');
    });
  });

  describe('Status Lifecycle', () => {
    test('should allow status transitions', async () => {
      const request = await ServiceRequest.create({
        customerId,
        providerId,
        serviceType: 'Plumbing',
        location: 'Nairobi',
        status: 'pending'
      });

      // Transition to accepted
      request.status = 'accepted';
      await request.save();
      expect(request.status).toBe('accepted');

      // Transition to in_progress
      request.status = 'in_progress';
      await request.save();
      expect(request.status).toBe('in_progress');

      // Transition to completed
      request.status = 'completed';
      await request.save();
      expect(request.status).toBe('completed');
    });

    test('should reject invalid status', async () => {
      expect(async () => {
        await ServiceRequest.create({
          customerId,
          providerId,
          serviceType: 'Plumbing',
          location: 'Nairobi',
          status: 'invalid_status'
        });
      }).rejects.toThrow();
    });

    test('should support all valid statuses', async () => {
      const validStatuses = ['pending', 'accepted', 'in_progress', 'completed', 'rejected', 'cancelled'];

      for (const status of validStatuses) {
        const request = await ServiceRequest.create({
          customerId,
          providerId,
          serviceType: 'Plumbing',
          location: 'Nairobi',
          status
        });

        expect(request.status).toBe(status);
      }
    });
  });

  describe('Cost Tracking', () => {
    test('should track estimated and final cost', async () => {
      const request = await ServiceRequest.create({
        customerId,
        providerId,
        serviceType: 'Plumbing',
        location: 'Nairobi',
        status: 'pending',
        estimatedCost: 5000,
        finalCost: 5500
      });

      expect(request.estimatedCost).toBe(5000);
      expect(request.finalCost).toBe(5500);
    });

    test('should validate costs are non-negative', async () => {
      expect(async () => {
        await ServiceRequest.create({
          customerId,
          providerId,
          serviceType: 'Plumbing',
          location: 'Nairobi',
          status: 'pending',
          estimatedCost: -1000
        });
      }).rejects.toThrow();
    });
  });

  describe('Urgency Levels', () => {
    test('should support urgency levels', async () => {
      const urgencies = ['low', 'medium', 'high'];

      for (const urgency of urgencies) {
        const request = await ServiceRequest.create({
          customerId,
          providerId,
          serviceType: 'Plumbing',
          location: 'Nairobi',
          status: 'pending',
          urgency
        });

        expect(request.urgency).toBe(urgency);
      }
    });

    test('should default to medium urgency', async () => {
      const request = await ServiceRequest.create({
        customerId,
        providerId,
        serviceType: 'Plumbing',
        location: 'Nairobi',
        status: 'pending'
      });

      expect(request.urgency).toBe('medium');
    });
  });

  describe('Payment Methods', () => {
    test('should support multiple payment methods', async () => {
      const methods = ['cash', 'mpesa', 'bank_transfer', 'card'];

      for (const method of methods) {
        const request = await ServiceRequest.create({
          customerId,
          providerId,
          serviceType: 'Plumbing',
          location: 'Nairobi',
          status: 'pending',
          paymentMethod: method
        });

        expect(request.paymentMethod).toBe(method);
      }
    });
  });

  describe('Notes and Communication', () => {
    test('should store customer notes', async () => {
      const notes = 'Please bring your own tools';
      const request = await ServiceRequest.create({
        customerId,
        providerId,
        serviceType: 'Plumbing',
        location: 'Nairobi',
        status: 'pending',
        customerNotes: notes
      });

      expect(request.customerNotes).toBe(notes);
    });

    test('should store provider notes', async () => {
      const notes = 'Will require 2 hours for completion';
      const request = await ServiceRequest.create({
        customerId,
        providerId,
        serviceType: 'Plumbing',
        location: 'Nairobi',
        status: 'pending'
      });

      request.providerNotes = notes;
      await request.save();

      expect(request.providerNotes).toBe(notes);
    });
  });

  describe('Review Tracking', () => {
    test('should track if service has been reviewed', async () => {
      const request = await ServiceRequest.create({
        customerId,
        providerId,
        serviceType: 'Plumbing',
        location: 'Nairobi',
        status: 'completed'
      });

      expect(request.isReviewed).toBe(false);

      request.isReviewed = true;
      await request.save();

      const updated = await ServiceRequest.findById(request._id);
      expect(updated.isReviewed).toBe(true);
    });
  });
});
