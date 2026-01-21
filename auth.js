/**
 * routes/auth.js
 * --------------------------------------------------------------
 * Router that wires the auth controller functions and exports a
 * JWT‑verification / session‑verification middleware for reuse
 * in other routers.
 * --------------------------------------------------------------
 */

const express = require('express');
const jwt     = require('jsonwebtoken');          // keep for JWT verification
const rateLimit = require('express-rate-limit');

// -----------------------------------------------------------------
// 1️⃣ Pull the controller functions (they live in controllers/authController.js)
// -----------------------------------------------------------------
const {
  register,   // POST /register
  login,      // POST /login
  getMe,      // GET  /me   (protected)
  logout,     // POST /logout  (protected)
} = require('../controllers/authController');

// -----------------------------------------------------------------
// 2️⃣ Validation helpers
// -----------------------------------------------------------------
const { body, validationResult } = require('express-validator');

// ── Rate limiting for the login endpoint (adjust numbers to your traffic)
//    5 attempts per 5 minutes from the same IP → 429 Too Many Requests
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  message: { ok: false, error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// -----------------------------------------------------------------
// 3️⃣ Middleware – verify JWT **or** session & attach decoded payload to req.user
// -----------------------------------------------------------------
function authenticate(req, res, next) {
  // -------------------------------------------------
  // 1️⃣ Try server‑side session first (fast, no crypto)
  // -------------------------------------------------
  if (req.session && req.session.userId) {
    req.user = {
      id:    req.session.userId,
      email: req.session.email,    // optional – you may have stored it at login
      name:  req.session.username,
      role:  req.session.role,
    };
    return next();
  }

  // -------------------------------------------------
  // 2️⃣ Fall back to JWT in the Authorization header
  // -------------------------------------------------
  const authHeader = req.headers['authorization']; // “Bearer <token>”
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Missing authentication token' });
  }

  const JWT_SECRET = process.env.JWT_SECRET || '🔑_dev_secret_change_me';

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ ok: false, error: 'Invalid or expired token' });
    }
    req.user = decoded; // payload we signed in authController.generateToken()
    next();
  });
}

// -----------------------------------------------------------------
// 4️⃣ Validation chains for register & login
// -----------------------------------------------------------------
const validateRegister = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('A valid e‑mail address is required')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long'),
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ ok: false, error: errors.array()[0].msg });
    }
    next();
  },
];

const validateLogin = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('A valid e‑mail address is required')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ ok: false, error: errors.array()[0].msg });
    }
    next();
  },
];

// -----------------------------------------------------------------
// 5️⃣ Build the router and wire the endpoints
// -----------------------------------------------------------------
const router = express.Router();

// PUBLIC – no session/JWT required
router.post('/register', validateRegister, register);
router.post('/login',    loginLimiter, validateLogin, login);

// PROTECTED – requires a valid session *or* a JWT
router.get('/me',      authenticate, getMe);
router.post('/logout', authenticate, logout);   // <-- protected logout

// -----------------------------------------------------------------
// 6️⃣ Export router & the auth middleware (for other routers to reuse)
// -----------------------------------------------------------------
module.exports = {
  authRouter: router,   // usage: app.use('/api/auth', authRouter);
  authenticate,         // preferred name – checks session first, then JWT
};
