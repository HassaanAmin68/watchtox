/**
 * utils/readWriteJSON.js
 * -------------------------------------------------------------
 * Tiny helper that reads and writes JSON files using the async
 * `fs.promises` API.
 *
 * • readJSON(filePath)   → returns parsed object or null if the file
 *                         does not exist / is malformed.
 * • writeJSON(filePath, data) → writes pretty‑printed JSON,
 *                         creates the containing folder if needed.
 *
 * Both functions throw on genuine I/O errors so that your
 * global error‑handler (express‑async‑errors) can catch them.
 * -------------------------------------------------------------
 */

const fs   = require('fs').promises;
const path = require('path');

/**
 * Debug helper – controlled via the env var `DEBUG_JSON`.
 * Set `DEBUG_JSON=true` in your .env or terminal to see console logs.
 */
function debug(...args) {
  if (process.env.DEBUG_JSON) {
    console.log('[json]', ...args);
  }
}

/**
 * Read a JSON file.
 *
 * @param {string} filePath – absolute path to the JSON file.
 * @returns {Promise<null|any>} Parsed JSON object, or `null` if the
 *                               file does not exist or cannot be parsed.
 */
async function readJSON(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    // --------------------------------------------------------------
    // - ENOENT  → file simply doesn't exist – treat as empty DB.
    // - SyntaxError (JSON.parse) → malformed → also treat as empty.
    // - Anything else → re‑throw so the caller knows something is wrong.
    // --------------------------------------------------------------
    if (err.code === 'ENOENT') {
      debug('readJSON – file not found, returning null →', filePath);
      return null;
    }

    if (err instanceof SyntaxError) {
      debug('readJSON – malformed JSON, returning null →', filePath);
      return null;
    }

    // Unexpected error – let it bubble up to the global error handler.
    throw err;
  }
}

/**
 * Write data to a JSON file (pretty‑printed, 2‑space indentation).
 *
 * @param {string} filePath – absolute path where the file should be written.
 * @param {any} data        – any JSON‑serialisable value.
 * @returns {Promise<void>}
 */
async function writeJSON(filePath, data) {
  try {
    // Ensure the target directory exists.
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    const json = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, json, 'utf8');
    debug('writeJSON – wrote', filePath);
  } catch (err) {
    // If we cannot write the file, surface the error – the global
    // error‑handler will turn it into a 500 JSON response.
    debug('writeJSON – error', err);
    throw err;
  }
}

module.exports = {
  readJSON,
  writeJSON,
};
