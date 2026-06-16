const express = require('express');
const { getReportedPosts, deletePost } = require('../controllers/adminController');
const { requireAdminKey, adminLimiter } = require('../middleware/adminAuth');

const router = express.Router();

// Apply admin rate limiting to all admin routes
router.use(adminLimiter);

// Get reported posts
router.get('/reported', requireAdminKey, getReportedPosts);

// Delete a post
router.delete('/posts/:postId', requireAdminKey, deletePost);

module.exports = router;
