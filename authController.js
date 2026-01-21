// controllers/authController.js
// -------------------------------------------------------------
// Handles registration, login and the “who‑am‑I” endpoint.
// -------------------------------------------------------------

const bcrypt   = require('bcrypt');          // npm i bcrypt
const jwt      = require('jsonwebtoken');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');      // safer IDs than Date.now()

// ----------------------------------------------------------------
// Tiny JSON read/write helpers (see utils/readWriteJSON.js)
// ----------------------------------------------------------------
const { readJSON, writeJSON } = require('../utils/readWriteJSON');

// ----------------------------------------------------------------
// Path to the JSON “database” that holds all users.
// ----------------------------------------------------------------
const USERS_DB = path.join(__dirname, '..', 'data', 'users.json');

// ----------------------------------------------------------------
// Configuration constants (easy to tweak in one place)
// ----------------------------------------------------------------
const SALT_ROUNDS    = 10;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';   // ← UPDATED: env‑override
const JWT_SECRET     = process.env.JWT_SECRET || '🔑_dev_secret_change_me';
const EMAIL_REGEX    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PWD_LENGTH = 8;
const JWT_COOKIE_NAME = 'auth_token';                     // ← NEW: HTTP‑Only cookie name

// ----------------------------------------------------------------
// Helper – generate a JWT for a given user payload.
// ----------------------------------------------------------------
function generateToken(user) {
  const payload = {
    id:    user.id,
    email: user.email,
    name:  user.name,
    // role: user.role,   // future‑proof
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Tiny debug logger – controlled with env var.
 * Usage: `DEBUG_AUTH=true node server.js`
 */
function debug(...args) {
  if (process.env.DEBUG_AUTH) {
    console.log('[auth]', ...args);
  }
}

/* -----------------------------------------------------------------
   1️⃣ Register a new user
   ----------------------------------------------------------------- */
async function register(req, res) {
  const { name, email, password } = req.body;

  // ---- Basic validation (should already be done by express‑validator) ----
  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ ok: false, error: 'Name, email and password are required.' });
  }
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ ok: false, error: 'Please provide a valid e‑mail address.' });
  }
  if (password.length < MIN_PWD_LENGTH) {
    return res.status(400).json({ ok: false, error: `Password must be at least ${MIN_PWD_LENGTH} characters.` });
  }

  // ---- Normalise email once (trim → lowercase) -------------------------
  const cleanEmail = email.trim().toLowerCase();

  // ---- Load existing users ---------------------------------------------
  const users = (await readJSON(USERS_DB)) ?? [];

  // ---- Ensure email uniqueness (case‑insensitive) -----------------------
  const emailTaken = users.some(u => u.email === cleanEmail);
  if (emailTaken) {
    return res.status(409).json({ ok: false, error: 'Email already in use.' });
  }

  // ---- Hash password ----------------------------------------------------
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // ---- Build new user object (UUID for safety) -------------------------
  const newUser = {
    id:        uuidv4(),
    name:      name.trim(),
    email:     cleanEmail,
    passwordHash,
    createdAt: new Date().toISOString(),
    // role: 'user',                // placeholder for RBAC
  };

  // ---- Persist ---------------------------------------------------------
  await writeJSON(USERS_DB, [...users, newUser]);

  // ---- Issue JWT -------------------------------------------------------
  const token = generateToken(newUser);
  const { passwordHash: _, ...safeUser } = newUser;

  // ---- OPTIONAL: log the user in immediately via session -----------------
  // (If you want registration to also create a session, uncomment the block)
  /*
  if (req.session) {
    req.session.userId   = newUser.id;
    req.session.role     = newUser.role || 'user';
    req.session.username = newUser.name;
    debug('register → session created for', newUser.id);
  }
  */

  // ---- Set JWT in an httpOnly cookie (safer than returning it in body) ---
  // You can still return it in body for API‑only clients; here we do both.
  res.cookie(JWT_COOKIE_NAME, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   1000 * 60 * 60 * 24 * 7, // 7 days – matches JWT_EXPIRES_IN
  });

  // ---- Optional redirect handling: client can request where to go ---
  const redirectTarget = req.query.redirect || '/earnings';

  debug('register →', safeUser.email, 'token created');

  // ---- IMPORTANT: if a session was created, ensure it is saved before we finish ----
  // (If you never create a session, this is a quick‑no‑op.)
  if (req.session) {
    req.session.save(err => {
      if (err) console.error('⚠️  Session save error (register):', err);
      // Send the final response **after** the session is persisted
      return res.status(201).json({
        ok:       true,
        message:  'User registered successfully.',
        token,                         // kept for API‑clients
        redirect: redirectTarget,
        user:     safeUser,
      });
    });
  } else {
    return res.status(201).json({
      ok:       true,
      message:  'User registered successfully.',
      token,
      redirect: redirectTarget,
      user:     safeUser,
    });
  }
}

