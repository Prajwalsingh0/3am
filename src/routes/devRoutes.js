const express = require('express');
const PostRepository = require('../services/PostRepository');
const config = require('../../config');
const logger = require('../../utils/logger');

const router = express.Router();

// Strict environment safety check middleware
router.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production' || config.isProduction) {
        return res.status(403).json({ error: { message: 'Development endpoints are disabled in production' } });
    }
    next();
});

// Manually trigger daily cleanup
router.post('/trigger-cleanup', async (req, res, next) => {
    try {
        logger.info('🔧 Manual cleanup triggered');
        await PostRepository.performDailyCleanup();
        res.json({ message: 'Cleanup completed', timestamp: new Date().toISOString() });
    } catch (e) {
        next(e);
    }
});

// Clear in-memory posts
router.post('/reset', (req, res) => {
    PostRepository.reset();
    res.json({ message: 'In-memory posts cleared' });
});

// Seed a ghost post
router.post('/seed-ghost', async (req, res, next) => {
    try {
        const samples = [
            "i keep thinking about the version of my life where i made different choices",
            "does anyone else feel most alive at 3am or is that just me",
            "i wrote a letter i'll never send. it's 47 pages long.",
            "the city looks kinder when everyone's asleep",
            "i miss someone i've never met"
        ];
        const content = samples[Math.floor(Math.random() * samples.length)];
        const moods = ['anxious', 'lonely', 'sad', null];
        const mood = moods[Math.floor(Math.random() * moods.length)];

        await PostRepository.createGhostPost({ content, mood, savedAt: new Date() });
        res.json({ message: 'Ghost post seeded', content });
    } catch (e) {
        next(e);
    }
});

module.exports = router;
