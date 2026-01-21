/**
 * controllers/lotteryController.js
 * -------------------------------------------------------------
 * Business‑logic layer for the lottery feature.
 *
 * All data lives in a single JSON file:  data/lottery.json
 *   {
 *     "draws":   [ {id, numbers, date} , … ],
 *     "tickets": [ {id, userId, numbers, drawId, purchasedAt}, … ]
 *   }
 *
 * The functions below are exported as Express route handlers.
 * -------------------------------------------------------------
 */

const { v4: uuidv4 } = require('uuid');
const path            = require('path');
const fs              = require('fs').promises;

const {
  readJSON,
  writeJSON,
} = require('../utils/readWriteJSON');

// ------------------------------------------------------------------
// Path to the lottery “database” (JSON file)
// ------------------------------------------------------------------
const LOTTERY_DB = path.join(__dirname, '..', 'data', 'lottery.json');

// ------------------------------------------------------------------
// Configurable limits (can be overridden via env)
// ------------------------------------------------------------------
const MAX_TICKETS_PER_DRAW = Number(process.env.MAX_TICKETS_PER_DRAW) || 1000;
const MAX_TICKETS_PER_USER = Number(process.env.MAX_TICKETS_PER_USER) || 100;

// ------------------------------------------------------------------
// Simple async‑error‑wrapper – use it on every exported handler
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
// Helper – ensure the JSON file exists and has the correct shape
// ------------------------------------------------------------------
async function loadDB() {
  const empty = { draws: [], tickets: [] };
  try {
    const data = await readJSON(LOTTERY_DB);
    return data ?? empty;
  } catch (e) {
    // If the file is corrupted we start fresh – but log it.
    console.error('⚠️  lottery DB corrupted – resetting', e);
    return empty;
  }
}

/**
 * Helper – atomic write with a tiny in‑memory lock.
 * This prevents two simultaneous requests from overwriting each other.
 */
let pendingWrite = Promise.resolve(); // resolves when the previous write finished
async function writeDBAtomic(payload) {
  // queue every write after the previous one
  pendingWrite = pendingWrite.then(() => writeJSON(LOTTERY_DB, payload));
  await pendingWrite;
}

// ------------------------------------------------------------------
// Helper – generate a 6‑number ticket (1‑49, no duplicates)
// ------------------------------------------------------------------
function generateTicketNumbers() {
  const numbers = new Set();
  while (numbers.size < 6) {
    numbers.add(Math.floor(Math.random() * 49) + 1); // 1‑49 inclusive
  }
  // Return a sorted array for nicer output
  return Array.from(numbers).sort((a, b) => a - b);
}

// ------------------------------------------------------------------
// Helper – count matching numbers between two arrays
// ------------------------------------------------------------------
function countMatches(ticketNumbers, drawNumbers) {
  const drawSet = new Set(drawNumbers);
  return ticketNumbers.filter(n => drawSet.has(n)).length;
}

// ------------------------------------------------------------------
// Helper – simple prize string based on match count
// ------------------------------------------------------------------
function prizeFromMatches(matches) {
  switch (matches) {
    case 6: return 'Jackpot!';
    case 5: return 'Big prize';
    case 4: return 'Small prize';
    default: return 'No prize';
  }
}

// ------------------------------------------------------------------
// Helper – admin check (role from session or email suffix as fallback)
// ------------------------------------------------------------------
function isAdmin(user) {
  if (!user) return false;
  // Prefer a proper role field (e.g. set in authController)
  if (user.role) return user.role === 'admin';
  // Legacy fallback – email ending with @admin.com
  return typeof user.email === 'string' && user.email.endsWith('@admin.com');
}

/* -----------------------------------------------------------------
   1️⃣ BUY A TICKET (authenticated)
   ----------------------------------------------------------------- */
