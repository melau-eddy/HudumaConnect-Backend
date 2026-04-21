const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Message = require('../../models/Message');
const User = require('../../models/User');
const ServiceRequest = require('../../models/ServiceRequest');

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
  await Message.deleteMany({});
  await ServiceRequest.deleteMany({});
  await User.deleteMany({});
});

describe('Messaging System', () => {
  let senderId, recipientId, serviceRequestId;
  let requestData;

  beforeEach(async () => {
    const sender = await User.create({
      name: 'Sender',
      email: 'sender@test.com',
      password: 'SecurePass123!',
      phone: '0712345678',
      role: 'customer'
    });
    senderId = sender._id;

    const recipient = await User.create({
      name: 'Recipient',
      email: 'recipient@test.com',
      password: 'SecurePass123!',
      phone: '0787654321',
      role: 'provider'
    });
    recipientId = recipient._id;

    requestData = {
      customerId: senderId,
      providerId: recipientId,
      serviceType: 'Plumbers',
      description: 'Need plumbing service',
      location: 'Nairobi',
      dateTime: new Date(Date.now() + 24 * 60 * 60 * 1000)
    };

    const request = await ServiceRequest.create(requestData);
    serviceRequestId = request._id;
  });

  describe('Send Message', () => {
    test('should send message between request participants', async () => {
      const message = await Message.create({
        serviceRequestId,
        senderId,
        recipientId,
        content: 'Hello, I need help with plumbing'
      });

      expect(message).toBeDefined();
      expect(message.senderId.toString()).toBe(senderId.toString());
      expect(message.recipientId.toString()).toBe(recipientId.toString());
      expect(message.serviceRequestId.toString()).toBe(serviceRequestId.toString());
      expect(message.isRead).toBe(false);
      expect(message.createdAt).toBeDefined();
    });

    test('should require sender and recipient', async () => {
      try {
        await Message.create({
          serviceRequestId,
          content: 'Hello'
          // Missing senderId and recipientId
        });
        expect(true).toBe(false);
      } catch (err) {
        expect(err.errors).toBeDefined();
      }
    });

    test('should require message content', async () => {
      try {
        await Message.create({
          serviceRequestId,
          senderId,
          recipientId
          // Missing content
        });
        expect(true).toBe(false);
      } catch (err) {
        expect(err.errors.content).toBeDefined();
      }
    });

    test('should allow empty attachments array', async () => {
      const message = await Message.create({
        serviceRequestId,
        senderId,
        recipientId,
        content: 'Hello',
        attachments: []
      });

      expect(message.attachments).toBeDefined();
      expect(Array.isArray(message.attachments)).toBe(true);
      expect(message.attachments.length).toBe(0);
    });
  });

  describe('Get Conversation', () => {
    beforeEach(async () => {
      // Create multiple messages in conversation
      await Message.create({
        serviceRequestId,
        senderId,
        recipientId,
        content: 'Hello'
      });

      await Message.create({
        serviceRequestId,
        senderId: recipientId,
        recipientId: senderId,
        content: 'Hi there'
      });

      await Message.create({
        serviceRequestId,
        senderId,
        recipientId,
        content: 'How can you help?'
      });
    });

    test('should retrieve all messages for conversation', async () => {
      const messages = await Message.find({ serviceRequestId });

      expect(messages.length).toBe(3);
      expect(messages.every(m => m.serviceRequestId.toString() === serviceRequestId.toString())).toBe(true);
    });

    test('should paginate messages (20 per page)', async () => {
      const pageSize = 20;
      const messages = await Message.find({ serviceRequestId })
        .skip(0)
        .limit(pageSize)
        .sort({ createdAt: 1 });

      expect(messages.length).toBeLessThanOrEqual(pageSize);
      expect(messages.length).toBe(3);
    });

    test('should sort messages by creation date', async () => {
      const messages = await Message.find({ serviceRequestId }).sort({ createdAt: 1 });

      for (let i = 0; i < messages.length - 1; i++) {
        expect(messages[i].createdAt.getTime()).toBeLessThanOrEqual(
          messages[i + 1].createdAt.getTime()
        );
      }
    });
  });

  describe('Mark as Read', () => {
    test('should mark message as read with timestamp', async () => {
      const message = await Message.create({
        serviceRequestId,
        senderId,
        recipientId,
        content: 'Hello'
      });

      expect(message.isRead).toBe(false);
      expect(message.readAt).toBeUndefined();

      message.isRead = true;
      message.readAt = new Date();
      await message.save();

      const updated = await Message.findById(message._id);
      expect(updated.isRead).toBe(true);
      expect(updated.readAt).toBeDefined();
    });

    test('should track read receipt time', async () => {
      const message = await Message.create({
        serviceRequestId,
        senderId,
        recipientId,
        content: 'Hello'
      });

      const before = new Date();
      message.isRead = true;
      message.readAt = new Date();
      await message.save();
      const after = new Date();

      const updated = await Message.findById(message._id);
      expect(updated.readAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(updated.readAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('Message Authorization', () => {
    test('should link message to service request', async () => {
      const message = await Message.create({
        serviceRequestId,
        senderId,
        recipientId,
        content: 'Hello'
      });

      const retrieved = await Message.findById(message._id);
      expect(retrieved.serviceRequestId.toString()).toBe(serviceRequestId.toString());
    });
  });
});
