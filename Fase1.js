(() => {
  "use strict";

  const CONFIG = {
    MAX_PAGES: 15,          // Límite de páginas a escanear por sesión (50 usuarios/página)
    DELAY_BETWEEN_PAGES: { min: 4000, max: 8000 } // Retraso entre peticiones de GraphQL
  };

  const STATE = {
    targetUserId: null,
    queryHashes: ["c76146de99bb02f6415203be841dd25a", "e4623e756814ac975ee0f334aa24e740"],
    currentHashIndex: 0
  };

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function getCsrfToken() {
    return document.cookie.match(/csrftoken=([^;]+)/)?.[1] || 
           document.querySelector('meta[name="csrf-token"]')?.content || '';
  }

  async function getTargetUserId(username) {
    try {
      const response = await fetch(`https://www.instagram.com/${username}/`, { credentials: 'include' });
      if (!response.ok) return null;
      const html = await response.text();
      const match = html.match(/"profilePage_([0-9]+)"/) || 
                    html.match(/"id":"([0-9]+)".*?"username":"[^"]*"/) ||
                    html.match(/"user_id":"([0-9]+)"/);
      return match ? match[1] : null;
    } catch { return null; }
  }

  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function startExtractor() {
    const rawUsername = prompt("Ingresa el @usuario de Instagram a escanear (sin @):");
    if (!rawUsername) return;
    const username = rawUsername.trim().replace('@', '');

    console.log(`🔍 Buscando ID para @${username}...`);
    STATE.targetUserId = await getTargetUserId(username);
    
    if (!STATE.targetUserId) {
      alert("❌ No se pudo obtener el ID del usuario. Asegúrate de que la cuenta existe y es pública.");
      return;
    }

    let followers = [];
    let after = null;
    let page = 0;
    const csrfToken = getCsrfToken();

    console.log(`📥 Iniciando extracción de seguidores de @${username}...`);

    while (page < CONFIG.MAX_PAGES) {
      page++;
      const queryHash = STATE.queryHashes[STATE.currentHashIndex];
      const variables = { id: STATE.targetUserId, include_reel: false, fetch_mutual: false, first: 50 };
      if (after) variables.after = after;

      const url = `https://www.instagram.com/graphql/query/?query_hash=${queryHash}&variables=${encodeURIComponent(JSON.stringify(variables))}`;
      
      try {
        const response = await fetch(url, {
          headers: {
            'X-IG-App-ID': '936619743392459',
            'X-CSRFToken': csrfToken,
            'X-Requested-With': 'XMLHttpRequest'
          },
          credentials: 'include'
        });

        if (!response.ok) {
          console.warn(`⚠️ Error HTTP ${response.status}. Deteniendo escaneo...`);
          break;
        }

        const data = await response.json();
        const edges = data.data?.user?.edge_followed_by?.edges || [];

        edges.forEach(edge => {
          followers.push({
            id: edge.node.id,
            username: edge.node.username,
            full_name: edge.node.full_name,
            followed_by_viewer: edge.node.followed_by_viewer
          });
        });

        console.log(`📄 Página ${page}: +${edges.length} usuarios cargados. (Total: ${followers.length})`);

        const pageInfo = data.data?.user?.edge_followed_by?.page_info;
        if (!pageInfo?.has_next_page || !pageInfo?.end_cursor) break;
        after = pageInfo.end_cursor;

        const delay = CONFIG.DELAY_BETWEEN_PAGES.min + Math.random() * (CONFIG.DELAY_BETWEEN_PAGES.max - CONFIG.DELAY_BETWEEN_PAGES.min);
        await sleep(delay);

      } catch (err) {
        console.error("❌ Error durante la extracción:", err);
        break;
      }
    }

    if (followers.length > 0) {
      const fileData = {
        target_account: username,
        extracted_at: new Date().toISOString(),
        total_followers: followers.length,
        followers: followers
      };
      const fileName = `followers_${username}_${Date.now()}.json`;
      downloadJSON(fileData, fileName);
      alert(`✅ Extracción completada. Guardados ${followers.length} usuarios en ${fileName}`);
    } else {
      alert("⚠️ No se pudieron obtener seguidores.");
    }
  }

  startExtractor();
})();
