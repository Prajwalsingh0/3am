/**
 * The 3AM Channel - Production Server
 * Features: Whisper Threads, Mood Tags, Ghost Posts, Smart Retention,
 *           Reports, Typing Indicators, Admin Routes
 */

// ========================================
// Dependencies
// ========================================
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
const {
    createPostValidators,
    addReactionValidators,
    addReplyValidators,
    addReportValidators,
    VALID_REPORT_REASONS
} = require('./middleware/validators');

// ========================================
// Initialize Express App
// ========================================
const app = express();
const server = http.createServer(app);

// ========================================
// Socket.io Setup
// ========================================
const io = new Server(server, {
    cors: {
        origin: config.cors.origin,
        methods: ['GET', 'POST'],
        credentials: config.cors.credentials
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// ========================================
// Security Middleware
// ========================================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com"],
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

app.use((req, res, next) => {
    req.id = uuidv4();
    res.setHeader('X-Request-ID', req.id);
    next();
});

const morganFormat = config.isDevelopment ? 'dev' : 'combined';
app.use(morgan(morganFormat, { stream: { write: (msg) => logger.http(msg.trim()) } }));

app.use(express.json({ limit: '50kb' })); // raised limit for longer posts
app.use(express.urlencoded({ extended: true, limit: '50kb' }));
app.use(compression());
app.use(require('cors')(config.cors));

const globalLimiter = rateLimit({
    windowMs: config.rateLimit.global.windowMs,
    max: config.rateLimit.global.max,
    message: { error: config.rateLimit.global.message },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => config.isDevelopment && (req.headers['x-spoof-mode'] === 'true' || config.devOverride)
});
app.use('/api/', globalLimiter);

const postLimiter = rateLimit({
    windowMs: config.rateLimit.post.windowMs,
    max: config.rateLimit.post.max,
    message: { error: config.rateLimit.post.message },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => config.isDevelopment && (req.headers['x-spoof-mode'] === 'true' || config.devOverride)
});

// Rate limiter for reports — 10 per hour per IP
const reportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Too many reports from this IP, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip
});

app.use(express.static(path.join(__dirname, '.'), {
    maxAge: config.isProduction ? '1y' : 0,
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));

// ============================================================
// /dev-config.js — synchronous client bootstrap for dev mode.
// Loaded by index.html BEFORE app.js (not deferred) so the
// client knows about DEV_OVERRIDE before init() runs.
// In production this still loads but sets __DEV_OVERRIDE=false.
// ============================================================
app.get('/dev-config.js', (req, res) => {
    const isDevOpen = config.devOverride && config.isDevelopment;
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-store');
    res.send(`window.__DEV_OVERRIDE = ${isDevOpen ? 'true' : 'false'};`);
});


function requireAdminKey(req, res, next) {
    const key = req.headers['x-admin-key'];
    if (!process.env.ADMIN_KEY || !key || key !== process.env.ADMIN_KEY) {
        return res.status(401).json({ error: { message: 'Unauthorized' } });
    }
    next();
}

// ========================================
// MongoDB Schemas
// ========================================

const ReplySchema = new mongoose.Schema({
    id: { type: String, required: true },
    content: { type: String, required: true, trim: true, minlength: 1 },
    userId: { type: String, required: true },
    mood: { type: String, maxlength: 20, default: null },
    createdAt: { type: Date, default: Date.now }
}, { _id: false });

// Report subdocument — stores reporter IP + reason + timestamp
const ReportSchema = new mongoose.Schema({
    ip: { type: String, required: true },
    reason: { type: String, enum: VALID_REPORT_REASONS, required: true },
    createdAt: { type: Date, default: Date.now }
}, { _id: false });

const PostSchema = new mongoose.Schema({
    id: { type: String, required: [true, 'Post ID is required'], unique: true, index: true },
    content: {
        type: String,
        required: [true, 'Content is required'],
        trim: true,
        minlength: [1, 'Content cannot be empty']
        // No maxlength — soft limit enforced in UI only
    },
    isAnonymous: { type: Boolean, default: true },
    userId: { type: String, required: [true, 'User ID is required'], index: true },
    timestamp: { type: Date, default: Date.now, index: true },
    mood: { type: String, maxlength: 20, default: null },
    reactions: {
        '😔': { type: [String], default: [] },
        '💀': { type: [String], default: [] },
        '🫂': { type: [String], default: [] },
        '❤️‍🩹': { type: [String], default: [] }
    },
    totalReactions: { type: Number, default: 0, index: true },
    replies: { type: [ReplySchema], default: [] },
    reports: { type: [ReportSchema], default: [] },
    isKept: { type: Boolean, default: false, index: true },
    sessionDate: { type: String, required: [true, 'Session date is required'], index: true }
}, { timestamps: true });

PostSchema.index({ sessionDate: 1, isKept: 1 });
PostSchema.index({ timestamp: -1 });
PostSchema.index({ sessionDate: 1, mood: 1 });

const Post = mongoose.model('Post', PostSchema);

const GhostPostSchema = new mongoose.Schema({
    content: { type: String, required: true },
    mood: { type: String, maxlength: 20, default: null },
    savedAt: { type: Date, default: Date.now, index: true }
});
const GhostPost = mongoose.model('GhostPost', GhostPostSchema);

// ========================================
// Database Connection
// ========================================
let isDbConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

async function connectDatabase() {
    // In dev with DEV_OVERRIDE=true and no URI, run on in-memory storage
    if (!config.database.uri) {
        if (config.devOverride && config.isDevelopment) {
            logger.warn('⚠️  No MONGODB_URI — running in-memory (data resets on restart)');
            return; // isDbConnected stays false → all routes use memoryPosts
        }
        logger.error('❌  MONGODB_URI is not set. See README.md → MongoDB Atlas Setup.');
        process.exit(1);
    }
    try {
        await mongoose.connect(config.database.uri, config.database.options);
        isDbConnected = true;
        reconnectAttempts = 0;
        logger.info('✅ Connected to MongoDB Atlas');
    } catch (err) {
        logger.error('❌ MongoDB Atlas connection failed', { error: err.message });
        if (config.devOverride && config.isDevelopment) {
            logger.warn('⚠️  MongoDB unavailable — falling back to in-memory storage');
            return; // graceful dev fallback
        }
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
            logger.info(`Retrying in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})…`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return connectDatabase();
        }
        logger.error('❌  Could not connect to MongoDB Atlas after 5 attempts.');
        process.exit(1);
    }
}

mongoose.connection.on('disconnected', () => { isDbConnected = false; logger.warn('MongoDB Atlas disconnected'); });
mongoose.connection.on('error', (err) => logger.error('MongoDB Atlas error', { error: err.message }));
mongoose.connection.on('reconnected', () => { isDbConnected = true; logger.info('✅ MongoDB Atlas reconnected'); });

let memoryPosts = [];

// ========================================
// Helper: Format post for API response
// NOTE: reports array deliberately excluded from public response
// ========================================
function formatPost(p) {
    return {
        id: p.id,
        content: p.content,
        isAnonymous: p.isAnonymous,
        userId: p.userId,
        timestamp: p.timestamp instanceof Date ? p.timestamp.toISOString() : p.timestamp,
        mood: p.mood || null,
        reactions: p.reactions,
        replies: (p.replies || []).map(r => ({
            id: r.id,
            content: r.content,
            userId: r.userId,
            mood: r.mood || null,
            createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt
        })),
        reportCount: (p.reports || []).length,
        isKept: p.isKept || false
    };
}

// ========================================
// Daily Cleanup Logic
// ========================================
async function performDailyCleanup() {
    if (!isDbConnected) { logger.info('Cleanup skipped - no database connection'); return; }
    try {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const sessionDateKey = yesterday.toISOString().split('T')[0];
        logger.info(`🧹 Running daily cleanup for session: ${sessionDateKey}`);

        const yesterdayPosts = await Post.find({ sessionDate: sessionDateKey, isKept: false });
        if (yesterdayPosts.length === 0) { logger.info('No posts to clean up'); return; }

        const ghostCandidate = yesterdayPosts[Math.floor(Math.random() * yesterdayPosts.length)];
        await GhostPost.create({ content: ghostCandidate.content, mood: ghostCandidate.mood || null, savedAt: new Date() });
        logger.info('👻 Ghost post saved');

        const ghostCount = await GhostPost.countDocuments();
        if (ghostCount > 30) {
            const oldest = await GhostPost.find().sort({ savedAt: 1 }).limit(ghostCount - 30);
            await GhostPost.deleteMany({ _id: { $in: oldest.map(g => g._id) } });
        }

        const postsWithScores = yesterdayPosts.map(post => ({
            post,
            total: Object.values(post.reactions).reduce((sum, arr) => sum + arr.length, 0)
        }));
        postsWithScores.sort((a, b) => b.total - a.total);

        const winner = postsWithScores[0].post;
        winner.isKept = true;
        winner.totalReactions = postsWithScores[0].total;
        await winner.save();
        logger.info(`🏆 Post survived with ${postsWithScores[0].total} reactions`);

        const idsToDelete = postsWithScores.slice(1).map(p => p.post._id);
        if (idsToDelete.length > 0) {
            await Post.deleteMany({ _id: { $in: idsToDelete } });
            logger.info(`🗑️  Deleted ${idsToDelete.length} posts`);
        }
    } catch (error) {
        logger.error('Error during cleanup', { error: error.message });
    }
}

cron.schedule(config.cleanup.cron, () => { logger.info('⏰ Scheduled cleanup triggered'); performDailyCleanup(); });

// ========================================
// Time Validation Middleware
// ========================================
function validateTimeWindow(req, res, next) {
    // Dev override: bypass time gate entirely when DEV_OVERRIDE=true in .env
    if (config.devOverride && config.isDevelopment) return next();
    // Legacy spoof-mode header (triple-click moon / ?dev button)
    if (req.headers['x-spoof-mode'] === 'true' && config.isDevelopment) return next();
    const now = new Date();
    const total = now.getHours() * 60 + now.getMinutes();
    const open = config.channel.openHour * 60 + config.channel.openMinute;
    const close = config.channel.closeHour * 60 + config.channel.closeMinute;
    if (total >= open && total < close) return next();
    res.status(403).json({
        error: {
            message: 'Channel is closed',
            details: 'The 3AM Channel is only open between 3:00 AM - 6:00 AM'
        }
    });
}

// ========================================
// Health / Utility Endpoints
// ========================================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.get('/ready', async (req, res) => {
    const checks = { server: 'ok', database: isDbConnected ? 'connected' : 'disconnected' };
    if (isDbConnected) {
        try { await mongoose.connection.db.admin().ping(); checks.databasePing = 'ok'; }
        catch { checks.databasePing = 'failed'; checks.database = 'unhealthy'; }
    }
    const isReady = checks.database === 'connected' && checks.databasePing === 'ok';
    res.status(isReady ? 200 : 503).json({ status: isReady ? 'ready' : 'not ready', checks, timestamp: new Date().toISOString() });
});