/* -----------------------------------------------------------------
   2️⃣ Login – verify credentials and issue a JWT
   ----------------------------------------------------------------- */
async function login(req, res) {
  const { email, password } = req.body;

  // ---- Guard – express‑validator already checked the basics ----------
  if (!email?.trim() || !password) {
    return res.status(400).json({ ok: false, error: 'Email and password are required.' });
  }

  const cleanEmail = email.trim().toLowerCase();

  // ---- Load users -------------------------------------------------------
  const users = (await readJSON(USERS_DB)) ?? [];

  // ---- Find user --------------------------------------------------------
  const user = users.find(u => u.email === cleanEmail);

  // ---- Provide *different* messages for dev vs prod (helps debugging) --
  if (!user) {
    const msg = process.env.NODE_ENV === 'production'
      ? 'Invalid credentials.'
      : 'E‑mail not found.';
    return res.status(401).json({ ok: false, error: msg });
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    const msg = process.env.NODE_ENV === 'production'
      ? 'Invalid credentials.'
      : 'Wrong password.';
    return res.status(401).json({ ok: false, error: msg });
  }

  // ---- Success – issue JWT ---------------------------------------------
  const token = generateToken(user);
  const { passwordHash: _, ...safeUser } = user;

  // ---- **NEW: create a per‑user session** --------------------------------
  if (req.session) {
    req.session.userId   = user.id;                 // unique identifier
    req.session.role     = user.role || 'user';    // optional, for RBAC
    req.session.username = user.name;              // optional, UI helper
    req.session.loginAt  = Date.now();            // optional, idle‑timeout
    debug('login → session created for', user.id);
  }

  // ---- Set JWT in httpOnly cookie (same as register) --------------------
  res.cookie(JWT_COOKIE_NAME, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   1000 * 60 * 60 * 24 * 7, // 7 days
  });

  // ---- Optional redirect (same pattern as register) --------------------
  const redirectTarget = req.query.redirect || '/earnings';

  debug('login →', safeUser.email, 'authenticated');

  // ---- Ensure session is persisted before responding --------------------
  if (req.session) {
    req.session.save(err => {
      if (err) console.error('⚠️  Session save error (login):', err);
      return res.json({
        ok:       true,
        message:  'Logged in successfully.',
        token,                         // kept for API‑only clients
        redirect: redirectTarget,
        user:     safeUser,
      });
    });
  } else {
    return res.json({
      ok:       true,
      message:  'Logged in successfully.',
      token,
      redirect: redirectTarget,
      user:     safeUser,
    });
  }
}

/* -----------------------------------------------------------------
   3️⃣ Get the currently‑authenticated user (`/me`)
   ----------------------------------------------------------------- */
async function getMe(req, res) {
  // `authenticateToken` middleware already placed the JWT payload onto req.user
  // If a session exists we prefer it (more reliable for server‑side state)
  const userId = req.session?.userId || req.user?.id;

  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }

  const users = (await readJSON(USERS_DB)) ?? [];
  const user = users.find(u => u.id === userId);

  if (!user) {
    return res.status(404).json({ ok: false, error: 'User not found.' });
  }

  const { passwordHash: _, ...safeUser } = user;
  return res.json({ ok: true, user: safeUser });
}

/* -----------------------------------------------------------------
   4️⃣ Logout – destroy the session (and clear the JWT cookie)
   ----------------------------------------------------------------- */
async function logout(req, res) {
  // Clear JWT cookie first (whether we have a session or not)
  res.clearCookie(JWT_COOKIE_NAME, { path: '/' });
  debug('logout → JWT cookie cleared');

  // If a session exists, destroy it
  if (req.session) {
    req.session.destroy(err => {
      if (err) {
        console.error('❌  Session destroy error:', err);
        return res.status(500).json({ ok: false, error: 'Could not log out.' });
      }
      // Clear the session cookie as well (the default name from express‑session)
      res.clearCookie('connect.sid', { path: '/' });
      debug('logout → session destroyed');
      return res.json({ ok: true, message: 'Logged out successfully.' });
    });
  } else {
    // No session – just confirm logout
    return res.json({ ok: true, message: 'Logged out (no session found).' });
  }
}

// ----------------------------------------------------------------
// Export the controller functions (including the new logout)
// ----------------------------------------------------------------
module.exports = {
  register,
  login,
  getMe,
  logout,          // <-- NEW export (already present, just kept)
};
