/*====================================================================
  public/js/main.js
  ---------------------------------------------------------------
  Front‑end helper for the WatchTox demo app.
  • Handles registration, login, logout.
  • Stores the JWT in localStorage.
  • Provides thin wrappers around the lottery API.
  • Simple DOM utilities – you only need to give your markup the
    IDs/classes referenced in the code (see the comments).
  ----------------------------------------------------------------- */
(() => {
  /* --------------------------------------------------------------
     1️⃣  Configuration & small utilities
     -------------------------------------------------------------- */
  const API_ROOT   = '/api';                     // all endpoints live under this prefix
  const TOKEN_KEY  = 'watchtox_jwt';             // key used in localStorage
  const JWT_SECRET = null; // we never verify the secret client‑side – only decode payload

  // -----------------------------------------------------------------
  // Token storage helpers (localStorage)
  // -----------------------------------------------------------------
  const tokenStore = {
    set(t)    { localStorage.setItem(TOKEN_KEY, t); },
    get()     { return localStorage.getItem(TOKEN_KEY); },
    clear()   { localStorage.removeItem(TOKEN_KEY); },
    exists()  { return !!this.get(); },
  };

  // -----------------------------------------------------------------
  // Decode a JWT payload (no verification – just base64 decode). Handy to
  // read `exp` and auto‑logout when the token is expired.
  // -----------------------------------------------------------------
  function decodeJwt(token) {
    try {
      const payload = token.split('.')[1];
      const json    = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  // -----------------------------------------------------------------
  // Wrapper around fetch that automatically adds the Authorization header
  // and always expects JSON. Throws an Error object that contains
  // `status` and `body` (the parsed JSON) – the UI shows the message.
  // -----------------------------------------------------------------
  async function authFetch(url, options = {}) {
    const opts = { ...options };
    const token = tokenStore.get();

    // Add JWT header if we have a token
    if (token) {
      opts.headers = {
        ...(opts.headers || {}),
        Authorization: `Bearer ${token}`,
      };
    }

    // Force JSON request/response
    opts.headers = {
      ...(opts.headers || {}),
      'Content-Type': 'application/json',
      Accept:        'application/json',
    };

    let response;
    try {
      response = await fetch(url, opts);
    } catch (netErr) {
      // network‑level failure (offline, CORS, etc.)
      const err = new Error('Network error – please check your connection');
      err.status = 0;
      err.body   = null;
      throw err;
    }

    const data = await response.json();

    if (!response.ok) {
      const err = new Error(data.error || 'Request failed');
      err.status = response.status;
      err.body   = data;
      throw err;
    }

    return data;
  }

  // -----------------------------------------------------------------
  // Tiny DOM shortcuts
  // -----------------------------------------------------------------
  const $  = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  // -----------------------------------------------------------------
  // UI Helpers
  // -----------------------------------------------------------------
  function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.textContent = msg;
    el.className = `toast toast-${type}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // Simple helper to disable/enable a button while async work runs
  async function withSpinner(btn, fn) {
    btn.disabled = true;
    btn.classList.add('spinner'); // you can style .spinner if you want
    try {
      await fn();
    } finally {
      btn.disabled = false;
      btn.classList.remove('spinner');
    }
  }

  // -----------------------------------------------------------------
  // Password‑visibility toggles (register & login)
  // -----------------------------------------------------------------
  function addPasswordToggle(inputEl) {
    // Create the eye‑icon element
    const toggle = document.createElement('span');
    toggle.className = 'pwd-toggle';
    toggle.innerHTML = '👁️';
    toggle.style.cursor = 'pointer';
    toggle.title = 'Show / hide password';
    toggle.style.marginLeft = '4px';

    // Insert after the input
    inputEl.parentNode.insertBefore(toggle, inputEl.nextSibling);

    // Click handler
    toggle.addEventListener('click', () => {
      const isHidden = inputEl.type === 'password';
      inputEl.type = isHidden ? 'text' : 'password';
      toggle.textContent = isHidden ? '🙈' : '👁️';
    });
  }

  // -----------------------------------------------------------------
  // 2️⃣  AUTH LOGIC
  // -----------------------------------------------------------------
  async function registerUser({ name, email, password }) {
    const data = await authFetch(`${API_ROOT}/auth/register`, {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });
    tokenStore.set(data.token);
    return data.user;
  }

  async function loginUser({ email, password }) {
    const data = await authFetch(`${API_ROOT}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    tokenStore.set(data.token);
    return data.user;
  }

  async function logout() {
    tokenStore.clear();
    // optional server call – harmless if endpoint missing
    await authFetch(`${API_ROOT}/auth/logout`, { method: 'POST' }).catch(() => {});
  }

  async function fetchCurrentUser() {
    if (!tokenStore.exists()) return null;
    // Auto‑logout if token is expired
    const payload = decodeJwt(tokenStore.get());
    if (payload && payload.exp && payload.exp * 1000 < Date.now()) {
      await logout();
      return null;
    }
    const data = await authFetch(`${API_ROOT}/auth/me`);
    return data.user;
  }

  // -----------------------------------------------------------------
  // 3️⃣  LOTTERY LOGIC  (unchanged, just tiny wrappers)
  // -----------------------------------------------------------------
  async function buyTicket() {
    return (await authFetch(`${API_ROOT}/lottery/tickets`, { method: 'POST' })).ticket;
  }
  async function getMyTickets() {
    return (await authFetch(`${API_ROOT}/lottery/tickets`)).tickets;
  }
  async function runDraw() {
    return (await authFetch(`${API_ROOT}/lottery/draw`, { method: 'POST' })).draw;
  }
  async function getAllDraws() {
    return (await authFetch(`${API_ROOT}/lottery/draws`)).draws;
  }
  async function getResults(drawId) {
    return await authFetch(`${API_ROOT}/lottery/results/${drawId}`);
  }

  // -----------------------------------------------------------------
  // 4️⃣  UI RENDERING
  // -----------------------------------------------------------------
  async function renderCurrentUser() {
    const container = $('#currentUser');
    if (!container) return;

    const user = await fetchCurrentUser();

    if (user) {
      container.innerHTML = `
        <span>Hello, <strong>${user.name}</strong></span>
        <button id="logoutBtn" class="btn btn-outline">Logout</button>
      `;
      $('#logoutBtn').addEventListener('click', async () => {
        await logout();
        location.reload();
      });
    } else {
      container.innerHTML = `<a href="#login" class="btn btn-primary">Login / Register</a>`;
    }
  }

  async function renderMyTickets() {
    const listEl = $('#myTickets');
    if (!listEl) return;
    try {
      const tickets = await getMyTickets();
      if (!tickets.length) {
        listEl.innerHTML = '<p>No tickets yet. Buy one!</p>';
        return;
      }
      listEl.innerHTML = tickets
        .map(t => `
          <div class="card mb-2">
            <div class="card-body">
              <strong>Ticket #${t.id.slice(0, 8)}…</strong><br>
              Numbers: ${t.numbers.join(', ')}<br>
              ${t.drawId
                ? `<small>Already in draw ${t.drawId.slice(0, 8)}…</small>`
                : '<small>Not drawn yet</small>'}
            </div>
          </div>
        `)
        .join('');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  async function renderDraws() {
    const listEl = $('#drawList');
    if (!listEl) return;
    try {
      const draws = await getAllDraws();
      if (!draws.length) {
        listEl.innerHTML = '<p>No draws have happened yet.</p>';
        return;
      }
      listEl.innerHTML = draws
        .map(d => `
          <div class="card mb-2">
            <div class="card-body">
              <strong>Draw ${d.id.slice(0, 8)}…</strong><br>
              Numbers: ${d.numbers.join(', ')}<br>
              <small>${new Date(d.date).toLocaleString()}</small><br>
              <button class="btn btn-outline btn-sm view-results"
                      data-draw="${d.id}">View My Results</button>
            </div>
          </div>
        `)
        .join('');

      // attach click listeners for result buttons
      $$('.view-results').forEach(btn => {
        btn.addEventListener('click', async e => {
          const drawId = e.currentTarget.dataset.draw;
          try {
            const res = await getResults(drawId);
            renderResultsModal(res);
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function renderResultsModal({ draw, myResults }) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <div class="modal-header">Results for draw ${draw.id.slice(0,8)}…</div>
        <div class="modal-body">
          <p>Winning numbers: <strong>${draw.numbers.join(', ')}</strong></p>
          <hr>
          ${myResults.length === 0
            ? '<p>You had no tickets in this draw.</p>'
            : myResults
                .map(r => `
                  <div class="card mb-2">
                    <div class="card-body">
                      Ticket ${r.ticketId.slice(0,8)}… – Numbers: ${r.numbers.join(', ')}<br>
                      Matches: ${r.matches} – <strong>${r.prize}</strong>
                    </div>
                  </div>
                `)
                .join('')}
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="closeResultModal">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    $('#closeResultModal').addEventListener('click', () => backdrop.remove());
  }

  async function renderAdminControls() {
    const adminBox = $('#adminControls');
    if (!adminBox) return;

    const user = await fetchCurrentUser();
    const isAdmin = user && typeof user.email === 'string' && user.email.endsWith('@admin.com');

    if (!isAdmin) {
      adminBox.innerHTML = '';
      return;
    }

    adminBox.innerHTML = `
      <button id="runDrawBtn" class="btn btn-primary">Run New Draw (Admin)</button>
    `;
    $('#runDrawBtn').addEventListener('click', async () => {
      try {
        const draw = await runDraw();
        toast(`New draw created! Numbers: ${draw.numbers.join(', ')}`, 'success');
        await renderDraws();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  // -----------------------------------------------------------------
  // 5️⃣  Auth‑form wiring (register & login)
  // -----------------------------------------------------------------
  function bindAuthForms() {
    // ---- Register ----------------------------------------------------
    const regForm = $('#registerForm');
    if (regForm) {
      // Add the password‑toggle *once* when the page loads
      const pwdInput = $('#regPassword');
      if (pwdInput) addPasswordToggle(pwdInput);

      regForm.addEventListener('submit', async e => {
        e.preventDefault();

        const btn = regForm.querySelector('button[type="submit"]');
        await withSpinner(btn, async () => {
          const name     = $('#regName').value.trim();
          const email    = $('#regEmail').value.trim();
          const password = $('#regPassword').value;

          await registerUser({ name, email, password });
          toast('Registration successful – you are now logged in', 'success');
          await renderCurrentUser();
          await renderMyTickets();
          await renderAdminControls();
          regForm.reset();
        });
      });
    }

    // ---- Login -------------------------------------------------------
    const loginForm = $('#loginForm');
    if (loginForm) {
      const pwdInput = $('#loginPassword');
      if (pwdInput) addPasswordToggle(pwdInput);

      loginForm.addEventListener('submit', async e => {
        e.preventDefault();

        const btn = loginForm.querySelector('button[type="submit"]');
        await withSpinner(btn, async () => {
          const email    = $('#loginEmail').value.trim();
          const password = $('#loginPassword').value;

          await loginUser({ email, password });
          toast('Logged in successfully', 'success');
          await renderCurrentUser();
          await renderMyTickets();
          await renderAdminControls();
          loginForm.reset();
        });
      });
    }
  }

  // -----------------------------------------------------------------
  // 6️⃣  Initialise everything on DOMContentLoaded
  // -----------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', async () => {
    // Render UI that depends on auth state
    await renderCurrentUser();
    await renderMyTickets();
    await renderAdminControls();

    // Public lottery UI
    await renderDraws();

    // Wire the forms
    bindAuthForms();

    // “Buy ticket” button – only visible to logged‑in users
    const buyBtn = $('#buyTicketBtn');
    if (buyBtn) {
      buyBtn.addEventListener('click', async () => {
        try {
          const ticket = await buyTicket();
          toast(`Ticket bought! Numbers: ${ticket.numbers.join(', ')}`, 'success');
          await renderMyTickets();
        } catch (e) {
          toast(e.message, 'error');
        }
      });
    }
  });

  /* --------------------------------------------------------------
     7️⃣  Minimal CSS for toasts & password‑toggle UI
     -------------------------------------------------------------- */
  const style = document.createElement('style');
  style.textContent = `
    .toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      padding: .75rem 1.5rem;
      background: rgba(0,0,0,.75);
      color: #fff;
      border-radius: var(--radius-sm);
      font-size: .95rem;
      z-index: 9999;
      opacity: 0;
      animation: toastFade .3s forwards;
    }
    .toast-success { background: #4caf50; }
    .toast-error   { background: #e53935; }
    .toast-info    { background: #2196f3; }

    @keyframes toastFade { to { opacity: 1; } }

    .pwd-toggle {
      user-select: none;
      font-size: 1.1rem;
      vertical-align: middle;
    }

    .spinner {
      cursor: progress;
      opacity: .6;
    }
  `;
  document.head.appendChild(style);
})();