app.get('/api/time', (req, res) => {
    res.json({ timestamp: Date.now(), iso: new Date().toISOString() });
});

app.get('/api/status', async (req, res) => {
    const now = new Date();
    const total = now.getHours() * 60 + now.getMinutes();
    const open = config.channel.openHour * 60 + config.channel.openMinute;
    const close = config.channel.closeHour * 60 + config.channel.closeMinute;
    let channelState = 'closed';
    if (config.devOverride && config.isDevelopment) channelState = 'open'; // dev override
    else if (total >= open && total < close) channelState = 'open';
    else if (total >= open - 15 && total < open) channelState = 'opening_soon';
    const postCount = isDbConnected
        ? await Post.countDocuments({ sessionDate: now.toISOString().split('T')[0] }).catch(() => 0)
        : memoryPosts.length;
    res.json({
        channel: { state: channelState, isOpen: channelState === 'open', opensAt: `${config.channel.openHour}:${String(config.channel.openMinute).padStart(2, '0')} AM`, closesAt: `${config.channel.closeHour}:${String(config.channel.closeMinute).padStart(2, '0')} AM` },
        stats: { activeUsers: io.sockets.sockets.size, postCount, database: isDbConnected ? 'mongodb-atlas' : 'memory' },
        server: { uptime: process.uptime(), timestamp: now.toISOString() },
        devOverride: config.devOverride && config.isDevelopment
    });
});

