/* =====================================================
   ngo_dashboard_patch.js  — PATCHED VERSION
   Changes over original ngo_dashboard.js:
   ① Upload modal → redirects to /ngo/upload/processing/<id>
     (Gemini runs server-side in a thread; client polls)
   ② Ola Maps heatmap wired to real need locations
   ③ Enhanced manual modal with Ola Maps location picker
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


document.addEventListener("DOMContentLoaded", async () => {
  await loadOlaMapsKey();
  loadDashboard();
  initManualMap();   // initialize the map inside the manual modal
});


// ─────────────────────────────────────────────
// 1. MAIN LOADER
// ─────────────────────────────────────────────

async function loadDashboard() {
  showSkeletons();

  try {
    const res = await fetch("/api/ngo/dashboard");
    if (res.status === 401) { window.location.href = "/getstarted"; return; }
    if (!res.ok) throw new Error("Failed to load dashboard");

    const data = await res.json();

    renderWelcome(data.org_name);
    renderStats(data.stats);
    renderRecentNeeds(data.recent_needs);
    renderMatches(data.suggested_matches);
    renderActivity(data.recent_activity);

    // Wire heatmap with real need locations
    initHeatmap(data.recent_needs || []);
    cachedNeeds = data.recent_needs || [];
  } catch (err) {
    console.error("Dashboard load error:", err);
    showDashboardError();
  }
}


// ─────────────────────────────────────────────
// 2. WELCOME SECTION
// ─────────────────────────────────────────────

function renderWelcome(orgName) {
  const el = document.getElementById("welcomeHeading");
  if (!el) return;
  const hour = new Date().getHours();
  let greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  el.textContent = `${greeting}, ${orgName || "Your Organization"} 👋`;
}


// ─────────────────────────────────────────────
// 3. STATS
// ─────────────────────────────────────────────

function renderStats(stats) {
  if (!stats) return;
  animateCounter("statOpenNeeds",     stats.open_needs        || 0);
  animateCounter("statAssignedNeeds", stats.assigned_needs    || 0);
  animateCounter("statCompleted",     stats.completed_month   || 0);
  animateCounter("statVolunteers",    stats.active_volunteers || 0);
  setProgressBar("progressOpen",     stats.open_needs,          100);
  setProgressBar("progressAssigned", stats.assigned_needs,       50);
  setProgressBar("progressDone",     stats.completed_month,     200);
  setProgressBar("progressVols",     stats.active_volunteers,   150);
}

function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  let cur = 0; const steps = 40; const inc = target / steps;
  const timer = setInterval(() => {
    cur += inc;
    if (cur >= target) { el.textContent = target; clearInterval(timer); }
    else el.textContent = Math.floor(cur);
  }, 800 / steps);
}

function setProgressBar(id, value, max) {
  const el = document.getElementById(id);
  if (el) el.style.width = Math.min(Math.round((value / max) * 100), 100) + "%";
}


// ─────────────────────────────────────────────
// 4. RECENT NEEDS
// ─────────────────────────────────────────────

function renderRecentNeeds(needs) {
  const container = document.getElementById("recentNeedsContainer");
  if (!container) return;

  if (!needs || needs.length === 0) {
    container.innerHTML = `
      <div class="p-10 text-center">
        <span class="material-symbols-outlined text-5xl text-outline-variant">inbox</span>
        <p class="text-on-surface-variant mt-3 font-medium">No needs posted yet.</p>
        <p class="text-sm text-on-surface-variant mt-1">Upload a field report or post a need manually.</p>
      </div>`;
    return;
  }

  container.innerHTML = needs.slice(0, 5).map(need => {
    const uc = getUrgencyConfig(need.urgency_label, need.urgency_score);
    return `
      <div class="p-8 flex items-center justify-between group hover:bg-surface-container-low transition-colors">
        <div class="flex items-center gap-6">
          <div class="w-2 h-12 ${uc.barColor} rounded-full flex-shrink-0"></div>
          <div>
            <div class="flex flex-wrap items-center gap-3 mb-1">
              <span class="text-base font-bold text-on-surface">${escHtml(need.title)}</span>
              <span class="px-3 py-1 ${uc.badgeBg} ${uc.badgeText} text-[10px] font-black uppercase tracking-widest rounded-full">
                ${escHtml(need.urgency_label || "Open")}
              </span>
              <span class="px-2 py-0.5 bg-surface-container text-on-surface-variant text-[10px] font-bold rounded-full uppercase">
                ${getStatusLabel(need.status)}
              </span>
            </div>
            <div class="flex flex-wrap gap-4 text-sm text-on-surface-variant">
              <span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">category</span>${escHtml(need.category || "General")}</span>
              <span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">schedule</span>${timeAgo(need.created_at)}</span>
              ${need.location ? `<span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">location_on</span>${escHtml(typeof need.location==='object'?need.location.city||'':need.location)}</span>` : ""}
            </div>
          </div>
        </div>
        <a href="/need/${need.id}/ngo" class="px-6 py-2 bg-surface-container-highest text-on-surface font-bold rounded-full text-sm group-hover:bg-primary group-hover:text-white transition-all whitespace-nowrap ml-4">View</a>
      </div>`;
  }).join('<hr class="border-surface-container"/>');
}


// ─────────────────────────────────────────────
// 5. SUGGESTED MATCHES
// ─────────────────────────────────────────────

function renderMatches(matches) {
  const container = document.getElementById("matchesContainer");
  const badge     = document.getElementById("matchesBadge");
  if (!container) return;
 
  if (!matches || matches.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8">
        <span class="material-symbols-outlined text-4xl text-outline-variant">person_search</span>
        <p class="text-on-surface-variant text-sm mt-2">No pending matches right now.</p>
        <p class="text-xs text-on-surface-variant mt-1 opacity-60">AI will surface volunteers once a need is posted.</p>
      </div>`;
    if (badge) badge.textContent = "0 new";
    return;
  }
 
  if (badge) badge.textContent = `New: ${matches.length}`;
 
  // Confidence → visual config
  const confConfig = {
    HIGH:   { bg: "bg-primary/10",    text: "text-primary",   icon: "verified",    label: "Strong match" },
    MEDIUM: { bg: "bg-secondary/10",  text: "text-secondary", icon: "thumb_up",    label: "Good match"   },
    LOW:    { bg: "bg-outline/10",    text: "text-outline",   icon: "help_outline", label: "Possible match" },
  };
 
  container.innerHTML = matches.slice(0, 3).map((match, idx) => {
    const conf    = confConfig[match.match_confidence] || confConfig.MEDIUM;
    const strengths = (match.match_strengths || []).slice(0, 2);
    const concerns  = (match.match_concerns  || []).slice(0, 1);
 
    return `
    <div class="flex flex-col gap-4 ${idx > 0 ? "pt-6 border-t border-surface-container" : ""}">
 
      <!-- Volunteer info row -->
      <div class="flex items-start gap-4">
        <div class="relative flex-shrink-0">
          <img alt="${escHtml(match.volunteer_name)}"
               class="w-14 h-14 rounded-full object-cover bg-surface-container-high"
               src="${match.volunteer_photo || '/static/images/default-avatar.png'}"
               onerror="this.src='/static/images/default-avatar.png'"/>
          <!-- Score ring -->
          <div class="absolute -bottom-1 -right-1 bg-white p-0.5 rounded-full shadow">
            <div class="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-primary-container
                        flex items-center justify-center text-[10px] text-white font-black">
              ${match.match_score}
            </div>
          </div>
        </div>
 
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h4 class="font-bold text-on-surface">${escHtml(match.volunteer_name)}</h4>
            <!-- Confidence badge -->
            <span class="inline-flex items-center gap-1 px-2 py-0.5 ${conf.bg} ${conf.text}
                         text-[10px] font-bold rounded-full uppercase tracking-wider">
              <span class="material-symbols-outlined" style="font-size:11px;font-variation-settings:'FILL' 1">${conf.icon}</span>
              ${conf.label}
            </span>
            ${!match.volunteer_was_online ? `
            <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-container text-on-surface-variant
                        text-[10px] font-bold rounded-full">
              <span class="material-symbols-outlined" style="font-size:10px">wifi_off</span>
              Offline — notified when online
            </span>` : ""}
          </div>
 
          <!-- Skills chips -->
          <div class="flex flex-wrap gap-1.5 mt-1.5">
            ${(match.skills || []).slice(0, 3).map(s => `
              <span class="px-2 py-0.5 bg-primary-fixed-dim/30 text-on-primary-fixed-variant
                           text-[10px] font-bold rounded-full uppercase tracking-tighter">
                ${escHtml(s)}
              </span>`).join("")}
          </div>
 
          <!-- Distance -->
          <p class="text-xs text-on-surface-variant mt-1 flex items-center gap-0.5">
            <span class="material-symbols-outlined" style="font-size:11px">location_on</span>
            ${escHtml(match.distance || "Nearby")}
          </p>
        </div>
      </div>
 
      <!-- AI reason -->
      ${match.match_reason ? `
      <div class="bg-surface-container-low rounded-lg px-4 py-3 text-sm text-on-surface-variant
                  flex items-start gap-2.5 border border-outline-variant/10">
        <span class="material-symbols-outlined text-primary flex-shrink-0 mt-0.5"
              style="font-size:15px;font-variation-settings:'FILL' 1">auto_awesome</span>
        <span class="italic leading-relaxed">${escHtml(match.match_reason)}</span>
      </div>` : ""}
 
      <!-- Strengths -->
      ${strengths.length ? `
      <div class="flex flex-wrap gap-2">
        ${strengths.map(s => `
          <span class="flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary/6 px-2.5 py-1 rounded-full">
            <span class="material-symbols-outlined" style="font-size:12px;font-variation-settings:'FILL' 1">check_circle</span>
            ${escHtml(s)}
          </span>`).join("")}
        ${concerns.map(c => `
          <span class="flex items-center gap-1 text-[11px] font-semibold text-outline bg-surface-container px-2.5 py-1 rounded-full">
            <span class="material-symbols-outlined" style="font-size:12px">info</span>
            ${escHtml(c)}
          </span>`).join("")}
      </div>` : ""}
 
      <!-- Action buttons -->
      <div class="flex gap-2">
        <button onclick="approveMatch('${match.match_id}', this)"
                class="flex-1 py-3 bg-primary text-on-primary rounded-full font-bold text-sm
                       shadow-lg shadow-primary/10 hover:bg-primary/90 transition-colors">
          Approve
        </button>
        <button onclick="startChat('${match.volunteer_id}', '${match.need_id}')" 
                class="p-3 bg-secondary/10 text-secondary rounded-full hover:bg-secondary/20 transition-all flex items-center justify-center"
                title="Chat with volunteer">
          <span class="material-symbols-outlined" style="font-size: 20px;">chat</span>
        </button>
        <button onclick="skipMatch('${match.match_id}', this)"
                class="flex-1 py-3 bg-surface-container-highest text-on-surface rounded-full
                       font-bold text-sm hover:bg-surface-container-high transition-colors">
          Skip
        </button>
      </div>
    </div>`;
  }).join("");
}

// ─────────────────────────────────────────────
// 6. ACTIVITY FEED
// ─────────────────────────────────────────────

function renderActivity(activities) {
  const container = document.getElementById("activityContainer");
  if (!container) return;
  if (!activities || activities.length === 0) {
    container.innerHTML = `<p class="text-on-surface-variant text-sm py-4">No recent activity.</p>`;
    return;
  }
  const iconMap = {
    completed: { icon:"check",         bg:"bg-primary-container" },
    matched:   { icon:"handshake",     bg:"bg-primary/80" },
    created:   { icon:"add",           bg:"bg-secondary" },
    warning:   { icon:"warning",       bg:"bg-tertiary" },
    donation:  { icon:"currency_rupee",bg:"bg-secondary" },
    default:   { icon:"info",          bg:"bg-outline" },
  };
  container.innerHTML = activities.map((item, idx) => {
    const cfg = iconMap[item.type] || iconMap.default;
    return `
      <div class="relative pl-10 ${idx > 0 ? "mt-8" : ""}">
        <div class="absolute left-0 top-1 w-7 h-7 rounded-full ${cfg.bg} border-[3px] border-white shadow-md flex items-center justify-center ${idx===0?"timeline-dot-first":""}">
          <span class="material-symbols-outlined text-white" style="font-size:13px;font-variation-settings:'FILL' 1">${cfg.icon}</span>
        </div>
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div>
            <p class="text-on-surface font-bold">${escHtml(item.title)}</p>
            <p class="text-on-surface-variant text-sm">${escHtml(item.subtitle || "")}</p>
          </div>
          <span class="text-xs font-bold text-primary bg-primary/8 px-3 py-1 rounded-full uppercase tracking-widest whitespace-nowrap">${timeAgo(item.created_at)}</span>
        </div>
      </div>`;
  }).join("");
}


// ─────────────────────────────────────────────
// 7. MATCH ACTIONS
// ─────────────────────────────────────────────

async function approveMatch(matchId, btn) {
  btn.disabled = true; btn.textContent = "Approving...";
  try {
    const res = await fetch(`/api/ngo/match/${matchId}/approve`, { method: "POST" });
    if (!res.ok) throw new Error();
    const card = btn.closest(".flex.flex-col.gap-4");
    card.style.opacity = "0"; card.style.transition = "opacity 0.3s";
    setTimeout(() => {
      card.remove();
      const badge = document.getElementById("matchesBadge");
      if (badge) { const c = parseInt(badge.textContent.replace("New: ",""))||0; badge.textContent = `New: ${Math.max(0,c-1)}`; }
    }, 300);
    showToast("Volunteer approved! They will be notified.", "success");
  } catch {
    btn.disabled = false; btn.textContent = "Approve";
    showToast("Failed to approve. Please try again.", "error");
  }
}

async function skipMatch(matchId, btn) {
  btn.disabled = true; btn.textContent = "Skipping...";
  try {
    const res = await fetch(`/api/ngo/match/${matchId}/skip`, { method: "POST" });
    if (!res.ok) throw new Error();
    const card = btn.closest(".flex.flex-col.gap-4");
    card.style.opacity = "0"; card.style.transition = "opacity 0.3s";
    setTimeout(() => card.remove(), 300);
  } catch { btn.disabled = false; btn.textContent = "Skip"; }
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
    console.error(err);
    showToast("Chat initialization failed.", "error");
  }
}


// ─────────────────────────────────────────────
// 8. UPLOAD REPORT — FIXED
//    Now shows redirect immediately, Gemini runs on server
// ─────────────────────────────────────────────

window.handleSubmit = async function() {
  const fileInput = document.getElementById("file-input");
  const submitBtn = document.getElementById("submit-btn");
  const file = fileInput.files[0];
  if (!file) return;

  submitBtn.disabled    = true;
  submitBtn.innerHTML   = `<span style="display:inline-flex;align-items:center;gap:8px">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin .8s linear infinite">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
    Uploading…</span>`;

  const formData = new FormData();
  formData.append("report", file);

  try {
    const res = await fetch("/api/ngo/upload-report", {
      method: "POST",
      body:   formData
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Upload failed");
    }

    const data = await res.json();
    closeModal();
    showToast("Report uploaded! AI analysis starting…", "success");

    // Redirect to the animated processing page
    setTimeout(() => {
      window.location.href = data.redirect || "/ngo/reports";
    }, 800);

  } catch (err) {
    console.error("Upload error:", err);
    submitBtn.disabled   = false;
    submitBtn.textContent = "Submit Report";
    showToast(err.message || "Upload failed. Please try again.", "error");
  }
};


// ─────────────────────────────────────────────
// 9. MANUAL NEED — FORM SUBMIT
// ─────────────────────────────────────────────

window.handleManualSubmit = async function() {
  const title       = document.getElementById("manualTitle")?.value.trim();
  const category    = document.getElementById("manualCategory")?.value;
  const urgency     = document.querySelector('input[name="urgency"]:checked')?.value;
  const location    = document.getElementById("manualLocationText")?.value.trim();
  const description = document.getElementById("manualDescription")?.value.trim();
  const affected    = document.getElementById("manualAffected")?.value;

  if (!title || !category || !urgency) {
    showToast("Please fill in Title, Category and Urgency.", "error");
    return;
  }

  const submitBtn = document.getElementById("manualSubmitBtn");
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Submitting…"; }

  // Read lat/lng from manual map
  const lat = parseFloat(document.getElementById("manualLat")?.value || "0") || null;
  const lng = parseFloat(document.getElementById("manualLng")?.value || "0") || null;

  try {
    const res = await fetch("/api/ngo/need/create", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        category,
        urgency_label:    urgency.toUpperCase(),
        urgency_score:    urgency === "high" ? 8 : urgency === "mid" ? 5 : 2,
        location:         lat ? { city: location, lat, lng } : location,
        description,
        estimated_people: affected ? parseInt(affected) : null,
        source:           "manual"
      })
    });

    if (!res.ok) throw new Error("Failed to create need");

    closeManual();
    showToast("Need posted! Matching volunteers…", "success");
    loadDashboard();

  } catch (err) {
    console.error("Manual submit error:", err);
    showToast("Failed to submit. Please try again.", "error");
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit Need"; }
  }
};


// ─────────────────────────────────────────────
// 10. OLA MAPS — NEEDS HEATMAP
//     Replaces the static image in the dashboard
// ─────────────────────────────────────────────
let modalMapInstance = null;
let modalMapLoaded = false;
let cachedNeeds = [];
let heatmapInstance   = null;
let heatmapInitialized = false;

function initHeatmap(needs) {
  const container = document.getElementById("needsHeatmap");
  if (!container || typeof OlaMaps === "undefined") return;
  if (heatmapInitialized) return;
  heatmapInitialized = true;

  const olaMaps = new OlaMaps({ apiKey: OLA_MAPS_API_KEY });

  heatmapInstance = olaMaps.init({
    style:       "https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json",
    container:   "needsHeatmap",
    center:      [77.5946, 12.9716],
    zoom:        11,
    interactive: false
  });

  heatmapInstance.on("load", () => {
    const geoPoints = needs
      .filter(n => n.location?.lat && n.location?.lng)
      .map(n => ({ lat: n.location.lat, lng: n.location.lng, urgency: n.urgency_score || 5 }));

    // Add urgency-colored pins
    geoPoints.forEach(pt => {
      const color = pt.urgency >= 8 ? "#a83639" : pt.urgency >= 5 ? "#855300" : "#006c44";
      const size  = pt.urgency >= 8 ? 20 : 14;

      const el = document.createElement("div");
      el.style.cssText = `
        width:${size}px;height:${size}px;background:${color};
        border-radius:50%;border:2px solid white;
        box-shadow:0 0 0 4px ${color}33;
      `;
      olaMaps.addMarker({ element: el })
             .setLngLat([pt.lng, pt.lat])
             .addTo(heatmapInstance);
    });

    // Try to centre on NGO's location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        heatmapInstance.setCenter([pos.coords.longitude, pos.coords.latitude]);
      }, () => {});
    }

    // Update the "just now" badge
    const badge = document.getElementById("heatmapUpdate");
    if (badge) badge.textContent = "Live";

    // Update pressure zone count
    const highPressure = geoPoints.filter(p => p.urgency >= 7).length;
    const zoneEl = document.getElementById("heatmapZoneCount");
    if (zoneEl) zoneEl.textContent = highPressure > 0 ? `${highPressure} High Pressure Zone${highPressure!==1?'s':''}` : "All Clear";
  });
}

function openHeatmapModal() {
  const modal = document.getElementById("heatmapModal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  document.body.style.overflow = "hidden";

  setTimeout(initModalHeatmap, 100); // wait for DOM
}
function closeHeatmapModal() {
  const modal = document.getElementById("heatmapModal");
  modal.classList.add("hidden");
  modal.classList.remove("flex");
  document.body.style.overflow = "";
}

function closeHeatmapModalOutside(e) {
  if (e.target.id === "heatmapModal") {
    closeHeatmapModal();
  }
}

function initModalHeatmap() {
  if (modalMapLoaded) return;

  const container = document.getElementById("heatmapModalMap");
  if (!container || typeof OlaMaps === "undefined") return;

  modalMapLoaded = true;

  const olaMaps = new OlaMaps({ apiKey: OLA_MAPS_API_KEY });

  modalMapInstance = olaMaps.init({
    style: "https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json",
    container: "heatmapModalMap",
    center: [77.5946, 12.9716],
    zoom: 11,
    interactive: true // 🔥 IMPORTANT
  });

  modalMapInstance.on("load", () => {

    const geoPoints = cachedNeeds
      .filter(n => n.location?.lat && n.location?.lng)
      .map(n => ({
        lat: n.location.lat,
        lng: n.location.lng,
        urgency: n.urgency_score || 5,
        title: n.title
      }));

    geoPoints.forEach(pt => {
      const color = pt.urgency >= 8 ? "#a83639" :
                    pt.urgency >= 5 ? "#855300" :
                                      "#006c44";

      const el = document.createElement("div");
      el.style.cssText = `
        width:18px;height:18px;background:${color};
        border-radius:50%;border:2px solid white;
        box-shadow:0 0 0 6px ${color}33;
        cursor:pointer;
      `;

      const marker = olaMaps.addMarker({ element: el })
        .setLngLat([pt.lng, pt.lat])
        .addTo(modalMapInstance);

      // 🔥 Custom Popup interaction
      const popup = olaMaps.addPopup({ closeButton: false, offset: [0, -12] })
        .setHTML(`
          <div style="font-family:'Plus Jakarta Sans',sans-serif; min-width:180px; padding:4px;">
            <p style="font-weight:700; font-size:0.9rem; margin:0 0 4px; color:#1e293b;">${escHtml(pt.title)}</p>
            <p style="font-size:0.75rem; color:#64748b; margin:0 0 12px;">Need Location · Urgency: ${pt.urgency}</p>
            <button onclick="window.location.href='/need/${pt.id}/ngo'" 
                    style="width:100%; background:#006c44; color:white; border:none; padding:8px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; transition:all 0.2s;">
              View Details
            </button>
          </div>
        `);

      el.addEventListener("click", () => {
        popup.setLngLat([pt.lng, pt.lat]).addTo(modalMapInstance);
      });
    });

    // Auto center
    if (geoPoints.length > 0) {
      modalMapInstance.setCenter([geoPoints[0].lng, geoPoints[0].lat]);
    }

    // Initialize Search
    initMapSearch(modalMapInstance);
  });
}

/**
 * ── Map Search Logic ──────────────────────────────────────────
 * Uses Ola Maps Places API for autocomplete
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
      resultsDiv.classList.add('hidden');
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`https://api.olamaps.io/places/v1/autocomplete?input=${encodeURIComponent(query)}&api_key=${OLA_MAPS_API_KEY}`);
        const data = await res.json();
        
        if (data.predictions && data.predictions.length > 0) {
          renderSearchResults(data.predictions, map, resultsDiv, input);
        } else {
          resultsDiv.innerHTML = '<div class="p-3 text-sm text-on-surface-variant">No results found</div>';
          resultsDiv.classList.remove('hidden');
        }
      } catch (err) {
        console.error("Search error:", err);
      }
    }, 300);
  });

  // Hide results when clicking outside
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !resultsDiv.contains(e.target)) {
      resultsDiv.classList.add('hidden');
    }
  });
}

function renderSearchResults(predictions, map, resultsDiv, input) {
  resultsDiv.innerHTML = predictions.map(p => `
    <div class="p-3 hover:bg-surface-container-low cursor-pointer border-b border-surface-container last:border-0 transition-colors"
         data-place-id="${p.place_id}" data-text="${escHtml(p.description)}">
      <div class="text-sm font-bold text-on-surface">${escHtml(p.structured_formatting?.main_text || p.description)}</div>
      <div class="text-[11px] text-on-surface-variant truncate">${escHtml(p.structured_formatting?.secondary_text || '')}</div>
    </div>
  `).join('');

  resultsDiv.classList.remove('hidden');

  resultsDiv.querySelectorAll('[data-place-id]').forEach(el => {
    el.addEventListener('click', async () => {
      const placeId = el.dataset.placeId;
      input.value = el.dataset.text;
      resultsDiv.classList.add('hidden');

      try {
        // Get coordinates for the place
        const res = await fetch(`https://api.olamaps.io/places/v1/details?place_id=${placeId}&api_key=${OLA_MAPS_API_KEY}`);
        const data = await res.json();
        
        if (data.result && data.result.geometry && data.result.geometry.location) {
          const loc = data.result.geometry.location;
          map.flyTo({ center: [loc.lng, loc.lat], zoom: 15 });
        }
      } catch (err) {
        console.error("Place details error:", err);
      }
    });
  });
}
// ─────────────────────────────────────────────
// 11. OLA MAPS — MANUAL MODAL LOCATION PICKER
// ─────────────────────────────────────────────

let manualMapInstance   = null;
let manualMapInitialized = false;
let manualMarker        = null;
let manualLat           = 12.9716;
let manualLng           = 77.5946;

function initManualMap() {
  // The map is inside the manual modal — init when modal first opens
  // Called from openManual()
}

function initManualMapOnce() {
  if (manualMapInitialized) return;
  const el = document.getElementById("manualMap");
  if (!el || typeof OlaMaps === "undefined") return;
  manualMapInitialized = true;

  const olaMaps = new OlaMaps({ apiKey: OLA_MAPS_API_KEY });

  manualMapInstance = olaMaps.init({
    style:     "https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json",
    container: "manualMap",
    center:    [manualLng, manualLat],
    zoom:      13
  });

  const pinEl = document.createElement("div");
  pinEl.style.cssText = `
    width:26px;height:26px;background:#006c44;
    border-radius:50% 50% 50% 0;transform:rotate(-45deg);
    border:2.5px solid white;box-shadow:0 3px 10px rgba(0,108,68,.35);cursor:grab;
  `;

  manualMapInstance.on("load", () => {
    manualMarker = olaMaps
      .addMarker({ element: pinEl, draggable: true })
      .setLngLat([manualLng, manualLat])
      .addTo(manualMapInstance);

    manualMarker.on("dragend", () => {
      const pos = manualMarker.getLngLat();
      updateManualLocation(pos.lat, pos.lng);
    });

    manualMapInstance.on("click", (e) => {
      const { lat, lng } = e.lngLat;
      manualMarker.setLngLat([lng, lat]);
      updateManualLocation(lat, lng);
    });
  });
}

async function updateManualLocation(lat, lng) {
  manualLat = lat; manualLng = lng;
  document.getElementById("manualLat").value = lat.toFixed(6);
  document.getElementById("manualLng").value = lng.toFixed(6);

  // Reverse geocode to fill location text
  try {
    const res  = await fetch(
      `https://api.olamaps.io/places/v1/reverse-geocode?latlng=${lat},${lng}&api_key=${OLA_MAPS_API_KEY}`
    );
    const data = await res.json();
    const results = data.results || [];
    if (results.length > 0) {
      const addr = results[0].formatted_address || "";
      const part = addr.split(",")[0];
      const locInput = document.getElementById("manualLocationText");
      if (locInput && !locInput.value) locInput.value = part;

      const tag = document.getElementById("manualMapTag");
      if (tag) tag.textContent = `📍 ${part}`;
    }
  } catch {}
}

// Use current location button inside manual modal
window.useManualCurrentLocation = function() {
  if (!navigator.geolocation) return;
  const btn = document.getElementById("manualUseLocationBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Detecting…"; }

  navigator.geolocation.getCurrentPosition(pos => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    manualMarker?.setLngLat([lng, lat]);
    manualMapInstance?.setCenter([lng, lat]);
    updateManualLocation(lat, lng);
    if (btn) { btn.disabled = false; btn.textContent = "⌖ Use my location"; }
  }, () => {
    if (btn) { btn.disabled = false; btn.textContent = "⌖ Use my location"; }
  }, { timeout: 8000 });
};

// Override openManual to init map
const _origOpenManual = window.openManual;
window.openManual = function() {
  document.getElementById('manual-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
  // Small delay so modal is visible before map init
  setTimeout(initManualMapOnce, 120);
};


// ─────────────────────────────────────────────
// 12. SKELETON LOADERS
// ─────────────────────────────────────────────

function showSkeletons() {
  // 1. Welcome
  const welcome = document.getElementById("welcomeHeading");
  if (welcome) {
    welcome.innerHTML = '<div class="h-10 w-64 skeleton"></div>';
  }

  // 2. Stats
  ["statOpenNeeds","statAssignedNeeds","statCompleted","statVolunteers"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.innerHTML = '<div class="h-10 w-16 skeleton mx-auto"></div>'; }
  });

  // 3. Recent Needs
  const needsContainer = document.getElementById("recentNeedsContainer");
  if (needsContainer) {
    needsContainer.innerHTML = [1,2,3].map(() => `
      <div class="p-8 flex items-center justify-between">
        <div class="flex items-center gap-6 flex-1">
          <div class="w-2 h-12 skeleton rounded-full flex-shrink-0"></div>
          <div class="space-y-3 flex-1">
            <div class="h-5 skeleton rounded w-2/3"></div>
            <div class="h-3 skeleton rounded w-1/3"></div>
          </div>
        </div>
        <div class="h-10 w-24 skeleton rounded-full ml-4"></div>
      </div>`).join('<hr class="border-surface-container"/>');
  }

  // 4. Suggested Matches
  const matchesContainer = document.getElementById("matchesContainer");
  if (matchesContainer) {
    matchesContainer.innerHTML = [1,2].map(() => `
      <div class="flex flex-col gap-4">
        <div class="flex items-start gap-4">
          <div class="w-14 h-14 rounded-full skeleton flex-shrink-0"></div>
          <div class="space-y-3 flex-1 pt-1">
            <div class="h-4 skeleton rounded w-1/2"></div>
            <div class="h-2 skeleton rounded w-1/3"></div>
            <div class="h-2 skeleton rounded w-1/4"></div>
          </div>
        </div>
        <div class="flex gap-2">
          <div class="h-11 flex-1 skeleton rounded-full"></div>
          <div class="h-11 w-11 skeleton rounded-full"></div>
          <div class="h-11 flex-1 skeleton rounded-full"></div>
        </div>
      </div>`).join("<hr class='border-surface-container my-6'/>");
  }

  // 5. Activity Feed
  const activityContainer = document.getElementById("activityContainer");
  if (activityContainer) {
    activityContainer.innerHTML = [1,2,3].map(() => `
      <div class="relative pl-10">
        <div class="absolute left-0 top-1 w-7 h-7 rounded-full skeleton border-[3px] border-white"></div>
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div class="space-y-2 flex-1">
            <div class="h-4 skeleton rounded w-1/3"></div>
            <div class="h-3 skeleton rounded w-1/2"></div>
          </div>
          <div class="h-6 w-20 skeleton rounded-full"></div>
        </div>
      </div>`).join('<div class="mt-8"></div>');
  }
}


// ─────────────────────────────────────────────
// 13. TOAST
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
  toast.style.cssText = `background:white;border-left:4px solid ${type==="success"?"#006c44":"#ba1a1a"};
    border-radius:.75rem;padding:14px 18px;box-shadow:0 8px 32px rgba(0,0,0,.12);
    font-size:.875rem;font-weight:500;max-width:320px;cursor:pointer;
    font-family:'Plus Jakarta Sans',sans-serif;color:#121c2a;`;
  toast.textContent = message;
  toast.addEventListener("click", () => toast.remove());
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity="0"; toast.style.transform="translateX(100%)"; toast.style.transition="all .3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}


// ─────────────────────────────────────────────
// 14. ERROR STATE
// ─────────────────────────────────────────────

function showDashboardError() {
  const needsContainer = document.getElementById("recentNeedsContainer");
  if (needsContainer) {
    needsContainer.innerHTML = `
      <div class="p-10 text-center">
        <span class="material-symbols-outlined text-4xl text-tertiary">error_outline</span>
        <p class="text-on-surface font-bold mt-2">Failed to load data</p>
        <button onclick="loadDashboard()" class="mt-4 px-6 py-2 bg-primary text-white rounded-full font-bold text-sm">Retry</button>
      </div>`;
  }
}


// ─────────────────────────────────────────────
// 15. HELPERS
// ─────────────────────────────────────────────

function getUrgencyConfig(label, score) {
  const l = (label||"").toUpperCase(); const s = score||0;
  if (l==="CRITICAL"||s>=8) return { barColor:"bg-tertiary",        badgeBg:"bg-tertiary-fixed",      badgeText:"text-on-tertiary-fixed" };
  if (l==="HIGH"    ||s>=6) return { barColor:"bg-secondary",       badgeBg:"bg-secondary-fixed",     badgeText:"text-on-secondary-fixed" };
  if (l==="MEDIUM"  ||s>=4) return { barColor:"bg-primary",         badgeBg:"bg-surface-container-high",badgeText:"text-on-surface" };
  return                            { barColor:"bg-primary-container",badgeBg:"bg-primary-fixed",      badgeText:"text-on-primary-fixed" };
}

function getStatusLabel(status) {
  return {"open":"Open","assigned":"Assigned","in_progress":"In Progress","completed":"Completed"}[status] || status || "Open";
}

function timeAgo(timestamp) {
  if (!timestamp) return "just now";
  let date;
  if (timestamp._seconds)          date = new Date(timestamp._seconds * 1000);
  else if (typeof timestamp==="string") date = new Date(timestamp);
  else if (typeof timestamp==="number") date = new Date(timestamp);
  else return "just now";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60)    return "just now";
  if (seconds < 3600)  return `${Math.floor(seconds/60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds/3600)}h ago`;
  return `${Math.floor(seconds/86400)}d ago`;
}

function escHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// Inject spin keyframe
const _st = document.createElement("style");
_st.textContent = "@keyframes spin{to{transform:rotate(360deg)}}";
document.head.appendChild(_st);