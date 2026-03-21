const Joi = require('joi');
require('dotenv').config();

// Peek at DEV_OVERRIDE before full schema validation so we can decide
// whether MONGODB_URI is required. In dev with DEV_OVERRIDE=true, MongoDB
// is optional — the server runs on in-memory storage so developers can
// test the full UI without an Atlas account.
//
// IMPORTANT: When NODE_ENV is 'development' (or not set), DEV_OVERRIDE
// defaults to TRUE so the server just works out of the box without any
// .env configuration. Set DEV_OVERRIDE=false explicitly to enforce the
// time window in development.
const _isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
const _isDevOverride = process.env.DEV_OVERRIDE !== undefined
    ? process.env.DEV_OVERRIDE === 'true'
    : _isDev; // default: true in dev, false in production
const _mongoOptional = _isDevOverride && _isDev;

// Environment validation schema
const envSchema = Joi.object({
    NODE_ENV: Joi.string()
        .valid('development', 'production', 'test')
        .default('development'),

    PORT: Joi.number()
        .port()
        .default(3000),

    // MongoDB Atlas connection string.
    // Required in production. Optional in development when DEV_OVERRIDE=true.
    // Format: mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/3am?retryWrites=true&w=majority
    MONGODB_URI: _mongoOptional
        ? Joi.string().uri({ scheme: ['mongodb', 'mongodb+srv'] }).optional()
        : Joi.string().uri({ scheme: ['mongodb', 'mongodb+srv'] }).required(),

    LOG_LEVEL: Joi.string()
        .valid('error', 'warn', 'info', 'http', 'verbose', 'debug')
        .default('info'),

    RATE_LIMIT_WINDOW_MS: Joi.number()
        .integer()
        .min(1000)
        .default(900000),

    RATE_LIMIT_MAX_REQUESTS: Joi.number()
        .integer()
        .min(1)
        .default(100),

    POST_RATE_LIMIT_WINDOW_MS: Joi.number()
        .integer()
        .min(1000)
        .default(60000),

    POST_RATE_LIMIT_MAX: Joi.number()
        .integer()
        .min(1)
        .default(10),

    CORS_ORIGIN: Joi.string()
        .default('*'),

    SENTRY_DSN: Joi.string()
        .uri()
        .optional(),

    CLEANUP_CRON: Joi.string()
        .default('5 6 * * *'),

    DEV_OVERRIDE: Joi.boolean()
        .truthy('true').falsy('false')
        .default(_isDev) // true in development, false in production
}).unknown();

// Validate environment
const { error, value: env } = envSchema.validate(process.env);

if (error) {
    const isMissingUri = error.details.some(d => d.context && d.context.key === 'MONGODB_URI');
    if (isMissingUri) {
        console.error('');
        console.error('\u2501'.repeat(51));
        console.error('\u274C  MONGODB_URI is missing from your .env file.');
        console.error('    See README.md \u2192 "MongoDB Atlas Setup" to get started.');
        console.error('    Tip: in development, DEV_OVERRIDE defaults to true so you');
        console.error('    can run without MongoDB. Just start with: npm run dev');
        console.error('\u2501'.repeat(51));
        console.error('');
    }
    throw new Error('Config validation error: ' + error.message);
}

// Resolve final devOverride — also trust the pre-schema peek value (_isDevOverride)
// so in-memory path is consistent even if Joi coercion differs.
const devOverride = env.DEV_OVERRIDE === true || _isDevOverride;

module.exports = {
    env: env.NODE_ENV,
    isDevelopment: env.NODE_ENV === 'development',
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',

    server: {
        port: env.PORT
    },

    database: {
        uri: env.MONGODB_URI || null,
        options: {
            maxPoolSize: 10,
            minPoolSize: 2,
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            heartbeatFrequencyMS: 10000,
        }
    },

    logging: {
        level: env.LOG_LEVEL
    },

    rateLimit: {
        global: {
            windowMs: env.RATE_LIMIT_WINDOW_MS,
            max: env.RATE_LIMIT_MAX_REQUESTS,
            message: 'Too many requests, please try again later'
        },
        post: {
            windowMs: env.POST_RATE_LIMIT_WINDOW_MS,
            max: env.POST_RATE_LIMIT_MAX,
            message: 'Posting too fast, please slow down'
        }
    },

    cors: {
        origin: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(','),
        credentials: true
    },

    channel: {
        openHour: 3,
        openMinute: 0,
        closeHour: 6,
        closeMinute: 0
    },

    cleanup: {
        cron: env.CLEANUP_CRON
    },

    devOverride,

    sentry: {
        dsn: env.SENTRY_DSN
    }
};
