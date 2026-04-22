require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

// Import models for Socket.IO authorization
const User = require('./models/User');
const ServiceRequest = require('./models/ServiceRequest');
const Message = require('./models/Message');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const providerRoutes = require('./routes/providers');
const serviceRoutes = require('./routes/services');
const requestRoutes = require('./routes/requests');
const reviewRoutes = require('./routes/reviews');
const complaintRoutes = require('./routes/complaints');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/upload');
const paymentRoutes = require('./routes/payments');
const webhookRoutes = require('./routes/webhooks');
const messageRoutes = require('./routes/messages');
const earningsRoutes = require('./routes/earnings');
const favoriteRoutes = require('./routes/favorites');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { rateLimiter } = require('./middleware/rateLimiter');
const sanitizeRequestBody = require('./middleware/sanitize');
const { csrfProtection, csrfErrorHandler, sendCsrfToken, cookieParser } = require('./middleware/csrf');

const app = express();
const server = http.createServer(app);

// CORS configuration - allow multiple frontend URLs
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8080',
  'http://localhost:8081'
];

// Add FRONTEND_URL from env if it exists and not already in the list
if (process.env.FRONTEND_URL && !allowedOrigins.includes(process.env.FRONTEND_URL)) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

// Socket.IO setup for real-time features
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

// Store io instance globally for use in other modules
app.set('io', io);

// Trust proxy - needed for Render and other reverse proxies
app.set('trust proxy', 1);

// Security middleware - enhanced helmet configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", process.env.FRONTEND_URL || 'http://localhost:3000']
    }
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  hsts: {
    maxAge: 31536000, // 1 year in seconds
    includeSubDomains: true,
    preload: true
  },
  frameguard: { action: 'deny' }, // Prevent clickjacking
  noSniff: true, // Prevent MIME sniffing
  xssFilter: true // Enable XSS filter
}));

// CORS configuration
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token']
}));

// Redirect HTTP to HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(301, `https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

// Remove X-Powered-By header to prevent exposing Express framework
app.disable('x-powered-by');

app.use(compression());

// Rate limiting
app.use(rateLimiter);

// Request logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Webhook routes - MUST be before body parser middleware for Stripe signature verification
app.use('/api/webhooks', webhookRoutes);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parsing for CSRF support
app.use(cookieParser());

// Sanitize request inputs to prevent XSS attacks
app.use(sanitizeRequestBody);

// Static files
app.use('/uploads', express.static('uploads'));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hudumaconnect')
.then(() => {
  console.log('✅ MongoDB connected successfully');
})
.catch((error) => {
  console.error('❌ MongoDB connection error:', error);
  process.exit(1);
});