app.get('/og-image.png', (req, res) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><radialGradient id="bg" cx="50%" cy="50%" r="70%"><stop offset="0%" stop-color="#0d0d1a"/><stop offset="100%" stop-color="#050508"/></radialGradient></defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="600" cy="200" r="72" fill="#1a1a2e" opacity="0.6"/>
  <path d="M546 200 Q600 146 654 200 Q600 254 546 200" fill="#2d2d44" opacity="0.9"/>
  <text x="600" y="332" font-family="Georgia,serif" font-size="58" font-weight="300" fill="#e8e8f0" text-anchor="middle" letter-spacing="10">THE 3AM CHANNEL</text>
  <text x="600" y="404" font-family="Georgia,serif" font-size="24" font-weight="300" fill="#9494b8" text-anchor="middle" letter-spacing="2">Opens at 3:00 AM · Closes at 6:00 AM</text>
  <text x="600" y="450" font-family="Georgia,serif" font-size="20" font-style="italic" fill="#555570" text-anchor="middle">Say what you can only say when the world is asleep.</text>
</svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(svg);
});

// ========================================
// API Routes — Posts
// ========================================

app.get('/api/posts', validateTimeWindow, async (req, res, next) => {
    try {
        const { mood } = req.query;
        const today = new Date().toISOString().split('T')[0];
        if (isDbConnected) {
            const query = { $or: [{ sessionDate: today }, { isKept: true }] };
            if (mood && typeof mood === 'string' && mood.length <= 20) query.mood = mood;
            const posts = await Post.find(query).sort({ timestamp: -1 }).select('-__v -createdAt -updatedAt').lean().exec();
            res.json(posts.map(formatPost));
        } else {
            let posts = memoryPosts;
            if (mood && typeof mood === 'string' && mood.length <= 20) posts = posts.filter(p => p.mood === mood);
            res.json(posts);
        }
    } catch (error) { next(error); }
});

