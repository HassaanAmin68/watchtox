/**
 * controllers/userController.js
 * -------------------------------------------------------------
 * Business‑logic for managing users (admin panel + self‑service).
 *
 * Data lives in: data/users.json
 *   [
 *     { id, name, email, passwordHash, role?, createdAt, updatedAt }
 *   ]
 *
 * Exported functions are meant to be used as Express route handlers,
 * e.g.:
 *
 *   const {
 *     listUsers,
 *     getUser,
 *     updateUser,
 *     deleteUser,
 *   } = require('../controllers/userController');
 *
 *   router.get('/users',            authenticateToken, isAdmin, listUsers);
 *   router.get('/users/:id',        authenticateToken, getUser);
 *   router.put('/users/:id',        authenticateToken, updateUser);
 *   router.delete('/users/:id',    authenticateToken, isAdmin, deleteUser);
 *
 * -------------------------------------------------------------
 */

const path      = require('path');
const bcrypt    = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const {
  readJSON,
  writeJSON,
} = require('../utils/readWriteJSON');

// ------------------------------------------------------------------
// Path to the JSON “database”
// ------------------------------------------------------------------
const USERS_DB = path.join(__dirname, '..', 'data', 'users.json');

// ------------------------------------------------------------------
// Configurable limits (can be overridden via env)
// ------------------------------------------------------------------
const SALT_ROUNDS = Number(process.env.SALT_ROUNDS) || 10;

// ------------------------------------------------------------------
// Simple async‑error‑wrapper (identical to the one used in lotteryController)
// ------------------------------------------------------------------
function asyncHandler(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

// ------------------------------------------------------------------
// In‑memory write‑lock to avoid race conditions on the JSON file
// ------------------------------------------------------------------
let pendingWrite = Promise.resolve(); // resolves when the previous write finished
async function writeDBAtomic(payload) {
  pendingWrite = pendingWrite.then(() => writeJSON(USERS_DB, payload));
  await pendingWrite;
}

// ------------------------------------------------------------------
// Helper – load all users, repairing a missing/corrupt file on the fly
// ------------------------------------------------------------------
async function loadUsers() {
  try {
    const data = await readJSON(USERS_DB);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('⚠️  Users DB corrupted – resetting', e);
    return [];
  }
}

// ------------------------------------------------------------------
// Helper – admin check (role from session/token or legacy email suffix)
// ------------------------------------------------------------------
function isAdmin(user) {
  if (!user) return false;
  if (user.role) return user.role === 'admin';
  return typeof user.email === 'string' && user.email.endsWith('@admin.com');
}

/* -----------------------------------------------------------------
   1️⃣ LIST ALL USERS (admin only) – optional pagination
   ----------------------------------------------------------------- */
async function listUsers(req, res) {
  // `isAdmin` is normally used as a separate middleware, but we double‑check
  if (!isAdmin(req.user)) {
    return res.status(403).json({ ok: false, error: 'Admin privileges required.' });
  }

  const all = await loadUsers();

  // ---- Pagination support: ?page=1&limit=20 -------------------------
  const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.max(1, parseInt(req.query.limit, 10) || 20);
  const start = (page - 1) * limit;
  const paged = all.slice(start, start + limit);

  // Remove passwordHash from every record before sending
  const safe = paged.map(u => {
    const { passwordHash, ...rest } = u;
    return rest;
  });

  res.json({
    ok: true,
    page,
    limit,
    totalUsers: all.length,
    users: safe,
  });
}

/* -----------------------------------------------------------------
   2️⃣ GET SINGLE USER (self‑service or admin)
   ----------------------------------------------------------------- */
async function getUser(req, res) {
  const { id } = req.params;
  const requester = req.user; // populated by JWT middleware

  // Only the owner or an admin may fetch the record
  if (!requester || (requester.id !== id && !isAdmin(requester))) {
    return res.status(403).json({ ok: false, error: 'Access denied.' });
  }

  const users = await loadUsers();
  const user = users.find(u => u.id === id);

  if (!user) {
    return res.status(404).json({ ok: false, error: 'User not found.' });
  }

  const { passwordHash, ...safeUser } = user;
  res.json({ ok: true, user: safeUser });
}

/* -----------------------------------------------------------------
   3️⃣ UPDATE USER (self‑service or admin)
   ----------------------------------------------------------------- */
async function updateUser(req, res) {
  const { id } = req.params;
  const requester = req.user;

  // Owner or admin may update
  if (!requester || (requester.id !== id && !isAdmin(requester))) {
    return res.status(403).json({ ok: false, error: 'Access denied.' });
  }

  const { name, email, password, role } = req.body; // role is only allowed for admins

  const users = await loadUsers();
  const idx = users.findIndex(u => u.id === id);

  if (idx === -1) {
    return res.status(404).json({ ok: false, error: 'User not found.' });
  }

  // -------------------------------------------------
  // Validate incoming fields (basic)
  // -------------------------------------------------
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Invalid e‑mail address.' });
  }
  if (password && password.length < 8) {
    return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters.' });
  }

  const user = users[idx];
  const updates = {};

  if (name)   updates.name = name.trim();
  if (email)  updates.email = email.trim().toLowerCase();

  // Only admins can change a user’s role
  if (role && isAdmin(requester)) {
    updates.role = role;                 // e.g. 'admin' or 'user'
  }

  // If password is supplied we store a bcrypt hash
  if (password) {
    updates.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  }

  // Timestamp
  updates.updatedAt = new Date().toISOString();

  // Apply updates
  users[idx] = { ...user, ...updates };
  await writeDBAtomic(users);

  const { passwordHash, ...safeUser } = users[idx];
  res.json({ ok: true, user: safeUser });
}

/* -----------------------------------------------------------------
   4️⃣ DELETE USER (admin only) – also used for self‑deletion if you wish
   ----------------------------------------------------------------- */
async function deleteUser(req, res) {
  const { id } = req.params;
  const requester = req.user;

  // Admins can delete anyone; users can delete themselves (optional)
  const canDelete = isAdmin(requester) || (requester && requester.id === id);
  if (!canDelete) {
    return res.status(403).json({ ok: false, error: 'Access denied.' });
  }

  const users = await loadUsers();
  const filtered = users.filter(u => u.id !== id);

  if (filtered.length === users.length) {
    return res.status(404).json({ ok: false, error: 'User not found.' });
  }

  await writeDBAtomic(filtered);

  // If the deleted user had a session, destroy it (Express‑session does this automatically
  // on the next request because the session store no longer contains the id,
  // but we can also clear the cookie for a cleaner UX.)
  if (req.session && req.session.userId === id) {
    req.session.destroy(err => {
      if (err) console.error('❌  Session destroy error (deleteUser):', err);
    });
    res.clearCookie('connect.sid', { path: '/' });
  }

  res.json({ ok: true, message: 'User deleted.' });
}

// ------------------------------------------------------------------
// Export everything wrapped with asyncHandler so the central error‑handler
// catches any uncaught promise rejection.
// ------------------------------------------------------------------
module.exports = {
  listUsers: asyncHandler(listUsers),
  getUser:   asyncHandler(getUser),
  updateUser: asyncHandler(updateUser),
  deleteUser: asyncHandler(deleteUser),
};
