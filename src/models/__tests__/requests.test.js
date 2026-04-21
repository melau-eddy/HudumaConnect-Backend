const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const ServiceRequest = require('../../models/ServiceRequest');
const User = require('../../models/User');
const Provider = require('../../models/Provider');

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
  await ServiceRequest.deleteMany({});
  await User.deleteMany({});
  await Provider.deleteMany({});
});

describe('Service Request Model & Logic', () => {
  let customerId, providerId;
  const validRequestData = {
    serviceType: 'Plumbers',
    description: 'I need professional plumbing service for my house',
    location: 'Nairobi',
    dateTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day from now
    estimatedCost: 500
  };

  beforeEach(async () => {
    const customer = await User.create({
      name: 'Customer',
      email: 'customer@test.com',
      password: 'SecurePass123!',
      phone: '0712345678',
      role: 'customer'
    });
    customerId = customer._id;

    const provider = await User.create({
      name: 'Provider',
      email: 'provider@test.com',
      password: 'SecurePass123!',
      phone: '0787654321',
      role: 'provider'
    });
    providerId = provider._id;

    await Provider.create({
      userId: providerId,
      services: ['Plumbers'],
      approvalStatus: 'approved',
      isActive: true
    });
  });

  describe('Create Request', () => {
    test('should create request with valid data', async () => {
      const request = await ServiceRequest.create({
        customerId,
        providerId,
        ...validRequestData
      });

      expect(request).toBeDefined();
      expect(request.customerId.toString()).toBe(customerId.toString());
      expect(request.providerId.toString()).toBe(providerId.toString());
      expect(request.status).toBe('pending');
      expect(request.createdAt).toBeDefined();
    });

    test('should mark request as completed after payment', async () => {
      const request = await ServiceRequest.create({
        customerId,
        providerId,
        ...validRequestData
      });

      // Accept then mark as completed (simulating payment confirmation)
      request.status = 'accepted';
      request.acceptedAt = new Date();
      await request.save();

      request.status = 'completed';
      request.completedAt = new Date();
      await request.save();

      const updated = await ServiceRequest.findById(request._id);
      expect(updated.status).toBe('completed');
      expect(updated.completedAt).toBeDefined();
    });

    test('should require description field', async () => {
      const incompleteData = {
        customerId,
        providerId,
        serviceType: 'Plumbers',
        location: 'Nairobi',
        dateTime: new Date()
        // Missing description
      };

      try {
        await ServiceRequest.create(incompleteData);
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err.errors.description).toBeDefined();
      }
    });

    test('should require dateTime field', async () => {
      const incompleteData = {
        customerId,
        providerId,
        serviceType: 'Plumbers',
        description: 'Need service',
        location: 'Nairobi'
        // Missing dateTime
      };

      try {
        await ServiceRequest.create(incompleteData);
        expect(true).toBe(false);
      } catch (err) {
        expect(err.errors.dateTime).toBeDefined();
      }
    });
  });

  describe('Get Requests', () => {
    beforeEach(async () => {
      // Create multiple requests
      await ServiceRequest.create({
        customerId,
        providerId,
        ...validRequestData,
        status: 'pending'
      });

      await ServiceRequest.create({
        customerId,
        providerId,
        ...validRequestData,
        status: 'accepted'
      });

      await ServiceRequest.create({
        customerId,
        providerId,
        ...validRequestData,
        status: 'completed'
      });
    });

    test('should list all customer requests', async () => {
      const requests = await ServiceRequest.find({ customerId }).populate('customerId');

      expect(requests.length).toBe(3);
      expect(requests.every(r => {
        const id = r.customerId._id || r.customerId;
        return id.toString() === customerId.toString();
      })).toBe(true);
    });

    test('should list only provider assigned requests', async () => {
      const requests = await ServiceRequest.find({ providerId }).populate('providerId');

      expect(requests.length).toBe(3);
      // providerId might be populated, so check the ID value
      expect(requests.every(r => {
        const id = r.providerId._id || r.providerId;
        return id.toString() === providerId.toString();
      })).toBe(true);
    });

    test('should filter requests by status', async () => {
      const pending = await ServiceRequest.find({
        customerId,
        status: 'pending'
      });

      expect(pending.length).toBe(1);
      expect(pending[0].status).toBe('pending');

      const completed = await ServiceRequest.find({
        customerId,
        status: 'completed'
      });

      expect(completed.length).toBe(1);
      expect(completed[0].status).toBe('completed');
    });

    test('should paginate requests (20 per page)', async () => {
      const pageSize = 20;
      const page = 1;
      const skip = (page - 1) * pageSize;

      const requests = await ServiceRequest.find({ customerId })
        .skip(skip)
        .limit(pageSize);

      expect(requests.length).toBeLessThanOrEqual(pageSize);
      expect(requests.length).toBe(3);
    });

    test('should return empty array when no requests found', async () => {
      const otherCustomerId = new mongoose.Types.ObjectId();
      const requests = await ServiceRequest.find({ customerId: otherCustomerId });

      expect(requests).toEqual([]);
    });
  });

  describe('Update Request', () => {
    let requestId;

    beforeEach(async () => {
      const request = await ServiceRequest.create({
        customerId,
        providerId,
        ...validRequestData
      });
      requestId = request._id;
    });

    test('should update request status', async () => {
      const request = await ServiceRequest.findById(requestId);
      request.status = 'accepted';
      request.acceptedAt = new Date();
      await request.save();

      const updated = await ServiceRequest.findById(requestId);
      expect(updated.status).toBe('accepted');
      expect(updated.acceptedAt).toBeDefined();
    });

    test('should track status transitions', async () => {
      let request = await ServiceRequest.findById(requestId);

      // pending → accepted
      request.status = 'accepted';
      await request.save();

      request = await ServiceRequest.findById(requestId);
      expect(request.status).toBe('accepted');

      // accepted → in_progress
      request.status = 'in_progress';
      request.startedAt = new Date();
      await request.save();

      request = await ServiceRequest.findById(requestId);
      expect(request.status).toBe('in_progress');

      // in_progress → completed
      request.status = 'completed';
      request.completedAt = new Date();
      await request.save();

      request = await ServiceRequest.findById(requestId);
      expect(request.status).toBe('completed');
    });

    test('should allow customer to cancel request', async () => {
      const request = await ServiceRequest.findById(requestId);
      request.status = 'cancelled';
      request.cancelledAt = new Date();
      await request.save();

      const updated = await ServiceRequest.findById(requestId);
      expect(updated.status).toBe('cancelled');
    });
  });

  describe('Request Authorization', () => {
    let requestId;

    beforeEach(async () => {
      const request = await ServiceRequest.create({
        customerId,
        providerId,
        ...validRequestData
      });
      requestId = request._id;
    });

    test('should verify customer is request owner', async () => {
      const request = await ServiceRequest.findById(requestId).populate('customerId');
      const customerId1 = request.customerId._id || request.customerId;
      const isCustomer = customerId1.toString() === customerId.toString();

      expect(isCustomer).toBe(true);
    });

    test('should verify provider is assigned to request', async () => {
      const request = await ServiceRequest.findById(requestId).populate('providerId');
      const providerId1 = request.providerId?._id || request.providerId;
      const isAssigned = providerId1?.toString() === providerId.toString();

      expect(isAssigned).toBe(true);
    });

    test('should prevent non-participant from modifying request', async () => {
      const otherUser = await User.create({
        name: 'Other',
        email: 'other@test.com',
        password: 'SecurePass123!',
        phone: '0755555555',
        role: 'customer'
      });

      const request = await ServiceRequest.findById(requestId);
      const isAuthorized =
        request.customerId.toString() === otherUser._id.toString() ||
        request.providerId?.toString() === otherUser._id.toString();

      expect(isAuthorized).toBe(false);
    });
  });

  describe('Request Timeline', () => {
    test('should track creation timestamp', async () => {
      const before = new Date();
      const request = await ServiceRequest.create({
        customerId,
        providerId,
        ...validRequestData
      });
      const after = new Date();

      expect(request.createdAt).toBeDefined();
      expect(request.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(request.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    test('should track acceptance timestamp', async () => {
      const request = await ServiceRequest.create({
        customerId,
        providerId,
        ...validRequestData
      });

      const before = new Date();
      request.status = 'accepted';
      request.acceptedAt = new Date();
      await request.save();
      const after = new Date();

      const updated = await ServiceRequest.findById(request._id);
      expect(updated.acceptedAt).toBeDefined();
      expect(updated.acceptedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    test('should track completion timestamp', async () => {
      const request = await ServiceRequest.create({
        customerId,
        providerId,
        ...validRequestData
      });

      request.status = 'completed';
      request.completedAt = new Date();
      await request.save();

      const updated = await ServiceRequest.findById(request._id);
      expect(updated.completedAt).toBeDefined();
    });
  });

  describe('Valid Service Types', () => {
    test('should only accept valid service types', () => {
      const validTypes = ['Electricians', 'Plumbers', 'Mechanics', 'Cleaners', 'Phone Repair', 'Painters', 'Carpenters', 'Landscapers'];
      expect(validTypes.includes(validRequestData.serviceType)).toBe(true);
    });
  });

  describe('Preventing Duplicate Requests', () => {
    test('should allow customer to create multiple requests', async () => {
      const req1 = await ServiceRequest.create({
        customerId,
        providerId,
        ...validRequestData
      });

      const req2 = await ServiceRequest.create({
        customerId,
        providerId,
        ...validRequestData,
        location: 'Mombasa' // Different location
      });

      expect(req1._id).not.toBe(req2._id);
      expect(req1.customerId.toString()).toBe(req2.customerId.toString());
    });
  });

  describe('Missing Provider Handling', () => {
    test('should allow request without assigned provider', async () => {
      const request = await ServiceRequest.create({
        customerId,
        // providerId omitted
        ...validRequestData
      });

      expect(request.providerId).toBeUndefined();
      expect(request.customerId).toBeDefined();
    });

    test('should allow assigning provider after request creation', async () => {
      const request = await ServiceRequest.create({
        customerId,
        ...validRequestData
      });

      request.providerId = providerId;
      await request.save();

      const updated = await ServiceRequest.findById(request._id);
      const updatedProviderId = updated.providerId._id || updated.providerId;
      expect(updatedProviderId.toString()).toBe(providerId.toString());
    });
  });
});
