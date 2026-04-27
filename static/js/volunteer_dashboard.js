/* =====================================================
   volunteer_dashboard.js  (fixed)
   
   Fixes:
   1. "View Details" was navigating to /need/<match_id>/volunteer
      which always 404'd. Fixed to use task.need_id (the actual need doc id).
   2. Same fix in accepted tasks card.
   3. ngo_id added to enriched task data for chat links.
   ===================================================== */

let OLA_MAPS_API_KEY = null;

async function loadOlaMapsKey() {
  try {
    const res = await fetch("/api/get_ola_maps_key");
    if (!res.ok) throw new Error("Failed to fetch key");
    const data = await res.json();
    OLA_MAPS_API_KEY = data.OLA_MAPS_API_KEY;
  } catch (err) {
    console.error("Error loading Ola Maps key:", err);
  }
}

// Store tasks globally so modals can reference them
let _allMatchedTasks = [];

// ─────────────────────────────────────────────
// 1. INIT
// ─────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  showSkeletons();
  await loadOlaMapsKey();
  loadDashboard();
  initOnlineToggle();
  initNavDropdown();
  initKeyboardEscape();
  wireStaticModalButtons();
  startBackgroundTracking();
});


// ─────────────────────────────────────────────
// 2. MAIN DASHBOARD LOADER
// ─────────────────────────────────────────────

async function loadDashboard() {
  try {
    const res = await fetch("/api/volunteer/dashboard");

    if (res.status === 401) { window.location.href = "/getstarted"; return; }
    if (!res.ok) throw new Error("Failed to load dashboard");

    const data = await res.json();
    _allMatchedTasks = data.matched_tasks || [];

    renderWelcome(data.volunteer_name);
    renderStats(data.stats);
    renderTasksForYou(_allMatchedTasks);
    renderAcceptedTasks(data.accepted_tasks);
    renderCompletedHistory(data.completed_tasks || []);
    initMiniMap(_allMatchedTasks);
    populateAllTasksModal(_allMatchedTasks);
    updateMapModalBar(_allMatchedTasks.length);

  } catch (err) {
    console.error("Dashboard error:", err);
    showDashboardError();
  }
}


// ─────────────────────────────────────────────
// 3. WELCOME BAR
// ─────────────────────────────────────────────

function renderWelcome(name) {
  const el = document.getElementById("welcomeHeading");
  if (!el) return;
  const hour  = new Date().getHours();
  const emoji = hour < 12 ? "🌅" : hour < 17 ? "🌱" : "🌙";
  el.textContent = `Hello, ${name || "there"}! Ready to make a difference? ${emoji}`;

  const sub = document.getElementById("welcomeSub");
  if (sub && _allMatchedTasks.length > 0) {
    sub.textContent = `There are ${_allMatchedTasks.length} new requests in your neighbourhood today.`;
  }
}


// ─────────────────────────────────────────────
// 4. STATS ROW
// ─────────────────────────────────────────────

function renderStats(stats) {
  if (!stats) return;
  ["statMatched","statCompleted","statRating"].forEach(id => {
    document.getElementById(id)?.classList.remove("skel-pulse");
  });
  animateCounter("statMatched",   stats.tasks_matched   || 0);
  animateCounter("statCompleted", stats.tasks_completed || 0);
  setRating("statRating",         stats.rating          || 0);
}

function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  let current = 0;
  const steps = 40, interval = 800 / steps, inc = target / steps;
  const timer = setInterval(() => {
    current += inc;
    if (current >= target) { el.textContent = target; clearInterval(timer); }
    else el.textContent = Math.floor(current);
  }, interval);
}

function setRating(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = Number(value).toFixed(1);
}


// ─────────────────────────────────────────────
// 5. TASKS FOR YOU
// ─────────────────────────────────────────────

function renderTasksForYou(tasks) {
  const container = document.getElementById("tasksForYou");
  if (!container) return;

  if (!tasks || tasks.length === 0) {
    container.innerHTML = `
      <div style="padding:32px;text-align:center;color:#6e7a71;">
        <span class="material-symbols-outlined" style="font-size:2.5rem;display:block;margin-bottom:8px;">task_alt</span>
        <p style="font-weight:600;">No new tasks matched yet.</p>
        <p style="font-size:.82rem;margin-top:4px;">Check back soon — new needs are added daily.</p>
      </div>`;
    return;
  }

  container.innerHTML = tasks.slice(0, 2).map(task => buildTaskCard(task)).join("");
  wireTaskActions(container);
}

