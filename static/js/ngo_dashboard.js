/* =====================================================
   ngo_dashboard.js
   Handles:
   - Dashboard data load from Flask API
   - Stats rendering with animated counters
   - Recent needs rendering
   - Suggested matches rendering
   - Activity feed rendering
   - Upload report (AI extraction)
   - Manual need submission
   - Skeleton loading states
   - onSnapshot real-time updates (Firestore)
   ===================================================== */

document.addEventListener("DOMContentLoaded", () => {
  loadDashboard();
});


// ─────────────────────────────────────────────
// 1. MAIN LOADER
// ─────────────────────────────────────────────

async function loadDashboard() {
  showSkeletons();

  try {
    const res = await fetch("/api/ngo/dashboard");

    if (res.status === 401) {
      window.location.href = "/getstarted";
      return;
    }

    if (!res.ok) throw new Error("Failed to load dashboard");

    const data = await res.json();

    renderWelcome(data.org_name);
    renderStats(data.stats);
    renderRecentNeeds(data.recent_needs);
    renderMatches(data.suggested_matches);
    renderActivity(data.recent_activity);

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
  let greeting = "Good morning";
  if (hour >= 12 && hour < 17) greeting = "Good afternoon";
  else if (hour >= 17)          greeting = "Good evening";

  el.textContent = `${greeting}, ${orgName || "Your Organization"} 👋`;
}


// ─────────────────────────────────────────────
// 3. STATS WITH ANIMATED COUNTER
// ─────────────────────────────────────────────

function renderStats(stats) {
  if (!stats) return;

  animateCounter("statOpenNeeds",      stats.open_needs      || 0);
  animateCounter("statAssignedNeeds",  stats.assigned_needs  || 0);
  animateCounter("statCompleted",      stats.completed_month || 0);
  animateCounter("statVolunteers",     stats.active_volunteers || 0);

  // Progress bar widths based on relative values
  setProgressBar("progressOpen",     stats.open_needs,     100);
  setProgressBar("progressAssigned", stats.assigned_needs, 50);
  setProgressBar("progressDone",     stats.completed_month,200);
  setProgressBar("progressVols",     stats.active_volunteers, 150);
}

function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;

  let current = 0;
  const duration = 800; // ms
  const steps    = 40;
  const increment = target / steps;
  const interval  = duration / steps;

  const timer = setInterval(() => {
    current += increment;
    if (current >= target) {
      el.textContent = target;
      clearInterval(timer);
    } else {
      el.textContent = Math.floor(current);
    }
  }, interval);
}

