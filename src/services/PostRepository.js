const mongoose = require('mongoose');
const config = require('../../config');
const { Post, GhostPost } = require('../models/Post');
const logger = require('../../utils/logger');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '../../local_db.json');

function loadMemoryDb() {
    if (config.isTest) {
        return { posts: [], ghostPosts: [] };
    }
    try {
        if (fs.existsSync(DB_FILE)) {
            const fileData = fs.readFileSync(DB_FILE, 'utf8').trim();
            if (fileData) {
                const data = JSON.parse(fileData);
                return {
                    posts: data.posts || [],
                    ghostPosts: data.ghostPosts || []
                };
            }
        }
    } catch (err) {
        logger.error('Failed to load local DB file', { error: err.message });
    }
    return { posts: [], ghostPosts: [] };
}

function saveMemoryDb(posts, ghostPosts) {
    if (config.isTest) {
        return;
    }
    try {
        const data = JSON.stringify({ posts, ghostPosts }, null, 2);
        fs.writeFileSync(DB_FILE, data, 'utf8');
    } catch (err) {
        logger.error('Failed to save local DB file', { error: err.message });
    }
}

// Local in-memory storage arrays with file persistence fallback in development
const initialData = loadMemoryDb();
let memoryPosts = initialData.posts;
let memoryGhostPosts = initialData.ghostPosts;

class PostRepository {
    static isDbConnected() {
        return mongoose.connection.readyState === 1;
    }

    static verifyConnection() {
        if (!this.isDbConnected()) {
            if (config.isDevelopment || config.isTest) {
                return false; // run in-memory
            }
            const err = new Error('Database is disconnected');
            err.statusCode = 503;
            throw err;
        }
        return true;
    }

    static async countPosts(query = {}) {
        if (this.verifyConnection()) {
            return await Post.countDocuments(query);
        } else {
            // Memory implementation
            let posts = memoryPosts;
            if (query.sessionDate) posts = posts.filter(p => p.sessionDate === query.sessionDate);
            if (query.isKept !== undefined) posts = posts.filter(p => p.isKept === query.isKept);
            if (query.mood) posts = posts.filter(p => p.mood === query.mood);
            return posts.length;
        }
    }

    static async getPosts({ mood, cursor, limit = 20 }) {
        const today = new Date().toISOString().split('T')[0];
        if (this.verifyConnection()) {
            const query = { $or: [{ sessionDate: today }, { isKept: true }] };
            if (mood && typeof mood === 'string' && mood.length <= 20) {
                query.mood = mood;
            }
            if (cursor) {
                query.timestamp = { $lt: new Date(cursor) };
            }
            return await Post.find(query)
                .sort({ timestamp: -1 })
                .limit(limit)
                .select('-__v -createdAt -updatedAt')
                .lean()
                .exec();
        } else {
            let posts = memoryPosts;
            if (mood && typeof mood === 'string' && mood.length <= 20) {
                posts = posts.filter(p => p.mood === mood);
            }
            if (cursor) {
                const cursorTime = new Date(cursor).getTime();
                posts = posts.filter(p => new Date(p.timestamp).getTime() < cursorTime);
            }
            posts = [...posts].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            return posts.slice(0, limit);
        }
    }

    static async getPostById(postId) {
        if (this.verifyConnection()) {
            return await Post.findOne({ id: postId }).exec();
        } else {
            return memoryPosts.find(p => p.id === postId) || null;
        }
    }

    static async createPost(postData) {
        if (this.verifyConnection()) {
            const post = new Post(postData);
            return await post.save();
        } else {
            memoryPosts.unshift(postData);
            saveMemoryDb(memoryPosts, memoryGhostPosts);
            return postData;
        }
    }

    static async addReaction(postId, emoji, userId) {
        const ALLOWED_EMOJIS = ['❤️', '😔', '💀', '💔', '🤍', '🌙', '🫂', '❤️‍🩹'];
        
        if (this.verifyConnection()) {
            const post = await Post.findOne({ id: postId });
            if (!post) return null;
            
            const arr = post.reactions[emoji] || [];
            const idx = arr.indexOf(userId);
            if (idx > -1) {
                arr.splice(idx, 1); // remove
            } else {
                // remove from all other emojis
                ALLOWED_EMOJIS.forEach(e => {
                    const otherArr = post.reactions[e];
                    if (Array.isArray(otherArr)) {
                        const oIdx = otherArr.indexOf(userId);
                        if (oIdx > -1) {
                            otherArr.splice(oIdx, 1);
                            post.markModified(`reactions.${e}`);
                        }
                    }
                });
                arr.push(userId); // add
            }
            post.reactions[emoji] = arr;
            post.totalReactions = ALLOWED_EMOJIS.reduce((sum, e) => {
                const list = post.reactions[e];
                return sum + (Array.isArray(list) ? list.length : 0);
            }, 0);
            post.markModified(`reactions.${emoji}`);
            await post.save();
            return post;
        } else {
            const post = memoryPosts.find(p => p.id === postId);
            if (!post) return null;
            if (!post.reactions) {
                post.reactions = {
                    '❤️': [],
                    '😔': [],
                    '💀': [],
                    '💔': [],
                    '🤍': [],
                    '🌙': [],
                    '🫂': [],
                    '❤️‍🩹': []
                };
            }
            const arr = post.reactions[emoji] || [];
            const idx = arr.indexOf(userId);
            if (idx > -1) {
                arr.splice(idx, 1);
            } else {
                // remove from all other emojis
                ALLOWED_EMOJIS.forEach(e => {
                    const otherArr = post.reactions[e];
                    if (Array.isArray(otherArr)) {
                        const oIdx = otherArr.indexOf(userId);
                        if (oIdx > -1) otherArr.splice(oIdx, 1);
                    }
                });
                arr.push(userId);
            }
            post.reactions[emoji] = arr;
            post.totalReactions = ALLOWED_EMOJIS.reduce((sum, e) => {
                const list = post.reactions[e];
                return sum + (Array.isArray(list) ? list.length : 0);
            }, 0);
            saveMemoryDb(memoryPosts, memoryGhostPosts);
            return post;
        }
    }

