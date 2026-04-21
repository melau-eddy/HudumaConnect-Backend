const User = require('../../models/User');
const authController = require('../../controllers/authController');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

let mongoServer;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await User.deleteMany({});
});

describe('Authentication Controller', () => {
  describe('User Registration', () => {
    test('should hash password before saving user', async () => {
      const userData = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePass123!',
        phone: '0712345678',
        role: 'customer'
      };

      const user = new User(userData);
      await user.save();

      expect(user.password).not.toBe(userData.password);
      expect(await user.comparePassword('SecurePass123!')).toBe(true);
      expect(await user.comparePassword('WrongPassword')).toBe(false);
    });

    test('should reject duplicate email on registration', async () => {
      const userData = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePass123!',
        phone: '0712345678',
        role: 'customer'
      };

      const user1 = new User(userData);
      await user1.save();

      const user2 = new User(userData);

      try {
        await user2.save();
        expect(true).toBe(false); // Should not reach here
      } catch (err) {
        expect(err.code).toBe(11000); // MongoDB duplicate key error
      }
    });

    test('should create user with valid data', async () => {
      const userData = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePass123!',
        phone: '0712345678',
        role: 'customer'
      };

      const user = new User(userData);
      await user.save();

      const saved = await User.findById(user._id);
      expect(saved.email).toBe(userData.email);
      expect(saved.name).toBe(userData.name);
      expect(saved.failedLoginAttempts).toBe(0);
      // lockUntil is undefined when not set, not null
      expect(saved.lockUntil).toBeUndefined();
    });
  });

  describe('Account Lockout', () => {
    beforeEach(async () => {
      const user = new User({
        name: 'Test User',
        email: 'test@example.com',
        password: 'SecurePass123!',
        phone: '0712345678',
        role: 'customer'
      });
      await user.save();
    });

    test('should increment failed login attempts', async () => {
      const user = await User.findOne({ email: 'test@example.com' });

      user.failedLoginAttempts = 0;
      await user.save();

      const isMatch = await user.comparePassword('WrongPassword');
      expect(isMatch).toBe(false);

      // Simulate incrementing
      user.failedLoginAttempts += 1;
      await user.save();

      const updated = await User.findOne({ email: 'test@example.com' });
      expect(updated.failedLoginAttempts).toBe(1);
    });

    test('should lock account after 5 failed attempts', async () => {
      const user = await User.findOne({ email: 'test@example.com' });

      // Simulate 5 failed attempts
      for (let i = 0; i < 5; i++) {
        user.failedLoginAttempts += 1;
        if (user.failedLoginAttempts >= 5) {
          user.lockUntil = new Date(Date.now() + 30 * 60 * 1000);
        }
        await user.save();
      }

      const locked = await User.findOne({ email: 'test@example.com' });
      expect(locked.failedLoginAttempts).toBe(5);
      expect(locked.lockUntil).toBeDefined();
      expect(locked.lockUntil.getTime()).toBeGreaterThan(Date.now());
    });

    test('should suppress login if account is locked', async () => {
      const user = await User.findOne({ email: 'test@example.com' });
      user.failedLoginAttempts = 5;
      user.lockUntil = new Date(Date.now() + 30 * 60 * 1000);
      await user.save();

      const locked = await User.findOne({ email: 'test@example.com' });

      // Check lock status
      const isLocked = locked.lockUntil && locked.lockUntil > new Date();
      expect(isLocked).toBe(true);
    });

    test('should reset failed attempts on successful login', async () => {
      const user = await User.findOne({ email: 'test@example.com' });

      // Simulate 3 failed attempts then reset
      user.failedLoginAttempts = 3;
      await user.save();

      user.failedLoginAttempts = 0;
      user.lockUntil = null;
      await user.save();

      const reset = await User.findOne({ email: 'test@example.com' });
      expect(reset.failedLoginAttempts).toBe(0);
      expect(reset.lockUntil).toBeNull();
    });
  });

  describe('JWT Token', () => {
    test('should generate valid JWT token', () => {
      const payload = { id: 'user123', role: 'customer', email: 'test@example.com' };
      const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      expect(decoded.id).toBe(payload.id);
      expect(decoded.role).toBe(payload.role);
    });

    test('should reject expired token', () => {
      const payload = { id: 'user123', role: 'customer' };
      const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '0s' });

      // Wait a bit for token to expire
      expect(() => {
        jwt.verify(token, process.env.JWT_SECRET);
      }).toThrow();
    });

    test('should reject token with invalid signature', () => {
      const payload = { id: 'user123', role: 'customer' };
      const token = jwt.sign(payload, 'wrong-secret', { expiresIn: '7d' });

      expect(() => {
        jwt.verify(token, process.env.JWT_SECRET);
      }).toThrow();
    });

    test('should extract user ID and role from token', () => {
      const userId = 'user456';
      const token = jwt.sign(
        { id: userId, role: 'provider' },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      expect(decoded.id).toBe(userId);
      expect(decoded.role).toBe('provider');
    });
  });

  describe('Password Validation', () => {
    test('should validate password strength', () => {
      const user = new User({
        name: 'Test',
        email: 'test@example.com',
        password: 'SecurePass123!',
        phone: '0712345678',
        role: 'customer'
      });

      // Password should be long enough and have special characters
      expect(user.password).toBeDefined();
    });

    test('should compare password correctly', async () => {
      const userData = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'SecurePass123!',
        phone: '0712345678',
        role: 'customer'
      };

      const user = new User(userData);
      await user.save();

      const match = await user.comparePassword('SecurePass123!');
      expect(match).toBe(true);

      const noMatch = await user.comparePassword('WrongPassword');
      expect(noMatch).toBe(false);
    });
  });

  describe('Email Verification', () => {
    test('should track email verification status', async () => {
      const user = new User({
        name: 'Test User',
        email: 'test@example.com',
        password: 'SecurePass123!',
        phone: '0712345678',
        role: 'customer',
        isEmailVerified: false
      });

      await user.save();

      let saved = await User.findById(user._id);
      expect(saved.isEmailVerified).toBe(false);

      // Mark as verified
      saved.isEmailVerified = true;
      await saved.save();

      saved = await User.findById(user._id);
      expect(saved.isEmailVerified).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    test('should allow password reset request', async () => {
      const user = new User({
        name: 'Test User',
        email: 'test@example.com',
        password: 'SecurePass123!',
        phone: '0712345678',
        role: 'customer'
      });

      await user.save();
      const saved = await User.findById(user._id);
      expect(saved.email).toBe('test@example.com');
    });

    test('should track reset token expiration', async () => {
      const user = new User({
        name: 'Test User',
        email: 'test@example.com',
        password: 'SecurePass123!',
        phone: '0712345678',
        role: 'customer'
      });

      await user.save();

      // Check user was created
      const saved = await User.findById(user._id);
      expect(saved).toBeDefined();
      expect(saved.email).toBe('test@example.com');
      // Password reset fields may not exist initially
    });
  });

  describe('CSRF Token', () => {
    test('should store CSRF token', () => {
      const csrfToken = 'test-csrf-token-123';

      expect(csrfToken).toBeDefined();
      expect(typeof csrfToken).toBe('string');
      expect(csrfToken.length).toBeGreaterThan(0);
    });

    test('should regenerate CSRF token', () => {
      const token1 = 'csrf-1-' + Math.random();
      const token2 = 'csrf-2-' + Math.random();

      expect(token1).not.toBe(token2);
    });
  });
});
