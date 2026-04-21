// Mock nodemailer before any modules load
jest.mock('nodemailer', () => ({
  createTransporter: jest.fn(() => ({
    sendMail: jest.fn((mailOptions, callback) => {
      if (callback) callback(null, { messageId: 'test-id' });
      return Promise.resolve({ messageId: 'test-id' });
    })
  }))
}));

// Mock socket.io with proper Server constructor
jest.mock('socket.io', () => {
  const mockIO = {
    on: jest.fn(),
    emit: jest.fn(),
    to: jest.fn(() => ({ emit: jest.fn() })),
    in: jest.fn(() => ({ emit: jest.fn() })),
    sockets: {
      emit: jest.fn(),
      in: jest.fn(() => ({ emit: jest.fn() })),
    }
  };

  class Server {
    constructor() {
      return mockIO;
    }
  }

  Server.defaultMaxListeners = 10;

  return { Server };
});

// Mock stripe
jest.mock('stripe', () => {
  return jest.fn(() => ({
    paymentIntents: {
      create: jest.fn(),
      retrieve: jest.fn(),
      update: jest.fn()
    },
    webhookEndpoints: {
      create: jest.fn(),
      list: jest.fn()
    }
  }));
});

// Suppress console logs during tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