    static async addReply(postId, replyData) {
        if (this.verifyConnection()) {
            const post = await Post.findOne({ id: postId });
            if (!post) return null;
            
            // Generate sequence reply number (4chan-style)
            const replyNum = post.replies.length + 1;
            replyData.replyNum = replyNum;
            
            if (post.replies.length >= 100) {
                const err = new Error('This post has reached its 100 whisper limit');
                err.statusCode = 403;
                throw err;
            }
            
            post.replies.push(replyData);
            await post.save();
            return { post, replyNum };
        } else {
            const post = memoryPosts.find(p => p.id === postId);
            if (!post) return null;
            if (!post.replies) post.replies = [];
            
            const replyNum = post.replies.length + 1;
            replyData.replyNum = replyNum;
            
            if (post.replies.length >= 100) {
                const err = new Error('This post has reached its 100 whisper limit');
                err.statusCode = 403;
                throw err;
            }
            
            post.replies.push(replyData);
            saveMemoryDb(memoryPosts, memoryGhostPosts);
            return { post, replyNum };
        }
    }

    static async addReport(postId, reportData) {
        if (this.verifyConnection()) {
            const post = await Post.findOne({ id: postId });
            if (!post) return null;
            
            post.reports.push(reportData);
            await post.save();
            return post;
        } else {
            const post = memoryPosts.find(p => p.id === postId);
            if (!post) return null;
            if (!post.reports) post.reports = [];
            post.reports.push(reportData);
            saveMemoryDb(memoryPosts, memoryGhostPosts);
            return post;
        }
    }

    static async getReportedPosts() {
        if (this.verifyConnection()) {
            return await Post.find({ 'reports.0': { $exists: true } })
                .sort({ timestamp: -1 })
                .select('-__v -createdAt -updatedAt')
                .lean()
                .exec();
        } else {
            return memoryPosts.filter(p => p.reports && p.reports.length > 0);
        }
    }

    static async deletePost(postId) {
        if (this.verifyConnection()) {
            const res = await Post.deleteOne({ id: postId });
            return res.deletedCount > 0;
        } else {
            const idx = memoryPosts.findIndex(p => p.id === postId);
            if (idx > -1) {
                memoryPosts.splice(idx, 1);
                saveMemoryDb(memoryPosts, memoryGhostPosts);
                return true;
            }
            return false;
        }
    }

    static async getGhostPost() {
        if (this.verifyConnection()) {
            const count = await GhostPost.countDocuments();
            if (count === 0) return null;
            const rand = Math.floor(Math.random() * count);
            const ghost = await GhostPost.findOne().skip(rand).exec();
            return ghost;
        } else {
            if (memoryGhostPosts.length === 0) return null;
            return memoryGhostPosts[Math.floor(Math.random() * memoryGhostPosts.length)];
        }
    }

    static async createGhostPost(ghostData) {
        if (this.verifyConnection()) {
            const ghost = new GhostPost(ghostData);
            return await ghost.save();
        } else {
            memoryGhostPosts.push(ghostData);
            saveMemoryDb(memoryPosts, memoryGhostPosts);
            return ghostData;
        }
    }

    static async performDailyCleanup() {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const sessionDateKey = yesterday.toISOString().split('T')[0];
        
        logger.info(`🧹 Running daily cleanup for session: ${sessionDateKey}`);

        if (this.verifyConnection()) {
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
        } else {
            // Memory Cleanup Implementation
            const yesterdayPosts = memoryPosts.filter(p => p.sessionDate === sessionDateKey && !p.isKept);
            if (yesterdayPosts.length === 0) { logger.info('No memory posts to clean up'); return; }

            const ghostCandidate = yesterdayPosts[Math.floor(Math.random() * yesterdayPosts.length)];
            memoryGhostPosts.push({ content: ghostCandidate.content, mood: ghostCandidate.mood || null, savedAt: new Date() });
            logger.info('👻 Ghost post saved to memory');

            if (memoryGhostPosts.length > 30) {
                memoryGhostPosts = memoryGhostPosts.slice(-30);
            }

            const postsWithScores = yesterdayPosts.map(post => ({
                post,
                total: Object.values(post.reactions || {}).reduce((sum, arr) => sum + arr.length, 0)
            }));
            postsWithScores.sort((a, b) => b.total - a.total);

            const winner = postsWithScores[0];
            winner.post.isKept = true;
            winner.post.totalReactions = winner.total;

            const idsToDelete = new Set(postsWithScores.slice(1).map(p => p.post.id));
            memoryPosts = memoryPosts.filter(p => !idsToDelete.has(p.id));
            saveMemoryDb(memoryPosts, memoryGhostPosts);
            logger.info(`🗑️  Deleted ${idsToDelete.size} memory posts`);
        }
    }

    static async hasRecentPost(userId, windowMs = 30000) {
        const threshold = new Date(Date.now() - windowMs);
        if (this.verifyConnection()) {
            const count = await Post.countDocuments({
                userId,
                timestamp: { $gte: threshold }
            });
            return count > 0;
        } else {
            return memoryPosts.some(p => p.userId === userId && new Date(p.timestamp) >= threshold);
        }
    }

    static reset() {
        memoryPosts = [];
        memoryGhostPosts = [];
        saveMemoryDb(memoryPosts, memoryGhostPosts);
        logger.info('In-memory posts reset');
    }
}

module.exports = PostRepository;
