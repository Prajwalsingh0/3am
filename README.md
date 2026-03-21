# 🌙 The 3AM Channel

> *A place that only exists between 3 and 6 in the morning.*

---

## What is this?

The 3AM Channel is an anonymous social space that opens at 3:00 AM and disappears at 6:00 AM — every single night. No accounts. No usernames. No history. Just people awake at the same strange hour, saying things they can only say when the world is asleep.

Everything you post is gone by morning. That's the point.

---

## How it works

- **Opens at 3:00 AM** in your local timezone, closes at 6:00 AM
- **All posts are deleted at 6AM**, permanently, every night
- **Fully anonymous** — no accounts, no tracking, no persistent identity
- One post survives each night: the most-reacted one gets "kept" as a ghost post that haunts the next session

---

## Features

### Core
- **Posting** — share a thought, max ~500 chars (soft limit, not enforced)
- **Mood tags** — tag your post with a preset mood or type a custom one
- **Anonymous toggle** — post as `anonymous` or as your session's `soul #xxxx`
- **Character counter** — soft indicator, never blocks you

### Social
- **Whisper threads** — reply privately to any post (3 replies per user per post)
- **Reaction system** — 4 reactions: 😔 💀 🫂 ❤️‍🩹 — toggle on/off, one per post
- **Bell notifications** — get notified when someone whispers on your post
- **Typing indicator** — see when others are composing (not yourself)

### Atmosphere
- **Ghost post** — a post from a previous night appears when the session opens
- **Heartbeat dot** — pulses on every post, speed and color shift as 6AM approaches
- **Exit ritual** — at 5 min and 2 min before close, toasts warn you; at 6AM posts stagger-fade
- **Starfield** — ambient canvas background on the locked screen

### Discovery
- **Mood filter bar** — filter feed by mood tag
- **New posts pill** — sticky pill appears when new posts arrive while you're scrolled down
- **Pull to refresh** — mobile pull gesture refreshes the feed
- **Desktop refresh button** — at the bottom of the feed

### Safety & Privacy
- **Report system** — report posts with a reason (offensive / spam / harassment / other)
- **Hide posts** — remove a post from your local view
- **Rate limiting** — 10 posts per session, IP-based; 3 whispers per user per post
- **Admin routes** — protected by `ADMIN_KEY` for moderation

---

## Tech Stack

| Technology | Purpose | Version |
|---|---|---|
| Node.js | Server runtime | ≥18 |
| Express 5 | HTTP framework | ^5.2 |
| Socket.io | Real-time events | ^4.8 |
| MongoDB Atlas | Database | cloud |
| Mongoose | MongoDB ODM | ^8.8 |
| Winston | Logging | ^3.11 |
| Helmet | Security headers | ^7.1 |
| express-rate-limit | Rate limiting | ^7.1 |
| express-validator | Input validation | ^7.0 |
| node-cron | Scheduled cleanup | ^3.0 |
| Vanilla JS | Frontend | ES2021 |

---

## Getting Started (Local)

### Prerequisites

