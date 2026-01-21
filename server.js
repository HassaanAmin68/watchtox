/**
 * ---------------------------------------------------------------
 * server.js
 * ---------------------------------------------------------------
 * Full Express server with:
 *   • Redis‑backed session store (fallback → MemoryStore)
 *   • Helmet, compression, mongo‑sanitize, CORS, rate‑limit, morgan
 *   • JSON‑file “databases” (users, lottery)
 *   • Auth, lottery, and user routers
 *   • Centralised error handling & SPA fallback
 * ---------------------------------------------------------------
 */

require('dotenv').config();               // 0️⃣ Load .env (optional)

const path          = require('path');
const fs            = require('fs');
const express       = require('express');
const cors          = require('cors');
const helmet        = require('helmet');
const morgan        = require('morgan');
const chokidar      = require('chokidar');            // optional – file watcher
const rateLimit     = require('express-rate-limit'); // global limiter
const compression   = require('compression');
const mongoSanitize = require('express-mongo-sanitize');

// ---- Session handling -------------------------------------------------
const session   = require('express-session');
const RedisStore = require('connect-redis'); // v9 → class export
const { createClient } = require('redis');

// ---- Async‑error handling – must be required **before** any routes ----
require('express-async-errors');

// -----------------------------------------------------------------
// 1️⃣  Async start‑up – we need Redis ready before the app is built
// -----------------------------------------------------------------
(async () => {
  // -------------------------------------------------------------
  // 1️⃣ Create Redis client (only in prod or if REDIS_URL is defined)
  // -------------------------------------------------------------
  let redisClient;
  let sessionStore;            // will hold the RedisStore instance
  let useRedis = false;

  if (process.env.NODE_ENV === 'production' || process.env.REDIS_URL) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    redisClient = createClient({ url: redisUrl });

    redisClient.on('error', err => {
      console.error('❌  Redis connection error – falling back to MemoryStore:', err);
    });

    try {
      await redisClient.connect();               // v4 client returns a promise
      console.log('✅  Connected to Redis at', redisUrl);
      useRedis = true;
      sessionStore = new RedisStore({ client: redisClient });
    } catch (e) {
      console.error('⚠️  Could not connect to Redis – using MemoryStore instead', e);
      // useRedis stays false → fallback to MemoryStore
    }
  }

  // -------------------------------------------------------------
  // 2️⃣  Create the Express app (must be before any app.use)
  // -------------------------------------------------------------
  const app = express();
  const PORT = process.env.PORT || 3000;

  // -------------------------------------------------------------
  // 3️⃣  Core settings
  // -------------------------------------------------------------
  app.enable('trust proxy'); // needed when behind NGINX, Heroku, etc.

  // -------------------------------------------------------------
  // 4️⃣  Global security & performance middleware
  // -------------------------------------------------------------
  app.use(
    helmet({
      contentSecurityPolicy: false, // you can enable later if needed
    })
  );
  app.use(compression());

  // -----------------------------------------------------------------
  // 5️⃣  Session middleware – must be placed BEFORE any router that reads it
  // -----------------------------------------------------------------
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'dev‑fallback‑secret',
      store: useRedis ? sessionStore : undefined, // fallback → MemoryStore
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24, // 1 day
      },
      proxy: true, // respect X‑Forwarded‑Proto when behind a proxy
    })
  );

  // -------------------------------------------------------------
  // 5️⃣½  Rate limiting – global (15 min, 100 req/IP)
  // -------------------------------------------------------------
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', apiLimiter); // only API routes

  // -------------------------------------------------------------
  // 6️⃣  Body parsing (JSON & URL‑encoded) – sensible size limits
  // -------------------------------------------------------------
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: true, limit: '10kb' }));

  // -------------------------------------------------------------
  // 7️⃣  Mongo‑sanitize – removes MongoDB operators from req objects
  // -------------------------------------------------------------
  app.use(mongoSanitize());

  // -------------------------------------------------------------
  // 8️⃣  CORS – open in dev, locked down in prod (allow credentials)
  // -------------------------------------------------------------
  if (process.env.NODE_ENV === 'production') {
    app.use(
      cors({
        origin: 'https://your-domain.com', // <- change to your real domain(s)
        credentials: true,
      })
    );
  } else {
    app.use(cors()); // dev: allow everything
  }

  // -------------------------------------------------------------
  // 9️⃣  Logging – morgan (dev vs combined)
  // -------------------------------------------------------------
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  // -------------------------------------------------------------
  // 10️⃣  Serve static files
  // -------------------------------------------------------------
  const PUBLIC_DIR = path.join(__dirname, 'public');
  app.use(express.static(PUBLIC_DIR));

  // -------------------------------------------------------------
  // 11️⃣  Tiny JSON‑file helpers for the **users** “DB”
  // -------------------------------------------------------------
  const USERS_DB = path.join(__dirname, 'data', 'users.json');

  async function readUsers() {
    try {
      const raw = await fs.promises.readFile(USERS_DB, 'utf8');
      return JSON.parse(raw);
    } catch (_) {
      return []; // start empty if file missing / malformed
    }
  }

  async function writeUsers(data) {
    await fs.promises.mkdir(path.dirname(USERS_DB), { recursive: true });
    await fs.promises.writeFile(USERS_DB, JSON.stringify(data, null, 2));
  }

  // -------------------------------------------------------------
  // 12️⃣  Basic /api/users CRUD (kept exactly as you wrote it)
  // -------------------------------------------------------------
  const usersRouter = express.Router();

  usersRouter.get('/', async (req, res) => {
    const users = await readUsers();
    res.json(users);
  });

  usersRouter.get('/:id', async (req, res) => {
    const users = await readUsers();
    const user = users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  });

  usersRouter.post('/', async (req, res) => {
    const users = await readUsers();
    const newUser = { id: Date.now().toString(), ...req.body };
    users.push(newUser);
    await writeUsers(users);
    res.status(201).json(newUser);
  });

  usersRouter.put('/:id', async (req, res) => {
    const users = await readUsers();
    const idx = users.findIndex(u => u.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });
    users[idx] = { ...users[idx], ...req.body };
    await writeUsers(users);
    res.json(users[idx]);
  });

  usersRouter.delete('/:id', async (req, res) => {
    const users = await readUsers();
    const filtered = users.filter(u => u.id !== req.params.id);
    if (filtered.length === users.length)
      return res.status(404).json({ error: 'User not found' });
    await writeUsers(filtered);
    res.status(204).end();
  });

  // -------------------------------------------------------------
  // 13️⃣  Import routers (auth, lottery, user)
  // -------------------------------------------------------------
  const { authRouter }    = require('./routes/auth');
  const { lotteryRouter } = require('./routes/lottery');
  const { userRouter }    = require('./routes/user');   // <-- NEW: user router

  // -------------------------------------------------------------
  // 14️⃣  Mount routers
  // -------------------------------------------------------------
  app.use('/api/auth',    authRouter);
  app.use('/api/lottery', lotteryRouter);
  app.use('/api/users',   usersRouter);   // our simple JSON CRUD
  // If you prefer the more feature‑rich userController, you can also mount:
  // app.use('/api/users', userRouter);

  // -------------------------------------------------------------
  // 15️⃣  Optional file‑watcher (dev only) – helps with SPA rebuilds
  // -------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const watcher = chokidar.watch(PUBLIC_DIR, { ignoreInitial: true });
    watcher.on('all', (event, changedPath) => {
      console.log(
        `[watch] ${event} → ${path.relative(__dirname, changedPath)}`
      );
    });
  }

  // -------------------------------------------------------------
  // 16️⃣  Generic 404 for non‑GET unmatched routes (POST, PUT, DELETE…)
  // -------------------------------------------------------------
  app.use((req, res, next) => {
    if (req.method === 'GET') return next();          // let SPA fallback handle GET
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // -------------------------------------------------------------
  // 17️⃣  SPA fallback for all other GET requests
  // -------------------------------------------------------------
  app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'index.html'));
  });

  // -------------------------------------------------------------
  // 18️⃣  Central error handler (must be after all routes)
  // -------------------------------------------------------------
  app.use((err, req, res, next) => {
    console.error('❌  Server error:', err);
    if (res.headersSent) return next(err);
    const status = err.status || 500;
    res.status(status).json({
      error: err.message || 'Internal Server Error',
    });
  });

  // -------------------------------------------------------------
  // 19️⃣  Start the HTTP server
  // -------------------------------------------------------------
  app.listen(PORT, () => {
    console.log(`🚀  Server listening on http://localhost:${PORT}`);
    console.log(`   • Static assets: ${PUBLIC_DIR}`);
    console.log(`   • API base: http://localhost:${PORT}/api`);
  });
})(); // ← end of async IIFE