function buildTaskCard(task) {
  const uc = getUrgencyChip(task.urgency_label, task.urgency_score);
  // FIX: use task.need_id for the /need/ route, NOT task.id (which is the match id)
  const needId = escHtml(task.need_id || task.id);
  const ngoId  = escHtml(task.ngo_id  || "");

  return `
    <div class="task-card" data-task-id="${escHtml(task.id)}">
      <div class="task-top">
        <span class="urgency-chip ${uc.cls}">
          <span class="uc-dot"></span>${uc.label}
        </span>
        <span class="task-dist">
          <span class="material-symbols-outlined">distance</span>
          ${task.distance_km ? task.distance_km + " km" : "Nearby"}
        </span>
      </div>
      <div class="task-name">${escHtml(task.title)}</div>
      <div class="task-org">${escHtml(task.ngo_name || "NGO")} · ${escHtml(task.location || "")}</div>
      <div class="task-tags">
        ${(task.required_skills || []).slice(0, 3).map(s =>
          `<span class="task-tag">${escHtml(s)}</span>`
        ).join("")}
      </div>
      <div class="task-actions" style="display:flex;gap:8px;">
        <button class="btn-accept" data-id="${escHtml(task.id)}" style="flex:1;">Accept Task</button>
        ${ngoId ? `
        <button onclick="startChat('${ngoId}', '${needId}')"
                style="padding:0 12px;border-radius:99px;background:#eef2ff;border:1.5px solid #e0e7ff;color:#4338ca;cursor:pointer;display:flex;align-items:center;justify-content:center;"
                title="Chat with NGO">
          <span class="material-symbols-outlined" style="font-size:18px">chat</span>
        </button>` : ""}
        <button class="btn-decline" data-id="${escHtml(task.id)}">Decline</button>
      </div>
      <button class="view-details-btn" style="margin-top:12px;width:100%;justify-content:center;"
              onclick="window.location.href='/need/${needId}/volunteer'">
        View Details
      </button>
    </div>`;
}

// ── "View All" modal ──────────────────────────

function populateAllTasksModal(tasks) {
  const container = document.getElementById("allTasksBody");
  if (!container) return;

  const countEl = document.getElementById("allTasksCount");

  if (!tasks || tasks.length === 0) {
    if (countEl) countEl.textContent = "No tasks available in your area right now.";
    container.innerHTML = `
      <div style="padding:32px;text-align:center;color:#6e7a71;">
        <span class="material-symbols-outlined" style="font-size:2.5rem;display:block;margin-bottom:8px;">search_off</span>
        <p style="font-weight:600;">Nothing matched yet.</p>
        <p style="font-size:.82rem;margin-top:4px;">Check back soon!</p>
      </div>`;
    return;
  }

  if (countEl) countEl.textContent = `${tasks.length} task${tasks.length !== 1 ? "s" : ""} available in your area today`;
  container.innerHTML = tasks.map(task => buildTaskCard(task)).join("");
  wireTaskActions(container);
}

function wireTaskActions(container) {
  container.querySelectorAll(".btn-accept").forEach(btn => {
    btn.addEventListener("click", () => acceptTask(btn.dataset.id, btn));
  });
  container.querySelectorAll(".btn-decline").forEach(btn => {
    btn.addEventListener("click", () => declineTask(btn.dataset.id, btn));
  });
}


// ─────────────────────────────────────────────
// 6. ACCEPTED TASKS
// ─────────────────────────────────────────────

