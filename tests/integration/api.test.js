/**
 * Integration tests for API endpoints
 */

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { app } = require('../../server');

let mongoServer;

beforeAll(async () => {
    // Create in-memory MongoDB instance
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();

    // Connect to in-memory database
    await mongoose.connect(mongoUri);
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

afterEach(async () => {
    // Clean up database between tests
    const collections = mongoose.connection.collections;
    for (const key in collections) {
        await collections[key].deleteMany();
    }
});

describe('API Integration Tests', () => {
    describe('GET /health', () => {
        it('should return 200 OK', async () => {
            const res = await request(app).get('/health');

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('status', 'ok');
            expect(res.body).toHaveProperty('timestamp');
            expect(res.body).toHaveProperty('uptime');
        });
    });

    describe('GET /ready', () => {
        it('should return readiness status', async () => {
            const res = await request(app).get('/ready');

            expect([200, 503]).toContain(res.status);
            expect(res.body).toHaveProperty('status');
            expect(res.body).toHaveProperty('checks');
        });
    });

    describe('POST /api/posts', () => {
        it('should create a post with valid data', async () => {
            const postData = {
                content: 'Test post content',
                userId: 'testuser123',
                isAnonymous: true
            };

            const res = await request(app)
                .post('/api/posts')
                .set('x-spoof-mode', 'true')
                .send(postData);

            expect(res.status).toBe(201);
            expect(res.body).toHaveProperty('id');
            expect(res.body.content).toBe(postData.content);
            expect(res.body.userId).toBe(postData.userId);
            expect(res.body.isAnonymous).toBe(true);
        });

        it('should reject empty content', async () => {
            const res = await request(app)
                .post('/api/posts')
                .set('x-spoof-mode', 'true')
                .send({
                    content: '',
                    userId: 'test'
                });

            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error');
        });

        it('should reject content over 500 characters', async () => {
            const longContent = 'a'.repeat(501);

            const res = await request(app)
                .post('/api/posts')
                .set('x-spoof-mode', 'true')
                .send({
                    content: longContent,
                    userId: 'test'
                });

            expect(res.status).toBe(400);
        });

        it('should reject invalid userId', async () => {
            const res = await request(app)
                .post('/api/posts')
                .set('x-spoof-mode', 'true')
                .send({
                    content: 'Test',
                    userId: 'invalid@user!'
                });

            expect(res.status).toBe(400);
        });

        it('should block requests outside time window', async () => {
            const res = await request(app)
                .post('/api/posts')
                .send({
                    content: 'Test',
                    userId: 'test123'
                });

            // Without spoof mode, should be blocked
            expect(res.status).toBe(403);
            expect(res.body.error).toHaveProperty('message', 'Channel is closed');
        });
    });

    describe('GET /api/posts', () => {
        beforeEach(async () => {
            // Create some test posts
            await request(app)
                .post('/api/posts')
                .set('x-spoof-mode', 'true')
                .send({ content: 'Post 1', userId: 'user1' });

            await request(app)
                .post('/api/posts')
                .set('x-spoof-mode', 'true')
                .send({ content: 'Post 2', userId: 'user2' });
        });

        it('should retrieve all posts', async () => {
            const res = await request(app)
                .get('/api/posts')
                .set('x-spoof-mode', 'true');

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBeGreaterThanOrEqual(2);
        });

        it('should block requests outside time window', async () => {
            const res = await request(app).get('/api/posts');

            expect(res.status).toBe(403);
        });
    });

    describe('POST /api/posts/:postId/react', () => {
        let postId;

        beforeEach(async () => {
            const res = await request(app)
                .post('/api/posts')
                .set('x-spoof-mode', 'true')
                .send({ content: 'Test post', userId: 'user1' });

            postId = res.body.id;
        });

        it('should add a reaction', async () => {
            const res = await request(app)
                .post(`/api/posts/${postId}/react`)
                .set('x-spoof-mode', 'true')
                .send({
                    emoji: '🤍',
                    userId: 'user2'
                });

            expect(res.status).toBe(200);
            expect(res.body.reactions['🤍']).toContain('user2');
        });

        it('should remove reaction if already exists', async () => {
            // Add reaction first
            await request(app)
                .post(`/api/posts/${postId}/react`)
                .set('x-spoof-mode', 'true')
                .send({ emoji: '🤍', userId: 'user2' });

            // Remove it
            const res = await request(app)
                .post(`/api/posts/${postId}/react`)
                .set('x-spoof-mode', 'true')
                .send({ emoji: '🤍', userId: 'user2' });

            expect(res.status).toBe(200);
            expect(res.body.reactions['🤍']).not.toContain('user2');
        });

        it('should switch reaction if user reacts with different emoji', async () => {
            // Add first reaction
            await request(app)
                .post(`/api/posts/${postId}/react`)
                .set('x-spoof-mode', 'true')
                .send({ emoji: '🤍', userId: 'user2' });

            // Switch to different emoji
            const res = await request(app)
                .post(`/api/posts/${postId}/react`)
                .set('x-spoof-mode', 'true')
                .send({ emoji: '🌙', userId: 'user2' });

            expect(res.status).toBe(200);
            expect(res.body.reactions['🤍']).not.toContain('user2');
            expect(res.body.reactions['🌙']).toContain('user2');
        });

        it('should reject invalid emoji', async () => {
            const res = await request(app)
                .post(`/api/posts/${postId}/react`)
                .set('x-spoof-mode', 'true')
                .send({
                    emoji: '😀',
                    userId: 'user2'
                });

            expect(res.status).toBe(400);
        });

        it('should return 404 for non-existent post', async () => {
            const res = await request(app)
                .post('/api/posts/nonexistent/react')
                .set('x-spoof-mode', 'true')
                .send({
                    emoji: '🤍',
                    userId: 'user2'
                });

            expect(res.status).toBe(404);
        });
    });

    describe('404 Handler', () => {
        it('should return 404 for unknown routes', async () => {
            const res = await request(app).get('/api/nonexistent');

            expect(res.status).toBe(404);
            expect(res.body).toHaveProperty('error');
        });
    });
});
