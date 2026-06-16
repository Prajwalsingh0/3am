const PostRepository = require('../services/PostRepository');
const logger = require('../../utils/logger');

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
            replyNum: r.replyNum,
            content: r.content,
            userId: r.userId,
            mood: r.mood || null,
            createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt
        })),
        reportCount: (p.reports || []).length,
        isKept: p.isKept || false
    };
}

async function getReportedPosts(req, res, next) {
    try {
        const posts = await PostRepository.getReportedPosts();
        const formatted = posts
            .map(p => ({
                ...formatPost(p),
                reports: (p.reports || []).map(r => ({ reason: r.reason, createdAt: r.createdAt })),
                reportCount: (p.reports || []).length
            }))
            .sort((a, b) => b.reportCount - a.reportCount);

        res.json(formatted);
    } catch (error) {
        next(error);
    }
}

async function deletePost(req, res, next) {
    try {
        const { postId } = req.params;
        if (!postId || typeof postId !== 'string' || postId.length > 50) {
            return res.status(400).json({ error: { message: 'Invalid post ID' } });
        }
        
        const success = await PostRepository.deletePost(postId);
        if (!success) {
            return res.status(404).json({ error: { message: 'Post not found' } });
        }
        
        logger.info('Admin deleted post', { postId });
        const io = req.app.get('io');
        if (io) io.emit('post_deleted', { id: postId });
        
        res.json({ message: 'Post deleted' });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    getReportedPosts,
    deletePost
};