function renderAcceptedTasks(tasks) {
  const container = document.getElementById("acceptedTasksGrid");
  if (!container) return;

  if (!tasks || tasks.length === 0) {
    container.innerHTML = `
      <div style="padding:24px;text-align:center;color:#6e7a71;grid-column:1/-1;">
        <p style="font-weight:600;">No accepted tasks yet.</p>
        <p style="font-size:.82rem;margin-top:4px;">Accept a task above to get started.</p>
      </div>`;
    return;
  }

  container.innerHTML = tasks.map(task => {
    const progress    = task.progress_pct || 0;
    const statusCls   = task.status === "in_progress" ? "sc-green" : "sc-amber";
    const statusLabel = task.status === "in_progress" ? "In Progress" : "Confirmed";
    // FIX: use task.need_id for the route
    const needId = escHtml(task.need_id || task.id);
    const ngoId  = escHtml(task.ngo_id  || "");

    return `
      <div class="accepted-card" data-task-id="${escHtml(task.id)}">
        <div class="accepted-top">
          <div>
            <div class="accepted-name">${escHtml(task.title)}</div>
            <div class="accepted-due">${escHtml(task.deadline_text || "")}</div>
          </div>
          <span class="status-chip ${statusCls}">${statusLabel}</span>
        </div>
        <div style="margin-bottom:12px;">
          <button onclick="handleWorkAction('${escHtml(task.id)}', '${task.status === "in_progress" ? "pause" : "start"}', this)"
                  class="work-action-btn ${task.status === "in_progress" ? "pause" : "start"}"
                  style="width:100%; padding:8px; border-radius:8px; font-weight:700; font-size:0.75rem; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:all 0.2s;">
            <span class="material-symbols-outlined" style="font-size:16px;">${task.status === "in_progress" ? "pause_circle" : "play_circle"}</span>
            ${task.status === "in_progress" ? "Pause Work" : "Start Work"}
          </button>
        </div>
        <div>
          <div class="progress-label">
            <span>${escHtml(task.phase || "In Progress")}</span>
            <span>${progress}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${progress}%;"></div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button class="view-details-btn" style="flex:1;justify-content:center;"
                  onclick="window.location.href='/need/${needId}/volunteer'">
            View Details
          </button>
          ${ngoId ? `
          <button onclick="startChat('${ngoId}', '${needId}')"
                  style="padding:0 16px;border-radius:12px;background:#f0faf5;border:1.5px solid #006c4420;color:#006c44;cursor:pointer;display:flex;align-items:center;justify-content:center;"
                  title="Chat with NGO">
            <span class="material-symbols-outlined" style="font-size:20px">chat</span>
          </button>` : ""}
        </div>
      </div>`;
  }).join("");
}


function renderCompletedHistory(tasks) {
  const container = document.getElementById("historyTasksBody");
  if (!container) return;

  if (!tasks || tasks.length === 0) {
    container.innerHTML = `
      <div style="padding:32px;text-align:center;color:#6e7a71;">
        <span class="material-symbols-outlined" style="font-size:2rem;margin-bottom:8px;">history</span>
        <p>No completed tasks in your history yet.</p>
      </div>`;
    return;
  }

  container.innerHTML = tasks.map(task => `
    <div class="task-card" style="border-left:4px solid #006c44;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
        <div>
          <div class="task-name">${escHtml(task.title)}</div>
          <div class="task-org">${escHtml(task.ngo_name)} · Completed ${task.completed_at || ""}</div>
        </div>
        <span class="status-chip sc-green">Completed</span>
      </div>
      <button class="view-details-btn" onclick="window.location.href='/need/${escHtml(task.need_id)}/volunteer'">
        View Record
      </button>
    </div>
  `).join("");
}

// ── ACCEPT / DECLINE ACTIONS ──────────────────────────

async function acceptTask(taskId, btn) {
  if (!taskId) return;
  const original  = btn.textContent;
  btn.disabled    = true;
  btn.textContent = "Accepting...";

  try {
    const res = await fetch(`/api/volunteer/task/${taskId}/accept`, { method: "POST" });
    if (!res.ok) throw new Error();
    btn.textContent      = "✓ Accepted!";
    btn.style.background = "#059669";
    setTimeout(() => {
      document.querySelectorAll(`.task-card[data-task-id="${taskId}"]`).forEach(card => {
        card.style.opacity = "0"; card.style.transition = "opacity .3s";
        setTimeout(() => card.remove(), 300);
      });
      _allMatchedTasks = _allMatchedTasks.filter(t => t.id !== taskId);
      populateAllTasksModal(_allMatchedTasks);
      loadDashboard();
    }, 800);
    showToast("Task accepted! The NGO has been notified.", "success");
  } catch {
    btn.disabled    = false;
    btn.textContent = original;
    showToast("Failed to accept task. Please try again.", "error");
  }
}