function setProgressBar(id, value, max) {
  const el = document.getElementById(id);
  if (!el) return;
  const pct = Math.min(Math.round((value / max) * 100), 100);
  el.style.width = pct + "%";
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
    const urgencyConfig = getUrgencyConfig(need.urgency_label, need.urgency_score);
    return `
      <div class="p-8 flex items-center justify-between group
                  hover:bg-surface-container-low transition-colors">
        <div class="flex items-center gap-6">
          <div class="w-2 h-12 ${urgencyConfig.barColor} rounded-full flex-shrink-0"></div>
          <div>
            <div class="flex flex-wrap items-center gap-3 mb-1">
              <span class="text-base font-bold text-on-surface">${escHtml(need.title)}</span>
              <span class="px-3 py-1 ${urgencyConfig.badgeBg} ${urgencyConfig.badgeText}
                           text-[10px] font-black uppercase tracking-widest rounded-full">
                ${escHtml(need.urgency_label || "Open")}
              </span>
              <span class="px-2 py-0.5 bg-surface-container text-on-surface-variant
                           text-[10px] font-bold rounded-full uppercase">
                ${getStatusLabel(need.status)}
              </span>
            </div>
            <div class="flex flex-wrap gap-4 text-sm text-on-surface-variant">
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-xs">category</span>
                ${escHtml(need.category || "General")}
              </span>
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-xs">schedule</span>
                ${timeAgo(need.created_at)}
              </span>
              ${need.location ? `
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-xs">location_on</span>
                ${escHtml(need.location)}
              </span>` : ""}
            </div>
          </div>
        </div>
        <a href="/ngo/need/${need.id}"
           class="px-6 py-2 bg-surface-container-highest text-on-surface font-bold
                  rounded-full text-sm group-hover:bg-primary group-hover:text-white
                  transition-all whitespace-nowrap ml-4">
          View
        </a>
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
      </div>`;
    if (badge) badge.textContent = "0 new";
    return;
  }

  if (badge) badge.textContent = `New: ${matches.length}`;

  container.innerHTML = matches.slice(0, 3).map((match, idx) => `
    <div class="flex flex-col gap-4 ${idx > 0 ? "pt-6 border-t border-surface-container" : ""}">
      <div class="flex items-center gap-4">
        <div class="relative flex-shrink-0">
          <img alt="${escHtml(match.volunteer_name)}"
               class="w-14 h-14 rounded-full object-cover bg-surface-container-high"
               src="${match.volunteer_photo || '/static/images/default-avatar.png'}"
               onerror="this.src='/static/images/default-avatar.png'"/>
          <div class="absolute -bottom-1 -right-1 bg-white p-1 rounded-full">
            <div class="w-6 h-6 rounded-full bg-primary flex items-center justify-center
                        text-[10px] text-white font-bold">
              ${match.match_score}%
            </div>
          </div>
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="font-bold text-on-surface">${escHtml(match.volunteer_name)}</h4>
          <div class="flex flex-wrap gap-2 mt-1">
            ${(match.skills || []).slice(0, 2).map(skill => `
              <span class="px-3 py-0.5 bg-primary-fixed-dim/30 text-on-primary-fixed-variant
                           text-[10px] font-bold rounded-full uppercase tracking-tighter">
                ${escHtml(skill)}
              </span>`).join("")}
          </div>
          <p class="text-xs text-on-surface-variant mt-1">
            <span class="material-symbols-outlined" style="font-size:11px">location_on</span>
            ${escHtml(match.distance || "Nearby")}
          </p>
        </div>
      </div>
      <div class="flex gap-2">
        <button onclick="approveMatch('${match.match_id}', this)"
                class="flex-1 py-3 bg-primary text-on-primary rounded-full font-bold
                       text-sm shadow-lg shadow-primary/10 hover:bg-primary/90 transition-colors">
          Approve
        </button>
        <button onclick="skipMatch('${match.match_id}', this)"
                class="flex-1 py-3 bg-surface-container-highest text-on-surface rounded-full
                       font-bold text-sm hover:bg-surface-container-high transition-colors">
          Skip
        </button>
      </div>
    </div>`).join("");
}


// ─────────────────────────────────────────────
// 6. ACTIVITY FEED
// ─────────────────────────────────────────────

function renderActivity(activities) {
  const container = document.getElementById("activityContainer");
  if (!container) return;

  if (!activities || activities.length === 0) {
    container.innerHTML = `
      <p class="text-on-surface-variant text-sm py-4">No recent activity.</p>`;
    return;
  }

  const iconMap = {
    "completed":  { icon: "check",          bg: "bg-primary-container" },
    "matched":    { icon: "handshake",       bg: "bg-primary/80" },
    "created":    { icon: "add",             bg: "bg-secondary" },
    "warning":    { icon: "warning",         bg: "bg-tertiary" },
    "donation":   { icon: "currency_rupee",  bg: "bg-secondary" },
    "default":    { icon: "info",            bg: "bg-outline" },
  };

  container.innerHTML = activities.map((item, idx) => {
    const cfg = iconMap[item.type] || iconMap.default;
    return `
      <div class="relative pl-10 ${idx > 0 ? "mt-8" : ""}">
        <div class="absolute left-0 top-1 w-7 h-7 rounded-full ${cfg.bg}
                    border-[3px] border-white shadow-md flex items-center justify-center
                    ${idx === 0 ? "timeline-dot-first" : ""}">
          <span class="material-symbols-outlined text-white"
                style="font-size:13px;font-variation-settings:'FILL' 1">
            ${cfg.icon}
          </span>
        </div>
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div>
            <p class="text-on-surface font-bold">${escHtml(item.title)}</p>
            <p class="text-on-surface-variant text-sm">${escHtml(item.subtitle || "")}</p>
          </div>
          <span class="text-xs font-bold text-primary bg-primary/8 px-3 py-1
                       rounded-full uppercase tracking-widest whitespace-nowrap">
            ${timeAgo(item.created_at)}
          </span>
        </div>
      </div>`;
  }).join("");
}


// ─────────────────────────────────────────────
// 7. MATCH ACTIONS
// ─────────────────────────────────────────────

