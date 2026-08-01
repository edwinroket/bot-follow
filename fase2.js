(() => {
  "use strict";

  // ========== CONFIGURACIÓN ANTI-BAN (ULTRA SEGURA) ==========
  const CONFIG = {
    FOLLOW_BATCH_SIZE: 3,         // Lotes pequeños (3 a 5 acciones continuas)
    BATCH_SIZE_VARIATION: 2,
    DELAY_BETWEEN_FOLLOWS: {
      min: 240000,  // 4 minutos mínimo entre acciones (240.000 ms)
      max: 600000   // 10 minutos máximo entre acciones (600.000 ms)
    },
    DELAY_BETWEEN_BATCHES: {
      min: 1800000, // 30 minutos de descanso entre lotes (1.800.000 ms)
      max: 3600000  // 60 minutos de descanso entre lotes (3.600.000 ms)
    },
    MAX_FOLLOWS_PER_DAY: 80,      // Límite diario seguro para cuentas normales
    MAX_FOLLOWS_PER_HOUR: 10,     // Límite por hora conservador
    RANDOMIZE_ORDER: true,
    SHUFFLE_EVERY_BATCH: true,
    SKIP_PERCENTAGE: 20,          // 20% de probabilidad de ignorar a un usuario aleatoriamente
    SAVE_PROGRESS: false
  };

  // ========== ESTADO ==========
  const STATE = {
    status: "idle",
    totalLoadedCount: 0,
    alreadyFollowing: [],
    pendingToFollow: [],
    completed: [],    
    failed: [],        
    skipped: [],
    dailyCounter: 0,
    hourlyCounter: 0,
    lastFollowTime: null,
    csrfToken: ""
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
    
    if (totalEl) totalEl.textContent = STATE.totalLoadedCount;
    if (pendingEl) pendingEl.textContent = STATE.pendingToFollow.length;
    if (doneEl) doneEl.textContent = STATE.completed.length;      
    if (failedEl) failedEl.textContent = STATE.failed.length;      
  }

  function getCsrfToken() {
    const token = document.cookie.match(/csrftoken=([^;]+)/)?.[1];
    if (!token) {
      const metaToken = document.querySelector('meta[name="csrf-token"]')?.content;
      if (metaToken) return metaToken;
    }
    return token || '';
  }

  // ========== ACCIÓN DE SEGUIR (BEHAVIOR ENGINE) ==========
  async function followUser(user) {
    try {
      // 1. Simulación Humana: Saltar usuarios aleatoriamente según porcentaje
      if (Math.random() * 100 < CONFIG.SKIP_PERCENTAGE) {
        logMessage(`⏭️ Skipped @${user.username} (Human behavior simulation)`, 'info');
        STATE.skipped.push(user);
        STATE.pendingToFollow = STATE.pendingToFollow.filter(u => u.id !== user.id);
        return { success: false, reason: 'skipped' };
      }

      // 2. Control de límites diarios y horarias
      if (STATE.dailyCounter >= CONFIG.MAX_FOLLOWS_PER_DAY) {
        logMessage(`⚠️ Daily limit reached (${CONFIG.MAX_FOLLOWS_PER_DAY})`, 'warning');
        return { success: false, reason: 'daily_limit' };
      }
      
      if (STATE.hourlyCounter >= CONFIG.MAX_FOLLOWS_PER_HOUR) {
        logMessage(`⏰ Hourly limit reached (${CONFIG.MAX_FOLLOWS_PER_HOUR})`, 'warning');
        return { success: false, reason: 'hourly_limit' };
      }

      // 3. Delays con Jitter variable (comportamiento orgánico)
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

  // ========== CARGA Y FUSIÓN DE ARCHIVOS JSON ==========
  function handleJsonFiles(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;

    let loadedUsers = [];
    let filesProcessed = 0;

    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const json = JSON.parse(e.target.result);
          // Permite leer tanto el formato estructurado del Script 1 como un array directo
          const rawList = Array.isArray(json) ? json : (json.followers || []);
          
          // Excluir usuarios que ya estaban marcados como 'seguidos' al extraer
          const validUsers = rawList.filter(u => !u.followed_by_viewer);
          loadedUsers = [...loadedUsers, ...validUsers];
          filesProcessed++;

          if (filesProcessed === files.length) {
            // Deduplicar lista en caso de subir múltiples JSON que compartan seguidores
            const uniqueMap = new Map();
            loadedUsers.forEach(u => uniqueMap.set(u.id, u));
            const uniqueList = Array.from(uniqueMap.values());

            STATE.pendingToFollow = CONFIG.RANDOMIZE_ORDER ? shuffleArray(uniqueList) : uniqueList;
            STATE.totalLoadedCount = uniqueList.length;
            STATE.completed = [];
            STATE.failed = [];
            STATE.skipped = [];

            updateCounters();
            updateUI({ progress: 0 });
            logMessage(`📁 Loaded ${files.length} file(s). ${uniqueList.length} unique targets in queue.`, 'success');
            updateStatus('Ready to start!', '#22c55e');
          }
        } catch (err) {
          logMessage(`❌ Failed to parse ${file.name}: Invalid JSON format`, 'error');
        }
      };
      reader.readAsText(file);
    });
  }

  // ========== EJECUCIÓN PRINCIPAL ==========
  async function startFollowing() {
    if (STATE.pendingToFollow.length === 0) {
      logMessage('Please upload at least one valid .json file first!', 'warning');
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
        if (result.reason === 'rate_limited') break;
        
        const processedTotal = STATE.completed.length + STATE.failed.length + STATE.skipped.length;
        updateUI({
          pending: STATE.pendingToFollow.length,
          progress: Math.round((processedTotal / STATE.totalLoadedCount) * 100)
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
        STATE.hourlyCounter = 0; // Reiniciar contador horario al cumplir la pausa del lote
      }
    }
    
    if (STATE.pendingToFollow.length === 0) {
      updateStatus('✅ Done!', '#22c55e');
      logMessage(`🎉 Completed: ${STATE.completed.length} followed, ${STATE.skipped.length} skipped, ${STATE.failed.length} failed`, 'success');
      updateCounters();
    }
    STATE.status = 'idle';
  }

  // ========== INTERFAZ GRÁFICA ==========
  function createUI() {
    const existingUI = document.getElementById('follow-bot-ui');
    if (existingUI) existingUI.remove();

    const overlay = document.createElement('div');
    overlay.id = 'follow-bot-ui';
    overlay.style.cssText = `
      position: fixed; top: 20px; right: 20px; width: 350px; max-height: 520px;
      background: rgba(15, 23, 42, 0.98); color: white; z-index: 999999; padding: 15px;
      font-family: 'Segoe UI', system-ui, sans-serif; border-radius: 12px;
      border: 2px solid #3b82f6; box-shadow: 0 8px 32px rgba(59, 130, 246, 0.3);
      backdrop-filter: blur(10px); overflow-y: auto;
    `;

    overlay.innerHTML = `
      <div style="margin-bottom: 12px;">
        <h3 style="margin: 0 0 4px 0; color: #3b82f6; font-size: 16px;">🔄 Instagram JSON Follower</h3>
        <div style="font-size: 11px; color: #10b981;">Human Engine • Multi-JSON Importer</div>
      </div>
      
      <div style="margin-bottom: 12px; background: rgba(30, 41, 59, 0.7); padding: 10px; border-radius: 8px; border: 1px dashed #4b5563;">
        <label style="display: block; font-size: 11px; color: #9ca3af; margin-bottom: 6px;">Upload Follower .JSON Files:</label>
        <input type="file" id="jsonFileInput" multiple accept=".json" 
               style="width: 100%; font-size: 11px; color: #d1d5db; background: rgba(15, 23, 42, 0.6); padding: 6px; border-radius: 4px; border: 1px solid #374151;">
      </div>

      <div style="background: rgba(30, 41, 59, 0.7); border-radius: 8px; padding: 10px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span style="color: #d1d5db; font-size: 12px;">Status</span>
          <span id="statusText" style="color: #a7f3d0; font-size: 12px;">Awaiting .json upload</span>
        </div>
        <div>
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
            <span style="color: #9ca3af;">Progress</span>
            <span id="progressText">0%</span>
          </div>
          <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
            <div id="progressBar" style="height: 100%; width: 0%; background: linear-gradient(90deg, #3b82f6, #10b981); transition: width 0.3s ease;"></div>
          </div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 12px;">
        <div style="background: rgba(34, 197, 94, 0.1); padding: 8px; border-radius: 6px; text-align: center;">
          <div style="font-size: 10px; color: #86efac;">Loaded</div>
          <div id="totalCount" style="font-size: 15px; font-weight: bold; color: #22c55e;">0</div>
        </div>
        <div style="background: rgba(59, 130, 246, 0.1); padding: 8px; border-radius: 6px; text-align: center;">
          <div style="font-size: 10px; color: #93c5fd;">Pending</div>
          <div id="pendingCount" style="font-size: 15px; font-weight: bold; color: #3b82f6;">0</div>
        </div>
        <div style="background: rgba(34, 211, 238, 0.1); padding: 8px; border-radius: 6px; text-align: center;">
          <div style="font-size: 10px; color: #67e8f9;">Done</div>
          <div id="doneCount" style="font-size: 15px; font-weight: bold; color: #06b6d4;">0</div>
        </div>
        <div style="background: rgba(239, 68, 68, 0.1); padding: 8px; border-radius: 6px; text-align: center;">
          <div style="font-size: 10px; color: #fca5a5;">Failed</div>
          <div id="failedCount" style="font-size: 15px; font-weight: bold; color: #ef4444;">0</div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
        <button id="startBtn" style="padding: 9px; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">▶ Start</button>
        <button id="pauseBtn" style="padding: 9px; background: #f59e0b; color: black; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">⏸ Pause</button>
      </div>

      <div id="logContainer" style="height: 100px; overflow-y: auto; background: rgba(15, 23, 42, 0.8); border-radius: 6px; padding: 10px; margin-bottom: 10px;">
        <div id="log" style="color: #d1d5db; font-size: 11px;"></div>
      </div>

      <div style="text-align: center;">
        <button id="stopBtn" style="padding: 5px 12px; background: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid #f87171; border-radius: 4px; cursor: pointer; font-size: 11px;">⏹ Stop</button>
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

  function updateUI(data = {}) {
    if (data.progress !== undefined) {
      document.getElementById('progressBar').style.width = `${data.progress}%`;
      document.getElementById('progressText').textContent = `${data.progress}%`;
    }
    updateCounters();
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
    document.getElementById('jsonFileInput')?.addEventListener('change', handleJsonFiles);
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
      console.warn('This script must be executed on Instagram');
      return;
    }
    
    STATE.csrfToken = getCsrfToken();
    if (!STATE.csrfToken) {
      alert('Please log in to Instagram first');
      return;
    }
    
    createUI();
    logMessage('🔄 JSON Runner Ready (Human Engine Active)', 'success');
    updateCounters();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    setTimeout(initialize, 1000);
  }
})();
