/**
 * authMiddleware.js
 * -----------------
 * 1️⃣ isAuthenticated – blocks every request that does NOT have a valid
 *    session (i.e. `req.session.userId` is missing).
 *
 * 2️⃣ hasRole(role) – optional role‑based guard.  Your user objects can
 *    contain a `role` property (e.g. 'admin', 'editor', 'user').
 *
 * 3️⃣ refreshSession – re‑issues the cookie if the session is still valid
 *    but the client hasn't sent a request for longer than `maxAge / 2`.
 *    This prevents the user from being logged out while actively using the
 *    app (sliding‑expiration pattern).
 *
 * All functions are exported as named properties, so you can import only
 * what you need:
 *
 *   const { isAuthenticated, hasRole, refreshSession } = require('../middlewares/authMiddleware');
 */
const ms = require('ms'); // optional, for human‑readable time (npm i ms)

// ---------------------------------------------------------------------
// 1️⃣  Simple auth guard – put it before any route that needs a logged‑in user
// ---------------------------------------------------------------------
function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    // optionally attach a tiny `req.user` object if you stored it in the session
    if (req.session.user) req.user = req.session.user;
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized – please log in' });
}

// ---------------------------------------------------------------------
// 2️⃣  Role guard – usage:  router.post('/admin', isAuthenticated, hasRole('admin'), …)
// ---------------------------------------------------------------------
function hasRole(requiredRole) {
  return (req, res, next) => {
    // we expect the role to be stored in the session (or you could fetch from DB)
    const user = req.session?.user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (user.role !== requiredRole) {
      return res.status(403).json({ error: 'Forbidden – insufficient privileges' });
    }
    next();
  };
}

// ---------------------------------------------------------------------
// 3️⃣  Sliding‑expiration helper – call it at the very top of any
//     route that you want to keep alive while the user is active.
// ---------------------------------------------------------------------
function refreshSession(req, res, next) {
  if (req.session && req.session.cookie && req.session.userId) {
    const maxAge = req.session.cookie.maxAge; // ms
    const now = Date.now();

    // If more than half the lifetime passed, reset the expiration.
    // (You can change the 0.5 factor to any value you like.)
    if (now - req.session.cookie._expires + maxAge / 2 >= maxAge) {
      // This will reset the Set-Cookie header with a fresh expires time.
      req.session._garbage = Date(); // forces regeneration
      req.session.touch();           // updates the expiration timestamp
    }
  }
  next();
}

// ---------------------------------------------------------------------
// Export the helpers
// ---------------------------------------------------------------------
module.exports = {
  isAuthenticated,
  hasRole,
  refreshSession,
};