async function approveMatch(matchId, btn) {
  btn.disabled    = true;
  btn.textContent = "Approving...";

  try {
    const res = await fetch(`/api/ngo/match/${matchId}/approve`, {
      method: "POST"
    });
    if (!res.ok) throw new Error();

    // Remove the match card from UI
    const card = btn.closest(".flex.flex-col.gap-4");
    card.style.opacity = "0";
    card.style.transition = "opacity 0.3s";
    setTimeout(() => {
      card.remove();
      // Reload matches count badge
      const badge = document.getElementById("matchesBadge");
      if (badge) {
        const current = parseInt(badge.textContent.replace("New: ", "")) || 0;
        badge.textContent = `New: ${Math.max(0, current - 1)}`;
      }
    }, 300);

    showToast("Volunteer approved! They will be notified.", "success");

  } catch (err) {
    btn.disabled    = false;
    btn.textContent = "Approve";
    showToast("Failed to approve. Please try again.", "error");
  }
}

async function skipMatch(matchId, btn) {
  btn.disabled    = true;
  btn.textContent = "Skipping...";

  try {
    const res = await fetch(`/api/ngo/match/${matchId}/skip`, {
      method: "POST"
    });
    if (!res.ok) throw new Error();

    const card = btn.closest(".flex.flex-col.gap-4");
    card.style.opacity = "0";
    card.style.transition = "opacity 0.3s";
    setTimeout(() => card.remove(), 300);

  } catch (err) {
    btn.disabled    = false;
    btn.textContent = "Skip";
  }
}


// ─────────────────────────────────────────────
// 8. UPLOAD REPORT MODAL — AI EXTRACTION
// ─────────────────────────────────────────────

// These are called by inline onclick in the HTML
// We override handleSubmit with the real API call

window.handleSubmit = async function() {
  const fileInput = document.getElementById("file-input");
  const submitBtn = document.getElementById("submit-btn");
  const file      = fileInput.files[0];

  if (!file) return;

  submitBtn.disabled    = true;
  submitBtn.textContent = "Uploading & Analyzing...";

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
    showToast(
      `AI found ${data.needs_count || "several"} needs in your report. Redirecting...`,
      "success"
    );

    // Redirect to the extraction review page
    setTimeout(() => {
      window.location.href = data.redirect || "/ngo/upload";
    }, 1500);

  } catch (err) {
    console.error("Upload error:", err);
    submitBtn.disabled    = false;
    submitBtn.textContent = "Submit Report";
    showToast(err.message || "Upload failed. Please try again.", "error");
  }
};


// ─────────────────────────────────────────────
// 9. MANUAL NEED MODAL — FORM SUBMIT
// ─────────────────────────────────────────────

window.handleManualSubmit = async function() {
  // Collect values from manual form
  const title       = document.getElementById("manualTitle")?.value.trim();
  const category    = document.getElementById("manualCategory")?.value;
  const urgency     = document.querySelector('input[name="urgency"]:checked')?.value;
  const location    = document.getElementById("manualLocation")?.value.trim();
  const description = document.getElementById("manualDescription")?.value.trim();
  const affected    = document.getElementById("manualAffected")?.value;

  if (!title || !category || !urgency) {
    showToast("Please fill in Title, Category and Urgency.", "error");
    return;
  }

  const submitBtn = document.getElementById("manualSubmitBtn");
  if (submitBtn) {
    submitBtn.disabled    = true;
    submitBtn.textContent = "Submitting...";
  }

  try {
    const res = await fetch("/api/ngo/need/create", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        category,
        urgency_label:    urgency.toUpperCase(),
        urgency_score:    urgency === "high" ? 8 : urgency === "mid" ? 5 : 2,
        location,
        description,
        estimated_people: affected ? parseInt(affected) : null,
        source:           "manual"
      })
    });

    if (!res.ok) throw new Error("Failed to create need");

    closeManual();
    showToast("Need posted successfully!", "success");
    // Reload dashboard data to show new need
    loadDashboard();

  } catch (err) {
    console.error("Manual submit error:", err);
    showToast("Failed to submit. Please try again.", "error");
    if (submitBtn) {
      submitBtn.disabled    = false;
      submitBtn.textContent = "Submit Need";
    }
  }
};


// ─────────────────────────────────────────────
// 10. SKELETON LOADERS
// ─────────────────────────────────────────────