async function handleWorkAction(taskId, action, btn) {
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px; animation:spin 1s linear infinite">refresh</span>`;
  
  try {
    const res = await window.syncManager.queueAction(`/api/volunteer/task/${taskId}/work`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });
    
    if (res.queued) {
      // Logic for when action is queued (offline)
      btn.innerHTML = originalHtml;
      btn.disabled = false;
      return;
    }

    const data = await res.json();
    if (data.success) {
      showToast(`Work ${action === "start" ? "started" : "paused"}!`, "success");
      loadDashboard();
    } else {
      showToast(data.error || "Action failed", "error");
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  } catch (err) {
    showToast("Network error", "error");
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

window.handleWorkAction = handleWorkAction;

async function declineTask(taskId, btn) {
  if (!taskId) return;
  btn.disabled    = true;
  btn.textContent = "...";
  try { await fetch(`/api/volunteer/task/${taskId}/decline`, { method: "POST" }); } catch {}
  document.querySelectorAll(`.task-card[data-task-id="${taskId}"]`).forEach(card => {
    card.style.opacity       = "0.35";
    card.style.pointerEvents = "none";
    card.style.transition    = "opacity .3s";
    setTimeout(() => card.remove(), 1500);
  });
  _allMatchedTasks = _allMatchedTasks.filter(t => t.id !== taskId);
  const countEl = document.getElementById("allTasksCount");
  if (countEl) countEl.textContent = `${_allMatchedTasks.length} tasks available in your area today`;
}

async function startChat(otherUid, needId) {
  try {
    const res = await fetch("/api/chat/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ other_uid: otherUid, need_id: needId })
    });
    const data = await res.json();
    if (data.success) {
      window.location.href = `/inbox?conv_id=${data.conversation_id}`;
    } else {
      showToast("Could not start chat: " + (data.error || "Unknown error"), "error");
    }
  } catch (err) {
    showToast("Chat initialization failed.", "error");
  }
}


// ─────────────────────────────────────────────
// 8. OLA MAPS — MINI MAP
// ─────────────────────────────────────────────

let miniMapInstance = null;

function initMiniMap(needs) {
  const el = document.getElementById("miniMap");
  if (!el || typeof OlaMaps === "undefined") return;

  const olaMaps = new OlaMaps({ apiKey: OLA_MAPS_API_KEY });
  miniMapInstance = olaMaps.init({
    style:       "https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json",
    container:   "miniMap",
    center:      [77.5946, 12.9716],
    zoom:        12,
    interactive: false
  });

  miniMapInstance.on("load", () => {
    (needs || []).filter(n => n.lat && n.lng).forEach(need => {
      const color = need.urgency_score >= 8 ? "#a83639" : need.urgency_score >= 5 ? "#855300" : "#006c44";
      const pinEl = document.createElement("div");
      pinEl.style.cssText = `width:22px;height:22px;background:${color};border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,.2);`;
      olaMaps.addMarker({ element: pinEl }).setLngLat([need.lng, need.lat]).addTo(miniMapInstance);
    });
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        miniMapInstance.setCenter([pos.coords.longitude, pos.coords.latitude]);
        updateLocationLabel(pos.coords.latitude, pos.coords.longitude);
      }, () => {});
    }
  });
}

async function updateLocationLabel(lat, lng) {
  try {
    const res  = await fetch(`https://api.olamaps.io/places/v1/reverse-geocode?latlng=${lat},${lng}&api_key=${OLA_MAPS_API_KEY}`);
    const data = await res.json();
    const results = data.results || [];
    if (results.length > 0) {
      const part = (results[0].formatted_address || "").split(",")[0];
      const el   = document.getElementById("currentLocation");
      if (el) el.textContent = part;
      const barEl = document.getElementById("mapModalLocation");
      if (barEl) barEl.textContent = part;
    }
  } catch {}
}


// ─────────────────────────────────────────────
// 9. OLA MAPS — FULL MAP MODAL
// ─────────────────────────────────────────────

let fullMapInstance    = null;
let fullMapInitialized = false;

function initFullMap(needs) {
  const el = document.getElementById("fullMapContainer");
  if (!el || typeof OlaMaps === "undefined" || fullMapInitialized) return;
  fullMapInitialized = true;

  const olaMaps = new OlaMaps({ apiKey: OLA_MAPS_API_KEY });
  fullMapInstance = olaMaps.init({
    style:     "https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json",
    container: "fullMapContainer",
    center:    [77.5946, 12.9716],
    zoom:      13
  });

  fullMapInstance.on("load", () => {
    (needs || []).filter(n => n.lat && n.lng).forEach(need => {
      const color = need.urgency_score >= 8 ? "#a83639" : need.urgency_score >= 5 ? "#855300" : "#006c44";
      const pinEl = document.createElement("div");
      pinEl.style.cssText = `width:28px;height:28px;background:${color};border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2.5px solid white;box-shadow:0 3px 10px rgba(0,0,0,.25);cursor:pointer;`;
      
      const nid = need.need_id || need.id;
      const popup = olaMaps.addPopup({ closeButton: false, offset: [0, -32] })
        .setHTML(`
          <div style="font-family:'Plus Jakarta Sans',sans-serif; min-width:180px; padding:4px;">
            <p style="font-weight:700; font-size:0.9rem; margin:0 0 4px; color:#1e293b;">${escHtml(need.title)}</p>
            <p style="font-size:0.75rem; color:#64748b; margin:0 0 12px;">${escHtml(need.ngo_name || "")} · ${need.distance_km ? need.distance_km + " km" : "Nearby"}</p>
            <button onclick="window.location.href='/need/${escHtml(nid)}/volunteer'" 
                    style="width:100%; background:#006c44; color:white; border:none; padding:8px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; transition:all 0.2s;">
              View Details
            </button>
          </div>
        `);
      olaMaps.addMarker({ element: pinEl }).setLngLat([need.lng, need.lat]).addTo(fullMapInstance)
             .on("click", () => popup.setLngLat([need.lng, need.lat]).addTo(fullMapInstance));
    });

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        fullMapInstance.setCenter([pos.coords.longitude, pos.coords.latitude]);
        updateLocationLabel(pos.coords.latitude, pos.coords.longitude);
      }, () => {});
    }

    // Initialize Search
    initMapSearch(fullMapInstance);
  });
}