app.post('/api/posts', validateTimeWindow, postLimiter, createPostValidators, async (req, res, next) => {
    try {
        const { content, isAnonymous, userId, mood } = req.body;
        if (isDbConnected) {
            const recentPost = await Post.findOne({ userId, timestamp: { $gte: new Date(Date.now() - 30000) } });
            if (recentPost) return res.status(429).json({ error: { message: 'Please wait before posting again' } });
        }
        const postData = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            content: content.trim(),
            isAnonymous: isAnonymous !== false,
            userId,
            mood: (mood && typeof mood === 'string' && mood.length <= 20) ? mood : null,
            timestamp: new Date(),
            reactions: { '😔': [], '💀': [], '🫂': [], '❤️‍🩹': [] },
            replies: [],
            reports: [],
            sessionDate: new Date().toISOString().split('T')[0]
        };
        if (isDbConnected) {
            const post = new Post(postData);
            await post.save();
            const responsePost = formatPost(post);
            io.emit('new_post', responsePost);
            logger.info('Post created', { postId: post.id, mood: postData.mood });
            res.status(201).json(responsePost);
        } else {
            memoryPosts.unshift(postData);
            io.emit('new_post', postData);
            res.status(201).json(postData);
        }
    } catch (error) { next(error); }
});

app.post('/api/posts/:postId/react', validateTimeWindow, addReactionValidators, async (req, res, next) => {
    try {
        const { postId } = req.params;
        const { emoji, userId } = req.body;
        if (!postId || typeof postId !== 'string' || postId.length > 50) {
            return res.status(400).json({ error: { message: 'Invalid post ID' } });
        }
        if (isDbConnected) {
            const post = await Post.findOne({ id: postId });
            if (!post) return res.status(404).json({ error: { message: 'Post not found' } });
            const index = post.reactions[emoji].indexOf(userId);
            if (index > -1) {
                post.reactions[emoji].splice(index, 1);
            } else {
                Object.keys(post.reactions).forEach(e => {
                    const idx = post.reactions[e].indexOf(userId);
                    if (idx > -1) post.reactions[e].splice(idx, 1);
                });
                post.reactions[emoji].push(userId);
            }
            post.markModified('reactions');
            await post.save();
            const responsePost = formatPost(post);
            io.emit('post_updated', responsePost);
            res.json(responsePost);
        } else {
            const post = memoryPosts.find(p => p.id === postId);
            if (!post) return res.status(404).json({ error: { message: 'Post not found' } });
            const index = post.reactions[emoji].indexOf(userId);
            if (index > -1) {
                post.reactions[emoji].splice(index, 1);
            } else {
                Object.keys(post.reactions).forEach(e => {
                    const idx = post.reactions[e].indexOf(userId);
                    if (idx > -1) post.reactions[e].splice(idx, 1);
                });
                post.reactions[emoji].push(userId);
            }
            io.emit('post_updated', post);
            res.json(post);
        }
    } catch (error) { next(error); }
});