function showSkeletons() {
  // Stats
  ["statOpenNeeds","statAssignedNeeds","statCompleted","statVolunteers"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = "—";
      el.classList.add("animate-pulse");
    }
  });

  // Recent needs
  const needsContainer = document.getElementById("recentNeedsContainer");
  if (needsContainer) {
    needsContainer.innerHTML = [1,2,3].map(() => `
      <div class="p-8 flex items-center justify-between">
        <div class="flex items-center gap-6 flex-1">
          <div class="w-2 h-12 bg-surface-container-high rounded-full animate-pulse"></div>
          <div class="space-y-2 flex-1">
            <div class="h-4 bg-surface-container-high rounded animate-pulse w-2/3"></div>
            <div class="h-3 bg-surface-container-high rounded animate-pulse w-1/3"></div>
          </div>
        </div>
        <div class="h-8 w-16 bg-surface-container-high rounded-full animate-pulse ml-4"></div>
      </div>`).join('<hr class="border-surface-container"/>');
  }

  // Matches
  const matchesContainer = document.getElementById("matchesContainer");
  if (matchesContainer) {
    matchesContainer.innerHTML = [1,2].map(() => `
      <div class="flex items-center gap-4">
        <div class="w-14 h-14 rounded-full bg-surface-container-high animate-pulse flex-shrink-0"></div>
        <div class="space-y-2 flex-1">
          <div class="h-4 bg-surface-container-high rounded animate-pulse w-1/2"></div>
          <div class="h-3 bg-surface-container-high rounded animate-pulse w-1/3"></div>
        </div>
      </div>`).join("<hr class='border-surface-container my-6'/>");
  }
}


// ─────────────────────────────────────────────
// 11. TOAST NOTIFICATIONS
// ─────────────────────────────────────────────

function showToast(message, type = "success") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.style.cssText = `
      position: fixed; bottom: 80px; right: 24px;
      z-index: 9999; display: flex; flex-direction: column; gap: 10px;
    `;
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.style.cssText = `
    background: white;
    border-left: 4px solid ${type === "success" ? "#006c44" : "#ba1a1a"};
    border-radius: 0.75rem;
    padding: 14px 18px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.12);
    font-size: 0.875rem;
    font-weight: 500;
    max-width: 320px;
    cursor: pointer;
    animation: slideIn 0.3s ease;
    font-family: 'Plus Jakarta Sans', sans-serif;
    color: #121c2a;
  `;
  toast.textContent = message;
  toast.addEventListener("click", () => toast.remove());
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity   = "0";
    toast.style.transform = "translateX(100%)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}


// ─────────────────────────────────────────────
// 12. DASHBOARD ERROR STATE
// ─────────────────────────────────────────────

function showDashboardError() {
  const needsContainer = document.getElementById("recentNeedsContainer");
  if (needsContainer) {
    needsContainer.innerHTML = `
      <div class="p-10 text-center">
        <span class="material-symbols-outlined text-4xl text-tertiary">error_outline</span>
        <p class="text-on-surface font-bold mt-2">Failed to load data</p>
        <p class="text-on-surface-variant text-sm mt-1">Please refresh the page.</p>
        <button onclick="loadDashboard()"
                class="mt-4 px-6 py-2 bg-primary text-white rounded-full font-bold text-sm">
          Retry
        </button>
      </div>`;
  }
}


// ─────────────────────────────────────────────
// 13. HELPERS
// ─────────────────────────────────────────────

function getUrgencyConfig(label, score) {
  const l = (label || "").toUpperCase();
  const s = score || 0;

  if (l === "CRITICAL" || s >= 8) return {
    barColor:   "bg-tertiary",
    badgeBg:    "bg-tertiary-fixed",
    badgeText:  "text-on-tertiary-fixed"
  };
  if (l === "HIGH" || s >= 6) return {
    barColor:   "bg-secondary",
    badgeBg:    "bg-secondary-fixed",
    badgeText:  "text-on-secondary-fixed"
  };
  if (l === "MEDIUM" || l === "MID" || s >= 4) return {
    barColor:   "bg-primary",
    badgeBg:    "bg-surface-container-high",
    badgeText:  "text-on-surface"
  };
  return {
    barColor:   "bg-primary-container",
    badgeBg:    "bg-primary-fixed",
    badgeText:  "text-on-primary-fixed"
  };
}

function getStatusLabel(status) {
  const map = {
    "open":        "Open",
    "assigned":    "Assigned",
    "in_progress": "In Progress",
    "completed":   "Completed"
  };
  return map[status] || status || "Open";
}

function timeAgo(timestamp) {
  if (!timestamp) return "just now";

  let date;
  if (timestamp._seconds) {
    // Firestore timestamp from JSON
    date = new Date(timestamp._seconds * 1000);
  } else if (typeof timestamp === "string") {
    date = new Date(timestamp);
  } else if (typeof timestamp === "number") {
    date = new Date(timestamp);
  } else {
    return "just now";
  }

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60)   return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400)return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}