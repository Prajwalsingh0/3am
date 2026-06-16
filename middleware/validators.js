const { body, validationResult } = require('express-validator');

const VALID_MOODS = ['anxious', 'sad', 'excited', 'lonely', "can't stop thinking", 'just bored'];
const VALID_REPORT_REASONS = ['offensive', 'spam', 'harassment', 'other'];

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: {
                message: 'Validation failed',
                details: errors.array().map(e => ({ field: e.path, message: e.msg }))
            }
        });
    }
    next();
};

const userIdRule = body('userId')
    .trim()
    .notEmpty().withMessage('User ID is required')
    .matches(/^[a-z0-9]+$/).withMessage('User ID must be alphanumeric lowercase')
    .isLength({ min: 1, max: 100 }).withMessage('User ID too long');

// Mood: optional, free text, max 20 chars (custom moods allowed)
const moodRule = body('mood')
    .optional({ nullable: true, checkFalsy: true })
    .isString().withMessage('Mood must be a string')
    .trim()
    .isLength({ min: 1, max: 20 }).withMessage('Mood must be 1–20 characters');

// Post creation — min 1 char, max 500 chars (hard limit)
const createPostValidators = [
    body('content')
        .trim()
        .notEmpty().withMessage('Content is required')
        .isLength({ min: 1 }).withMessage('Content cannot be empty')
        .isLength({ max: 500 }).withMessage('Content too long (maximum 500 characters)'),
    userIdRule,
    body('isAnonymous')
        .optional()
        .isBoolean().withMessage('isAnonymous must be boolean')
        .toBoolean(),
    moodRule,
    validate
];

const addReactionValidators = [
    body('emoji')
        .notEmpty().withMessage('Emoji is required')
        .isIn(['❤️', '😔', '💀', '💔', '🤍', '🌙', '🫂', '❤️‍🩹']).withMessage('Invalid emoji'),
    userIdRule,
    validate
];

// Whisper reply — min 1 char, max 500 chars (hard limit)
const addReplyValidators = [
    body('content')
        .trim()
        .notEmpty().withMessage('Whisper content is required')
        .isLength({ min: 1 }).withMessage('Whisper cannot be empty')
        .isLength({ max: 500 }).withMessage('Whisper too long (maximum 500 characters)'),
    userIdRule,
    moodRule,
    validate
];

const addReportValidators = [
    body('reason')
        .notEmpty().withMessage('Reason is required')
        .isIn(VALID_REPORT_REASONS).withMessage(`Reason must be one of: ${VALID_REPORT_REASONS.join(', ')}`),
    validate
];

module.exports = {
    createPostValidators,
    addReactionValidators,
    addReplyValidators,
    addReportValidators,
    VALID_MOODS,
    VALID_REPORT_REASONS
};