/**
 * ── Map Search Logic ──────────────────────────────────────────
 */
function initMapSearch(map) {
  const input = document.getElementById('mapSearchInput');
  const resultsDiv = document.getElementById('mapSearchResults');
  if (!input || !resultsDiv) return;

  let debounceTimer;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (query.length < 3) {
      resultsDiv.style.display = 'none';
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`https://api.olamaps.io/places/v1/autocomplete?input=${encodeURIComponent(query)}&api_key=${OLA_MAPS_API_KEY}`);
        const data = await res.json();
        
        if (data.predictions && data.predictions.length > 0) {
          renderSearchResults(data.predictions, map, resultsDiv, input);
        } else {
          resultsDiv.innerHTML = '<div style="padding:10px; font-size:.8rem; color:#6e7a71;">No results found</div>';
          resultsDiv.style.display = 'block';
        }
      } catch (err) {
        console.error("Search error:", err);
      }
    }, 300);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !resultsDiv.contains(e.target)) {
      resultsDiv.style.display = 'none';
    }
  });
}

function renderSearchResults(predictions, map, resultsDiv, input) {
  resultsDiv.innerHTML = predictions.map(p => `
    <div style="padding:10px; cursor:pointer; border-bottom:1px solid #f1f5f9; transition:background .2s;"
         class="search-result-item"
         data-place-id="${p.place_id}" data-text="${escHtml(p.description)}">
      <div style="font-size:.85rem; font-weight:700; color:#121c2a;">${escHtml(p.structured_formatting?.main_text || p.description)}</div>
      <div style="font-size:.7rem; color:#6e7a71; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escHtml(p.structured_formatting?.secondary_text || '')}</div>
    </div>
  `).join('');

  resultsDiv.style.display = 'block';

  resultsDiv.querySelectorAll('.search-result-item').forEach(el => {
    el.addEventListener('mouseover', () => el.style.background = '#f8f9ff');
    el.addEventListener('mouseout', () => el.style.background = 'transparent');
    
    el.addEventListener('click', async () => {
      const placeId = el.dataset.placeId;
      input.value = el.dataset.text;
      resultsDiv.style.display = 'none';

      try {
        const res = await fetch(`https://api.olamaps.io/places/v1/details?place_id=${placeId}&api_key=${OLA_MAPS_API_KEY}`);
        const data = await res.json();
        
        if (data.result && data.result.geometry && data.result.geometry.location) {
          const loc = data.result.geometry.location;
          map.flyTo({ center: [loc.lng, loc.lat], zoom: 15 });
          updateLocationLabel(loc.lat, loc.lng);
        }
      } catch (err) {
        console.error("Place details error:", err);
      }
    });
  });
}

function updateMapModalBar(count) {
  const countEl = document.getElementById("mapModalTaskCount");
  if (countEl) countEl.textContent = `${count} task${count !== 1 ? "s" : ""} nearby`;
}


// ─────────────────────────────────────────────
// 10. MODAL HELPERS
// ─────────────────────────────────────────────

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("open");
  document.body.style.overflow = "hidden";
  if (id === "relocate-modal") {
    setTimeout(initRelocationMap, 100);
  }
  if (id === "history-modal") {
    // Optional: Refresh or animation
  }
  if (id === "map-modal") {
    setTimeout(() => {
      fullMapInstance?.resize?.();
      if (!fullMapInitialized) initFullMap(_allMatchedTasks);
    }, 150);
  }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("open");
  document.body.style.overflow = "";
}

