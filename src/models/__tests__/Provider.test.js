const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Provider = require('../../src/models/Provider');
const User = require('../../src/models/User');

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

describe('Provider Model', () => {
  let userId;

  beforeEach(async () => {
    const user = await User.create({
      name: 'Test Provider',
      email: 'provider@test.com',
      password: 'hashedpassword',
      phone: '0787654321',
      role: 'provider'
    });
    userId = user._id;
  });

  describe('Provider Creation', () => {
    test('should create a valid provider profile', async () => {
      const provider = await Provider.create({
        userId,
        services: ['Plumbing', 'Electrical'],
        bio: 'Professional service provider',
        location: 'Nairobi'
      });

      expect(provider).toBeDefined();
      expect(provider.userId).toEqual(userId);
      expect(provider.services).toEqual(['Plumbing', 'Electrical']);
      expect(provider.bio).toBe('Professional service provider');
    });

    test('should support all service categories', async () => {
      const categories = ['Plumbing', 'Electrical', 'Mechanics', 'Cleaning', 'Phone Repair', 'Carpentry'];

      for (const category of categories) {
        const provider = await Provider.create({
          userId,
          services: [category],
          location: 'Nairobi'
        });

        expect(provider.services).toContain(category);
      }
    });

    test('should track provider approval status', async () => {
      const provider = await Provider.create({
        userId,
        services: ['Plumbing'],
        location: 'Nairobi',
        approvalStatus: 'pending'
      });

      expect(provider.approvalStatus).toBe('pending');
    });
  });

  describe('Approval Workflow', () => {
    test('should support all approval statuses', async () => {
      const statuses = ['pending', 'approved', 'rejected'];

      for (const status of statuses) {
        const provider = await Provider.create({
          userId,
          services: ['Plumbing'],
          location: 'Nairobi',
          approvalStatus: status
        });

        expect(provider.approvalStatus).toBe(status);
      }
    });

    test('should track approval metadata', async () => {
      const admin = await User.create({
        name: 'Admin',
        email: 'admin@test.com',
        password: 'hashed',
        phone: '0712345678',
        role: 'admin'
      });

      const provider = await Provider.create({
        userId,
        services: ['Plumbing'],
        location: 'Nairobi',
        approvalStatus: 'approved',
        approvedBy: admin._id,
        approvedAt: new Date()
      });

      expect(provider.approvalStatus).toBe('approved');
      expect(provider.approvedBy).toEqual(admin._id);
      expect(provider.approvedAt).toBeDefined();
    });

    test('should track rejection reason', async () => {
      const reason = 'Incomplete documentation';
      const provider = await Provider.create({
        userId,
        services: ['Plumbing'],
        location: 'Nairobi',
        approvalStatus: 'rejected',
        rejectionReason: reason
      });

      expect(provider.rejectionReason).toBe(reason);
    });
  });

  describe('Provider Status', () => {
    test('should track if provider is active', async () => {
      const provider = await Provider.create({
        userId,
        services: ['Plumbing'],
        location: 'Nairobi',
        isActive: true
      });

      expect(provider.isActive).toBe(true);
    });

    test('should track if provider is accepting jobs', async () => {
      const provider = await Provider.create({
        userId,
        services: ['Plumbing'],
        location: 'Nairobi',
        isAcceptingJobs: true
      });

      expect(provider.isAcceptingJobs).toBe(true);
    });

    test('should allow toggling job acceptance', async () => {
      const provider = await Provider.create({
        userId,
        services: ['Plumbing'],
        location: 'Nairobi',
        isAcceptingJobs: true
      });

      provider.isAcceptingJobs = false;
      await provider.save();

      const updated = await Provider.findById(provider._id);
      expect(updated.isAcceptingJobs).toBe(false);
    });
  });

  describe('Rating and Reviews', () => {
    test('should track provider rating', async () => {
      const provider = await Provider.create({
        userId,
        services: ['Plumbing'],
        location: 'Nairobi',
        rating: 4.5
      });

      expect(provider.rating).toBe(4.5);
    });

    test('should track review count', async () => {
      const provider = await Provider.create({
        userId,
        services: ['Plumbing'],
        location: 'Nairobi',
        reviewCount: 0
      });

      expect(provider.reviewCount).toBe(0);
    });

    test('should track approved bookings count', async () => {
      const provider = await Provider.create({
        userId,
        services: ['Plumbing'],
        location: 'Nairobi',
        approvedBookings: 0
      });

      expect(provider.approvedBookings).toBe(0);
    });
  });

  describe('Response Metrics', () => {
    test('should track response rate', async () => {
      const provider = await Provider.create({
        userId,
        services: ['Plumbing'],
        location: 'Nairobi',
        responseRate: 95
      });

      expect(provider.responseRate).toBe(95);
    });

    test('should track average response time', async () => {
      const provider = await Provider.create({
        userId,
        services: ['Plumbing'],
        location: 'Nairobi',
        avgResponseTime: 30 // minutes
      });

      expect(provider.avgResponseTime).toBe(30);
    });
  });

  describe('Portfolio and Documents', () => {
    test('should store portfolio images', async () => {
      const portfolio = [
        {
          filename: 'image1.jpg',
          originalName: 'installation.jpg',
          url: 'https://example.com/image1.jpg',
          uploadedAt: new Date()
        }
      ];

      const provider = await Provider.create({
        userId,
        services: ['Plumbing'],
        location: 'Nairobi',
        portfolio
      });

      expect(provider.portfolio.length).toBe(1);
    });

    test('should store documents', async () => {
      const documents = [
        {
          filename: 'cert.pdf',
          documentType: 'license',
          url: 'https://example.com/cert.pdf',
          uploadedAt: new Date()
        }
      ];

      const provider = await Provider.create({
        userId,
        services: ['Plumbing'],
        location: 'Nairobi',
        documents
      });

      expect(provider.documents.length).toBe(1);
    });
  });

  describe('Availability Schedule', () => {
    test('should store weekly availability', async () => {
      const provider = await Provider.create({
        userId,
        services: ['Plumbing'],
        location: 'Nairobi',
        scheduleWindows: [
          {
            dayOfWeek: 'Monday',
            startTime: '08:00',
            endTime: '17:00',
            isAvailable: true
          }
        ]
      });

      expect(provider.scheduleWindows.length).toBe(1);
      expect(provider.scheduleWindows[0].dayOfWeek).toBe('Monday');
    });
  });

  describe('Bank Details', () => {
    test('should store bank account for payouts', async () => {
      const provider = await Provider.create({
        userId,
        services: ['Plumbing'],
        location: 'Nairobi',
        bankDetails: {
          accountNumber: '01234567890',
          bankCode: 'EQBLKENY',
          accountName: 'John Plumber'
        }
      });

      expect(provider.bankDetails).toBeDefined();
      expect(provider.bankDetails.accountNumber).toBe('01234567890');
    });
  });

  describe('Location and Coverage', () => {
    test('should store provider location', async () => {
      const provider = await Provider.create({
        userId,
        services: ['Plumbing'],
        location: 'Nairobi',
        coordinates: {
          latitude: -1.2921,
          longitude: 36.8219
        }
      });

      expect(provider.location).toBe('Nairobi');
      expect(provider.coordinates.latitude).toBe(-1.2921);
      expect(provider.coordinates.longitude).toBe(36.8219);
    });

    test('should track service radius', async () => {
      const provider = await Provider.create({
        userId,
        services: ['Plumbing'],
        location: 'Nairobi',
        serviceRadius: 15 // km
      });

      expect(provider.serviceRadius).toBe(15);
    });
  });
});
