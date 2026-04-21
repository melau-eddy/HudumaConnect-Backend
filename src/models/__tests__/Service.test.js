const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Service = require('../../src/models/Service');
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

describe('Service Model', () => {
  let providerId;

  beforeEach(async () => {
    const provider = await User.create({
      name: 'Test Provider',
      email: 'provider@test.com',
      password: 'hashedpassword',
      phone: '0787654321',
      role: 'provider'
    });
    providerId = provider._id;

    await Provider.create({
      userId: providerId,
      services: ['Plumbing'],
      approvalStatus: 'approved',
      isActive: true
    });
  });

  describe('Service Creation', () => {
    test('should create a valid service', async () => {
      const service = await Service.create({
        providerId,
        name: 'Pipe Installation',
        category: 'Plumbing',
        description: 'Professional pipe installation and repair services',
        pricingModel: 'fixed',
        basePrice: 5000,
        location: 'Nairobi'
      });

      expect(service).toBeDefined();
      expect(service.name).toBe('Pipe Installation');
      expect(service.category).toBe('Plumbing');
      expect(service.pricingModel).toBe('fixed');
      expect(service.basePrice).toBe(5000);
    });

    test('should support different pricing models', async () => {
      const models = ['fixed', 'range', 'hourly', 'negotiable'];

      for (const model of models) {
        const service = await Service.create({
          providerId,
          name: `Service - ${model}`,
          category: 'Plumbing',
          description: 'Professional service',
          pricingModel: model,
          basePrice: 1000,
          location: 'Nairobi'
        });

        expect(service.pricingModel).toBe(model);
      }
    });

    test('should require category', async () => {
      expect(async () => {
        await Service.create({
          providerId,
          name: 'Pipe Installation',
          description: 'Professional service',
          pricingModel: 'fixed',
          basePrice: 5000,
          location: 'Nairobi'
        });
      }).rejects.toThrow();
    });
  });

  describe('Availability', () => {
    test('should track service availability', async () => {
      const service = await Service.create({
        providerId,
        name: 'Plumbing Service',
        category: 'Plumbing',
        description: 'Professional service',
        pricingModel: 'fixed',
        basePrice: 5000,
        location: 'Nairobi',
        isAvailable: true
      });

      expect(service.isAvailable).toBe(true);
    });

    test('should allow toggling service availability', async () => {
      const service = await Service.create({
        providerId,
        name: 'Plumbing Service',
        category: 'Plumbing',
        description: 'Professional service',
        pricingModel: 'fixed',
        basePrice: 5000,
        location: 'Nairobi',
        isAvailable: true
      });

      service.isAvailable = false;
      await service.save();

      const updated = await Service.findById(service._id);
      expect(updated.isAvailable).toBe(false);
    });
  });

  describe('Service Pricing', () => {
    test('should support price ranges', async () => {
      const service = await Service.create({
        providerId,
        name: 'Plumbing Service',
        category: 'Plumbing',
        description: 'Professional service',
        pricingModel: 'range',
        basePrice: 5000,
        maxPrice: 10000,
        location: 'Nairobi'
      });

      expect(service.basePrice).toBe(5000);
      expect(service.maxPrice).toBe(10000);
    });

    test('should support hourly rates', async () => {
      const service = await Service.create({
        providerId,
        name: 'Hourly Service',
        category: 'Plumbing',
        description: 'Hourly rate service',
        pricingModel: 'hourly',
        basePrice: 500, // per hour
        location: 'Nairobi'
      });

      expect(service.pricingModel).toBe('hourly');
      expect(service.basePrice).toBe(500);
    });
  });

  describe('Service Details', () => {
    test('should store service tags', async () => {
      const tags = ['repair', 'installation', 'maintenance'];
      const service = await Service.create({
        providerId,
        name: 'Plumbing Service',
        category: 'Plumbing',
        description: 'Professional service',
        pricingModel: 'fixed',
        basePrice: 5000,
        location: 'Nairobi',
        tags
      });

      expect(service.tags).toEqual(tags);
    });

    test('should store service images', async () => {
      const images = [
        {
          url: 'https://example.com/image1.jpg',
          description: 'Before repair'
        },
        {
          url: 'https://example.com/image2.jpg',
          description: 'After repair'
        }
      ];

      const service = await Service.create({
        providerId,
        name: 'Plumbing Service',
        category: 'Plumbing',
        description: 'Professional service',
        pricingModel: 'fixed',
        basePrice: 5000,
        location: 'Nairobi',
        images
      });

      expect(service.images.length).toBe(2);
    });
  });

  describe('Booking and Statistics', () => {
    test('should track booking count', async () => {
      const service = await Service.create({
        providerId,
        name: 'Plumbing Service',
        category: 'Plumbing',
        description: 'Professional service',
        pricingModel: 'fixed',
        basePrice: 5000,
        location: 'Nairobi'
      });

      expect(service.bookingsCount).toBe(0);
    });

    test('should track average rating', async () => {
      const service = await Service.create({
        providerId,
        name: 'Plumbing Service',
        category: 'Plumbing',
        description: 'Professional service',
        pricingModel: 'fixed',
        basePrice: 5000,
        location: 'Nairobi'
      });

      expect(service.rating).toBe(0);
      expect(service.reviewCount).toBe(0);
    });
  });

  describe('Service Status', () => {
    test('should have active status by default', async () => {
      const service = await Service.create({
        providerId,
        name: 'Plumbing Service',
        category: 'Plumbing',
        description: 'Professional service',
        pricingModel: 'fixed',
        basePrice: 5000,
        location: 'Nairobi'
      });

      expect(service.status).toBe('active');
    });

    test('should support different statuses', async () => {
      const service = await Service.create({
        providerId,
        name: 'Plumbing Service',
        category: 'Plumbing',
        description: 'Professional service',
        pricingModel: 'fixed',
        basePrice: 5000,
        location: 'Nairobi',
        status: 'inactive'
      });

      expect(service.status).toBe('inactive');
    });
  });
});
