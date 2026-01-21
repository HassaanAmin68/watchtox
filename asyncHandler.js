/**
 * asyncHandler(fn)
 * ----------------
 * Wrap an async route/controller so that any thrown error is passed to
 * Express's next(err) automatically.
 *
 * Usage:
 *   router.get('/foo', asyncHandler(fooController));
 */
module.exports = function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