function closeOnBackdrop(event, id) {
  if (event.target === document.getElementById(id)) closeModal(id);
}

window.openModal       = openModal;
window.closeModal      = closeModal;
window.closeOnBackdrop = closeOnBackdrop;

function wireStaticModalButtons() {
  document.getElementById("view-all-btn")?.addEventListener("click",    () => openModal("all-tasks-modal"));
  document.getElementById("close-tasks-modal")?.addEventListener("click",() => closeModal("all-tasks-modal"));
  document.getElementById("find-task-btn")?.addEventListener("click",   () => openModal("map-modal"));
  document.getElementById("close-map-modal")?.addEventListener("click", () => closeModal("map-modal"));
  document.getElementById("close-history-modal")?.addEventListener("click", () => closeModal("history-modal"));
  document.getElementById("close-relocate-modal")?.addEventListener("click", () => closeModal("relocate-modal"));
}


// ─────────────────────────────────────────────
// 11. ONLINE / OFFLINE TOGGLE
// ─────────────────────────────────────────────

function initOnlineToggle() {
  const track   = document.querySelector(".toggle-track");
  const thumb   = document.querySelector(".toggle-thumb");
  const label   = document.querySelector(".status-label");
  const wrapper = document.querySelector(".status-toggle");
  if (!track) return;

  let isOnline = true;
  applyToggleState(isOnline, track, thumb, label, wrapper);

  track.addEventListener("click", async () => {
    isOnline = !isOnline;
    applyToggleState(isOnline, track, thumb, label, wrapper);
    try {
      await window.syncManager.queueAction("/api/volunteer/status", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ online: isOnline })
      });
    } catch {}
  });
}

function applyToggleState(isOnline, track, thumb, label, wrapper) {
  if (isOnline) {
    track.style.background     = "#006c44";
    track.style.justifyContent = "flex-end";
    if (thumb) thumb.style.background = "#ffffff";
    if (label) { label.textContent = "Online"; label.style.color = "#006c44"; }
    wrapper?.classList.remove("offline");
  } else {
    track.style.background     = "#bdcabf";
    track.style.justifyContent = "flex-start";
    if (thumb) thumb.style.background = "#ffffff";
    if (label) { label.textContent = "Offline"; label.style.color = "#6e7a71"; }
    wrapper?.classList.add("offline");
  }
}


// ─────────────────────────────────────────────
// 12. NAV DROPDOWN
// ─────────────────────────────────────────────

function initNavDropdown() {
  const menuWrap = document.querySelector(".menu-wrap");
  const navDd    = document.getElementById("nav-dd");
  if (!menuWrap || !navDd) return;
  document.querySelector(".menu-btn")?.addEventListener("click", () => navDd.classList.toggle("open"));
  document.addEventListener("click", (e) => {
    if (!menuWrap.contains(e.target)) navDd.classList.remove("open");
  });
}


// ─────────────────────────────────────────────
// 13. KEYBOARD ESCAPE
// ─────────────────────────────────────────────

function initKeyboardEscape() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { 
      closeModal("all-tasks-modal"); 
      closeModal("map-modal"); 
      closeModal("history-modal");
      closeModal("relocate-modal");
    }
  });
}


// ─────────────────────────────────────────────
// 14. SKELETON LOADERS
// ─────────────────────────────────────────────

