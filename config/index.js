const Joi = require('joi');
require('dotenv').config();

// MongoDB is always optional in development — the server falls back to in-memory
// storage so developers can test the full UI (including the real time-gated
// closed screen) without an Atlas account.
//
// DEV_OVERRIDE only controls the time gate (1AM–6AM window bypass):
//   DEV_OVERRIDE=false → real time gate enforced, closed screen with countdown
//   DEV_OVERRIDE=true  → time gate bypassed, feed always accessible
const _isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
const _isTest = process.env.NODE_ENV === 'test';
const _isDevOverride = process.env.DEV_OVERRIDE === 'true';
const _mongoOptional = _isDev || _isTest;

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
        .default(false),

    SESSION_SECRET: Joi.string()
        .default('default-3am-secret-key-change-in-production'),

    TRUST_PROXY: Joi.string()
        .default('loopback')
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
        console.error('    Tip: in development, set DEV_OVERRIDE=true in your .env');
        console.error('    to run without MongoDB using in-memory fallback.');
        console.error('\u2501'.repeat(51));
        console.error('');
    }
    throw new Error('Config validation error: ' + error.message);
}

const devOverride = env.DEV_OVERRIDE === true || _isDevOverride;

module.exports = {
    env: env.NODE_ENV,
    isDevelopment: env.NODE_ENV === 'development',
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',

    server: {
        port: env.PORT,
        trustProxy: env.TRUST_PROXY
    },

    database: {
        uri: env.MONGODB_URI || null,
        options: {
            maxPoolSize: 10,
            minPoolSize: 2,
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            heartbeatFrequencyMS: 10000
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
        openHour: 1,
        openMinute: 0,
        closeHour: 6,
        closeMinute: 0
    },

    cleanup: {
        cron: env.CLEANUP_CRON
    },

    devOverride,
    sessionSecret: env.SESSION_SECRET,

    sentry: {
        dsn: env.SENTRY_DSN
    }
};
