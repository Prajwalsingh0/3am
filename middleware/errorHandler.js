const logger = require('../utils/logger');

/**
 * Global error handler middleware
 * Catches all errors and sends appropriate responses
 */
function errorHandler(err, req, res, next) {
    // Log the error with request context
    logger.error('Request error', {
        error: err.message,
        stack: err.stack,
        method: req.method,
        path: req.path,
        ip: req.ip,
        userId: req.body?.userId || 'unknown'
    });

    // Don't leak error details in production
    const isDev = process.env.NODE_ENV === 'development';

    // Determine status code
    const statusCode = err.statusCode || err.status || 500;

    // Send error response
    res.status(statusCode).json({
        error: {
            message: isDev ? err.message : 'Internal server error',
            ...(isDev && { stack: err.stack }),
            requestId: req.id
        }
    });
}

/**
 * 404 handler for unknown routes
 */
function notFoundHandler(req, res) {
    logger.warn('Route not found', {
        method: req.method,
        path: req.path,
        ip: req.ip
    });

    res.status(404).json({
        error: {
            message: 'Route not found',
            path: req.path
        }
    });
}

module.exports = {
    errorHandler,
    notFoundHandler
};
