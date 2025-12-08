(() => {
  "use strict";

  // ========== CONFIGURACIÓN ACTUALIZADA ==========
  const CONFIG = {
    FOLLOW_BATCH_SIZE: 3,
    BATCH_SIZE_VARIATION: 2,
    DELAY_BETWEEN_FOLLOWS: {
      min: 120000,  // 2 minutos
      max: 240000   // 4 minutos
    },
    DELAY_BETWEEN_BATCHES: {
      min: 300000,  // 5 minutos
      max: 900000   // 15 minutos
    },
    MAX_FOLLOWS_PER_DAY: 60,
    MAX_FOLLOWS_PER_HOUR: 15,
    RANDOMIZE_ORDER: true,
    SHUFFLE_EVERY_BATCH: true,
    SKIP_PERCENTAGE: 10,
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
    targetUserId: null
  };

  // ========== FUNCIONES ACTUALIZADAS ==========

  // 1. Obtener CSRF token
  function getCsrfToken() {
    const token = document.cookie.match(/csrftoken=([^;]+)/)?.[1];
    if (!token) {
      const metaToken = document.querySelector('meta[name="csrf-token"]')?.content;
      if (metaToken) return metaToken;
    }
    return token || '';
  }

  // 2. Método ALTERNATIVO para obtener User ID - SIN API
  async function getTargetUserIdAlternative(username) {
    try {
      console.log(`🔍 Attempting to get user ID for @${username}...`);
      
      // Método 1: Intentar cargar la página del perfil
      const response = await fetch(`https://www.instagram.com/${username}/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0'
        },
        credentials: 'include',
        redirect: 'follow'
      });

      if (!response.ok) {
        console.warn(`Failed to load profile page: ${response.status}`);
        return null;
      }

      const html = await response.text();
      
      // Buscar el ID en el HTML de varias maneras
      const patterns = [
        // Patrón 1: "profilePage_"
        /"profilePage_([0-9]+)"/,
        
        // Patrón 2: window._sharedData
        /window\._sharedData\s*=\s*({.*?});/,
        
        // Patrón 3: data-reactid con ID
        /"id":"([0-9]+)".*?"username":"[^"]*"/,
        
        // Patrón 4: GraphQL data
        /"user_id":"([0-9]+)"/,
        
        // Patrón 5: Enlace de perfil
        /"profile_id":"([0-9]+)"/,
        
        // Patrón 6: Instagram ID
        /"instagram_id":"([0-9]+)"/,
        
        // Patrón 7: En meta tags
        /<meta[^>]*content="instagram:\/\/user\?username=[^&]+&id=([0-9]+)"[^>]*>/,
        
        // Patrón 8: En JSON-LD
        /"@type":"Person".*?"identifier":"([0-9]+)"/,
        
        // Patrón 9: En scripts
        /"id"\s*:\s*"([0-9]+)".*?"username"\s*:\s*"[^"]*"/s
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          console.log(`✅ Found user ID using pattern: ${match[1]}`);
          return match[1];
        }
      }

      // Método alternativo: Buscar en window si estamos en la página
      if (window.location.pathname === `/${username}/`) {
        // Intentar extraer de datos globales
        if (window._sharedData) {
          try {
            const entryData = window._sharedData.entry_data;
            if (entryData && entryData.ProfilePage) {
              const userData = entryData.ProfilePage[0]?.graphql?.user;
              if (userData && userData.id) {
                console.log(`✅ Found user ID from window._sharedData: ${userData.id}`);
                return userData.id;
              }
            }
          } catch (e) {
            console.warn('Error parsing window._sharedData:', e);
          }
        }
      }

      console.warn('❌ Could not find user ID in page');
      return null;

    } catch (error) {
      console.error('Error in getTargetUserIdAlternative:', error);
      return null;
    }
  }

  // 3. Obtener seguidores usando método DIRECTO
  async function fetchFollowersDirect(username) {
    try {
      console.log(`📥 Fetching followers for @${username}...`);
      
      // Primero intentar obtener el ID
      STATE.targetUserId = await getTargetUserIdAlternative(username);
      if (!STATE.targetUserId) {
        throw new Error('User ID not found. Account may be private or non-existent.');
      }

      // Usar el endpoint de seguidores directamente
      let allFollowers = [];
      let after = null;
      let page = 0;
      const maxPages = 20; // Límite para no hacer demasiadas requests

      while (page < maxPages) {
        page++;
        
        // Construir URL para GraphQL
        const queryHash = "c76146de99bb02f6415203be841dd25a";
        const variables = {
          id: STATE.targetUserId,
          include_reel: false,
          fetch_mutual: false,
          first: 50
        };

        if (after) {
          variables.after = after;
        }

        const url = `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${encodeURIComponent(JSON.stringify(variables))}`;
        
        console.log(`📄 Fetching page ${page}...`);
        
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'X-IG-App-ID': '936619743392459',
            'X-CSRFToken': STATE.csrfToken,
            'X-Requested-With': 'XMLHttpRequest',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'Referer': `https://www.instagram.com/${username}/followers/`,
            'Priority': 'u=1'
          },
          credentials: 'include',
          mode: 'cors'
        });

        if (!response.ok) {
          console.warn(`Response status: ${response.status}`);
          if (response.status === 429) {
            console.warn('Rate limited! Waiting 1 minute...');
            await sleep(60000);
            continue;
          }
          break;
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
          profile_pic_url: edge.node.profile_pic_url,
          is_private: edge.node.is_private,
          is_verified: edge.node.is_verified
        }));

        allFollowers = [...allFollowers, ...followers];
        
        const pageInfo = data.data.user.edge_followed_by.page_info;
        if (!pageInfo.has_next_page || !pageInfo.end_cursor) {
          break;
        }
        
        after = pageInfo.end_cursor;
        
        // Pequeña pausa entre requests
        await sleep(2000 + Math.random() * 3000);
        
        // Mostrar progreso
        logMessage(`📊 Page ${page}: ${followers.length} followers (Total: ${allFollowers.length})`, 'info');
        updateUI({
          found: allFollowers.length,
          progress: Math.min(95, Math.round((page / maxPages) * 100))
        });
      }

      console.log(`✅ Total followers fetched: ${allFollowers.length}`);
      return allFollowers;

    } catch (error) {
      console.error('Error in fetchFollowersDirect:', error);
      return [];
    }
  }

  // 4. Verificar si ya seguimos
  async function checkIfFollowing(userId) {
    try {
      const response = await fetch(`https://www.instagram.com/api/v1/friendships/show/${userId}/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'X-IG-App-ID': '936619743392459',
          'X-CSRFToken': STATE.csrfToken,
          'X-Instagram-AJAX': Math.floor(Math.random() * 1000000000).toString()
        },
        credentials: 'include'
      });

      if (!response.ok) return false;
      
      const data = await response.json();
      return data.following || false;
      
    } catch (error) {
      console.warn('Error checking follow status:', error);
      return false;
    }
  }

  // 5. Seguir usuario
  async function followUser(user) {
    try {
      // Verificar límites
      if (STATE.dailyCounter >= CONFIG.MAX_FOLLOWS_PER_DAY) {
        logMessage(`⚠️ Daily limit reached (${CONFIG.MAX_FOLLOWS_PER_DAY})`, 'warning');
        return { success: false, reason: 'daily_limit' };
      }
      
      if (STATE.hourlyCounter >= CONFIG.MAX_FOLLOWS_PER_HOUR) {
        logMessage(`⏰ Hourly limit reached (${CONFIG.MAX_FOLLOWS_PER_HOUR})`, 'warning');
        return { success: false, reason: 'hourly_limit' };
      }

      // Verificar si ya seguimos
      const alreadyFollowing = await checkIfFollowing(user.id);
      if (alreadyFollowing) {
        logMessage(`✓ Already following @${user.username}`, 'info');
        STATE.alreadyFollowing.push(user);
        STATE.pendingToFollow = STATE.pendingToFollow.filter(u => u.id !== user.id);
        return { success: true, alreadyFollowing: true };
      }

      // Delay aleatorio
      const delay = CONFIG.DELAY_BETWEEN_FOLLOWS.min + 
                   Math.random() * (CONFIG.DELAY_BETWEEN_FOLLOWS.max - CONFIG.DELAY_BETWEEN_FOLLOWS.min);
      
      const delayMinutes = Math.round(delay / 60000);
      
      if (delayMinutes > 0) {
        logMessage(`⏱️ Waiting ${delayMinutes}m before @${user.username}`, 'info');
        updateStatus(`Waiting ${delayMinutes}m...`);
        await sleep(delay);
      }

      // Intentar follow
      const formData = new FormData();
      formData.append('user_id', user.id);
      
      const response = await fetch(`https://www.instagram.com/api/v1/web/friendships/${user.id}/follow/`, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'X-IG-App-ID': '936619743392459',
          'X-CSRFToken': STATE.csrfToken,
          'X-Instagram-AJAX': Math.floor(Math.random() * 1000000000).toString(),
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: formData,
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
          return { success: true };
        }
      }
      
      logMessage(`❌ Failed @${user.username}`, 'error');
      STATE.failed.push(user);
      return { success: false, reason: 'api_error' };
      
    } catch (error) {
      logMessage(`⚠️ Error @${user.username}: ${error.message}`, 'error');
      STATE.failed.push(user);
      return { success: false, reason: 'exception' };
    }
  }

  // 6. Funciones auxiliares
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // ========== LÓGICA PRINCIPAL ==========
  async function scanFollowers() {
    const username = document.getElementById('targetUsername').value.trim().replace('@', '');
    if (!username) {
      alert('Please enter a username');
      return;
    }

    STATE.status = 'scanning';
    updateStatus('Scanning...', '#3b82f6');
    logMessage(`🎯 Scanning @${username}`, 'info');
    
    STATE.scannedFollowers = [];
    STATE.alreadyFollowing = [];
    STATE.pendingToFollow = [];
    
    // Obtener seguidores usando método directo
    const followers = await fetchFollowersDirect(username);
    
    if (followers.length === 0) {
      updateStatus('No followers found', '#ef4444');
      logMessage('Could not fetch followers. Possible reasons:', 'error');
      logMessage('1. Account is private', 'error');
      logMessage('2. Instagram blocked the request', 'error');
      logMessage('3. User does not exist', 'error');
      STATE.status = 'idle';
      return;
    }
    
    STATE.scannedFollowers = followers;
    
    // Verificar cuáles ya seguimos (más rápido, en lotes)
    updateStatus('Checking follows...', '#3b82f6');
    const batchSize = 5;
    
    for (let i = 0; i < followers.length; i += batchSize) {
      if (STATE.status !== 'scanning') break;
      
      const batch = followers.slice(i, i + batchSize);
      const promises = batch.map(follower => checkIfFollowing(follower.id));
      const results = await Promise.all(promises);
      
      results.forEach((isFollowing, index) => {
        const follower = batch[index];
        if (isFollowing) {
          STATE.alreadyFollowing.push(follower);
        } else {
          STATE.pendingToFollow.push(follower);
        }
      });
      
      updateUI({
        progress: 50 + Math.round(i / followers.length * 50),
        following: STATE.alreadyFollowing.length,
        pending: STATE.pendingToFollow.length
      });
      
      await sleep(1000 + Math.random() * 1000);
    }
    
    // Aplicar aleatoriedad
    STATE.pendingToFollow = shuffleArray(STATE.pendingToFollow);
    
    updateUI({
      progress: 100,
      found: STATE.scannedFollowers.length,
      following: STATE.alreadyFollowing.length,
      pending: STATE.pendingToFollow.length
    });
    
    updateStatus('Ready!', '#22c55e');
    logMessage(`📊 Scan complete: ${STATE.scannedFollowers.length} total, ${STATE.alreadyFollowing.length} already followed, ${STATE.pendingToFollow.length} pending`, 'success');
  }

  async function startFollowing() {
    if (STATE.pendingToFollow.length === 0) {
      logMessage('No users to follow!', 'warning');
      return;
    }
    
    STATE.status = 'following';
    updateStatus('Starting...', '#10b981');
    
    let batchNumber = 0;
    
    while (STATE.pendingToFollow.length > 0 && STATE.status === 'following') {
      batchNumber++;
      
      // Determinar tamaño de batch
      const batchSize = CONFIG.FOLLOW_BATCH_SIZE + 
                       Math.floor(Math.random() * (CONFIG.BATCH_SIZE_VARIATION * 2 + 1)) - 
                       CONFIG.BATCH_SIZE_VARIATION;
      
      const actualBatchSize = Math.max(1, Math.min(5, batchSize));
      const actualBatchSizeFinal = Math.min(actualBatchSize, STATE.pendingToFollow.length);
      
      // Tomar batch
      const batch = STATE.pendingToFollow.slice(0, actualBatchSizeFinal);
      
      logMessage(`🔄 Batch #${batchNumber}: ${actualBatchSizeFinal} users`, 'info');
      
      // Procesar batch
      for (const user of batch) {
        if (STATE.status !== 'following') break;
        
        await followUser(user);
        
        updateUI({
          pending: STATE.pendingToFollow.length,
          completed: STATE.completed.length,
          failed: STATE.failed.length,
          daily: STATE.dailyCounter,
          hourly: STATE.hourlyCounter,
          progress: Math.round((STATE.completed.length / STATE.scannedFollowers.length) * 100)
        });
      }
      
      // Delay entre batches
      if (STATE.pendingToFollow.length > 0 && STATE.status === 'following') {
        const batchDelay = CONFIG.DELAY_BETWEEN_BATCHES.min + 
                          Math.random() * (CONFIG.DELAY_BETWEEN_BATCHES.max - CONFIG.DELAY_BETWEEN_BATCHES.min);
        
        const batchDelayMinutes = Math.round(batchDelay / 60000);
        
        logMessage(`⏸️ Next batch in ${batchDelayMinutes}m`, 'info');
        updateStatus(`Next in ${batchDelayMinutes}m`);
        
        // Cuenta regresiva
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
          
          if (minutes > 0) {
            updateStatus(`Next in ${minutes}m ${seconds}s`);
          } else {
            updateStatus(`Next in ${seconds}s`);
          }
        }, 1000);
        
        await sleep(batchDelay);
        clearInterval(interval);
        
        // Reset contador de hora
        STATE.hourlyCounter = 0;
      }
    }
    
    if (STATE.pendingToFollow.length === 0) {
      updateStatus('✅ Done!', '#22c55e');
      logMessage(`🎉 Completed: ${STATE.completed.length} followed, ${STATE.failed.length} failed`, 'success');
    }
    
    STATE.status = 'idle';
  }

  // ========== UI SIMPLIFICADA ==========
  function createUI() {
    const existingUI = document.getElementById('follow-bot-ui');
    if (existingUI) existingUI.remove();

    const overlay = document.createElement('div');
    overlay.id = 'follow-bot-ui';
    overlay.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: 340px;
      max-height: 500px;
      background: rgba(15, 23, 42, 0.98);
      color: white;
      z-index: 999999;
      padding: 15px;
      font-family: 'Segoe UI', system-ui, sans-serif;
      border-radius: 12px;
      border: 2px solid #3b82f6;
      box-shadow: 0 8px 32px rgba(59, 130, 246, 0.3);
      backdrop-filter: blur(10px);
      overflow-y: auto;
    `;

    overlay.innerHTML = `
      <div style="margin-bottom: 15px;">
        <h3 style="margin: 0 0 10px 0; color: #3b82f6; font-size: 16px;">
          🔄 Instagram Follower Bot
        </h3>
        <div style="font-size: 11px; color: #9ca3af;">
          Fixed version • No API required
        </div>
      </div>
      
      <div style="margin-bottom: 15px;">
        <div style="display: flex; gap: 10px;">
          <input type="text" id="targetUsername" placeholder="username (without @)" 
                 style="flex: 1; padding: 8px 12px; background: rgba(30, 41, 59, 0.7); 
                        color: white; border: 1px solid #4b5563; border-radius: 6px;
                        font-size: 13px;">
          <button id="scanBtn" style="padding: 8px 15px; background: #3b82f6; color: white; 
                    border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
            Scan
          </button>
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
            <div id="progressBar" style="height: 100%; width: 0%; background: linear-gradient(90deg, #3b82f6, #10b981); 
                  transition: width 0.3s ease;"></div>
          </div>
        </div>
      </div>
      
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 15px;">
        <div style="background: rgba(34, 197, 94, 0.1); padding: 8px; border-radius: 6px; text-align: center;">
          <div style="font-size: 10px; color: #86efac;">Total</div>
          <div id="totalCount" style="font-size: 16px; font-weight: bold; color: #22c55e;">0</div>
        </div>
        <div style="background: rgba(59, 130, 246, 0.1); padding: 8px; border-radius: 6px; text-align: center;">
          <div style="font-size: 10px; color: #93c5fd;">Pending</div>
          <div id="pendingCount" style="font-size: 16px; font-weight: bold; color: #3b82f6;">0</div>
        </div>
        <div style="background: rgba(239, 68, 68, 0.1); padding: 8px; border-radius: 6px; text-align: center;">
          <div style="font-size: 10px; color: #fca5a5;">Failed</div>
          <div id="failedCount" style="font-size: 16px; font-weight: bold; color: #ef4444;">0</div>
        </div>
      </div>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
        <button id="startBtn" style="padding: 10px; background: #10b981; 
                color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
          ▶ Start
        </button>
        <button id="pauseBtn" style="padding: 10px; background: #f59e0b; 
                color: black; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
          ⏸ Pause
        </button>
      </div>
      
      <div style="font-size: 11px; color: #9ca3af; margin-bottom: 10px; padding: 8px; background: rgba(30, 41, 59, 0.5); border-radius: 6px;">
        <div>⚡ Follow delay: ${CONFIG.DELAY_BETWEEN_FOLLOWS.min/60000}-${CONFIG.DELAY_BETWEEN_FOLLOWS.max/60000} min</div>
        <div>⏸️ Batch delay: ${CONFIG.DELAY_BETWEEN_BATCHES.min/60000}-${CONFIG.DELAY_BETWEEN_BATCHES.max/60000} min</div>
      </div>
      
      <div id="logContainer" style="height: 100px; overflow-y: auto; background: rgba(15, 23, 42, 0.8); 
            border-radius: 6px; padding: 10px; margin-bottom: 10px;">
        <div id="log" style="color: #d1d5db; font-size: 11px;"></div>
      </div>
      
      <div style="text-align: center;">
        <button id="stopBtn" style="padding: 6px 12px; background: rgba(239, 68, 68, 0.2); 
                color: #fca5a5; border: 1px solid #f87171; border-radius: 4px; cursor: pointer; font-size: 11px;">
          ⏹ Stop
        </button>
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
    if (data.found !== undefined) {
      document.getElementById('totalCount').textContent = data.found;
    }
    if (data.pending !== undefined) {
      document.getElementById('pendingCount').textContent = data.pending;
    }
    if (data.failed !== undefined) {
      document.getElementById('failedCount').textContent = data.failed;
    }
    if (data.progress !== undefined) {
      document.getElementById('progressBar').style.width = `${data.progress}%`;
      document.getElementById('progressText').textContent = `${data.progress}%`;
    }
    if (data.daily !== undefined) {
      // No hay elemento para daily en esta UI
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
    });
  }

  // ========== INICIALIZACIÓN ==========
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
    logMessage('🔄 Instagram Follower Bot initialized', 'success');
    logMessage('⚡ Using alternative method (no API)', 'info');
    logMessage('⚠️ Enter username and click Scan', 'warning');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    setTimeout(initialize, 1000);
  }
})();