// Global test setup
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
// Don't set MONGODB_URI here - the integration tests create their own MongoMemoryServer
// and connect via mongoose directly. Setting this would conflict.

// Increase timeout for async operations
jest.setTimeout(15000);

// Mock logger in tests to suppress noise
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    http: jest.fn()
}));
