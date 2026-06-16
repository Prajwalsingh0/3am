const { rateLimit } = require('express-rate-limit');

function requireAdminKey(req, res, next) {
    const key = req.headers['x-admin-key'];
    if (!process.env.ADMIN_KEY || !key || key !== process.env.ADMIN_KEY) {
        return res.status(401).json({ error: { message: 'Unauthorized' } });
    }
    next();
}

const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP or admin key to 100 requests per windowMs
    keyGenerator: (req) => req.headers['x-admin-key'] || req.ip || 'unknown',
    message: { error: { message: 'Too many admin requests, please try again later' } }
});

module.exports = {
    requireAdminKey,
    adminLimiter
};