// Socket.IO connection handling with authorization
io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);

  // Extract user ID from socket handshake data
  let userId = null;
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.id;
      socket.userId = userId; // Store userId on socket for later use
      console.log(`👤 User ${userId} authenticated for Socket.IO`);
    } catch (error) {
      console.warn('🔐 Invalid Socket.IO token:', error.message);
      socket.emit('auth_error', { message: 'Invalid authentication token' });
    }
  }

  // Join user to their personal room for notifications
  socket.on('join', (requestedUserId) => {
    if (!userId) {
      socket.emit('auth_error', { message: 'Not authenticated' });
      return;
    }

    // Verify user can only join their own room
    if (userId !== requestedUserId) {
      socket.emit('auth_error', { message: 'Cannot join another user\'s room' });
      console.warn(`🔐 User ${userId} attempted to join user ${requestedUserId}'s room`);
      return;
    }

    socket.join(userId);
    console.log(`👤 User ${userId} joined their notification room`);
  });

  // Handle provider location updates
  socket.on('updateLocation', (data) => {
    if (!userId) {
      socket.emit('auth_error', { message: 'Not authenticated' });
      return;
    }
    socket.broadcast.emit('providerLocationUpdate', { ...data, providerId: userId });
  });

  // Messaging events with authorization
  // Join service request conversation room (AUTHORIZED)
  socket.on('join_conversation', async (serviceRequestId) => {
    if (!userId) {
      socket.emit('auth_error', { message: 'Not authenticated' });
      return;
    }

    try {
      // Verify user is a participant in this service request
      const request = await ServiceRequest.findById(serviceRequestId);

      if (!request) {
        socket.emit('auth_error', { message: 'Service request not found' });
        console.warn(`🔐 User ${userId} tried to join non-existent request ${serviceRequestId}`);
        return;
      }

      const isCustomer = request.customerId.toString() === userId;
      const isProvider = request.providerId?.toString() === userId;

      if (!isCustomer && !isProvider) {
        socket.emit('auth_error', { message: 'You are not authorized to access this conversation' });
        console.warn(`🔐 User ${userId} attempted unauthorized access to request ${serviceRequestId}`);
        return;
      }

      socket.join(serviceRequestId);
      console.log(`💬 User ${userId} joined authorized conversation: ${serviceRequestId}`);

      // Send conversation history to the joining user
      try {
        const recentMessages = await Message.getConversation(serviceRequestId, {
          page: 1,
          limit: 20
        });
        // Reverse to show oldest first in conversation
        socket.emit('conversation_history', recentMessages.reverse());
        console.log(`📜 Sent ${recentMessages.length} messages history to user ${userId}`);
      } catch (historyError) {
        console.error('Error fetching conversation history:', historyError);
        // Don't fail the join, just log the error
      }
    } catch (error) {
      console.error('Error authorizing conversation access:', error);
      socket.emit('auth_error', { message: 'Error joining conversation' });
    }
  });

  // Leave service request conversation room
  socket.on('leave_conversation', (serviceRequestId) => {
    if (!userId) return;
    socket.leave(serviceRequestId);
    console.log(`💬 User ${userId} left conversation: ${serviceRequestId}`);
  });

  // Typing indicator (authorized - only works if in room)
  socket.on('typing', ({ serviceRequestId, userName }) => {
    if (!userId) {
      socket.emit('auth_error', { message: 'Not authenticated' });
      return;
    }
    // Only emit if user is in the conversation room
    if (socket.rooms.has(serviceRequestId)) {
      socket.to(serviceRequestId).emit('user_typing', {
        userId,
        userName
      });
    }
  });

  // Stop typing indicator (authorized)
  socket.on('stop_typing', ({ serviceRequestId }) => {
    if (!userId) return;
    // Only emit if user is in the conversation room
    if (socket.rooms.has(serviceRequestId)) {
      socket.to(serviceRequestId).emit('user_stopped_typing', {
        userId
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 User disconnected:', socket.id);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'HudumaConnect API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Routes
// Auth routes with partial CSRF (only on state-changing endpoints)
app.use('/api/auth', authRoutes);

// Protected routes with CSRF protection
const protectedRoutes = [
  { path: '/api/users', routes: userRoutes },
  { path: '/api/providers', routes: providerRoutes },
  { path: '/api/services', routes: serviceRoutes },
  { path: '/api/requests', routes: requestRoutes },
  { path: '/api/reviews', routes: reviewRoutes },
  { path: '/api/complaints', routes: complaintRoutes },
  { path: '/api/notifications', routes: notificationRoutes },
  { path: '/api/admin', routes: adminRoutes },
  { path: '/api/upload', routes: uploadRoutes },
  { path: '/api/payments', routes: paymentRoutes },
  { path: '/api/messages', routes: messageRoutes },
  { path: '/api/earnings', routes: earningsRoutes },
  { path: '/api/favorites', routes: favoriteRoutes }
];

// Apply CSRF protection to all protected routes (protect from state-changing methods)
const csrfProtectedRouter = express.Router();
csrfProtectedRouter.use(csrfProtection);

protectedRoutes.forEach(({ path, routes }) => {
  csrfProtectedRouter.use(path, routes);
});

app.use(csrfProtectedRouter);

// Apply CSRF error handler after routes
app.use(csrfErrorHandler);

// 404 handler for undefined routes
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found',
    path: req.originalUrl
  });
});

// Global error handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Process terminated');
    mongoose.connection.close();
  });
});

module.exports = app;