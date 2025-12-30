(() => {
  "use strict";

  // ========== CONFIGURACIÓN ACTUALIZADA ==========
  const CONFIG = {
    FOLLOW_BATCH_SIZE: 8,
    BATCH_SIZE_VARIATION: 3,
    DELAY_BETWEEN_FOLLOWS: {
      min: 90000,   // 1.5 minutos
      max: 180000   // 3 minutos
    },
    DELAY_BETWEEN_BATCHES: {
      min: 240000,  // 4 minutos
      max: 480000   // 8 minutos
    },
    MAX_FOLLOWS_PER_DAY: 80,
    MAX_FOLLOWS_PER_HOUR: 40,
    RANDOMIZE_ORDER: true,
    SHUFFLE_EVERY_BATCH: true,
    SKIP_PERCENTAGE: 15,
    SAVE_PROGRESS: false
  };

  // ========== ESTADO ==========
  const STATE = {
    status: "idle",
    scannedLikers: [],
    alreadyFollowing: [],
    pendingToFollow: [],
    completed: [],
    failed: [],
    skipped: [],
    dailyCounter: 0,
    hourlyCounter: 0,
    lastFollowTime: null,
    csrfToken: "",
    postId: null,
    postShortcode: null
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

  function updateCounters() {
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
      const patterns = [
        /instagram\.com\/p\/([a-zA-Z0-9_-]+)/,
        /instagram\.com\/reel\/([a-zA-Z0-9_-]+)/,
        /instagram\.com\/tv\/([a-zA-Z0-9_-]+)/
      ];
      
      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
          return match[1];
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error extracting post ID:', error);
      return null;
    }
  }

  // 3. OBTENER LIKERS DESDE LA PÁGINA HTML (MÉTODO PRINCIPAL MEJORADO)
  async function fetchLikersFromPage(postUrl) {
    try {
      console.log(`📥 Loading post page: ${postUrl}`);
      
      const response = await fetch(postUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Referer': 'https://www.instagram.com/',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-origin'
        },
        credentials: 'include',
        redirect: 'follow'
      });

      if (!response.ok) {
        console.warn(`Failed to load page: ${response.status}`);
        return [];
      }

      const html = await response.text();
      
      // Buscar window._sharedData primero
      const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.*?});/s);
      if (sharedDataMatch) {
        try {
          const sharedData = JSON.parse(sharedDataMatch[1]);
          console.log('✅ Found sharedData');
          
          // Intentar obtener datos del post
          const postData = sharedData.entry_data?.PostPage?.[0]?.graphql?.shortcode_media;
          if (postData) {
            // Guardar shortcode para uso posterior
            STATE.postShortcode = postData.shortcode;
            STATE.postId = postData.id;
            
            // Obtener likes iniciales
            const initialLikers = [];
            if (postData.edge_media_preview_like?.edges) {
              postData.edge_media_preview_like.edges.forEach(edge => {
                if (edge.node) {
                  initialLikers.push({
                    id: edge.node.id,
                    username: edge.node.username,
                    full_name: edge.node.full_name || '',
                    profile_pic_url: edge.node.profile_pic_url,
                    is_private: edge.node.is_private || false,
                    is_verified: edge.node.is_verified || false
                  });
                }
              });
            }
            
            // Si hay más likes, usar la API para obtener el resto
            const totalLikes = postData.edge_media_preview_like?.count || 0;
            logMessage(`📊 Found ${initialLikers.length} initial likers (Total: ${totalLikes})`, 'info');
            
            if (totalLikes > initialLikers.length && STATE.postId) {
              logMessage(`📥 Fetching remaining likers via API...`, 'info');
              const remainingLikers = await fetchRemainingLikers();
              return [...initialLikers, ...remainingLikers];
            }
            
            return initialLikers;
          }
        } catch (e) {
          console.warn('Failed to parse sharedData:', e);
        }
      }
      
      // Método alternativo: buscar datos adicionales
      const additionalDataMatch = html.match(/window\.__additionalDataLoaded\s*\([^,]+,({.*?})\);/s);
      if (additionalDataMatch) {
        try {
          const additionalData = JSON.parse(additionalDataMatch[1]);
          const graphql = additionalData.graphql?.shortcode_media;
          if (graphql) {
            const likers = [];
            if (graphql.edge_media_preview_like?.edges) {
              graphql.edge_media_preview_like.edges.forEach(edge => {
                if (edge.node) {
                  likers.push({
                    id: edge.node.id,
                    username: edge.node.username,
                    full_name: edge.node.full_name || '',
                    profile_pic_url: edge.node.profile_pic_url,
                    is_private: edge.node.is_private || false,
                    is_verified: edge.node.is_verified || false
                  });
                }
              });
            }
            return likers;
          }
        } catch (e) {
          console.warn('Failed to parse additionalData:', e);
        }
      }
      
      return [];
      
    } catch (error) {
      console.error('Error fetching likers from page:', error);
      return [];
    }
  }

  // 4. OBTENER LIKERS RESTANTES VÍA API
  async function fetchRemainingLikers() {
    if (!STATE.postId) return [];
    
    const allLikers = [];
    let after = null;
    let attempt = 0;
    const maxAttempts = 3;
    
    while (attempt < maxAttempts) {
      attempt++;
      
      try {
        // Usar endpoint de la API web
        const url = after 
          ? `https://www.instagram.com/graphql/query/?query_hash=d5d763b1e2acf209d62d22d184488e57&variables=${encodeURIComponent(JSON.stringify({
              shortcode: STATE.postShortcode,
              include_reel: true,
              first: 24,
              after: after
            }))}`
          : `https://www.instagram.com/graphql/query/?query_hash=d5d763b1e2acf209d62d22d184488e57&variables=${encodeURIComponent(JSON.stringify({
              shortcode: STATE.postShortcode,
              include_reel: true,
              first: 24
            }))}`;
        
        console.log(`🔍 Fetching API page ${attempt}: ${url.substring(0, 100)}...`);
        
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'X-IG-App-ID': '936619743392459',
            'X-CSRFToken': STATE.csrfToken,
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': `https://www.instagram.com/p/${STATE.postShortcode}/`,
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin'
          },
          credentials: 'include'
        });

        if (!response.ok) {
          console.warn(`API response ${response.status}`);
          if (response.status === 429) {
            logMessage('⏸️ Rate limited, waiting 30 seconds...', 'warning');
            await sleep(30000);
            continue;
          }
          break;
        }

        const data = await response.json();
        
        if (data.data?.shortcode_media?.edge_liked_by?.edges) {
          const edges = data.data.shortcode_media.edge_liked_by.edges;
          const likers = edges.map(edge => ({
            id: edge.node.id,
            username: edge.node.username,
            full_name: edge.node.full_name || '',
            profile_pic_url: edge.node.profile_pic_url,
            is_private: edge.node.is_private || false,
            is_verified: edge.node.is_verified || false
          }));
          
          allLikers.push(...likers);
          logMessage(`📄 API page ${attempt}: Found ${likers.length} likers`, 'info');
          
          // Verificar si hay más páginas
          const pageInfo = data.data.shortcode_media.edge_liked_by.page_info;
          if (pageInfo?.has_next_page && pageInfo.end_cursor) {
            after = pageInfo.end_cursor;
            await sleep(2000 + Math.random() * 2000);
            continue;
          }
        }
        
        break;
        
      } catch (error) {
        console.warn(`API attempt ${attempt} failed:`, error);
        await sleep(5000);
      }
    }
    
    return allLikers;
  }

  // 5. MÉTODO SIMPLE PARA OBTENER LIKERS (FALLBACK)
  async function fetchLikersSimple(postUrl) {
    try {
      console.log('🔄 Using simple method...');
      
      const response = await fetch(postUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        credentials: 'include'
      });

      if (!response.ok) return [];
      
      const html = await response.text();
      
      // Buscar usuarios en el HTML
      const userPatterns = [
        /"username":"([^"]+)"/g,
        /"id":"(\d+)","username":"([^"]+)"/g,
        /"user":{"id":"(\d+)","username":"([^"]+)"}/g
      ];
      
      const foundUsers = new Set();
      const likers = [];
      
      for (const pattern of userPatterns) {
        const matches = html.matchAll(pattern);
        for (const match of matches) {
          const username = match[2] || match[1];
          const userId = match[1] || '';
          
          if (username && !foundUsers.has(username) && username !== 'instagram') {
            foundUsers.add(username);
            likers.push({
              id: userId || `temp_${Date.now()}_${Math.random()}`,
              username: username,
              full_name: '',
              profile_pic_url: '',
              is_private: false,
              is_verified: false
            });
          }
        }
      }
      
      // Eliminar duplicados
      const uniqueLikers = [];
      const usernamesSeen = new Set();
      
      likers.forEach(liker => {
        if (!usernamesSeen.has(liker.username)) {
          usernamesSeen.add(liker.username);
          uniqueLikers.push(liker);
        }
      });
      
      return uniqueLikers;
      
    } catch (error) {
      console.error('Simple method failed:', error);
      return [];
    }
  }

  // 6. Verificar si ya seguimos
  async function checkIfFollowing(userId) {
    try {
      // Primero verificar si es un ID temporal
      if (userId.startsWith('temp_')) {
        return false;
      }
      
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

  // 7. Seguir usuario
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

      // Si es un ID temporal, buscar el ID real
      let actualUserId = user.id;
      if (user.id.startsWith('temp_')) {
        logMessage(`🔍 Looking up ID for @${user.username}...`, 'info');
        const realId = await getUserIdFromUsername(user.username);
        if (!realId) {
          logMessage(`❌ Could not find ID for @${user.username}`, 'error');
          STATE.failed.push(user);
          updateCounters();
          return { success: false, reason: 'user_not_found' };
        }
        actualUserId = realId;
        user.id = realId; // Actualizar el ID para futuras referencias
      }

      // Verificar si ya seguimos
      const alreadyFollowing = await checkIfFollowing(actualUserId);
      if (alreadyFollowing) {
        logMessage(`✓ Already following @${user.username}`, 'info');
        STATE.alreadyFollowing.push(user);
        STATE.pendingToFollow = STATE.pendingToFollow.filter(u => u.username !== user.username);
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
      formData.append('user_id', actualUserId);
      
      const response = await fetch(`https://www.instagram.com/api/v1/web/friendships/${actualUserId}/follow/`, {
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
          STATE.pendingToFollow = STATE.pendingToFollow.filter(u => u.username !== user.username);
          
          logMessage(`✅ Followed @${user.username}`, 'success');
          updateCounters();
          updateLimitCounters();
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

  // 8. Obtener User ID desde username
  async function getUserIdFromUsername(username) {
    try {
      const response = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'X-IG-App-ID': '936619743392459',
          'X-CSRFToken': STATE.csrfToken
        },
        credentials: 'include'
      });

      if (!response.ok) return null;
      
      const data = await response.json();
      return data.data?.user?.id || null;
      
    } catch (error) {
      console.warn('Error getting user ID:', error);
      return null;
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
    
    // RESETAR ESTADOS
    STATE.scannedLikers = [];
    STATE.alreadyFollowing = [];
    STATE.pendingToFollow = [];
    STATE.completed = [];
    STATE.failed = [];
    STATE.dailyCounter = 0;
    STATE.hourlyCounter = 0;
    
    updateCounters();
    updateLimitCounters();
    
    // Extraer shortcode
    const shortcode = extractPostIdFromUrl(postUrl);
    if (!shortcode) {
      updateStatus('Invalid URL', '#ef4444');
      logMessage('Could not extract post ID from URL', 'error');
      STATE.status = 'idle';
      return;
    }
    
    STATE.postShortcode = shortcode;
    
    // Intentar método principal
    logMessage(`🔍 Using primary method for post ${shortcode}...`, 'info');
    let likers = await fetchLikersFromPage(postUrl);
    
    // Si falla, intentar método simple
    if (likers.length === 0) {
      logMessage('🔄 Primary method failed, trying simple method...', 'warning');
      likers = await fetchLikersSimple(postUrl);
    }
    
    if (likers.length === 0) {
      updateStatus('No likers found', '#ef4444');
      logMessage('Could not fetch likers. The post might be private, deleted, or have no likes.', 'error');
      STATE.status = 'idle';
      return;
    }
    
    STATE.scannedLikers = likers;
    
    // Verificar cuáles ya seguimos
    updateStatus('Checking follows...', '#3b82f6');
    const batchSize = 3;
    
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
        found: STATE.scannedLikers.length,
        following: STATE.alreadyFollowing.length,
        pending: STATE.pendingToFollow.length
      });
      
      await sleep(1500 + Math.random() * 1000);
    }
    
    // Aplicar aleatoriedad
    if (CONFIG.RANDOMIZE_ORDER) {
      STATE.pendingToFollow = shuffleArray(STATE.pendingToFollow);
    }
    
    // Aplicar porcentaje de skip
    if (CONFIG.SKIP_PERCENTAGE > 0) {
      const skipCount = Math.floor(STATE.pendingToFollow.length * (CONFIG.SKIP_PERCENTAGE / 100));
      STATE.skipped = STATE.pendingToFollow.slice(0, skipCount);
      STATE.pendingToFollow = STATE.pendingToFollow.slice(skipCount);
      logMessage(`⏭️ Skipped ${skipCount} users (${CONFIG.SKIP_PERCENTAGE}%)`, 'info');
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
    let totalFollowed = 0;
    
    while (STATE.pendingToFollow.length > 0 && STATE.status === 'following') {
      batchNumber++;
      
      // Calcular tamaño del batch
      const batchSize = CONFIG.FOLLOW_BATCH_SIZE + 
                       Math.floor(Math.random() * (CONFIG.BATCH_SIZE_VARIATION * 2 + 1)) - 
                       CONFIG.BATCH_SIZE_VARIATION;
      
      const actualBatchSize = Math.max(1, Math.min(8, batchSize));
      const actualBatchSizeFinal = Math.min(actualBatchSize, STATE.pendingToFollow.length);
      
      // Shuffle cada batch si está configurado
      if (CONFIG.SHUFFLE_EVERY_BATCH) {
        STATE.pendingToFollow = shuffleArray(STATE.pendingToFollow);
      }
      
      const batch = STATE.pendingToFollow.slice(0, actualBatchSizeFinal);
      
      logMessage(`🔄 Batch #${batchNumber}: ${actualBatchSizeFinal} users`, 'info');
      
      // Procesar batch
      for (const user of batch) {
        if (STATE.status !== 'following') break;
        
        const result = await followUser(user);
        
        if (result.success && !result.alreadyFollowing) {
          totalFollowed++;
        }
        
        // Actualizar UI
        updateUI({
          pending: STATE.pendingToFollow.length,
          progress: Math.round((STATE.completed.length / STATE.scannedLikers.length) * 100)
        });
        
        // Pequeño delay entre follows dentro del batch
        if (STATE.status === 'following') {
          await sleep(1000 + Math.random() * 2000);
        }
      }
      
      // Delay entre batches
      if (STATE.pendingToFollow.length > 0 && STATE.status === 'following') {
        const batchDelay = CONFIG.DELAY_BETWEEN_BATCHES.min + 
                          Math.random() * (CONFIG.DELAY_BETWEEN_BATCHES.max - CONFIG.DELAY_BETWEEN_BATCHES.min);
        
        const batchDelayMinutes = Math.round(batchDelay / 60000);
        
        logMessage(`⏸️ Next batch in ${batchDelayMinutes}m (Total followed: ${totalFollowed})`, 'info');
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
        updateLimitCounters();
      }
    }
    
    if (STATE.pendingToFollow.length === 0) {
      updateStatus('✅ Done!', '#22c55e');
      logMessage(`🎉 Completed: ${STATE.completed.length} followed successfully, ${STATE.failed.length} failed, ${STATE.skipped.length} skipped`, 'success');
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
      max-height: 580px;
      background: rgba(15, 23, 42, 0.98);
      color: white;
      z-index: 999999;
      padding: 15px;
      font-family: 'Segoe UI', system-ui, sans-serif;
      border-radius: 12px;
      border: 2px solid #ec4899;
      box-shadow: 0 8px 32px rgba(236, 72, 153, 0.3);
      backdrop-filter: blur(10px);
      overflow-y: auto;
    `;

    overlay.innerHTML = `
      <div style="margin-bottom: 15px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
          <div style="color: #ec4899; font-size: 20px;">❤️</div>
          <h3 style="margin: 0; color: #ec4899; font-size: 16px; flex: 1;">
            Instagram Like Follower
          </h3>
          <div style="font-size: 10px; background: rgba(236, 72, 153, 0.2); padding: 2px 6px; border-radius: 10px; color: #f472b6;">
            V2.0
          </div>
        </div>
        <div style="font-size: 11px; color: #9ca3af; line-height: 1.4;">
          Follows users who liked a specific post. Works with posts, reels, and IGTV.
        </div>
      </div>
      
      <div style="margin-bottom: 15px;">
        <div style="margin-bottom: 10px;">
          <label style="display: block; font-size: 12px; color: #cbd5e1; margin-bottom: 4px;">
            📎 Instagram Post URL:
          </label>
          <input type="text" id="targetPostUrl" 
                 placeholder="https://www.instagram.com/p/ABC123... or /reel/ABC123..."
                 style="width: 100%; padding: 10px 12px; background: rgba(30, 41, 59, 0.7); 
                        color: white; border: 1px solid #4b5563; border-radius: 8px;
                        font-size: 13px; outline: none; transition: border 0.2s;">
        </div>
        <button id="scanBtn" style="width: 100%; padding: 12px; background: linear-gradient(135deg, #ec4899, #8b5cf6); 
                  color: white; border: none; border-radius: 8px; cursor: pointer; 
                  font-weight: 600; font-size: 14px; transition: opacity 0.2s;">
          🔍 Scan Likes from Post
        </button>
      </div>
      
      <div style="background: rgba(30, 41, 59, 0.7); border-radius: 8px; padding: 12px; margin-bottom: 15px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span style="color: #d1d5db; font-size: 12px;">📈 Status</span>
          <span id="statusText" style="color: #a7f3d0; font-size: 12px; font-weight: 500;">Ready</span>
        </div>
        
        <div style="margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px;">
            <span style="color: #9ca3af;">Progress</span>
            <span id="progressText">0%</span>
          </div>
          <div style="height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden;">
            <div id="progressBar" style="height: 100%; width: 0%; background: linear-gradient(90deg, #ec4899, #10b981); 
                  transition: width 0.3s ease; border-radius: 4px;"></div>
          </div>
        </div>
      </div>
      
      <!-- ESTADÍSTICAS PRINCIPALES -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 15px;">
        <div style="background: rgba(34, 197, 94, 0.15); padding: 10px; border-radius: 8px; text-align: center; border: 1px solid rgba(34, 197, 94, 0.3);">
          <div style="font-size: 10px; color: #86efac; margin-bottom: 4px;">❤️ Likers</div>
          <div id="totalCount" style="font-size: 18px; font-weight: bold; color: #22c55e;">0</div>
        </div>
        <div style="background: rgba(59, 130, 246, 0.15); padding: 10px; border-radius: 8px; text-align: center; border: 1px solid rgba(59, 130, 246, 0.3);">
          <div style="font-size: 10px; color: #93c5fd; margin-bottom: 4px;">⏳ Pending</div>
          <div id="pendingCount" style="font-size: 18px; font-weight: bold; color: #3b82f6;">0</div>
        </div>
        <div style="background: rgba(34, 211, 238, 0.15); padding: 10px; border-radius: 8px; text-align: center; border: 1px solid rgba(34, 211, 238, 0.3);">
          <div style="font-size: 10px; color: #67e8f9; margin-bottom: 4px;">✅ Done</div>
          <div id="doneCount" style="font-size: 18px; font-weight: bold; color: #06b6d4;">0</div>
        </div>
        <div style="background: rgba(239, 68, 68, 0.15); padding: 10px; border-radius: 8px; text-align: center; border: 1px solid rgba(239, 68, 68, 0.3);">
          <div style="font-size: 10px; color: #fca5a5; margin-bottom: 4px;">❌ Failed</div>
          <div id="failedCount" style="font-size: 18px; font-weight: bold; color: #ef4444;">0</div>
        </div>
      </div>
      
      <!-- LÍMITES Y CONTROLES -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 15px;">
        <div style="background: rgba(245, 158, 11, 0.15); padding: 8px; border-radius: 8px; text-align: center; border: 1px solid rgba(245, 158, 11, 0.3);">
          <div style="font-size: 9px; color: #fde047; margin-bottom: 2px;">📅 Daily</div>
          <div id="dailyCounter" style="font-size: 14px; font-weight: bold; color: #f59e0b;">0/${CONFIG.MAX_FOLLOWS_PER_DAY}</div>
        </div>
        <div style="background: rgba(99, 102, 241, 0.15); padding: 8px; border-radius: 8px; text-align: center; border: 1px solid rgba(99, 102, 241, 0.3);">
          <div style="font-size: 9px; color: #a5b4fc; margin-bottom: 2px;">⏰ Hourly</div>
          <div id="hourlyCounter" style="font-size: 14px; font-weight: bold; color: #6366f1;">0/${CONFIG.MAX_FOLLOWS_PER_HOUR}</div>
        </div>
      </div>
      
      <!-- BOTONES DE CONTROL -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
        <button id="startBtn" style="padding: 12px; background: linear-gradient(135deg, #10b981, #059669); 
                color: white; border: none; border-radius: 8px; cursor: pointer; 
                font-weight: 600; font-size: 13px; transition: opacity 0.2s;">
          ▶ Start Following
        </button>
        <button id="pauseBtn" style="padding: 12px; background: linear-gradient(135deg, #f59e0b, #d97706); 
                color: white; border: none; border-radius: 8px; cursor: pointer; 
                font-weight: 600; font-size: 13px; transition: opacity 0.2s;">
          ⏸ Pause/Resume
        </button>
      </div>
      
      <!-- CONFIG INFO -->
      <div style="font-size: 11px; color: #9ca3af; margin-bottom: 10px; padding: 10px; background: rgba(30, 41, 59, 0.5); border-radius: 8px; line-height: 1.5;">
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
          <span>⚡</span>
          <span>Follow delay: ${CONFIG.DELAY_BETWEEN_FOLLOWS.min/60000}-${CONFIG.DELAY_BETWEEN_FOLLOWS.max/60000} min</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
          <span>⏸️</span>
          <span>Batch delay: ${CONFIG.DELAY_BETWEEN_BATCHES.min/60000}-${CONFIG.DELAY_BETWEEN_BATCHES.max/60000} min</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span>🎯</span>
          <span>Skip rate: ${CONFIG.SKIP_PERCENTAGE}% random users</span>
        </div>
      </div>
      
      <!-- LOG DE ACTIVIDAD -->
      <div style="margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="color: #d1d5db; font-size: 12px;">📝 Activity Log</span>
          <button id="clearLogBtn" style="padding: 4px 8px; background: rgba(156, 163, 175, 0.2); 
                  color: #9ca3af; border: 1px solid #4b5563; border-radius: 4px; 
                  cursor: pointer; font-size: 10px;">
            Clear
          </button>
        </div>
        <div id="logContainer" style="height: 120px; overflow-y: auto; background: rgba(15, 23, 42, 0.8); 
              border-radius: 8px; padding: 10px; border: 1px solid rgba(255,255,255,0.1);">
          <div id="log" style="color: #d1d5db; font-size: 11px; line-height: 1.4;"></div>
        </div>
      </div>
      
      <!-- BOTÓN STOP -->
      <div style="text-align: center;">
        <button id="stopBtn" style="padding: 10px 20px; background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(220, 38, 38, 0.2)); 
                color: #fca5a5; border: 1px solid #f87171; border-radius: 8px; 
                cursor: pointer; font-size: 12px; font-weight: 500; width: 100%;">
          ⏹ Stop Process & Reset
        </button>
      </div>
      
      <div style="margin-top: 10px; text-align: center; font-size: 10px; color: #6b7280;">
        Works with public posts • Requires Instagram login • Use responsibly
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
    if (data.found !== undefined) {
      document.getElementById('totalCount').textContent = data.found;
    }
    if (data.pending !== undefined) {
      document.getElementById('pendingCount').textContent = data.pending;
    }
    if (data.progress !== undefined) {
      const progress = Math.max(0, Math.min(100, data.progress));
      document.getElementById('progressBar').style.width = `${progress}%`;
      document.getElementById('progressText').textContent = `${progress}%`;
    }
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
    let emoji = '📝';
    
    switch(type) {
      case 'success': color = '#10b981'; emoji = '✅'; break;
      case 'error': color = '#ef4444'; emoji = '❌'; break;
      case 'warning': color = '#f59e0b'; emoji = '⚠️'; break;
      case 'info': color = '#60a5fa'; emoji = 'ℹ️'; break;
    }
    
    logElement.innerHTML += `<div style="color: ${color}; margin-bottom: 3px; display: flex; align-items: flex-start; gap: 6px;">
      <span style="flex-shrink: 0; color: #9ca3af; font-size: 10px;">[${time}]</span>
      <span style="flex-shrink: 0;">${emoji}</span>
      <span style="flex: 1; word-break: break-word;">${message}</span>
    </div>`;
    
    logElement.parentElement.scrollTop = logElement.parentElement.scrollHeight;
  }

  function attachEventListeners() {
    // Input focus effects
    const postUrlInput = document.getElementById('targetPostUrl');
    if (postUrlInput) {
      postUrlInput.addEventListener('focus', function() {
        this.style.border = '1px solid #ec4899';
        this.style.boxShadow = '0 0 0 2px rgba(236, 72, 153, 0.1)';
      });
      postUrlInput.addEventListener('blur', function() {
        this.style.border = '1px solid #4b5563';
        this.style.boxShadow = 'none';
      });
    }
    
    // Botones
    document.getElementById('scanBtn')?.addEventListener('click', scanLikers);
    document.getElementById('startBtn')?.addEventListener('click', startFollowing);
    
    document.getElementById('pauseBtn')?.addEventListener('click', () => {
      if (STATE.status === 'following') {
        STATE.status = 'paused';
        updateStatus('Paused', '#f59e0b');
        logMessage('⏸️ Process paused', 'warning');
      } else if (STATE.status === 'paused') {
        STATE.status = 'following';
        updateStatus('Resuming...', '#10b981');
        logMessage('▶️ Process resumed', 'info');
      } else if (STATE.status === 'scanning') {
        STATE.status = 'idle';
        updateStatus('Scan stopped', '#ef4444');
        logMessage('⏹️ Scan stopped', 'error');
      }
    });
    
    document.getElementById('stopBtn')?.addEventListener('click', () => {
      STATE.status = 'idle';
      updateStatus('Stopped', '#ef4444');
      logMessage('🛑 Process stopped and reset', 'error');
      logMessage(`📊 Final stats: ${STATE.completed.length} followed, ${STATE.failed.length} failed, ${STATE.skipped.length} skipped`, 'info');
      updateCounters();
      updateLimitCounters();
    });
    
    document.getElementById('clearLogBtn')?.addEventListener('click', () => {
      const logElement = document.getElementById('log');
      if (logElement) {
        logElement.innerHTML = '';
        logMessage('📝 Log cleared', 'info');
      }
    });
    
    // Efectos hover en botones
    const buttons = ['scanBtn', 'startBtn', 'pauseBtn', 'stopBtn', 'clearLogBtn'];
    buttons.forEach(btnId => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.addEventListener('mouseenter', () => {
          btn.style.opacity = '0.9';
        });
        btn.addEventListener('mouseleave', () => {
          btn.style.opacity = '1';
        });
      }
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
      alert('⚠️ Please log in to Instagram first');
      return;
    }
    
    createUI();
    logMessage('❤️ Instagram Like Follower initialized', 'success');
    logMessage('📋 Paste a post/reel/IGTV URL and click "Scan Likes"', 'info');
    logMessage('⚙️ Delays: 1.5-3min per follow, 4-8min between batches', 'info');
    updateCounters();
    
    // Auto-focus en el input
    setTimeout(() => {
      const input = document.getElementById('targetPostUrl');
      if (input) input.focus();
    }, 500);
  }

  // Iniciar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    setTimeout(initialize, 1000);
  }
})();
