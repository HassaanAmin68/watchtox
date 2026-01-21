/**
 * routes/lottery.js
 * ------------------------------------------------------------
 * Thin router that delegates all business logic to
 * controllers/lotteryController.js.
 *
 * End‑points (mounted in server.js under /api/lottery):
 *
 *   POST   /tickets                 → buyTicket   (auth required)
 *   GET    /tickets                 → myTickets   (auth required)
 *   POST   /draw                    → draw        (auth + admin check)
 *   GET    /draws                   → listDraws   (public)
 *   GET    /results/:drawId         → results     (auth required)
 * ------------------------------------------------------------
 */

const express   = require('express');
const rateLimit = require('express-rate-limit');

// -----------------------------------------------------------------
// 1️⃣  Auth middleware (same one exported from routes/auth.js)
// -----------------------------------------------------------------
const { authenticate } = require('./auth');   // ← checks session first, then JWT

// -----------------------------------------------------------------
// 2️⃣  Optional admin guard – re‑uses the same logic that
//     `isAdmin` in lotteryController uses (role field or @admin.com suffix)
// -----------------------------------------------------------------
function adminOnly(req, res, next) {
  const user = req.user; // set by `authenticate`

  // The controller already does this check, but we add it here to
  // short‑circuit the request before any heavy DB work.
  const isAdmin =
    (user && user.role === 'admin') ||
    (user && typeof user.email === 'string' && user.email.endsWith('@admin.com'));

  if (!isAdmin) {
    return res.status(403).json({
      ok: false,
      error: 'Admin privileges required to run a draw.',
    });
  }
  next();
}

// -----------------------------------------------------------------
// 3️⃣  Controller functions (business logic)
// -----------------------------------------------------------------
const {
  buyTicket,   // POST /tickets
  myTickets,   // GET  /tickets
  draw,        // POST /draw   (admin only – double‑checked)
  listDraws,   // GET  /draws
  results,     // GET  /results/:drawId
} = require('../controllers/lotteryController');

// -----------------------------------------------------------------
// 4️⃣  Rate limiting (optional but useful)
// -----------------------------------------------------------------
// Limit ticket purchases to 20 per 10 minutes from a single IP
const ticketLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 20,
  message: { ok: false, error: 'Too many ticket purchases – please wait a while.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// -----------------------------------------------------------------
// 5️⃣  Build the router
// -----------------------------------------------------------------
const router = express.Router();

// ---- Protected routes (require a valid JWT or session) ----
router.post('/tickets', authenticate, ticketLimiter, buyTicket);
router.get('/tickets',  authenticate, myTickets);
router.post('/draw',    authenticate, adminOnly, draw);
router.get('/results/:drawId', authenticate, results);

// ---- Public route (no auth needed) ----
router.get('/draws', listDraws);

// -----------------------------------------------------------------
// 6️⃣  Export
// -----------------------------------------------------------------
module.exports = {
  lotteryRouter: router,
};
