/**
 * Zero-dependency preview server for The 3AM Channel
 * Serves static files + mocks API so the full UI works without npm install.
 * Usage: node preview-server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.txt': 'text/plain', '.woff2': 'font/woff2'
};

// In-memory store — matches real API formatPost shape
let posts = [
  {
    id: 'p1',
    content: "can't sleep again. the ceiling fan sounds like it's judging me.",
    mood: 'lonely',
    isAnonymous: false,
    userId: '4a2fuser',
    timestamp: new Date(Date.now() - 120000).toISOString(),
    seenCount: 7,
    optInSurvivor: true,
    replies: [],
    reportCount: 0,
    isKept: false
  },
  {
    id: 'p2',
    content: "anyone else feel like tomorrow already started and you're behind?",
    mood: 'anxious',
    isAnonymous: true,
    userId: 'anon2',
    timestamp: new Date(Date.now() - 240000).toISOString(),
    seenCount: 12,
    optInSurvivor: true,
    replies: [
      { id: 'r1', replyNum: 1, content: 'every night.', userId: 'u3', mood: null, createdAt: new Date(Date.now() - 60000).toISOString() }
    ],
    reportCount: 0,
    isKept: false
  },
  {
    id: 'p3',
    content: "3am thoughts hit different. just needed somewhere to put this.",
    mood: "can't stop thinking",
    isAnonymous: false,
    userId: '9c1euser',
    timestamp: new Date(Date.now() - 480000).toISOString(),
    seenCount: 4,
    optInSurvivor: true,
    replies: [],
    reportCount: 0,
    isKept: false
  }
];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let p = url.pathname;

  const json = (code, data) => {
    res.writeHead(code, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    });
    res.end(JSON.stringify(data));
  };

  if (req.method === 'OPTIONS') return json(204, {});

  if (p === '/dev-config.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
    return res.end('window.__DEV_OVERRIDE = true;');
  }

  if (p === '/socket.io/socket.io.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end(`
      window.io = function() {
        const handlers = {};
        return {
          on(e, fn) { handlers[e] = handlers[e] || []; handlers[e].push(fn); return this; },
          emit() { return this; },
          off() { return this; },
          disconnect() {},
          connected: true,
          id: 'preview-' + Math.random().toString(36).slice(2,8)
        };
      };
    `);
  }

  if (p === '/api/status') {
    return json(200, {
      isOpen: true, isTimeOpen: true, devOverride: true,
      activeUsers: 3, databaseType: 'memory',
      openHour: 1, closeHour: 6
    });
  }
  if (p === '/api/time') {
    return json(200, { serverTime: Date.now() });
  }
  if (p === '/api/posts' && req.method === 'GET') {
    return json(200, posts);
  }
  if (p === '/api/posts' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const post = {
          id: 'p' + Date.now(),
          content: data.content || '',
          mood: data.mood || null,
          isAnonymous: !!data.isAnonymous,
          userId: data.userId || ('u' + Math.random().toString(16).slice(2, 8)),
          timestamp: new Date().toISOString(),
          seenCount: 0,
          optInSurvivor: data.optInSurvivor !== false,
          replies: [],
          reportCount: 0,
          isKept: false
        };
        posts.unshift(post);
        json(201, post);
      } catch (e) { json(400, { error: { message: 'bad request' } }); }
    });
    return;
  }
  if (p.match(/^\/api\/posts\/[^/]+\/react$/) && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { emoji } = JSON.parse(body || '{}');
        const id = p.split('/')[3];
        const post = posts.find(x => x.id === id);
        if (post && emoji) {
          if (!post.reactions) post.reactions = {};
          post.reactions[emoji] = (post.reactions[emoji] || 0) + 1;
          return json(200, post);
        }
        json(404, { error: { message: 'not found' } });
      } catch (e) { json(400, { error: { message: 'bad' } }); }
    });
    return;
  }
  if (p.match(/^\/api\/posts\/[^/]+\/reply$/) && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const id = p.split('/')[3];
        const post = posts.find(x => x.id === id);
        if (post) {
          const reply = { id: 'r' + Date.now(), content: data.content, createdAt: new Date().toISOString() };
          post.replies.push(reply);
          return json(201, reply);
        }
        json(404, { error: { message: 'not found' } });
      } catch (e) { json(400, { error: { message: 'bad' } }); }
    });
    return;
  }
  if (p === '/api/ghost') return json(200, { post: null });
  if (p === '/api/users/register' && req.method === 'POST') {
    return json(200, { soulId: Math.random().toString(16).slice(2, 6), sessionToken: 'preview' });
  }
  if (p.startsWith('/api/')) return json(404, { error: { message: 'not found' } });
  if (p === '/health' || p === '/ready') return json(200, { ok: true });

  if (p === '/') p = '/index.html';
  const filePath = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ══════════════════════════════════════════');
  console.log('   3AM Channel — PREVIEW MODE');
  console.log('   http://localhost:' + PORT);
  console.log('   Time window BYPASSED · in-memory posts');
  console.log('  ══════════════════════════════════════════');
  console.log('');
});
