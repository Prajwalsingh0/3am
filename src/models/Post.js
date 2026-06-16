const mongoose = require('mongoose');

const VALID_REPORT_REASONS = ['offensive', 'spam', 'harassment', 'other'];

const ReplySchema = new mongoose.Schema({
    id: { type: String, required: true },
    replyNum: { type: Number, required: true },
    content: { type: String, required: true, trim: true, minlength: 1, maxlength: 500 },
    userId: { type: String, required: true },
    mood: { type: String, maxlength: 20, default: null },
    createdAt: { type: Date, default: Date.now }
}, { _id: false });

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
        minlength: [1, 'Content cannot be empty'],
        maxlength: [500, 'Content too long']
    },
    isAnonymous: { type: Boolean, default: true },
    userId: { type: String, required: [true, 'User ID is required'], index: true },
    timestamp: { type: Date, default: Date.now, index: true },
    mood: { type: String, maxlength: 20, default: null },
    reactions: {
        '❤️': { type: [String], default: [] },
        '😔': { type: [String], default: [] },
        '💀': { type: [String], default: [] },
        '💔': { type: [String], default: [] },
        '🤍': { type: [String], default: [] },
        '🌙': { type: [String], default: [] },
        '🫂': { type: [String], default: [] },
        '❤️‍🩹': { type: [String], default: [] }
    },
    totalReactions: { type: Number, default: 0, index: true },
    replies: { type: [ReplySchema], default: [] },
    reports: { type: [ReportSchema], default: [] },
    isKept: { type: Boolean, default: false, index: true },
    sessionDate: { type: String, required: [true, 'Session date is required'], index: true }
}, { timestamps: true });

// Existing indexes
PostSchema.index({ sessionDate: 1, isKept: 1 });
PostSchema.index({ timestamp: -1 });
PostSchema.index({ sessionDate: 1, mood: 1 });

// Optimize compound filtering for mood filters (remedies inefficient compound index queries)
PostSchema.index({ mood: 1, sessionDate: 1 });
PostSchema.index({ mood: 1, isKept: 1 });

const Post = mongoose.model('Post', PostSchema);

const GhostPostSchema = new mongoose.Schema({
    content: { type: String, required: true },
    mood: { type: String, maxlength: 20, default: null },
    savedAt: { type: Date, default: Date.now, index: true }
});

const GhostPost = mongoose.model('GhostPost', GhostPostSchema);

module.exports = {
    Post,
    GhostPost,
    VALID_REPORT_REASONS
};
