const crypto = require('crypto');
const config = require('../../config');
const PostRepository = require('../services/PostRepository');
const logger = require('../../utils/logger');

// Format helper to ensure API payload consistency
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
            replyNum: r.replyNum, // Thread number sequence (4chan-style)
            content: r.content,
            userId: r.userId,
            mood: r.mood || null,
            createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt
        })),
        reportCount: (p.reports || []).length,
        isKept: p.isKept || false
    };
}

// User ID signature utilities
function generateUserSignature(userId) {
    const hmac = crypto.createHmac('sha256', config.sessionSecret);
    hmac.update(userId);
    return hmac.digest('hex');
}

function validateUserSignature(userId, token) {
    if (!userId || !token) return false;
    const expectedToken = generateUserSignature(userId);
    try {
        return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expectedToken, 'hex'));
    } catch (e) {
        return false;
    }
}

// Middleware to authenticate signed user identities
function authenticateUser(req, res, next) {
    if (config.isTest || (config.isDevelopment && config.devOverride)) {
        return next();
    }
    const userId = req.body?.userId || req.query?.userId;
    const token = req.headers['x-user-token'];
    if (!userId || !token || !validateUserSignature(userId, token)) {
        return res.status(401).json({ error: { message: 'Invalid or missing user identity signature' } });
    }
    next();
}

// Register user or issue signature for existing ID
function registerUser(req, res) {
    let { userId } = req.body || {};
    if (userId) {
        userId = String(userId).trim().toLowerCase();
        if (!/^[a-z0-9]+$/.test(userId) || userId.length < 1 || userId.length > 100) {
            userId = null;
        }
    }
    if (!userId) {
        userId = crypto.randomBytes(16).toString('hex');
    }
    const token = generateUserSignature(userId);
    res.json({ userId, token });
}

// Get paginated posts with optional mood filtering
async function getPosts(req, res, next) {
    try {
        const { mood, cursor } = req.query;
        const limit = parseInt(req.query.limit, 10) || 20;
        
        const posts = await PostRepository.getPosts({ mood, cursor, limit });
        res.json(posts.map(formatPost));
    } catch (error) {
        next(error);
    }
}

// Create a new post
async function createPost(req, res, next) {
    try {
        const { content, isAnonymous, userId, mood } = req.body;
        
        // Rate limiting check per user ID
        const hasPostedRecently = await PostRepository.hasRecentPost(userId);
        if (hasPostedRecently) {
            return res.status(429).json({ error: { message: 'Please wait before posting again' } });
        }
        
        const postData = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            content: content.trim(),
            isAnonymous: isAnonymous !== false,
            userId,
            mood: (mood && typeof mood === 'string' && mood.length <= 20) ? mood : null,
            timestamp: new Date(),
            reactions: {
                '❤️': [],
                '😔': [],
                '💀': [],
                '💔': [],
                '🤍': [],
                '🌙': [],
                '🫂': [],
                '❤️‍🩹': []
            },
            replies: [],
            reports: [],
            sessionDate: new Date().toISOString().split('T')[0]
        };

        const post = await PostRepository.createPost(postData);
        const formatted = formatPost(post);
        
        // Broadcast real-time feed updates
        const io = req.app.get('io');
        if (io) io.emit('new_post', formatted);
        
        res.status(201).json(formatted);
    } catch (error) {
        next(error);
    }
}

// Add a reaction (toggles on/off, max 1 reaction per user per post)
async function addReaction(req, res, next) {
    try {
        const { postId } = req.params;
        const { emoji, userId } = req.body;
        
        if (!postId || typeof postId !== 'string' || postId.length > 50) {
            return res.status(400).json({ error: { message: 'Invalid post ID' } });
        }
        
        const post = await PostRepository.addReaction(postId, emoji, userId);
        if (!post) {
            return res.status(404).json({ error: { message: 'Post not found' } });
        }
        
        const formatted = formatPost(post);
        const io = req.app.get('io');
        if (io) io.emit('post_updated', formatted);
        
        res.json(formatted);
    } catch (error) {
        next(error);
    }
}

// Add a reply (unrestricted thread replies with sequential index No. N)
async function addReply(req, res, next) {
    try {
        const { postId } = req.params;
        const { content, userId, mood } = req.body;
        
        if (!postId || typeof postId !== 'string' || postId.length > 50) {
            return res.status(400).json({ error: { message: 'Invalid post ID' } });
        }
        
        const replyData = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            content: content.trim(),
            userId,
            mood: (mood && typeof mood === 'string' && mood.length <= 20) ? mood : null,
            createdAt: new Date()
        };

        const result = await PostRepository.addReply(postId, replyData);
        if (!result) {
            return res.status(404).json({ error: { message: 'Post not found' } });
        }
        
        const formatted = formatPost(result.post);
        const io = req.app.get('io');
        if (io) io.emit('post_updated', formatted);
        
        res.status(201).json(formatted);
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: { message: error.message } });
        }
        next(error);
    }
}

// Report a post
async function addReport(req, res, next) {
    try {
        const { postId } = req.params;
        const { reason } = req.body;
        
        if (!postId || typeof postId !== 'string' || postId.length > 50) {
            return res.status(400).json({ error: { message: 'Invalid post ID' } });
        }
        
        // Resolve client IP securely
        const reporterIp = req.ip || req.connection?.remoteAddress || 'unknown';
        
        const post = await PostRepository.getPostById(postId);
        if (!post) {
            return res.status(404).json({ error: { message: 'Post not found' } });
        }
        
        // Enforce max 3 reports per IP per post
        const ipReports = (post.reports || []).filter(r => r.ip === reporterIp).length;
        if (ipReports >= 3) {
            return res.status(429).json({ error: { message: 'You have already reported this post the maximum number of times' } });
        }
        
        const updatedPost = await PostRepository.addReport(postId, { ip: reporterIp, reason, createdAt: new Date() });
        const formatted = formatPost(updatedPost);
        
        // Delete post automatically if reports >= 10
        if (formatted.reportCount >= 10) {
            await PostRepository.deletePost(postId);
            const io = req.app.get('io');
            if (io) io.emit('post_deleted', postId);
            return res.json({ message: 'Post reported and auto-removed due to high reports flag' });
        }
        
        res.json({ message: 'Post reported' });
    } catch (error) {
        next(error);
    }
}

// Get the random ghost post
async function getGhostPost(req, res, next) {
    try {
        const ghost = await PostRepository.getGhostPost();
        if (!ghost) return res.json({ ghost: null });
        res.json({ ghost: { content: ghost.content, mood: ghost.mood || null } });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    authenticateUser,
    registerUser,
    getPosts,
    createPost,
    addReaction,
    addReply,
    addReport,
    getGhostPost,
    validateUserSignature,
    formatPost
};