app.post('/api/posts/:postId/reply', validateTimeWindow, addReplyValidators, async (req, res, next) => {
    try {
        const { postId } = req.params;
        const { content, userId, mood } = req.body;
        if (!postId || typeof postId !== 'string' || postId.length > 50) {
            return res.status(400).json({ error: { message: 'Invalid post ID' } });
        }
        if (isDbConnected) {
            const post = await Post.findOne({ id: postId });
            if (!post) return res.status(404).json({ error: { message: 'Post not found' } });
            if (post.replies.length >= 3) return res.status(403).json({ error: { message: 'This post has reached its 3 whisper limit' } });
            const userReplyCount = post.replies.filter(r => r.userId === userId).length;
            if (userReplyCount >= 3) return res.status(403).json({ error: { message: 'You have reached your 3 whisper limit on this post' } });
            const reply = {
                id: Date.now().toString(36) + Math.random().toString(36).substr(2),
                content: content.trim(),
                userId,
                mood: (mood && typeof mood === 'string' && mood.length <= 20) ? mood : null,
                createdAt: new Date()
            };
            post.replies.push(reply);
            post.markModified('replies');
            await post.save();
            const responsePost = formatPost(post);
            io.emit('post_updated', responsePost);
            logger.info('Reply added', { postId, replyCount: post.replies.length });
            res.status(201).json(responsePost);
        } else {
            const post = memoryPosts.find(p => p.id === postId);
            if (!post) return res.status(404).json({ error: { message: 'Post not found' } });
            if (!post.replies) post.replies = [];
            if (post.replies.length >= 3) return res.status(403).json({ error: { message: 'Whisper limit reached' } });
            const userReplyCountMem = post.replies.filter(r => r.userId === userId).length;
            if (userReplyCountMem >= 3) return res.status(403).json({ error: { message: 'You have reached your 3 whisper limit on this post' } });
            const reply = {
                id: Date.now().toString(36) + Math.random().toString(36).substr(2),
                content: content.trim(),
                userId,
                mood: (mood && typeof mood === 'string' && mood.length <= 20) ? mood : null,
                createdAt: new Date().toISOString()
            };
            post.replies.push(reply);
            io.emit('post_updated', post);
            res.status(201).json(post);
        }
    } catch (error) { next(error); }
});

