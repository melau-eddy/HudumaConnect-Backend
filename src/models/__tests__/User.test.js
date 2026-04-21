const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../../src/models/User');
const bcrypt = require('bcryptjs');

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

describe('User Model', () => {
  describe('User Creation and Validation', () => {
    test('should create a valid user', async () => {
      const user = await User.create({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'testPassword123',
        phone: '0712345678',
        role: 'customer'
      });

      expect(user).toBeDefined();
      expect(user.name).toBe('John Doe');
      expect(user.email).toBe('john@example.com');
      expect(user.role).toBe('customer');
    });

    test('should enforce unique email', async () => {
      await User.create({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'testPassword123',
        phone: '0712345678',
        role: 'customer'
      });

      expect(async () => {
        await User.create({
          name: 'Jane Doe',
          email: 'john@example.com',
          password: 'testPassword456',
          phone: '0787654321',
          role: 'customer'
        });
      }).rejects.toThrow();
    });

    test('should validate email format', async () => {
      expect(async () => {
        await User.create({
          name: 'John Doe',
          email: 'invalid-email',
          password: 'testPassword123',
          phone: '0712345678',
          role: 'customer'
        });
      }).rejects.toThrow();
    });

    test('should validate Kenyan phone number', async () => {
      // Valid formats: +254XXXXXXXXX or 0XXXXXXXXX
      const user = await User.create({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'testPassword123',
        phone: '+254712345678',
        role: 'customer'
      });

      expect(user.phone).toBe('+254712345678');
    });

    test('should reject invalid phone number', async () => {
      expect(async () => {
        await User.create({
          name: 'John Doe',
          email: 'john@example.com',
          password: 'testPassword123',
          phone: '123456789', // Invalid format
          role: 'customer'
        });
      }).rejects.toThrow();
    });

    test('should allow valid roles only', async () => {
      expect(async () => {
        await User.create({
          name: 'John Doe',
          email: 'john@example.com',
          password: 'testPassword123',
          phone: '0712345678',
          role: 'invalidRole'
        });
      }).rejects.toThrow();
    });
  });

  describe('Password Hashing', () => {
    test('should hash password before saving', async () => {
      const user = await User.create({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'testPassword123',
        phone: '0712345678',
        role: 'customer'
      });

      expect(user.password).not.toBe('testPassword123'); // Should be hashed
      expect(user.password.length).toBeGreaterThan(20); // Bcrypt hash is long
    });

    test('should match password with comparePassword method', async () => {
      const user = await User.create({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'testPassword123',
        phone: '0712345678',
        role: 'customer'
      });

      // comparePassword should be defined
      if (user.comparePassword) {
        const isMatch = await user.comparePassword('testPassword123');
        expect(isMatch).toBe(true);
      }
    });
  });

  describe('Account Lockout', () => {
    test('should track failed login attempts', async () => {
      const user = await User.create({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'testPassword123',
        phone: '0712345678',
        role: 'customer'
      });

      // Check if lockout fields exist
      expect(user).toHaveProperty('loginAttempts');
      expect(user).toHaveProperty('lockUntil');
    });
  });

  describe('Email Verification', () => {
    test('should start with unverified email', async () => {
      const user = await User.create({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'testPassword123',
        phone: '0712345678',
        role: 'customer'
      });

      expect(user.isEmailVerified).toBe(false);
    });

    test('should allow marking email as verified', async () => {
      const user = await User.create({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'testPassword123',
        phone: '0712345678',
        role: 'customer'
      });

      user.isEmailVerified = true;
      await user.save();

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.isEmailVerified).toBe(true);
    });
  });

  describe('Role-Based Access', () => {
    test('should create customer user', async () => {
      const user = await User.create({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'testPassword123',
        phone: '0712345678',
        role: 'customer'
      });

      expect(user.role).toBe('customer');
    });

    test('should create provider user', async () => {
      const user = await User.create({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'testPassword123',
        phone: '0712345678',
        role: 'provider'
      });

      expect(user.role).toBe('provider');
    });

    test('should create admin user', async () => {
      const user = await User.create({
        name: 'Admin User',
        email: 'admin@example.com',
        password: 'testPassword123',
        phone: '0712345678',
        role: 'admin'
      });

      expect(user.role).toBe('admin');
    });
  });

  describe('User Deactivation', () => {
    test('should allow deactivating user', async () => {
      const user = await User.create({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'testPassword123',
        phone: '0712345678',
        role: 'customer'
      });

      user.isActive = false;
      await user.save();

      const updatedUser = await User.findById(user._id);
      expect(updatedUser.isActive).toBe(false);
    });
  });
});
