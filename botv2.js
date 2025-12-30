(() => {
  "use strict";

  // ========== CONFIGURACIÓN ACTUALIZADA ==========
  const CONFIG = {
    FOLLOW_BATCH_SIZE: 10,
    BATCH_SIZE_VARIATION: 4,
    DELAY_BETWEEN_FOLLOWS: {
      min: 120000,  // 2 minutos
      max: 240000   // 4 minutos
    },
    DELAY_BETWEEN_BATCHES: {
      min: 300000,  // 5 minutos
      max: 600000   // 10 minutos
    },
    MAX_FOLLOWS_PER_DAY: 100,
    MAX_FOLLOWS_PER_HOUR: 50,
    RANDOMIZE_ORDER: true,
    SHUFFLE_EVERY_BATCH: true,
    SKIP_PERCENTAGE: 10,
    SAVE_PROGRESS: false
  };

  // ========== ESTADO ==========
  const STATE = {
    status: "idle",
    scannedLikers: [],
    alreadyFollowing: [],
    pendingToFollow: [],
    completed: [],    // ✅ FOLLOWS EXITOSOS
    failed: [],       // ❌ FOLLOWS FALLADOS
    skipped: [],
    dailyCounter: 0,
    hourlyCounter: 0,
    lastFollowTime: null,
    csrfToken: "",
    postId: null
  };

  // ========== FUNCIONES AUXILIARES ==========
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

  // ========== FUNCIÓN NUEVA: updateCounters() ==========
  function updateCounters() {
    // Actualizar TODOS los contadores en la UI
    const totalEl = document.getElementById('totalCount');
    const pendingEl = document.getElementById('pendingCount');
    const doneEl = document.getElementById('doneCount');
    const failedEl = document.getElementById('failedCount');
    
    if (totalEl) totalEl.textContent = STATE.scannedLikers.length;
    if (pendingEl) pendingEl.textContent = STATE.pendingToFollow.length;
    if (doneEl) doneEl.textContent = STATE.completed.length;
    if (failedEl) failedEl.textContent = STATE.failed.length;
  }

  // ========== FUNCIONES DE LA APP ==========

  // 1. Obtener CSRF token
  function getCsrfToken() {
    const token = document.cookie.match(/csrftoken=([^;]+)/)?.[1];
    if (!token) {
      const metaToken = document.querySelector('meta[name="csrf-token"]')?.content;
      if (metaToken) return metaToken;
    }
    return token || '';
  }

  // 2. Extraer Post ID del URL
  function extractPostIdFromUrl(url) {
    try {
      // Formatos de URL de Instagram
      const patterns = [
        /instagram\.com\/p\/([a-zA-Z0-9_-]+)/,
        /instagram\.com\/reel\/([a-zA-Z0-9_-]+)/,
        /instagram\.com\/tv\/([a-zA-Z0-9_-]+)/
      ];
      
      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
          console.log(`✅ Extracted shortcode: ${match[1]}`);
          return match[1];
        }
      }
      
      // Si es un link directo con parámetros
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length >= 2) {
        return pathParts[1];
      }
      
      return null;
    } catch (error) {
      console.error('Error extracting post ID:', error);
      return null;
    }
  }

  // 3. Obtener likers de una publicación
  async function fetchLikersFromPost(postUrl) {
    try {
      console.log(`📥 Fetching likers from post...`);
      
      const shortcode = extractPostIdFromUrl(postUrl);
      if (!shortcode) {
        throw new Error('Invalid Instagram post URL');
      }

      STATE.postId = shortcode;
      let allLikers = [];
      let after = null;
      let page = 0;
      const maxPages = 20; // Límite de páginas para evitar rate limiting

      while (page < maxPages) {
        page++;
        
        const queryHash = "d5d763b1e2acf209d62d22d184488e57"; // Query hash para obtener likes
        const variables = {
          shortcode: shortcode,
          include_reel: true,
          first: 50
        };

        if (after) {
          variables.after = after;
        }

        const url = `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${encodeURIComponent(JSON.stringify(variables))}`;
        
        console.log(`📄 Fetching likers page ${page}...`);
        
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
            'Referer': `https://www.instagram.com/p/${shortcode}/`,
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
        
        if (!data.data?.shortcode_media?.edge_liked_by) {
          // Intentar estructura alternativa
          if (data.data?.shortcode_media?.edge_media_preview_like) {
            const edges = data.data.shortcode_media.edge_media_preview_like.edges || [];
            const likers = edges.map(edge => ({
              id: edge.node.id,
              username: edge.node.username,
              full_name: edge.node.full_name || '',
              profile_pic_url: edge.node.profile_pic_url,
              is_private: edge.node.is_private || false,
              is_verified: edge.node.is_verified || false
            }));
            
            allLikers = [...allLikers, ...likers];
            break; // Esta estructura no tiene paginación
          } else {
            console.warn('Unexpected response structure:', data);
            break;
          }
        }

        const edges = data.data.shortcode_media.edge_liked_by.edges || [];
        const likers = edges.map(edge => ({
          id: edge.node.id,
          username: edge.node.username,
          full_name: edge.node.full_name || '',
          profile_pic_url: edge.node.profile_pic_url,
          is_private: edge.node.is_private || false,
          is_verified: edge.node.is_verified || false
        }));

        allLikers = [...allLikers, ...likers];
        
        const pageInfo = data.data.shortcode_media.edge_liked_by.page_info;
        if (!pageInfo.has_next_page || !pageInfo.end_cursor) {
          break;
        }
        
        after = pageInfo.end_cursor;
        await sleep(2000 + Math.random() * 3000);
        
        logMessage(`📊 Page ${page}: ${likers.length} likers (Total: ${allLikers.length})`, 'info');
        updateUI({
          found: allLikers.length,
          progress: Math.min(95, Math.round((page / maxPages) * 100))
        });
      }

      console.log(`✅ Total likers fetched: ${allLikers.length}`);
      return allLikers;

    } catch (error) {
      console.error('Error in fetchLikersFromPost:', error);
      return [];
    }
  }

  // 4. Método alternativo para posts privados o que fallen
  async function fetchLikersAlternative(postUrl) {
    try {
      console.log(`🔍 Trying alternative method...`);
      
      const response = await fetch(postUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        },
        credentials: 'include'
      });

      if (!response.ok) return [];
      
      const html = await response.text();
      
      // Buscar datos embebidos en la página
      const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.*?});/);
      if (sharedDataMatch) {
        try {
          const sharedData = JSON.parse(sharedDataMatch[1]);
          const postData = sharedData.entry_data?.PostPage?.[0]?.graphql?.shortcode_media;
          
          if (postData?.edge_liked_by) {
            const edges = postData.edge_liked_by.edges || [];
            return edges.map(edge => ({
              id: edge.node.id,
              username: edge.node.username,
              full_name: edge.node.full_name || '',
              profile_pic_url: edge.node.profile_pic_url,
              is_private: edge.node.is_private || false,
              is_verified: edge.node.is_verified || false
            }));
          }
        } catch (e) {
          console.warn('Failed to parse shared data:', e);
        }
      }
      
      return [];
    } catch (error) {
      console.error('Alternative method failed:', error);
      return [];
    }
  }

  // 5. Verificar si ya seguimos
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

  // 6. Seguir usuario
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
        updateCounters();
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
          // ✅ FOLLOW EXITOSO
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
      
      // ❌ FOLLOW FALLADO
      logMessage(`❌ Failed @${user.username}`, 'error');
      STATE.failed.push(user);
      updateCounters();
      return { success: false, reason: 'api_error' };
      
    } catch (error) {
      logMessage(`⚠️ Error @${user.username}: ${error.message}`, 'error');
      STATE.failed.push(user);
      updateCounters();
      return { success: false, reason: 'exception' };
    }
  }

  // ========== LÓGICA PRINCIPAL ==========
  async function scanLikers() {
    const postUrl = document.getElementById('targetPostUrl').value.trim();
    if (!postUrl) {
      alert('Please enter a post URL');
      return;
    }

    if (!postUrl.includes('instagram.com')) {
      alert('Please enter a valid Instagram post URL');
      return;
    }

    STATE.status = 'scanning';
    updateStatus('Scanning...', '#3b82f6');
    logMessage(`🎯 Scanning likes from post...`, 'info');
    
    // RESETAR TODOS LOS ESTADOS
    STATE.scannedLikers = [];
    STATE.alreadyFollowing = [];
    STATE.pendingToFollow = [];
    STATE.completed = [];
    STATE.failed = [];
    
    // Obtener likers
    const likers = await fetchLikersFromPost(postUrl);
    
    // Si falla el método principal, intentar alternativo
    if (likers.length === 0) {
      logMessage('Trying alternative method...', 'warning');
      const altLikers = await fetchLikersAlternative(postUrl);
      if (altLikers.length > 0) {
        STATE.scannedLikers = altLikers;
        logMessage(`✅ Found ${altLikers.length} likers via alternative method`, 'success');
      } else {
        updateStatus('No likers found', '#ef4444');
        logMessage('Could not fetch likers. The post might be private or deleted.', 'error');
        STATE.status = 'idle';
        return;
      }
    } else {
      STATE.scannedLikers = likers;
    }
    
    // Verificar cuáles ya seguimos
    updateStatus('Checking follows...', '#3b82f6');
    const batchSize = 5;
    
    for (let i = 0; i < STATE.scannedLikers.length; i += batchSize) {
      if (STATE.status !== 'scanning') break;
      
      const batch = STATE.scannedLikers.slice(i, i + batchSize);
      const promises = batch.map(liker => checkIfFollowing(liker.id));
      const results = await Promise.all(promises);
      
      results.forEach((isFollowing, index) => {
        const liker = batch[index];
        if (isFollowing) {
          STATE.alreadyFollowing.push(liker);
        } else {
          STATE.pendingToFollow.push(liker);
        }
      });
      
      updateUI({
        progress: 50 + Math.round(i / STATE.scannedLikers.length * 50),
        following: STATE.alreadyFollowing.length,
        pending: STATE.pendingToFollow.length
      });
      
      await sleep(1000 + Math.random() * 1000);
    }
    
    // Aplicar aleatoriedad si está configurado
    if (CONFIG.RANDOMIZE_ORDER) {
      STATE.pendingToFollow = shuffleArray(STATE.pendingToFollow);
    }
    
    updateCounters();
    
    updateUI({
      progress: 100,
      found: STATE.scannedLikers.length,
      following: STATE.alreadyFollowing.length,
      pending: STATE.pendingToFollow.length
    });
    
    updateStatus('Ready!', '#22c55e');
    logMessage(`📊 Scan complete: ${STATE.scannedLikers.length} total likers, ${STATE.alreadyFollowing.length} already followed, ${STATE.pendingToFollow.length} pending`, 'success');
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
      
      const batchSize = CONFIG.FOLLOW_BATCH_SIZE + 
                       Math.floor(Math.random() * (CONFIG.BATCH_SIZE_VARIATION * 2 + 1)) - 
                       CONFIG.BATCH_SIZE_VARIATION;
      
      const actualBatchSize = Math.max(1, Math.min(5, batchSize));
      const actualBatchSizeFinal = Math.min(actualBatchSize, STATE.pendingToFollow.length);
      
      // Aplicar shuffle cada batch si está configurado
      if (CONFIG.SHUFFLE_EVERY_BATCH) {
        STATE.pendingToFollow = shuffleArray(STATE.pendingToFollow);
      }
      
      const batch = STATE.pendingToFollow.slice(0, actualBatchSizeFinal);
      
      logMessage(`🔄 Batch #${batchNumber}: ${actualBatchSizeFinal} users`, 'info');
      
      // Procesar batch
      for (const user of batch) {
        if (STATE.status !== 'following') break;
        
        await followUser(user);
        
        // Actualizar UI para progreso
        updateUI({
          pending: STATE.pendingToFollow.length,
          progress: Math.round((STATE.completed.length / STATE.scannedLikers.length) * 100)
        });
      }
      
      // Delay entre batches
      if (STATE.pendingToFollow.length > 0 && STATE.status === 'following') {
        const batchDelay = CONFIG.DELAY_BETWEEN_BATCHES.min + 
                          Math.random() * (CONFIG.DELAY_BETWEEN_BATCHES.max - CONFIG.DELAY_BETWEEN_BATCHES.min);
        
        const batchDelayMinutes = Math.round(batchDelay / 60000);
        
        logMessage(`⏸️ Next batch in ${batchDelayMinutes}m`, 'info');
        updateStatus(`Next in ${batchDelayMinutes}m`);
        
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
      logMessage(`🎉 Completed: ${STATE.completed.length} followed successfully, ${STATE.failed.length} failed`, 'success');
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
      position: fixed;
      top: 20px;
      right: 20px;
      width: 380px;
      max-height: 550px;
      background: rgba(15, 23, 42, 0.98);
      color: white;
      z-index: 999999;
      padding: 15px;
      font-family: 'Segoe UI', system-ui, sans-serif;
      border-radius: 12px;
      border: 2px solid #8b5cf6;
      box-shadow: 0 8px 32px rgba(139, 92, 246, 0.3);
      backdrop-filter: blur(10px);
      overflow-y: auto;
    `;

    overlay.innerHTML = `
      <div style="margin-bottom: 15px;">
        <h3 style="margin: 0 0 10px 0; color: #8b5cf6; font-size: 16px;">
          ❤️ Instagram Like Follower Bot
        </h3>
        <div style="font-size: 11px; color: #9ca3af;">
          Follows users who liked a specific post
        </div>
      </div>
      
      <div style="margin-bottom: 15px;">
        <div style="margin-bottom: 10px;">
          <label style="display: block; font-size: 12px; color: #cbd5e1; margin-bottom: 4px;">
            Instagram Post URL:
          </label>
          <input type="text" id="targetPostUrl" 
                 placeholder="https://www.instagram.com/p/ABC123..." 
                 style="width: 100%; padding: 8px 12px; background: rgba(30, 41, 59, 0.7); 
                        color: white; border: 1px solid #4b5563; border-radius: 6px;
                        font-size: 13px;">
        </div>
        <button id="scanBtn" style="width: 100%; padding: 10px; background: #8b5cf6; color: white; 
                  border: none; border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 14px;">
          🔍 Scan Likes
        </button>
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
            <div id="progressBar" style="height: 100%; width: 0%; background: linear-gradient(90deg, #8b5cf6, #10b981); 
                  transition: width 0.3s ease;"></div>
          </div>
        </div>
      </div>
      
      <!-- 4 CONTADORES EN UNA FILA -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 15px;">
        <!-- TOTAL LIKERS -->
        <div style="background: rgba(34, 197, 94, 0.1); padding: 8px; border-radius: 6px; text-align: center;">
          <div style="font-size: 10px; color: #86efac;">Total Likers</div>
          <div id="totalCount" style="font-size: 16px; font-weight: bold; color: #22c55e;">0</div>
        </div>
        <!-- PENDIENTES -->
        <div style="background: rgba(59, 130, 246, 0.1); padding: 8px; border-radius: 6px; text-align: center;">
          <div style="font-size: 10px; color: #93c5fd;">Pending</div>
          <div id="pendingCount" style="font-size: 16px; font-weight: bold; color: #3b82f6;">0</div>
        </div>
        <!-- EXITOSOS -->
        <div style="background: rgba(34, 211, 238, 0.1); padding: 8px; border-radius: 6px; text-align: center;">
          <div style="font-size: 10px; color: #67e8f9;">Done</div>
          <div id="doneCount" style="font-size: 16px; font-weight: bold; color: #06b6d4;">0</div>
        </div>
        <!-- FALLADOS -->
        <div style="background: rgba(239, 68, 68, 0.1); padding: 8px; border-radius: 6px; text-align: center;">
          <div style="font-size: 10px; color: #fca5a5;">Failed</div>
          <div id="failedCount" style="font-size: 16px; font-weight: bold; color: #ef4444;">0</div>
        </div>
      </div>
      
      <!-- CONTADORES DE LÍMITES -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 15px;">
        <div style="background: rgba(245, 158, 11, 0.1); padding: 6px; border-radius: 6px; text-align: center;">
          <div style="font-size: 9px; color: #fde047;">Daily</div>
          <div id="dailyCounter" style="font-size: 14px; font-weight: bold; color: #f59e0b;">${STATE.dailyCounter}/${CONFIG.MAX_FOLLOWS_PER_DAY}</div>
        </div>
        <div style="background: rgba(99, 102, 241, 0.1); padding: 6px; border-radius: 6px; text-align: center;">
          <div style="font-size: 9px; color: #a5b4fc;">Hourly</div>
          <div id="hourlyCounter" style="font-size: 14px; font-weight: bold; color: #6366f1;">${STATE.hourlyCounter}/${CONFIG.MAX_FOLLOWS_PER_HOUR}</div>
        </div>
      </div>
      
      <!-- BOTONES DE CONTROL -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
        <button id="startBtn" style="padding: 10px; background: #10b981; 
                color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
          ▶ Start Following
        </button>
        <button id="pauseBtn" style="padding: 10px; background: #f59e0b; 
                color: black; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
          ⏸ Pause
        </button>
      </div>
      
      <!-- CONFIGURACIÓN -->
      <div style="font-size: 11px; color: #9ca3af; margin-bottom: 10px; padding: 8px; background: rgba(30, 41, 59, 0.5); border-radius: 6px;">
        <div>⚡ Follow delay: ${CONFIG.DELAY_BETWEEN_FOLLOWS.min/60000}-${CONFIG.DELAY_BETWEEN_FOLLOWS.max/60000} min</div>
        <div>⏸️ Batch delay: ${CONFIG.DELAY_BETWEEN_BATCHES.min/60000}-${CONFIG.DELAY_BETWEEN_BATCHES.max/60000} min</div>
        <div>🎯 Daily limit: ${CONFIG.MAX_FOLLOWS_PER_DAY} follows/day</div>
        <div>📊 Supports: Posts, Reels, IGTV</div>
      </div>
      
      <!-- LOG DE ACTIVIDAD -->
      <div id="logContainer" style="height: 120px; overflow-y: auto; background: rgba(15, 23, 42, 0.8); 
            border-radius: 6px; padding: 10px; margin-bottom: 10px;">
        <div id="log" style="color: #d1d5db; font-size: 11px;"></div>
      </div>
      
      <!-- BOTÓN STOP -->
      <div style="text-align: center;">
        <button id="stopBtn" style="padding: 8px 16px; background: rgba(239, 68, 68, 0.2); 
                color: #fca5a5; border: 1px solid #f87171; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500;">
          ⏹ Stop Process
        </button>
      </div>
    `;

    document.body.appendChild(overlay);
    attachEventListeners();
    updateLimitCounters();
  }

  function updateStatus(text, color = '#a7f3d0') {
    const element = document.getElementById('statusText');
    if (element) {
      element.textContent = text;
      element.style.color = color;
    }
  }

  function updateUI(data) {
    // Actualizar contadores principales
    if (data.found !== undefined) {
      document.getElementById('totalCount').textContent = data.found;
    }
    if (data.pending !== undefined) {
      document.getElementById('pendingCount').textContent = data.pending;
    }
    // doneCount y failedCount se actualizan con updateCounters()
    if (data.progress !== undefined) {
      document.getElementById('progressBar').style.width = `${data.progress}%`;
      document.getElementById('progressText').textContent = `${data.progress}%`;
    }
    
    // Actualizar contadores de límites
    updateLimitCounters();
  }

  function updateLimitCounters() {
    const dailyEl = document.getElementById('dailyCounter');
    const hourlyEl = document.getElementById('hourlyCounter');
    
    if (dailyEl) dailyEl.textContent = `${STATE.dailyCounter}/${CONFIG.MAX_FOLLOWS_PER_DAY}`;
    if (hourlyEl) hourlyEl.textContent = `${STATE.hourlyCounter}/${CONFIG.MAX_FOLLOWS_PER_HOUR}`;
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
      case 'info': color = '#8b5cf6'; break;
    }
    
    logElement.innerHTML += `<div style="color: ${color}; margin-bottom: 2px;">
      <span style="color: #9ca3af;">[${time}]</span> ${message}
    </div>`;
    
    logElement.parentElement.scrollTop = logElement.parentElement.scrollHeight;
  }

  function attachEventListeners() {
    document.getElementById('scanBtn')?.addEventListener('click', scanLikers);
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
      updateLimitCounters();
      logMessage(`📊 Final stats: ${STATE.completed.length} successful, ${STATE.failed.length} failed`, 'info');
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
    logMessage('❤️ Instagram Like Follower Bot initialized', 'success');
    logMessage('📊 Follows users who liked a specific post', 'info');
    logMessage('⚠️ Paste a post URL and click "Scan Likes"', 'warning');
    updateCounters();
  }

  // Iniciar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    setTimeout(initialize, 1000);
  }
})();
