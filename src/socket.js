const config = require('../config');
const PostRepository = require('./services/PostRepository');
const { validateUserSignature, formatPost } = require('./controllers/postController');
const logger = require('../utils/logger');

// Typing state tracking
const typingUsers = new Map();
const TYPING_TIMEOUT_MS = 5000;

function setupSockets(io) {
    // Socket.io connection security middleware (HMAC check)
    io.use((socket, next) => {
        const userId = socket.handshake.auth?.userId || socket.handshake.query?.userId;
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        
        if (config.isTest || (config.isDevelopment && config.devOverride)) {
            return next();
        }
        
        if (!userId || !token || !validateUserSignature(userId, token)) {
            return next(new Error('Authentication error: invalid user identity signature'));
        }
        next();
    });

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
                // Fetch initial feed posts via repository
                const rawPosts = await PostRepository.getPosts({ limit: 100 });
                const posts = rawPosts.map(formatPost);
                socket.emit('init', { posts, userCount: currentCount });
            } catch (err) {
                logger.error('Error fetching posts for socket init', { error: err.message });
                socket.emit('init', { posts: [], userCount: currentCount });
            }
        };

        fetchInitialData();
        io.emit('user_count', currentCount);

        // Typing indicators
        socket.on('typing_start', (data) => {
            const userId = data && data.userId ? String(data.userId).slice(0, 100) : socket.id;

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
}

module.exports = setupSockets;