function showSkeletons() {
  const heading = document.getElementById("welcomeHeading");
  if (heading) heading.innerHTML = `<span style="display:inline-block;width:55%;height:28px;background:#e2e8f0;border-radius:6px;animation:skelPulse 1.4s ease infinite;"></span>`;
  const sub = document.getElementById("welcomeSub");
  if (sub) sub.innerHTML = `<span style="display:inline-block;width:40%;height:16px;background:#e2e8f0;border-radius:6px;animation:skelPulse 1.4s ease infinite;"></span>`;
  ["statMatched","statCompleted","statRating"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<span style="display:inline-block;width:44px;height:32px;background:#e2e8f0;border-radius:6px;animation:skelPulse 1.4s ease infinite;"></span>`;
  });
  const tfy = document.getElementById("tasksForYou");
  if (tfy) {
    tfy.innerHTML = [1,2].map(() => `
      <div class="task-card" style="pointer-events:none;">
        <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
          <span style="width:110px;height:22px;background:#e2e8f0;border-radius:99px;display:inline-block;animation:skelPulse 1.4s ease infinite;"></span>
          <span style="width:60px;height:18px;background:#e2e8f0;border-radius:6px;display:inline-block;animation:skelPulse 1.4s ease infinite;"></span>
        </div>
        <div style="width:80%;height:20px;background:#e2e8f0;border-radius:6px;margin-bottom:8px;animation:skelPulse 1.4s ease infinite;"></div>
        <div style="width:55%;height:14px;background:#e2e8f0;border-radius:6px;margin-bottom:14px;animation:skelPulse 1.4s ease infinite;"></div>
        <div style="height:40px;background:#e2e8f0;border-radius:99px;animation:skelPulse 1.4s ease infinite;"></div>
      </div>`).join("");
  }
  const atg = document.getElementById("acceptedTasksGrid");
  if (atg) {
    atg.innerHTML = [1,2].map(() => `
      <div class="accepted-card" style="pointer-events:none;">
        <div style="display:flex;justify-content:space-between;margin-bottom:16px;">
          <div style="flex:1;"><div style="width:70%;height:18px;background:#e2e8f0;border-radius:6px;margin-bottom:8px;animation:skelPulse 1.4s ease infinite;"></div><div style="width:40%;height:13px;background:#e2e8f0;border-radius:6px;animation:skelPulse 1.4s ease infinite;"></div></div>
          <span style="width:80px;height:24px;background:#e2e8f0;border-radius:99px;animation:skelPulse 1.4s ease infinite;display:inline-block;"></span>
        </div>
        <div style="height:8px;background:#e2e8f0;border-radius:99px;margin-bottom:14px;animation:skelPulse 1.4s ease infinite;"></div>
        <div style="height:36px;background:#e2e8f0;border-radius:10px;animation:skelPulse 1.4s ease infinite;"></div>
      </div>`).join("");
  }
  if (!document.getElementById("skel-style")) {
    const s = document.createElement("style");
    s.id = "skel-style";
    s.textContent = `@keyframes skelPulse{0%,100%{opacity:1}50%{opacity:.45}}`;
    document.head.appendChild(s);
  }
}


// ─────────────────────────────────────────────
// 15. TOAST
// ─────────────────────────────────────────────

function showToast(message, type = "success") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.style.cssText = "position:fixed;bottom:80px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:10px;";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.style.cssText = `background:white;border-left:4px solid ${type === "success" ? "#006c44" : "#a83639"};border-radius:.75rem;padding:14px 18px;box-shadow:0 8px 32px rgba(0,0,0,.12);font-size:.875rem;font-weight:500;max-width:300px;cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif;color:#121c2a;`;
  toast.textContent = message;
  toast.addEventListener("click", () => toast.remove());
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0"; toast.style.transform = "translateX(100%)"; toast.style.transition = "all .3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}


// ─────────────────────────────────────────────
// 16. ERROR STATE
// ─────────────────────────────────────────────

function showDashboardError() {
  const el = document.getElementById("tasksForYou");
  if (el) {
    el.innerHTML = `
      <div style="padding:24px;text-align:center;">
        <p style="font-weight:700;color:#a83639;">Failed to load tasks</p>
        <button onclick="loadDashboard()" style="margin-top:12px;padding:8px 20px;background:#006c44;color:white;border:none;border-radius:9999px;font-weight:700;cursor:pointer;">Retry</button>
      </div>`;
  }
}


// ─────────────────────────────────────────────
// 17. HELPERS
// ─────────────────────────────────────────────

function getUrgencyChip(label, score) {
  const l = (label || "").toUpperCase(), s = score || 0;
  if (l === "CRITICAL" || s >= 8) return { cls: "uc-high", label: "High Urgency" };
  if (l === "HIGH"     || s >= 6) return { cls: "uc-high", label: "High Urgency" };
  if (l === "MEDIUM"   || s >= 4) return { cls: "uc-mid",  label: "Medium Urgency" };
  return                                  { cls: "uc-low",  label: "Low Urgency" };
}

// ─────────────────────────────────────────────
// 18. BACKGROUND TRACKING
// ─────────────────────────────────────────────

function startBackgroundTracking() {
  if (!navigator.geolocation) return;

  // Initial update
  updateCurrentLocation();

  // Every 5 minutes (300000ms)
  setInterval(updateCurrentLocation, 300000);
}

async function updateCurrentLocation() {
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lng } = pos.coords;
    
    try {
      await window.syncManager.queueAction("/api/volunteer/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng })
      });
    } catch (err) {
      console.warn("[Tracking] Location sync queued");
    }
  }, (err) => {
    console.warn("[Tracking] Geolocation failed", err);
  }, { enableHighAccuracy: true });
}