async function buyTicket(req, res) {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentication required' });
  }

  const db = await loadDB();

  // ---- Enforce per‑draw ticket limit ---------------------------------
  const ticketsWithoutDraw = db.tickets.filter(t => t.drawId === null);
  if (ticketsWithoutDraw.length >= MAX_TICKETS_PER_DRAW) {
    return res.status(429).json({
      ok: false,
      error: `Maximum of ${MAX_TICKETS_PER_DRAW} pending tickets reached. Try later.`,
    });
  }

  // ---- Enforce per‑user limit (only on tickets that are still pending) ----
  const myPending = ticketsWithoutDraw.filter(t => t.userId === userId);
  if (myPending.length >= MAX_TICKETS_PER_USER) {
    return res.status(429).json({
      ok: false,
      error: `You already have ${MAX_TICKETS_PER_USER} pending tickets.`,
    });
  }

  const numbers = generateTicketNumbers();

  const newTicket = {
    id: uuidv4(),
    userId,
    numbers,
    drawId: null, // will be filled when a draw occurs
    purchasedAt: new Date().toISOString(),
  };

  db.tickets.push(newTicket);
  await writeDBAtomic(db);

  res.status(201).json({
    ok: true,
    message: 'Ticket purchased successfully.',
    ticket: newTicket,
  });
}

/* -----------------------------------------------------------------
   2️⃣ LIST MY TICKETS (authenticated) – optional pagination
   ----------------------------------------------------------------- */
async function myTickets(req, res) {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentication required' });
  }

  const db = await loadDB();
  const myAll = db.tickets.filter(t => t.userId === userId);

  // ---- Pagination support (query ?page=1&limit=20) ----------------------
  const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.max(1, parseInt(req.query.limit, 10) || 20);
  const start = (page - 1) * limit;
  const paged = myAll.slice(start, start + limit);

  res.json({
    ok: true,
    page,
    limit,
    totalTickets: myAll.length,
    tickets: paged,
  });
}

/* -----------------------------------------------------------------
   3️⃣ RUN A DRAW (admin only)
   ----------------------------------------------------------------- */
async function draw(req, res) {
  // ---- Admin check ----------------------------------------------------
  if (!isAdmin(req.user)) {
    return res.status(403).json({ ok: false, error: 'Admin privileges required.' });
  }

  const db = await loadDB();

  // ---- Guard: do not allow a new draw if a previous “open” draw still has pending tickets.
  const openDraw = db.draws.find(d => !db.tickets.some(t => t.drawId === d.id));
  if (openDraw) {
    // This means there are tickets that have not been assigned yet – we keep the old draw open.
    return res.status(400).json({
      ok: false,
      error: 'There is already an active draw awaiting tickets.',
    });
  }

  const newDraw = {
    id: uuidv4(),
    numbers: generateTicketNumbers(),
    date: new Date().toISOString(),
  };
  db.draws.push(newDraw);

  // Associate every ticket that hasn't been drawn yet with this draw
  db.tickets.forEach(ticket => {
    if (ticket.drawId === null) ticket.drawId = newDraw.id;
  });

  await writeDBAtomic(db);

  res.status(201).json({
    ok: true,
    message: 'New draw created.',
    draw: newDraw,
  });
}

/* -----------------------------------------------------------------
   4️⃣ LIST ALL DRAWS (public – no auth required)
   ----------------------------------------------------------------- */
async function listDraws(req, res) {
  const db = await loadDB();
  // Return draws sorted most‑recent first
  const draws = db.draws
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  res.json({ ok: true, draws });
}

/* -----------------------------------------------------------------
   5️⃣ GET RESULTS FOR A SPECIFIC DRAW (authenticated)
   ----------------------------------------------------------------- */
async function results(req, res) {
  const { drawId } = req.params;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Authentication required' });
  }

  const db = await loadDB();

  const draw = db.draws.find(d => d.id === drawId);
  if (!draw) {
    return res.status(404).json({ ok: false, error: 'Draw not found.' });
  }

  // Grab only the tickets belonging to the logged‑in user for this draw
  const myTickets = db.tickets.filter(
    t => t.userId === userId && t.drawId === drawId
  );

  const detailedResults = myTickets.map(t => {
    const matches = countMatches(t.numbers, draw.numbers);
    return {
      ticketId: t.id,
      numbers:  t.numbers,
      matches,
      prize: prizeFromMatches(matches),
    };
  });

  res.json({
    ok: true,
    draw: {
      id: draw.id,
      numbers: draw.numbers,
      date: draw.date,
    },
    myResults: detailedResults,
  });
}

/* -----------------------------------------------------------------
   Export everything wrapped with asyncHandler so the central
   error‑handler catches any uncaught promise rejection.
   ----------------------------------------------------------------- */
module.exports = {
  buyTicket:    asyncHandler(buyTicket),
  myTickets:    asyncHandler(myTickets),
  draw:         asyncHandler(draw),
  listDraws:    asyncHandler(listDraws),
  results:      asyncHandler(results),
};