/**
 * POST /api/posts/:postId/report
 * One report per IP per post. Reason is required enum.
 * Posts are NEVER auto-hidden — manual admin review only.
 */
app.post('/api/posts/:postId/report', reportLimiter, addReportValidators, async (req, res, next) => {
    try {
        const { postId } = req.params;
        const { reason } = req.body;
        const reporterIp = req.ip || req.connection.remoteAddress || 'unknown';

        if (!postId || typeof postId !== 'string' || postId.length > 50) {
            return res.status(400).json({ error: { message: 'Invalid post ID' } });
        }

        if (isDbConnected) {
            const post = await Post.findOne({ id: postId });
            if (!post) return res.status(404).json({ error: { message: 'Post not found' } });

            // One report per IP per post
            const alreadyReported = post.reports.some(r => r.ip === reporterIp);
            if (alreadyReported) {
                return res.status(429).json({ error: { message: 'You already reported this post' } });
            }

            post.reports.push({ ip: reporterIp, reason, createdAt: new Date() });
            post.markModified('reports');
            await post.save();

            logger.info('Post reported', { postId, reason, reportCount: post.reports.length });
            res.status(201).json({ message: 'Report received' });
        } else {
            // Memory fallback
            const post = memoryPosts.find(p => p.id === postId);
            if (!post) return res.status(404).json({ error: { message: 'Post not found' } });
            if (!post.reports) post.reports = [];
            if (post.reports.some(r => r.ip === reporterIp)) {
                return res.status(429).json({ error: { message: 'You already reported this post' } });
            }
            post.reports.push({ ip: reporterIp, reason, createdAt: new Date().toISOString() });
            res.status(201).json({ message: 'Report received' });
        }
    } catch (error) { next(error); }
});

// ========================================
// Admin Routes
// ========================================

/**
 * GET /api/admin/reported
 * Returns all posts with at least 1 report, sorted by report count desc.
 * Protected by x-admin-key header.
 */
app.get('/api/admin/reported', requireAdminKey, async (req, res, next) => {
    try {
        if (isDbConnected) {
            const posts = await Post.find({ 'reports.0': { $exists: true } })
                .sort({ 'reports.length': -1, timestamp: -1 })
                .lean();

            const formatted = posts
                .map(p => ({
                    ...formatPost(p),
                    reports: p.reports.map(r => ({ reason: r.reason, createdAt: r.createdAt })),
                    reportCount: p.reports.length
                }))
                .sort((a, b) => b.reportCount - a.reportCount);

            res.json(formatted);
        } else {
            const posts = memoryPosts
                .filter(p => p.reports && p.reports.length > 0)
                .sort((a, b) => (b.reports.length) - (a.reports.length));
            res.json(posts);
        }
    } catch (error) { next(error); }
});

/**
 * DELETE /api/admin/posts/:postId
 * Hard-delete a post by admin.
 * Protected by x-admin-key header.
 */
app.delete('/api/admin/posts/:postId', requireAdminKey, async (req, res, next) => {
    try {
        const { postId } = req.params;
        if (!postId || typeof postId !== 'string' || postId.length > 50) {
            return res.status(400).json({ error: { message: 'Invalid post ID' } });
        }
        if (isDbConnected) {
            const result = await Post.deleteOne({ id: postId });
            if (result.deletedCount === 0) {
                return res.status(404).json({ error: { message: 'Post not found' } });
            }
            logger.info('Admin deleted post', { postId });
            // Notify all clients to remove the post from their feed
            io.emit('post_deleted', { id: postId });
            res.json({ message: 'Post deleted' });
        } else {
            const idx = memoryPosts.findIndex(p => p.id === postId);
            if (idx === -1) return res.status(404).json({ error: { message: 'Post not found' } });
            memoryPosts.splice(idx, 1);
            io.emit('post_deleted', { id: postId });
            res.json({ message: 'Post deleted' });
        }
    } catch (error) { next(error); }
});