- Node.js ≥ 18 — [nodejs.org](https://nodejs.org)
- A free MongoDB Atlas account — [mongodb.com/atlas](https://www.mongodb.com/atlas)

### 1. Clone and install

```bash
git clone https://github.com/yourusername/3am-channel.git
cd 3am-channel
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env`. For local dev with no database, just set:

```env
NODE_ENV=development
DEV_OVERRIDE=true
```

The app runs fully on in-memory storage. Posts reset on restart, but everything works.

### 3. Start the server

```bash
npm run dev
```

You'll see:

```
═══════════════════════════════════════════════════════
  ⚠️   DEV OVERRIDE ACTIVE
  Time window (3–6 AM) is BYPASSED
  All routes open. Posts are in-memory unless
  MONGODB_URI is set in .env
═══════════════════════════════════════════════════════

🚀 3AM Channel running at http://localhost:3000
```

Open **http://localhost:3000** — you should see the feed immediately, with a `DEV MODE 🛠` badge in the bottom left.

---

## MongoDB Atlas Setup

For persistent data (required in production):

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com) → create a free account
2. Create a free **M0** cluster (any region is fine)
3. **Security → Database Access** → Add a user with password auth
4. **Security → Network Access** → Add `0.0.0.0/0` (or your specific IP)
5. Click your cluster → **Connect** → **Drivers** → copy the connection string
6. Paste into `.env`:

```env
MONGODB_URI=mongodb+srv://youruser:yourpassword@cluster0.xxxxx.mongodb.net/3am?retryWrites=true&w=majority
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | `development` or `production` |
| `PORT` | No | `3000` | HTTP port |
| `MONGODB_URI` | Production only | — | MongoDB Atlas connection string |
| `DEV_OVERRIDE` | No | `true` in dev | Bypass 3–6AM time window in development |
| `LOG_LEVEL` | No | `info` | `error` / `warn` / `info` / `debug` |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Global rate limit window (15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | Max requests per window per IP |
| `POST_RATE_LIMIT_WINDOW_MS` | No | `60000` | Post rate limit window (1 hr) |
| `POST_RATE_LIMIT_MAX` | No | `10` | Max posts per window per IP |
| `CORS_ORIGIN` | No | `*` | Allowed origins, comma-separated |
| `CLEANUP_CRON` | No | `5 6 * * *` | When to run nightly cleanup (cron) |
| `ADMIN_KEY` | No | — | Secret key for admin routes |
| `SENTRY_DSN` | No | — | Sentry error tracking DSN |

---

## Deployment

### Railway (easiest)

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Then in the Railway dashboard → Variables, add at minimum:
- `MONGODB_URI`
- `NODE_ENV=production`
- `ADMIN_KEY=<long random string>`
- `CORS_ORIGIN=https://yourdomain.com`

### Render

1. Push repo to GitHub
2. New **Web Service** on [render.com](https://render.com)
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables in the dashboard
6. HTTPS is automatic

**Both platforms:** Make sure `DEV_OVERRIDE` is `false` (or absent) in production — it defaults to `false` when `NODE_ENV=production`.

---

## API Reference

| Method | Route | Description | Protected |
|---|---|---|---|
| `GET` | `/health` | Server health check | — |
| `GET` | `/ready` | Readiness check (DB ping) | — |
| `GET` | `/api/time` | Server timestamp for clock sync | — |
| `GET` | `/api/status` | Channel state, user count, dev override | — |
| `GET` | `/api/posts` | Get tonight's posts (+ kept posts) | Time window |
| `POST` | `/api/posts` | Create a post | Time window + rate limit |
| `POST` | `/api/posts/:id/react` | Toggle a reaction emoji | Time window |
| `POST` | `/api/posts/:id/reply` | Add a whisper reply | Time window |
| `POST` | `/api/posts/:id/report` | Report a post | — |
| `GET` | `/api/ghost` | Get a random ghost post | — |
| `GET` | `/api/admin/reported` | List reported posts | `x-admin-key` |
| `DELETE` | `/api/admin/posts/:id` | Delete a post | `x-admin-key` |
| `POST` | `/dev/seed-ghost` | Seed a test ghost post | Dev only |
| `POST` | `/dev/reset` | Clear in-memory posts | Dev only |
| `GET` | `/dev-config.js` | Client dev bootstrap script | — |

---

## Project Structure

```
3am-channel/
│
├── server.js              # Express + Socket.io server (all routes)
├── app.js                 # Frontend JavaScript (single-file SPA)
├── index.html             # HTML shell
├── styles.css             # All styles (~2100 lines)
├── sw.js                  # Service worker (PWA shell caching)
├── manifest.json          # PWA manifest
├── robots.txt             # Search engine directives
├── privacy.html           # Privacy policy page
│
├── config/
│   └── index.js           # Joi-validated environment config
│
├── middleware/
│   ├── validators.js      # express-validator rules for all routes
│   └── errorHandler.js    # Global error + 404 handlers
│
├── utils/
│   └── logger.js          # Winston logger with daily rotation
│
├── tests/
│   ├── setup.js           # Jest global setup
│   ├── integration/
│   │   └── api.test.js    # API integration tests (MongoMemoryServer)
│   └── e2e/
│       └── user-flow.spec.js  # Playwright end-to-end tests
│
├── logs/                  # Auto-created by logger (git-ignored)
├── .env.example           # Environment template
├── .gitignore
├── package.json
├── jest.config.js
├── playwright.config.js
└── .eslintrc.js
```

---

## Admin

Protect sensitive operations with the `x-admin-key` header:

```bash
# View all reported posts
curl -H "x-admin-key: your-secret-key" https://yourdomain.com/api/admin/reported

# Delete a post
curl -X DELETE -H "x-admin-key: your-secret-key" https://yourdomain.com/api/admin/posts/POST_ID
```

Set `ADMIN_KEY` in your `.env`. Use a long random string in production:

```bash
openssl rand -hex 32
```

---

## Dev Mode

`DEV_OVERRIDE=true` in `.env` (only active when `NODE_ENV=development`) does the following:

- Bypasses the 3–6AM time window on the **server** (all routes stay open)
- Injects `window.__DEV_OVERRIDE = true` via `/dev-config.js` (loaded synchronously before `app.js`)
- Client sets `isSpoofMode = true` at startup — **no async race**, feed shows instantly
- Shows a `DEV MODE 🛠` badge in the bottom-left corner
- Disables the exit ritual (which would otherwise fire at "0 seconds left" during the day)
- Shows `"dev mode — open all day 🛠"` in the time-remaining header
- All rate limiters skip when `x-spoof-mode: true` header is sent

### Useful dev commands

```bash
# Seed a ghost post (appears on next page load)
curl -X POST http://localhost:3000/dev/seed-ghost

# Reset in-memory posts
curl -X POST http://localhost:3000/dev/reset

# Trigger the nightly cleanup manually
curl -X POST http://localhost:3000/dev/trigger-cleanup

# Check channel status
curl http://localhost:3000/api/status
```

---

## Running Tests

```bash
# Unit + integration tests
npm test

# Watch mode
npm run test:watch

# End-to-end (requires running server)
npm run test:e2e
```

---

## License

MIT — do whatever you want with it.

---

*The channel opens at 3. Don't be late.*
