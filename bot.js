(() => {
  "use strict";

  // ========== CONFIGURACIÓN ANTI-BAN (ULTRA SEGURA) ==========
  const CONFIG = {
    FOLLOW_BATCH_SIZE: 3,         // Lotes pequeños (3 a 5 acciones continuas)
    BATCH_SIZE_VARIATION: 2,
    DELAY_BETWEEN_FOLLOWS: {
      min: 240000,  // 4 minutos mínimo entre acciones
      max: 600000   // 10 minutos máximo entre acciones
    },
    DELAY_BETWEEN_BATCHES: {
      min: 1800000, // 30 minutos de descanso entre lotes
      max: 3600000  // 60 minutos de descanso entre lotes
    },
    MAX_FOLLOWS_PER_DAY: 80,      // Límite diario seguro para cuentas normales
    MAX_FOLLOWS_PER_HOUR: 10,     // Límite por hora muy conservador
    RANDOMIZE_ORDER: true,
    SHUFFLE_EVERY_BATCH: true,
    SKIP_PERCENTAGE: 20,          // 20% de probabilidad de ignorar a un usuario aleatoriamente
    SAVE_PROGRESS: false
  };

  // ========== ESTADO ==========
  const STATE = {
    status: "idle",
    scannedFollowers: [],
    alreadyFollowing: [],
    pendingToFollow: [],
    completed: [],    
    failed: [],        
    skipped: [],
    dailyCounter: 0,
    hourlyCounter: 0,
    lastFollowTime: null,
    csrfToken: "",
    targetUserId: null,
    currentQueryHashIndex: 0,
    queryHashes: ["c76146de99bb02f6415203be841dd25a", "e4623e756814ac975ee0f334aa24e740"]
  };

  // ========== FUNCIONES AUXILIARES Y SIMULACIÓN HUMANA ==========
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getRandomJitter() {
    // Añade entre 5 y 25 segundos aleatorios extra para romper patrones numéricos fijos
    return Math.floor(Math.random() * 20000) + 5000;
  }

  function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  function updateCounters() {
    const totalEl = document.getElementById('totalCount');
    const pendingEl = document.getElementById('pendingCount');
    const doneEl = document.getElementById('doneCount');
    const failedEl = document.getElementById('failedCount');
    
    if (totalEl) totalEl.textContent = STATE.scannedFollowers.length;
    if (pendingEl) pendingEl.textContent = STATE.pendingToFollow.length;
    if (doneEl) doneEl.textContent = STATE.completed.length;      
    if (failedEl) failedEl.textContent = STATE.failed.length;      
  }

  // ========== FUNCIONES DE LA APP ==========

  function getCsrfToken() {
    const token = document.cookie.match(/csrftoken=([^;]+)/)?.[1];
    if (!token) {
      const metaToken = document.querySelector('meta[name="csrf-token"]')?.content;
      if (metaToken) return metaToken;
    }
    return token || '';
  }

  async function getTargetUserIdAlternative(username) {
    try {
      console.log(`🔍 Attempting to get user ID for @${username}...`);
      
      const response = await fetch(`https://www.instagram.com/${username}/`, {
        headers: {
          'User-Agent': window.navigator.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        },
        credentials: 'include',
        redirect: 'follow'
      });

      if (!response.ok) {
        console.warn(`Failed to load profile page: ${response.status}`);
        return null;
      }

      const html = await response.text();
      
      const patterns = [
        /"profilePage_([0-9]+)"/,
        /window\._sharedData\s*=\s*({.*?});/,
        /"id":"([0-9]+)".*?"username":"[^"]*"/,
        /"user_id":"([0-9]+)"/,
        /"profile_id":"([0-9]+)"/,
        /"instagram_id":"([0-9]+)"/,
        /<meta[^>]*content="instagram:\/\/user\?username=[^&]+&id=([0-9]+)"[^>]*>/,
        /"@type":"Person".*?"identifier":"([0-9]+)"/,
        /"id"\s*:\s*"([0-9]+)".*?"username"\s*:\s*"[^"]*"/s
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          console.log(`✅ Found user ID using pattern: ${match[1]}`);
          return match[1];
        }
      }
      return null;
    } catch (error) {
      console.error('Error in getTargetUserIdAlternative:', error);
      return null;
    }
  }

  async function fetchFollowersDirect(username) {
    try {
      console.log(`📥 Fetching followers for @${username}...`);
      
      STATE.targetUserId = await getTargetUserIdAlternative(username);
      if (!STATE.targetUserId) {
        throw new Error('User ID not found. Account may be private or non-existent.');
      }

      let allFollowers = [];
      let after = null;
      let page = 0;
      const maxPages = 20; // Reducido a 20 páginas para evitar scraping agresivo

      while (page < maxPages) {
        page++;
        
        const queryHash = STATE.queryHashes[STATE.currentQueryHashIndex];
        const variables = {
          id: STATE.targetUserId,
          include_reel: false,
          fetch_mutual: false,
          first: 50
        };

        if (after) variables.after = after;

        const url = `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${encodeURIComponent(JSON.stringify(variables))}`;
        console.log(`📄 Fetching page ${page} using hash: ${queryHash.substring(0,6)}...`);
        
        const response = await fetch(url, {
          headers: {
            'User-Agent': window.navigator.userAgent,
            'Accept': '*/*',
            'X-IG-App-ID': '936619743392459',
            'X-CSRFToken': STATE.csrfToken,
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': `https://www.instagram.com/${username}/followers/`
          },
          credentials: 'include'
        });

        if (!response.ok) {
          logMessage(`⚠️ HTTP Error ${response.status} on page ${page}`, 'warning');
          if (response.status === 429) {
            logMessage('⏳ Rate limited by Instagram. Waiting 5 minutes...', 'warning');
            await sleep(300000); // Espera extendida a 5 minutos si hay 429
            continue;
          }
          break;
        }

        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          console.warn("❌ Instagram returned HTML instead of JSON. Changing query hash...");
          logMessage("⚠️ Token hash expired or restricted. Attempting fallback hash...", "warning");
          
          if (STATE.currentQueryHashIndex < STATE.queryHashes.length - 1) {
            STATE.currentQueryHashIndex++;
            page--;
            await sleep(5000);
            continue;
          } else {
            logMessage("❌ Instagram block active: Soft Rate Limit. Please wait before scanning again.", "error");
            break;
          }
        }

        const data = await response.json();
        if (!data.data?.user?.edge_followed_by) {
          console.warn('Unexpected response structure:', data);
          break;
        }

        const edges = data.data.user.edge_followed_by.edges || [];
        const followers = edges.map(edge => ({
          id: edge.node.id,
          username: edge.node.username,
          full_name: edge.node.full_name,
          followed_by_viewer: edge.node.followed_by_viewer
        }));

        allFollowers = [...allFollowers, ...followers];
        
        const pageInfo = data.data.user.edge_followed_by.page_info;
        if (!pageInfo.has_next_page || !pageInfo.end_cursor) break;
        
        after = pageInfo.end_cursor;
        
        // Retraso entre peticiones de escaneo (más lento para no alertar al firewall)
        const dynamicDelay = 5000 + (page * 300) + getRandomJitter();
        await sleep(dynamicDelay);
        
        logMessage(`📊 Page ${page}: +${followers.length} followers (Total parsed: ${allFollowers.length})`, 'info');
        updateUI({
          found: allFollowers.length,
          progress: Math.min(95, Math.round((page / maxPages) * 100))
        });
      }

      console.log(`✅ Total followers fetched successfully: ${allFollowers.length}`);
      return allFollowers;
    } catch (error) {
      console.error('Error in fetchFollowersDirect:', error);
      logMessage(`⚠️ Scanning interrupted: ${error.message}`, 'error');
      return [];
    }
  }

  async function followUser(user) {
    try {
      // 1. Simulación Humana: Saltar usuarios con un porcentaje aleatorio
      if (Math.random() * 100 < CONFIG.SKIP_PERCENTAGE) {
        logMessage(`⏭️ Skipped @${user.username} (Human behavior simulation)`, 'info');
        STATE.skipped.push(user);
        STATE.pendingToFollow = STATE.pendingToFollow.filter(u => u.id !== user.id);
        return { success: false, reason: 'skipped' };
      }

      // 2. Control de límites
      if (STATE.dailyCounter >= CONFIG.MAX_FOLLOWS_PER_DAY) {
        logMessage(`⚠️ Daily limit reached (${CONFIG.MAX_FOLLOWS_PER_DAY})`, 'warning');
        return { success: false, reason: 'daily_limit' };
      }
      
      if (STATE.hourlyCounter >= CONFIG.MAX_FOLLOWS_PER_HOUR) {
        logMessage(`⏰ Hourly limit reached (${CONFIG.MAX_FOLLOWS_PER_HOUR})`, 'warning');
        return { success: false, reason: 'hourly_limit' };
      }

      // 3. Delays largos con Jitter variable
      const baseDelay = CONFIG.DELAY_BETWEEN_FOLLOWS.min + 
                        Math.random() * (CONFIG.DELAY_BETWEEN_FOLLOWS.max - CONFIG.DELAY_BETWEEN_FOLLOWS.min);
      const delay = baseDelay + getRandomJitter();
      
      const delayMinutes = (delay / 60000).toFixed(1);
      
      if (delay > 0) {
        logMessage(`⏱️ Waiting ${delayMinutes}m before trying to follow @${user.username}`, 'info');
        updateStatus(`Waiting ${delayMinutes}m...`);
        await sleep(delay);
      }

      const params = new URLSearchParams();
      params.append('user_id', user.id);

      const response = await fetch(`https://www.instagram.com/api/v1/friendships/create/${user.id}/`, {
        method: 'POST',
        headers: {
          'User-Agent': window.navigator.userAgent,
          'Accept': '*/*',
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-IG-App-ID': '936619743392459',
          'X-CSRFToken': STATE.csrfToken,
          'X-Requested-With': 'XMLHttpRequest',
          'X-Instagram-AJAX': '1'
        },
        body: params.toString(),
        credentials: 'include'
      });

      if (response.ok) {
        const result = await response.json();
        if (result.status === 'ok' || result.friendship_status?.following) {
          STATE.dailyCounter++;
          STATE.hourlyCounter++;
          STATE.lastFollowTime = Date.now();
          STATE.completed.push(user);
          STATE.pendingToFollow = STATE.pendingToFollow.filter(u => u.id !== user.id);
          
          logMessage(`✅ Followed @${user.username}`, 'success');
          updateCounters();
          return { success: true };
        }
      }

      if (response.status === 429 || response.status === 400) {
        logMessage(`🚫 Action restricted (Status ${response.status}). Stopping to avoid ban!`, 'error');
        STATE.status = 'idle';
        updateStatus('Restricted / Stopped', '#ef4444');
        return { success: false, reason: 'rate_limited' };
      }
      
      logMessage(`❌ Failed @${user.username} (Status: ${response.status})`, 'error');
      STATE.failed.push(user);
      STATE.pendingToFollow = STATE.pendingToFollow.filter(u => u.id !== user.id);
      updateCounters();
      return { success: false, reason: 'api_error' };
      
    } catch (error) {
      logMessage(`⚠️ Error @${user.username}: ${error.message}`, 'error');
      STATE.failed.push(user);
      STATE.pendingToFollow = STATE.pendingToFollow.filter(u => u.id !== user.id);
      updateCounters();
      return { success: false, reason: 'exception' };
    }
  }

  // ========== LÓGICA PRINCIPAL ==========
  async function scanFollowers() {
    const username = document.getElementById('targetUsername').value.trim().replace('@', '');
    if (!username) {
      alert('Please enter a username');
      return;
    }

    STATE.status = 'scanning';
    STATE.currentQueryHashIndex = 0;
    updateStatus('Scanning...', '#3b82f6');
    logMessage(`🎯 Scanning @${username}`, 'info');
    
    STATE.scannedFollowers = [];
    STATE.alreadyFollowing = [];
    STATE.pendingToFollow = [];
    STATE.completed = [];
    STATE.failed = [];
    STATE.skipped = [];
    
    const followers = await fetchFollowersDirect(username);
    
    if (followers.length === 0) {
      updateStatus('Scan stopped/Empty', '#ef4444');
      logMessage('No active followers retrieved. Try refreshing your Instagram page.', 'error');
      STATE.status = 'idle';
      return;
    }
    
    STATE.scannedFollowers = followers;
    updateStatus('Processing users...', '#3b82f6');
    
    followers.forEach((follower) => {
      if (follower.followed_by_viewer === true) {
        STATE.alreadyFollowing.push(follower);
      } else {
        STATE.pendingToFollow.push(follower);
      }
    });
    
    if (CONFIG.RANDOMIZE_ORDER) {
      STATE.pendingToFollow = shuffleArray(STATE.pendingToFollow);
    }
    
    updateCounters();
    
    updateUI({
      progress: 100,
      found: STATE.scannedFollowers.length,
      following: STATE.alreadyFollowing.length,
      pending: STATE.pendingToFollow.length
    });
    
    updateStatus('Ready!', '#22c55e');
    logMessage(`📊 Scan complete: ${STATE.scannedFollowers.length} total. ${STATE.pendingToFollow.length} users queued.`, 'success');
  }

  async function startFollowing() {
    if (STATE.pendingToFollow.length === 0) {
      logMessage('No users to follow!', 'warning');
      return;
    }
    
    STATE.status = 'following';
    updateStatus('Starting...', '#10b981');
    updateCounters();
    
    let batchNumber = 0;
    
    while (STATE.pendingToFollow.length > 0 && STATE.status === 'following') {
      batchNumber++;
      
      if (CONFIG.SHUFFLE_EVERY_BATCH) {
        STATE.pendingToFollow = shuffleArray(STATE.pendingToFollow);
      }

      const calculatedBatchSize = CONFIG.FOLLOW_BATCH_SIZE + 
                             Math.floor(Math.random() * (CONFIG.BATCH_SIZE_VARIATION * 2 + 1)) - 
                             CONFIG.BATCH_SIZE_VARIATION;
      
      const actualBatchSize = Math.max(1, Math.min(5, calculatedBatchSize));
      const actualBatchSizeFinal = Math.min(actualBatchSize, STATE.pendingToFollow.length);
      
      const batch = STATE.pendingToFollow.slice(0, actualBatchSizeFinal);
      logMessage(`🔄 Batch #${batchNumber}: Processing ${actualBatchSizeFinal} users`, 'info');
      
      for (const user of batch) {
        if (STATE.status !== 'following') break;
        
        const result = await followUser(user);
        if (result.reason === 'rate_limited') break; // Detener ejecución si hay bloqueo
        
        updateUI({
          pending: STATE.pendingToFollow.length,
          progress: Math.round(((STATE.completed.length + STATE.failed.length + STATE.skipped.length) / STATE.scannedFollowers.length) * 100)
        });
      }
      
      if (STATE.pendingToFollow.length > 0 && STATE.status === 'following') {
        const batchDelay = CONFIG.DELAY_BETWEEN_BATCHES.min + 
                           Math.random() * (CONFIG.DELAY_BETWEEN_BATCHES.max - CONFIG.DELAY_BETWEEN_BATCHES.min) +
                           getRandomJitter();
        
        const batchDelayMinutes = Math.round(batchDelay / 60000);
        logMessage(`⏸️ Next batch in ${batchDelayMinutes}m`, 'info');
        
        const startTime = Date.now();
        const interval = setInterval(() => {
          if (STATE.status !== 'following') {
            clearInterval(interval);
            return;
          }
          
          const elapsed = Date.now() - startTime;
          const remaining = Math.max(0, batchDelay - elapsed);
          const minutes = Math.floor(remaining / 60000);
          const seconds = Math.floor((remaining % 60000) / 1000);
          
          updateStatus(`Next in ${minutes}m ${seconds}s`);
        }, 1000);
        
        await sleep(batchDelay);
        clearInterval(interval);
        STATE.hourlyCounter = 0; // Reinicia contador por hora al cambiar de lote largo
      }
    }
    
    if (STATE.pendingToFollow.length === 0) {
      updateStatus('✅ Done!', '#22c55e');
      logMessage(`🎉 Completed: ${STATE.completed.length} followed, ${STATE.skipped.length} skipped, ${STATE.failed.length} failed`, 'success');
      updateCounters();
    }
    STATE.status = 'idle';
  }

  // ========== UI FUNCTIONS ==========
  function createUI() {
    const existingUI = document.getElementById('follow-bot-ui');
    if (existingUI) existingUI.remove();

    const overlay = document.createElement('div');
    overlay.id = 'follow-bot-ui';
    overlay.style.cssText = `
      position: fixed; top: 20px; right: 20px; width: 350px; max-height: 500px;
      background: rgba(15, 23, 42, 0.98); color: white; z-index: 999999; padding: 15px;
      font-family: 'Segoe UI', system-ui, sans-serif; border-radius: 12px;
      border: 2px solid #3b82f6; box-shadow: 0 8px 32px rgba(59, 130, 246, 0.3);
      backdrop-filter: blur(10px); overflow-y: auto;
    `;

    overlay.innerHTML = `
      <div style="margin-bottom: 15px;">
        <h3 style="margin: 0 0 10px 0; color: #3b82f6; font-size: 16px;">🔄 Instagram Follower Bot</h3>
        <div style="font-size: 11px; color: #10b981;">Safe Edition • Ultra-Low Behavior Profile</div>
      </div>
      <div style="margin-bottom: 15px;">
        <div style="display: flex; gap: 10px;">
          <input type="text" id="targetUsername" placeholder="username" 
                 style="flex: 1; padding: 8px 12px; background: rgba(30, 41, 59, 0.7); color: white; border: 1px solid #4b5563; border-radius: 6px; font-size: 13px;">
          <button id="scanBtn" style="padding: 8px 15px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">Scan</button>
        </div>
      </div>
      <div style="background: rgba(30, 41, 59, 0.7); border-radius: 8px; padding: 12px; margin-bottom: 15px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span style="color: #d1d5db; font-size: 12px;">Status</span>
          <span id="statusText" style="color: #a7f3d0; font-size: 12px;">Ready</span>
        </div>
        <div style="margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
            <span style="color: #9ca3af;">Progress</span>
            <span id="progressText">0%</span>
          </div>
          <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
            <div id="progressBar" style="height: 100%; width: 0%; background: linear-gradient(90deg, #3b82f6, #10b981); transition: width 0.3s ease;"></div>
          </div>
        </div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 15px;">
        <div style="background: rgba(34, 197, 94, 0.1); padding: 8px; border-radius: 6px; text-align: center;">
          <div style="font-size: 10px; color: #86efac;">Total</div>
          <div id="totalCount" style="font-size: 16px; font-weight: bold; color: #22c55e;">0</div>
        </div>
        <div style="background: rgba(59, 130, 246, 0.1); padding: 8px; border-radius: 6px; text-align: center;">
          <div style="font-size: 10px; color: #93c5fd;">Pending</div>
          <div id="pendingCount" style="font-size: 16px; font-weight: bold; color: #3b82f6;">0</div>
        </div>
        <div style="background: rgba(34, 211, 238, 0.1); padding: 8px; border-radius: 6px; text-align: center;">
          <div style="font-size: 10px; color: #67e8f9;">Done</div>
          <div id="doneCount" style="font-size: 16px; font-weight: bold; color: #06b6d4;">0</div>
        </div>
        <div style="background: rgba(239, 68, 68, 0.1); padding: 8px; border-radius: 6px; text-align: center;">
          <div style="font-size: 10px; color: #fca5a5;">Failed</div>
          <div id="failedCount" style="font-size: 16px; font-weight: bold; color: #ef4444;">0</div>
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
        <button id="startBtn" style="padding: 10px; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">▶ Start</button>
        <button id="pauseBtn" style="padding: 10px; background: #f59e0b; color: black; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">⏸ Pause</button>
      </div>
      <div id="logContainer" style="height: 100px; overflow-y: auto; background: rgba(15, 23, 42, 0.8); border-radius: 6px; padding: 10px; margin-bottom: 10px;">
        <div id="log" style="color: #d1d5db; font-size: 11px;"></div>
      </div>
      <div style="text-align: center;">
        <button id="stopBtn" style="padding: 6px 12px; background: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid #f87171; border-radius: 4px; cursor: pointer; font-size: 11px;">⏹ Stop</button>
      </div>
    `;

    document.body.appendChild(overlay);
    attachEventListeners();
  }

  function updateStatus(text, color = '#a7f3d0') {
    const element = document.getElementById('statusText');
    if (element) {
      element.textContent = text;
      element.style.color = color;
    }
  }

  function updateUI(data) {
    if (data.found !== undefined) document.getElementById('totalCount').textContent = data.found;
    if (data.pending !== undefined) document.getElementById('pendingCount').textContent = data.pending;
    if (data.failed !== undefined) document.getElementById('failedCount').textContent = data.failed;
    if (data.progress !== undefined) {
      document.getElementById('progressBar').style.width = `${data.progress}%`;
      document.getElementById('progressText').textContent = `${data.progress}%`;
    }
  }

  function logMessage(message, type = 'info') {
    const logElement = document.getElementById('log');
    if (!logElement) return;
    
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    let color = '#d1d5db';
    
    switch(type) {
      case 'success': color = '#10b981'; break;
      case 'error': color = '#ef4444'; break;
      case 'warning': color = '#f59e0b'; break;
      case 'info': color = '#3b82f6'; break;
    }
    
    logElement.innerHTML += `<div style="color: ${color}; margin-bottom: 2px;">
      <span style="color: #9ca3af;">[${time}]</span> ${message}
    </div>`;
    logElement.parentElement.scrollTop = logElement.parentElement.scrollHeight;
  }

  function attachEventListeners() {
    document.getElementById('scanBtn')?.addEventListener('click', scanFollowers);
    document.getElementById('startBtn')?.addEventListener('click', startFollowing);
    
    document.getElementById('pauseBtn')?.addEventListener('click', () => {
      if (STATE.status === 'following') {
        STATE.status = 'paused';
        updateStatus('Paused', '#f59e0b');
        logMessage('Process paused', 'warning');
      } else if (STATE.status === 'paused') {
        STATE.status = 'following';
        updateStatus('Resuming...', '#10b981');
        logMessage('Process resumed', 'info');
      }
    });
    
    document.getElementById('stopBtn')?.addEventListener('click', () => {
      STATE.status = 'idle';
      updateStatus('Stopped', '#ef4444');
      logMessage('Process stopped', 'error');
      updateCounters();
    });
  }

  function initialize() {
    if (!window.location.hostname.includes('instagram.com')) {
      console.warn('This script only works on Instagram');
      return;
    }
    
    STATE.csrfToken = getCsrfToken();
    if (!STATE.csrfToken) {
      alert('Please log in to Instagram first');
      return;
    }
    
    createUI();
    logMessage('🔄 Instagram Follower Bot initialized (Safe Mode)', 'success');
    updateCounters();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    setTimeout(initialize, 1000);
  }
})();