// In-memory ghost posts for dev mode (seeded via /dev/seed-ghost)
let memoryGhosts = [];

app.get('/api/ghost', async (req, res, next) => {
    try {
        if (!isDbConnected) {
            if (memoryGhosts.length === 0) return res.json({ ghost: null });
            const g = memoryGhosts[Math.floor(Math.random() * memoryGhosts.length)];
            return res.json({ ghost: g });
        }
        const count = await GhostPost.countDocuments();
        if (count === 0) return res.json({ ghost: null });
        const random = Math.floor(Math.random() * count);
        const ghost = await GhostPost.findOne().skip(random).lean();
        res.json({ ghost: ghost ? { content: ghost.content, mood: ghost.mood || null, savedAt: ghost.savedAt } : null });
    } catch (error) { next(error); }
});

// ========================================
// Development Endpoints
// ========================================
if (config.isDevelopment) {
    app.post('/dev/trigger-cleanup', async (req, res) => {
        logger.info('🔧 Manual cleanup triggered');
        await performDailyCleanup();
        res.json({ message: 'Cleanup completed', timestamp: new Date().toISOString() });
    });
    app.post('/dev/reset', (req, res) => { memoryPosts = []; res.json({ message: 'In-memory posts cleared' }); });
    app.post('/dev/seed-ghost', async (req, res) => {
        if (!isDbConnected) {
            const samples = ["i keep thinking about the version of my life where i made different choices", "does anyone else feel most alive at 3am or is that just me", "i wrote a letter i'll never send. it's 47 pages long.", "the city looks kinder when everyone's asleep", "i miss someone i've never met"];
            const content = samples[Math.floor(Math.random() * samples.length)];
            const moods = ['anxious', 'lonely', 'sad', null];
            const ghost = { content, mood: moods[Math.floor(Math.random() * moods.length)], savedAt: new Date() };
            memoryGhosts.push(ghost);
            return res.json({ message: 'Ghost post seeded (memory)', content });
        }
        const samples = ["i keep thinking about the version of my life where i made different choices", "does anyone else feel most alive at 3am or is that just me", "i wrote a letter i'll never send. it's 47 pages long.", "the city looks kinder when everyone's asleep", "i miss someone i've never met"];
        const content = samples[Math.floor(Math.random() * samples.length)];
        const moods = ['anxious', 'lonely', 'sad', null];
        await GhostPost.create({ content, mood: moods[Math.floor(Math.random() * moods.length)] });
        res.json({ message: 'Ghost post seeded', content });
    });
}

// ========================================
// Socket.io — Real-time + Typing Indicators
// ========================================

// Typing state: Map<socketId, { userId, timeout }>
const typingUsers = new Map();
const TYPING_TIMEOUT_MS = 5000; // auto-clear after 5s of no refresh

function broadcastTypingCount() {
    const count = typingUsers.size;
    if (count > 0) {
        io.emit('someone_typing', { count });
    } else {
        io.emit('typing_stopped');
    }
}

