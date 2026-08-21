/**
 * The 3AM Channel - Refactored Main Server
 * Architecture: MVC Refactored Express Server with Socket.io & Mongoose
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cron = require('node-cron');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const config = require('./config');
const logger = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const apiRoutes = require('./src/routes/apiRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const devRoutes = require('./src/routes/devRoutes');
const PostRepository = require('./src/services/PostRepository');
const setupSockets = require('./src/socket');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io Server
const io = new Server(server, {
    cors: {
        origin: config.cors.origin,
        methods: ['GET', 'POST'],
        credentials: config.cors.credentials
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Expose Socket.io server to routing handlers via req.app.get('io')
app.set('io', io);

// ════════════════════════════════════════
// Security Middleware & CSP Configuration
// ════════════════════════════════════════
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            // Pure self-hosting: Removed CDN/cdnjs script domain
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            connectSrc: ["'self'", "ws:", "wss:"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"]
        }
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));

// Request correlation tracking
app.use((req, res, next) => {
    req.id = uuidv4();
    res.setHeader('X-Request-ID', req.id);
    next();
});

// Logger middleware
const morganFormat = config.isDevelopment ? 'dev' : 'combined';
app.use(morgan(morganFormat, { stream: { write: (msg) => logger.http(msg.trim()) } }));

app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));
app.use(compression());
app.use(require('cors')(config.cors));

// ════════════════════════════════════════
// Global Rate Limiters
// ════════════════════════════════════════
const globalLimiter = rateLimit({
    windowMs: config.rateLimit.global.windowMs,
    max: config.rateLimit.global.max,
    message: { error: config.rateLimit.global.message },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => config.isTest || (config.isDevelopment && (req.headers['x-spoof-mode'] === 'true' || config.devOverride))
});
app.use('/api/', globalLimiter);

// ════════════════════════════════════════
// Static Assets & Dynamic Developer Config
// ════════════════════════════════════════
app.use(express.static(path.join(__dirname, '.'), {
    maxAge: config.isProduction ? '1y' : 0,
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));

// Serves DEV_OVERRIDE state dynamically to the frontend client
app.get('/dev-config.js', (req, res) => {
    const isDevOpen = config.devOverride && config.isDevelopment;
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-store');
    res.send(`window.__DEV_OVERRIDE = ${isDevOpen ? 'true' : 'false'};`);
});

// ════════════════════════════════════════
// Application API Endpoints & Routes
// ════════════════════════════════════════
app.use('/api', apiRoutes);
app.use('/api/admin', adminRoutes);
app.use('/dev', devRoutes);

// Health / Readiness checks
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.get('/ready', async (req, res) => {
    const isDbConnected = mongoose.connection.readyState === 1;
    const checks = { server: 'ok', database: isDbConnected ? 'connected' : 'disconnected' };
    if (isDbConnected) {
        try {
            await mongoose.connection.db.admin().ping();
            checks.databasePing = 'ok';
        } catch {
            checks.databasePing = 'failed';
            checks.database = 'unhealthy';
        }
    }
    const isReady = checks.database === 'connected' && (!isDbConnected || checks.databasePing === 'ok');
    res.status(isReady ? 200 : 503).json({
        status: isReady ? 'ready' : 'not ready',
        checks,
        timestamp: new Date().toISOString()
    });
});

app.get('/api/time', (req, res) => {
    res.json({ timestamp: Date.now(), iso: new Date().toISOString() });
});

// ════════════════════════════════════════
// Database Connection Setup
// ════════════════════════════════════════
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

async function connectDatabase() {
    if (!config.database.uri) {
        if (config.isDevelopment || config.isTest) {
            logger.warn('⚠️ No MONGODB_URI — running in-memory (data resets on restart)');
            return;
        }
        logger.error('❌ MONGODB_URI is not set. See README.md → MongoDB Atlas Setup.');
        process.exit(1);
    }
    try {
        await mongoose.connect(config.database.uri, config.database.options);
        reconnectAttempts = 0;
        logger.info('✅ Connected to MongoDB Atlas');
    } catch (err) {
        logger.error('❌ MongoDB Atlas connection failed', { error: err.message });
        if (config.isDevelopment || config.isTest) {
            logger.warn('⚠️ MongoDB unavailable — falling back to in-memory storage');
            return;
        }
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
            logger.info(`Retrying in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})…`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return connectDatabase();
        }
        logger.error('❌ Could not connect to MongoDB Atlas after 5 attempts.');
        process.exit(1);
    }
}

mongoose.connection.on('disconnected', () => logger.warn('MongoDB Atlas disconnected'));
mongoose.connection.on('error', (err) => logger.error('MongoDB Atlas error', { error: err.message }));
mongoose.connection.on('reconnected', () => logger.info('✅ MongoDB Atlas reconnected'));

// ════════════════════════════════════════
// Sockets Setup & Scheduled Cleanups
// ════════════════════════════════════════
setupSockets(io);

cron.schedule(config.cleanup.cron, () => {
    logger.info('⏰ Scheduled cleanup triggered');
    PostRepository.performDailyCleanup();
});

// Error handling fallback
app.use(notFoundHandler);
app.use(errorHandler);

// Global exception catches
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', { error: error.message });
    gracefulShutdown(1);
});
process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection', { reason: String(reason) });
});

async function gracefulShutdown(exitCode = 0) {
    logger.info('Initiating graceful shutdown...');
    server.close(() => logger.info('HTTP server closed'));
    io.close(() => logger.info('Socket.io closed'));
    if (mongoose.connection.readyState === 1) {
        try {
            await mongoose.connection.close();
            logger.info('MongoDB connection closed');
        } catch (err) {
            logger.error('Error closing MongoDB', { error: err.message });
        }
    }
    setTimeout(() => {
        process.exit(exitCode);
    }, 1000);
}

// OS exit signal listeners
process.on('SIGTERM', () => gracefulShutdown(0));
process.on('SIGINT', () => gracefulShutdown(0));

// Start Boot sequence
//added || bcoz issue in deployment
const PORT = process.env.PORT || config.server.port;
if (process.env.NODE_ENV !== 'test') {
    connectDatabase().then(() => {
        server.listen(PORT, () => {
            logger.info(`🚀 Server running on port ${PORT} in ${config.env} mode`);
        });
    });
} else {
    connectDatabase();
}

module.exports = { app, server };
