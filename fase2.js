(() => {
  "use strict";

  // ========== CONFIGURACIÓN ANTI-BAN (ULTRA SEGURA) ==========
  const CONFIG = {
    FOLLOW_BATCH_SIZE: 3,
    BATCH_SIZE_VARIATION: 2,
    DELAY_BETWEEN_FOLLOWS: { min: 240000, max: 600000 },   // 4 a 10 min entre acciones
    DELAY_BETWEEN_BATCHES: { min: 1800000, max: 3600000 }, // 30 a 60 min entre lotes
    MAX_FOLLOWS_PER_DAY: 80,
    MAX_FOLLOWS_PER_HOUR: 10,
    RANDOMIZE_ORDER: true,
    SHUFFLE_EVERY_BATCH: true,
    SKIP_PERCENTAGE: 20
  };

  // ========== ESTADO GLOBAL ==========
  const STATE = {
    status: "initial", // "initial", "running", "paused"
    totalLoadedCount: 0,
    pendingToFollow: [],
    completed: [],
    failed: [],
    skipped: [],
    dailyCounter: 0,
    hourlyCounter: 0,
    searchTerm: "",
    csrfToken: "",
    statusText: "System Ready",
    timeRemainingText: "",
    progressPercentage: 0
  };

  // ========== FUNCIONES AUXILIARES & ENGINE HUMANO ==========
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function getRandomJitter() { return Math.floor(Math.random() * 20000) + 5000; }

  function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function getCsrfToken() {
    return document.cookie.match(/csrftoken=([^;]+)/)?.[1] || 
           document.querySelector('meta[name="csrf-token"]')?.content || '';
  }

  function getAvatarUrl(username) {
    return `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(username)}&backgroundColor=0f172a,1f2937,312e81&fontFamily=Verdana`;
  }

  // ========== ESTILOS CSS INYECTADOS (ESTILO DASHBOARD / WORKSPACE) ==========
  function injectStyles() {
    if (document.getElementById("iu-custom-styles")) return;
    const style = document.createElement("style");
    style.id = "iu-custom-styles";
    style.textContent = `
      :root {
        --surface: #151515;
        --surface-raised: #1e1d1a;
        --text: #f7f1e8;
        --muted: #ada79d;
        --line: rgba(247, 241, 232, 0.14);
        --amber: #e0a33a;
        --cyan: #62d6d0;
        --rose: #ef6a62;
        --green: #8ccf7e;
      }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        background: #10100f !important;
        color: var(--text) !important;
        font-family: "Avenir Next", "Segoe UI", sans-serif !important;
        min-height: 100vh;
      }
      .iu-app {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        background: radial-gradient(circle at 15% 20%, rgba(224, 163, 58, 0.12), transparent 32rem),
                    radial-gradient(circle at 86% 12%, rgba(98, 214, 208, 0.1), transparent 30rem),
                    linear-gradient(135deg, #10100f 0%, #191714 52%, #111 100%);
      }
      .iu-header {
        height: 4.5rem;
        background: rgba(18, 17, 15, 0.85);
        border-bottom: 1px solid var(--line);
        backdrop-filter: blur(12px);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 1.5rem;
        position: sticky;
        top: 0;
        z-index: 100;
      }
      .iu-logo {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-family: Georgia, serif;
        font-weight: 700;
        font-size: 1.1rem;
        color: var(--text);
      }
      .iu-logo-badge {
        background: var(--amber);
        color: #111;
        padding: 2px 8px;
        border-radius: 4px;
        font-family: sans-serif;
        font-size: 0.7rem;
        font-weight: 800;
      }
      .iu-search-bar {
        background: rgba(0,0,0,0.4);
        border: 1px solid var(--line);
        color: var(--text);
        padding: 0.5rem 1rem;
        border-radius: 6px;
        width: 220px;
        font-size: 0.85rem;
      }
      .iu-workspace {
        display: grid;
        grid-template-columns: 20rem 1fr;
        flex: 1;
      }
      .iu-sidebar {
        background: rgba(18, 17, 15, 0.75);
        border-right: 1px solid var(--line);
        padding: 1.5rem 1rem;
        display: flex;
        flex-direction: column;
        gap: 1.2rem;
      }
      .iu-panel-title {
        color: var(--muted);
        font-size: 0.75rem;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 0.5rem;
      }
      .iu-metric-card {
        background: hsla(0, 0%, 100%, 0.035);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 0.75rem 1rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .iu-metric-card span { color: var(--muted); font-size: 0.8rem; }
      .iu-metric-card strong { font-size: 1.1rem; color: var(--text); }
      .iu-btn {
        border: 1px solid var(--line);
        background: hsla(0, 0%, 100%, 0.06);
        color: var(--text);
        padding: 0.75rem 1rem;
        border-radius: 8px;
        font-weight: 700;
        font-size: 0.85rem;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
      }
      .iu-btn:hover {
        background: rgba(224, 163, 58, 0.15);
        border-color: rgba(224, 163, 58, 0.4);
      }
      .iu-btn-primary {
        background: var(--amber);
        color: #111;
        border: none;
      }
      .iu-btn-primary:hover { background: #f0b44b; }
      .iu-btn-danger {
        background: rgba(239, 106, 98, 0.15);
        border-color: rgba(239, 106, 98, 0.4);
        color: var(--rose);
      }
      .iu-file-input-wrapper {
        border: 1px dashed var(--line);
        padding: 1rem;
        border-radius: 8px;
        text-align: center;
        background: rgba(0, 0, 0, 0.2);
      }
      .iu-file-input-wrapper input { display: none; }
      .iu-file-label {
        color: var(--cyan);
        cursor: pointer;
        font-size: 0.85rem;
        font-weight: 600;
      }
      .iu-content-area {
        padding: 1.5rem;
        overflow-y: auto;
        max-height: calc(100vh - 4.5rem);
      }
      .iu-progressbar-track {
        height: 6px;
        background: rgba(247, 241, 232, 0.08);
        border-radius: 3px;
        overflow: hidden;
        margin-bottom: 1rem;
      }
      .iu-progressbar-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--amber), var(--cyan));
        width: 0%;
        transition: width 0.3s ease;
      }
      .iu-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 1rem;
      }
      .iu-user-card {
        background: hsla(0, 0%, 100%, 0.045);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 1rem;
        display: flex;
        align-items: center;
        gap: 1rem;
      }
      .iu-avatar {
        width: 3rem;
        height: 3rem;
        border-radius: 8px;
        border: 1px solid var(--line);
      }
      .iu-user-info { display: flex; flex-direction: column; overflow: hidden; }
      .iu-username { font-weight: 700; font-size: 0.95rem; color: var(--text); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }
      .iu-fullname { font-size: 0.8rem; color: var(--muted); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }
      .iu-status-badge {
        margin-left: auto;
        font-size: 0.7rem;
        padding: 3px 8px;
        border-radius: 12px;
        font-weight: 800;
        text-transform: uppercase;
      }
      .badge-pending { background: rgba(98, 214, 208, 0.15); color: var(--cyan); }
      .badge-done { background: rgba(140, 207, 126, 0.15); color: var(--green); }
      .badge-failed { background: rgba(239, 106, 98, 0.15); color: var(--rose); }
      .badge-skipped { background: rgba(224, 163, 58, 0.15); color: var(--amber); }
      .iu-log-box {
        background: #0d0d0c;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 0.75rem;
        height: 140px;
        overflow-y: auto;
        font-family: monospace;
        font-size: 0.75rem;
        color: var(--muted);
        margin-top: 1rem;
      }
    `;
    document.head.appendChild(style);
  }

  // ========== RENDERIZADO DE LA INTERFAZ COMPLETA (DOM REPLACEMENT) ==========
  function mountUI() {
    document.body.innerHTML = "";
    injectStyles();

    const app = document.createElement("div");
    app.className = "iu-app";
    app.innerHTML = `
      <header class="iu-header">
        <div class="iu-logo">
          <svg width="30" height="30" viewBox="0 0 354 354" fill="none">
            <circle cx="177" cy="177" r="177" fill="#e0a33a"/>
            <circle cx="177" cy="115" r="50" fill="#151515"/>
            <ellipse cx="177" cy="243" rx="76" ry="66" fill="#151515"/>
            <rect x="243" y="112" width="66" height="20" rx="10" fill="#62d6d0"/>
          </svg>
          Instagram Auto-Follower
          <span class="iu-logo-badge">JSON DASHBOARD</span>
        </div>
        <input type="text" id="iuSearchInput" class="iu-search-bar" placeholder="Filter loaded users...">
      </header>

      <div class="iu-workspace">
        <aside class="iu-sidebar">
          <div>
            <div class="iu-panel-title">Data Import</div>
            <div class="iu-file-input-wrapper">
              <label for="iuFileInput" class="iu-file-label">📁 Select .JSON Files</label>
              <input type="file" id="iuFileInput" multiple accept=".json">
            </div>
          </div>

          <div>
            <div class="iu-panel-title">Metrics & Status</div>
            <div style="display:flex; flex-direction:column; gap:0.5rem;">
              <div class="iu-metric-card"><span>Total Loaded</span><strong id="iuStatLoaded">0</strong></div>
              <div class="iu-metric-card"><span>Pending</span><strong id="iuStatPending" style="color:var(--cyan)">0</strong></div>
              <div class="iu-metric-card"><span>Followed</span><strong id="iuStatDone" style="color:var(--green)">0</strong></div>
              <div class="iu-metric-card"><span>Failed</span><strong id="iuStatFailed" style="color:var(--rose)">0</strong></div>
            </div>
          </div>

          <div>
            <div class="iu-panel-title">Controls</div>
            <div style="display:flex; flex-direction:column; gap:0.5rem;">
              <button id="iuStartBtn" class="iu-btn iu-btn-primary">▶ Start Execution</button>
              <button id="iuPauseBtn" class="iu-btn">⏸ Pause Process</button>
            </div>
          </div>

          <div style="margin-top:auto;">
            <div class="iu-panel-title">System Activity</div>
            <div class="iu-log-box" id="iuLogBox"></div>
          </div>
        </aside>

        <main class="iu-content-area">
          <div class="iu-progressbar-track">
            <div class="iu-progressbar-fill" id="iuProgressBar"></div>
          </div>
          
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
            <span id="iuStatusMessage" style="font-size:0.9rem; font-weight:700; color:var(--amber);">Awaiting .JSON upload...</span>
            <span id="iuTimeMessage" style="font-size:0.85rem; color:var(--cyan);"></span>
          </div>

          <div class="iu-grid" id="iuUserGrid">
            <!-- User cards dynamically populated here -->
          </div>
        </main>
      </div>
    `;

    document.body.appendChild(app);
    attachEvents();
  }

  function log(msg, color = "var(--muted)") {
    const box = document.getElementById("iuLogBox");
    if (!box) return;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    box.innerHTML += `<div style="color:${color}; margin-bottom:4px;">[${time}] ${msg}</div>`;
    box.scrollTop = box.scrollHeight;
  }

  function updateUI() {
    const loadedEl = document.getElementById("iuStatLoaded");
    const pendingEl = document.getElementById("iuStatPending");
    const doneEl = document.getElementById("iuStatDone");
    const failedEl = document.getElementById("iuStatFailed");
    const barEl = document.getElementById("iuProgressBar");
    const statusEl = document.getElementById("iuStatusMessage");
    const timeEl = document.getElementById("iuTimeMessage");

    if (loadedEl) loadedEl.textContent = STATE.totalLoadedCount;
    if (pendingEl) pendingEl.textContent = STATE.pendingToFollow.length;
    if (doneEl) doneEl.textContent = STATE.completed.length;
    if (failedEl) failedEl.textContent = STATE.failed.length;
    if (barEl) barEl.style.width = `${STATE.progressPercentage}%`;
    if (statusEl) statusEl.textContent = STATE.statusText;
    if (timeEl) timeEl.textContent = STATE.timeRemainingText;

    renderGrid();
  }

  function renderGrid() {
    const grid = document.getElementById("iuUserGrid");
    if (!grid) return;

    const term = STATE.searchTerm.toLowerCase();
    
    // Unificar listas para visualización
    const allUsers = [
      ...STATE.completed.map(u => ({ ...u, statusType: 'done' })),
      ...STATE.failed.map(u => ({ ...u, statusType: 'failed' })),
      ...STATE.skipped.map(u => ({ ...u, statusType: 'skipped' })),
      ...STATE.pendingToFollow.map(u => ({ ...u, statusType: 'pending' }))
    ].filter(u => u.username.toLowerCase().includes(term) || (u.full_name && u.full_name.toLowerCase().includes(term)));

    grid.innerHTML = allUsers.map(u => `
      <div class="iu-user-card">
        <img class="iu-avatar" src="${getAvatarUrl(u.username)}" alt="${u.username}">
        <div class="iu-user-info">
          <span class="iu-username">${u.username}</span>
          <span class="iu-fullname">${u.full_name || 'Instagram User'}</span>
        </div>
        <span class="iu-status-badge badge-${u.statusType}">${u.statusType}</span>
      </div>
    `).join("");
  }

  // ========== BEHAVIOR & API ENGINE ==========
  async function followUser(user) {
    if (Math.random() * 100 < CONFIG.SKIP_PERCENTAGE) {
      log(`⏭️ Skipped @${user.username} (Human simulation)`, "var(--amber)");
      STATE.skipped.push(user);
      STATE.pendingToFollow = STATE.pendingToFollow.filter(u => u.id !== user.id);
      return { success: false, reason: 'skipped' };
    }

    if (STATE.dailyCounter >= CONFIG.MAX_FOLLOWS_PER_DAY) {
      log(`⚠️ Daily limit reached (${CONFIG.MAX_FOLLOWS_PER_DAY})`, "var(--amber)");
      return { success: false, reason: 'limit' };
    }

    const baseDelay = CONFIG.DELAY_BETWEEN_FOLLOWS.min + Math.random() * (CONFIG.DELAY_BETWEEN_FOLLOWS.max - CONFIG.DELAY_BETWEEN_FOLLOWS.min);
    const delay = baseDelay + getRandomJitter();
    const mins = (delay / 60000).toFixed(1);

    STATE.statusText = `Waiting before following @${user.username}`;
    STATE.timeRemainingText = `Delay: ${mins}m`;
    log(`⏱️ Cooling down ${mins}m before following @${user.username}...`, "var(--cyan)");
    updateUI();

    await sleep(delay);

    try {
      const params = new URLSearchParams();
      params.append('user_id', user.id);

      const response = await fetch(`https://www.instagram.com/api/v1/friendships/create/${user.id}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-IG-App-ID': '936619743392459',
          'X-CSRFToken': STATE.csrfToken,
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: params.toString(),
        credentials: 'include'
      });

      if (response.ok) {
        const result = await response.json();
        if (result.status === 'ok' || result.friendship_status?.following) {
          STATE.dailyCounter++;
          STATE.hourlyCounter++;
          STATE.completed.push(user);
          STATE.pendingToFollow = STATE.pendingToFollow.filter(u => u.id !== user.id);
          log(`✅ Followed @${user.username}`, "var(--green)");
          updateUI();
          return { success: true };
        }
      }

      if (response.status === 429 || response.status === 400) {
        log(`🚫 Restricted by Instagram (HTTP ${response.status}). Stopping!`, "var(--rose)");
        STATE.status = 'idle';
        STATE.statusText = "Action Restricted";
        updateUI();
        return { success: false, reason: 'blocked' };
      }

      log(`❌ Failed @${user.username} (HTTP ${response.status})`, "var(--rose)");
      STATE.failed.push(user);
      STATE.pendingToFollow = STATE.pendingToFollow.filter(u => u.id !== user.id);
      updateUI();
      return { success: false, reason: 'error' };

    } catch (e) {
      log(`⚠️ Exception @${user.username}: ${e.message}`, "var(--rose)");
      STATE.failed.push(user);
      STATE.pendingToFollow = STATE.pendingToFollow.filter(u => u.id !== user.id);
      updateUI();
      return { success: false, reason: 'exception' };
    }
  }

  async function startEngine() {
    if (STATE.pendingToFollow.length === 0) {
      alert("Please upload at least one valid .JSON file first.");
      return;
    }

    STATE.status = 'running';
    log("▶️ Execution Engine Started", "var(--green)");

    let batchCount = 0;

    while (STATE.pendingToFollow.length > 0 && STATE.status === 'running') {
      batchCount++;

      if (CONFIG.SHUFFLE_EVERY_BATCH) {
        STATE.pendingToFollow = shuffleArray(STATE.pendingToFollow);
      }

      const batchSize = Math.max(1, Math.min(5, CONFIG.FOLLOW_BATCH_SIZE + Math.floor(Math.random() * (CONFIG.BATCH_SIZE_VARIATION * 2 + 1)) - CONFIG.BATCH_SIZE_VARIATION));
      const batch = STATE.pendingToFollow.slice(0, Math.min(batchSize, STATE.pendingToFollow.length));

      log(`🔄 Batch #${batchCount}: Processing ${batch.length} users`, "var(--cyan)");

      for (const user of batch) {
        if (STATE.status !== 'running') break;

        const res = await followUser(user);
        if (res.reason === 'blocked' || res.reason === 'limit') {
          STATE.status = 'idle';
          return;
        }

        const processed = STATE.completed.length + STATE.failed.length + STATE.skipped.length;
        STATE.progressPercentage = Math.round((processed / STATE.totalLoadedCount) * 100);
        updateUI();
      }

      if (STATE.pendingToFollow.length > 0 && STATE.status === 'running') {
        const batchDelay = CONFIG.DELAY_BETWEEN_BATCHES.min + Math.random() * (CONFIG.DELAY_BETWEEN_BATCHES.max - CONFIG.DELAY_BETWEEN_BATCHES.min) + getRandomJitter();
        const batchMins = Math.round(batchDelay / 60000);

        log(`⏸️ Batch Pause: Next execution in ${batchMins}m`, "var(--amber)");

        const startTime = Date.now();
        while (Date.now() - startTime < batchDelay && STATE.status === 'running') {
          const remaining = Math.max(0, batchDelay - (Date.now() - startTime));
          const m = Math.floor(remaining / 60000);
          const s = Math.floor((remaining % 60000) / 1000);
          STATE.statusText = `Batch Pause Active`;
          STATE.timeRemainingText = `Next batch in ${m}m ${s}s`;
          updateUI();
          await sleep(1000);
        }
      }
    }

    if (STATE.pendingToFollow.length === 0) {
      STATE.statusText = "Completed All Follows";
      STATE.timeRemainingText = "";
      log("🎉 Queue fully processed!", "var(--green)");
    }
    STATE.status = 'idle';
    updateUI();
  }

  // ========== EVENT HANDLERS & FILE PARSER ==========
  function attachEvents() {
    document.getElementById("iuFileInput")?.addEventListener("change", (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;

      let loaded = [];
      let processed = 0;

      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const json = JSON.parse(evt.target.result);
            const rawList = Array.isArray(json) ? json : (json.followers || []);
            const valid = rawList.filter(u => !u.followed_by_viewer);
            loaded = [...loaded, ...valid];
            processed++;

            if (processed === files.length) {
              const uniqueMap = new Map();
              loaded.forEach(u => uniqueMap.set(u.id, u));
              const uniqueList = Array.from(uniqueMap.values());

              STATE.pendingToFollow = CONFIG.RANDOMIZE_ORDER ? shuffleArray(uniqueList) : uniqueList;
              STATE.totalLoadedCount = uniqueList.length;
              STATE.completed = [];
              STATE.failed = [];
              STATE.skipped = [];
              STATE.progressPercentage = 0;
              STATE.statusText = "Ready to start";

              log(`📁 Parsed ${files.length} JSON file(s). ${uniqueList.length} unique targets loaded.`, "var(--green)");
              updateUI();
            }
          } catch (err) {
            log(`❌ Error reading ${file.name}: Invalid JSON`, "var(--rose)");
          }
        };
        reader.readAsText(file);
      });
    });

    document.getElementById("iuStartBtn")?.addEventListener("click", () => {
      if (STATE.status !== 'running') startEngine();
    });

    document.getElementById("iuPauseBtn")?.addEventListener("click", () => {
      STATE.status = 'paused';
      STATE.statusText = "Process Paused";
      log("⏸ Process paused by user", "var(--amber)");
      updateUI();
    });

    document.getElementById("iuSearchInput")?.addEventListener("input", (e) => {
      STATE.searchTerm = e.target.value;
      renderGrid();
    });
  }

  // ========== INICIALIZACIÓN ==========
  function init() {
    STATE.csrfToken = getCsrfToken();
    if (!STATE.csrfToken) {
      alert("Please log in to Instagram first.");
      return;
    }
    mountUI();
    log("System initialized with Human-Engine parameters.", "var(--cyan)");
  }

  init();
})();
