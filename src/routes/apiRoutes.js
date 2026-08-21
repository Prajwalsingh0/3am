const express = require('express');
const { rateLimit } = require('express-rate-limit');
const config = require('../../config');

const {
    authenticateUser,
    registerUser,
    getPosts,
    createPost,
    addSeen,
    addReply,
    addReport,
    getGhostPost
} = require('../controllers/postController');

const { validateTimeWindow } = require('../middleware/timeGate');

const {
    createPostValidators,
    addSeenValidators,
    addReplyValidators
} = require('../../middleware/validators');

const router = express.Router();

// Post rate limiter definition
const postLimiter = rateLimit({
    windowMs: config.rateLimit.post.windowMs,
    max: config.rateLimit.post.max,
    message: { error: { message: config.rateLimit.post.message } },
    skip: (req) => config.isTest || (config.isDevelopment && (req.headers['x-spoof-mode'] === 'true' || config.devOverride))
});

// User identity registration
router.post('/users/register', registerUser);

// Status check (channel state, active users, database type)
router.get('/status', (req, res) => {
    const now = new Date();
    const total = now.getHours() * 60 + now.getMinutes();
    const open = config.channel.openHour * 60 + config.channel.openMinute;
    const close = config.channel.closeHour * 60 + config.channel.closeMinute;
    const isTimeOpen = total >= open && total < close;
    const isOpen = (config.devOverride && config.isDevelopment) || config.isTest || isTimeOpen;

    const io = req.app.get('io');
    const activeUsers = io ? io.sockets.sockets.size : 0;
    const databaseType = config.database.uri ? 'atlas' : 'memory';

    res.json({
        channel: {
            isOpen
        },
        devOverride: config.devOverride,
        stats: {
            activeUsers,
            database: databaseType
        }
    });
});

// Feed retrieve
router.get('/posts', validateTimeWindow, getPosts);

// Create new post (requires client signature auth + validation + rate limits)
router.post('/posts', validateTimeWindow, postLimiter, authenticateUser, createPostValidators, createPost);

// Add seen status (requires signature auth)
router.post('/posts/:postId/seen', validateTimeWindow, authenticateUser, addSeenValidators, addSeen);

// Whisper reply (requires signature auth)
router.post('/posts/:postId/reply', validateTimeWindow, authenticateUser, addReplyValidators, addReply);

// Report post (anonymous, IP-gated)
router.post('/posts/:postId/report', validateTimeWindow, addReport);

// Ghost message
router.get('/ghost', getGhostPost);

module.exports = router;
