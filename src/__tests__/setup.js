// Global test setup
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRE = '7d';
process.env.FRONTEND_URL = 'http://localhost:3000';

// Mock Socket.io if needed
jest.mock('socket.io', () => {
  return class MockIO {
    on() {}
    emit() {}
  };
});
