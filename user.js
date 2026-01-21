/**
 * routes/user.js
 * ------------------------------------------------------------
 * Router for CRUD operations on the “users” resource.
 *
 * End‑points (mounted in server.js under /api/users):
 *
 *   GET    /                 → listUsers   (admin only)
 *   GET    /:id              → getUser     (self or admin)
 *   PUT    /:id              → updateUser  (self or admin)
 *   DELETE /:id              → deleteUser  (self or admin)
 *
 * All routes except the public list are protected by the
 * `authenticate` middleware (session first, then JWT).
 * ------------------------------------------------------------
 */

const express   = require('express');
const { body, validationResult } = require('express-validator');

// -----------------------------------------------------------------
// 1️⃣  Auth middleware (same one exported from routes/auth.js)
// -----------------------------------------------------------------
const { authenticate } = require('./auth');

// -----------------------------------------------------------------
// 2️⃣  Admin‑only guard (re‑uses the same logic that the controller
//      uses – role === 'admin' OR email ends with @admin.com)
// -----------------------------------------------------------------
function adminOnly(req, res, next) {
  const user = req.user; // set by `authenticate`

  const isAdmin =
    (user && user.role === 'admin') ||
    (user && typeof user.email === 'string' && user.email.endsWith('@admin.com'));

  if (!isAdmin) {
    return res.status(403).json({ ok: false, error: 'Admin privileges required.' });
  }
  next();
}

// -----------------------------------------------------------------
// 3️⃣  Controller functions (business logic)
// -----------------------------------------------------------------
const {
  listUsers,
  getUser,
  updateUser,
  deleteUser,
} = require('../controllers/userController');

// -----------------------------------------------------------------
// 4️⃣  Validation chain for updating a user
// -----------------------------------------------------------------
const validateUpdate = [
  // name – optional but if present must not be empty
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Name cannot be empty.'),

  // email – optional, must be a valid e‑mail if supplied
  body('email')
    .optional()
    .trim()
    .isEmail()
    .withMessage('A valid e‑mail address is required.')
    .normalizeEmail(),

  // password – optional, minimum 8 chars
  body('password')
    .optional()
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long.'),

  // role – only an admin may change it (the controller will ignore it for non‑admins)
  body('role')
    .optional()
    .isIn(['admin', 'user'])
    .withMessage('Role must be either "admin" or "user".'),

  // final step – if any validation failed, respond with the first error
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ ok: false, error: errors.array()[0].msg });
    }
    next();
  },
];

// -----------------------------------------------------------------
// 5️⃣  Build the router
// -----------------------------------------------------------------
const router = express.Router();

/**
 *  📋  ADMIN‑ONLY LIST ALL USERS
 */
router.get('/',        authenticate, adminOnly, listUsers);

/**
 *  📋  GET SINGLE USER – self or admin
 */
router.get('/:id',     authenticate, getUser);

/**
 *  📋  UPDATE USER – self or admin (payload validated by `validateUpdate`)
 */
router.put('/:id',     authenticate, validateUpdate, updateUser);

/**
 *  📋  DELETE USER – self or admin
 */
router.delete('/:id',  authenticate, deleteUser);

// -----------------------------------------------------------------
// 6️⃣  Export the router (named export to keep consistency with other routers)
// -----------------------------------------------------------------
module.exports = {
  userRouter: router,
};