io.on('connection', (socket) => {
    logger.debug('Socket connected', { socketId: socket.id });
    const currentCount = io.sockets.sockets.size;

    const fetchInitialData = async () => {
        try {
            let posts = [];
            if (isDbConnected) {
                const today = new Date().toISOString().split('T')[0];
                const dbPosts = await Post.find({ $or: [{ sessionDate: today }, { isKept: true }] })
                    .sort({ timestamp: -1 }).select('-__v -createdAt -updatedAt').lean();
                posts = dbPosts.map(formatPost);
            } else { posts = memoryPosts; }
            socket.emit('init', { posts, userCount: currentCount });
        } catch (err) {
            logger.error('Error fetching posts for socket init', { error: err.message });
            socket.emit('init', { posts: [], userCount: currentCount });
        }
    };

    fetchInitialData();
    io.emit('user_count', currentCount);

    // ── Typing indicators ──────────────────────────────────────
    socket.on('typing_start', (data) => {
        const userId = data && data.userId ? String(data.userId).slice(0, 100) : socket.id;

        // Clear any existing timeout for this socket
        if (typingUsers.has(socket.id)) {
            clearTimeout(typingUsers.get(socket.id).timeout);
        }

        const timeout = setTimeout(() => {
            typingUsers.delete(socket.id);
            broadcastTypingCount();
        }, TYPING_TIMEOUT_MS);

        typingUsers.set(socket.id, { userId, timeout });
        broadcastTypingCount();
    });

    socket.on('typing_stop', () => {
        if (typingUsers.has(socket.id)) {
            clearTimeout(typingUsers.get(socket.id).timeout);
            typingUsers.delete(socket.id);
            broadcastTypingCount();
        }
    });

    socket.on('disconnect', (reason) => {
        logger.debug('Socket disconnected', { socketId: socket.id, reason });
        // Clean up typing state on disconnect
        if (typingUsers.has(socket.id)) {
            clearTimeout(typingUsers.get(socket.id).timeout);
            typingUsers.delete(socket.id);
            broadcastTypingCount();
        }
        io.emit('user_count', io.sockets.sockets.size);
    });

    socket.on('error', (error) => {
        logger.error('Socket error', { socketId: socket.id, error: error.message });
    });
});

// ========================================
// Error Handling
// ========================================
app.use(notFoundHandler);
app.use(errorHandler);

process.on('uncaughtException', (error) => { logger.error('Uncaught Exception', { error: error.message }); gracefulShutdown(1); });
process.on('unhandledRejection', (reason) => { logger.error('Unhandled Rejection', { reason: String(reason) }); });

async function gracefulShutdown(exitCode = 0) {
    logger.info('Initiating graceful shutdown...');
    server.close(() => logger.info('HTTP server closed'));
    io.close(() => logger.info('Socket.io closed'));
    if (isDbConnected) {
        try { await mongoose.connection.close(); logger.info('MongoDB connection closed'); }
        catch (err) { logger.error('Error closing MongoDB', { error: err.message }); }
    }
    setTimeout(() => { process.exit(exitCode); }, 10000);
}

process.on('SIGTERM', () => { logger.info('SIGTERM received'); gracefulShutdown(); });
process.on('SIGINT', () => { logger.info('SIGINT received'); gracefulShutdown(); });

async function startServer() {
    // Print dev override banner BEFORE database connection attempt,
    // so the user knows the server is starting in dev mode even if DB is slow.
    if (config.devOverride && config.isDevelopment) {
        console.log('\n' + '═'.repeat(55));
        console.log('  ⚠️   DEV OVERRIDE ACTIVE');
        console.log('  Time window (3–6 AM) is BYPASSED');
        console.log('  All routes open. Posts are in-memory unless');
        console.log('  MONGODB_URI is set in .env');
        console.log('═'.repeat(55) + '\n');
    }
    try {
        await connectDatabase();
        server.listen(config.server.port, () => {
            logger.info(`🚀 3AM Channel running at http://localhost:${config.server.port}`);
            logger.info(`📊 Environment: ${config.env}`);
            if (config.devOverride && config.isDevelopment) {
                logger.warn('⚠️  DEV OVERRIDE ACTIVE — time window bypassed, all routes open');
                logger.warn(`⚠️  Database: ${isDbConnected ? 'MongoDB Atlas' : 'in-memory (posts reset on restart)'}`);
                logger.warn(`⚠️  Open http://localhost:${config.server.port} — you should see the feed immediately`);
            }
            logger.info(`✨ Features: Whisper Threads, Mood Tags, Ghost Posts, Reports, Typing Indicators`);
        });
    } catch (error) {
        logger.error('Failed to start server', { error: error.message });
        process.exit(1);
    }
}

startServer();
module.exports = { app, server, io };