// ─────────────────────────────────────────────
// 19. RELOCATION LOGIC
// ─────────────────────────────────────────────

let relocateMapInstance = null;
let relocateCoords = null;

function initRelocationMap() {
  if (relocateMapInstance) {
    relocateMapInstance.resize();
    return;
  }

  const olaMaps = new OlaMaps({ apiKey: OLA_MAPS_API_KEY });
  relocateMapInstance = olaMaps.init({
    style: "https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json",
    container: "relocateMap",
    center: [77.5946, 12.9716],
    zoom: 12
  });

  relocateMapInstance.on('move', () => {
    const center = relocateMapInstance.getCenter();
    relocateCoords = { lat: center.lat, lng: center.lng };
    updateRelocateAddress(center.lat, center.lng);
  });

  // Search logic for relocation
  const input = document.getElementById('relocateSearchInput');
  const resultsDiv = document.getElementById('relocateSearchResults');
  
  input.addEventListener('input', () => {
    const query = input.value.trim();
    if (query.length < 3) { resultsDiv.style.display = 'none'; return; }
    
    clearTimeout(window.relocateSearchTimer);
    window.relocateSearchTimer = setTimeout(async () => {
      try {
        const res = await fetch(`https://api.olamaps.io/places/v1/autocomplete?input=${query}&api_key=${OLA_MAPS_API_KEY}`);
        const data = await res.json();
        renderRelocateResults(data.predictions || []);
      } catch (err) { console.error("Relocate search error:", err); }
    }, 400);
  });

  document.getElementById('confirmRelocateBtn').addEventListener('click', confirmRelocation);
}

function renderRelocateResults(predictions) {
  const resultsDiv = document.getElementById('relocateSearchResults');
  const input = document.getElementById('relocateSearchInput');
  
  resultsDiv.innerHTML = predictions.map(p => `
    <div style="padding:10px; cursor:pointer; border-bottom:1px solid #f1f5f9;"
         onclick="selectRelocatePlace('${p.place_id}', '${escHtml(p.description)}')">
      <div style="font-size:0.85rem; font-weight:700;">${escHtml(p.structured_formatting?.main_text || p.description)}</div>
      <div style="font-size:0.7rem; color:#6e7a71;">${escHtml(p.structured_formatting?.secondary_text || '')}</div>
    </div>
  `).join('');
  resultsDiv.style.display = 'block';
}

window.selectRelocatePlace = async (placeId, text) => {
  const input = document.getElementById('relocateSearchInput');
  const resultsDiv = document.getElementById('relocateSearchResults');
  input.value = text;
  resultsDiv.style.display = 'none';

  try {
    const res = await fetch(`https://api.olamaps.io/places/v1/details?place_id=${placeId}&api_key=${OLA_MAPS_API_KEY}`);
    const data = await res.json();
    if (data.result?.geometry?.location) {
      const loc = data.result.geometry.location;
      relocateMapInstance.flyTo({ center: [loc.lng, loc.lat], zoom: 15 });
    }
  } catch (err) { console.error("Place details error:", err); }
};

async function updateRelocateAddress(lat, lng) {
  const addrEl = document.getElementById('relocateAddress');
  try {
    const res = await fetch(`https://api.olamaps.io/places/v1/reverse-geocode?latlng=${lat},${lng}&api_key=${OLA_MAPS_API_KEY}`);
    const data = await res.json();
    if (data.results && data.results[0]) {
      addrEl.textContent = data.results[0].formatted_address;
      addrEl.dataset.city = extractCity(data.results[0].address_components);
    }
  } catch {
    addrEl.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

function extractCity(components) {
  const cityObj = components.find(c => c.types.includes('locality') || c.types.includes('administrative_area_level_2'));
  return cityObj ? cityObj.long_name : "Unknown City";
}

async function confirmRelocation() {
  if (!relocateCoords) return showToast("Please pick a location on the map", "warning");

  const btn = document.getElementById('confirmRelocateBtn');
  const addrEl = document.getElementById('relocateAddress');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Updating...";

  try {
    const res = await fetch('/api/volunteer/relocate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: relocateCoords.lat,
        lng: relocateCoords.lng,
        city: addrEl.dataset.city || "Unknown City",
        address: addrEl.textContent
      })
    });
    
    const data = await res.json();
    if (data.success) {
      showToast("Base location updated! Refreshing matches...", "success");
      setTimeout(() => window.location.reload(), 1500);
    } else {
      showToast(data.error || "Update failed", "error");
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  } catch (err) {
    showToast("Network error", "error");
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

function escHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}