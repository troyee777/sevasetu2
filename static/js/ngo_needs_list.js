/* =============================================================
   ngo_needs_list.js  — Complete rewrite
   - Loads needs from /api/ngo/needs  (no more localStorage)
   - Delete calls DELETE /api/ngo/need/<id>
   - Manual create posts to /api/ngo/need/create  (same as dashboard)
   - Filters: status tabs, category, urgency, search  (all client-side)
   - Upload redirects to /ngo/dashboard (trigger the existing upload flow)
   - Ola Maps location picker inside the manual modal
   ============================================================= */

'use strict';

// ── State ────────────────────────────────────────────────────
let allNeeds        = [];          // raw from API
let filteredNeeds   = [];          // after filters applied
let currentStatus   = 'All';
let currentCategory = 'All';
let currentUrgency  = 'All';
let searchQuery     = '';
let currentSkills   = [];
let OLA_MAPS_API_KEY = null;

// Manual modal map state
let manualMapInstance    = null;
let manualMapInitialized = false;
let manualMarker         = null;
let manualLat            = 22.5726;
let manualLng            = 88.3639;

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadOlaMapsKey();
  loadNeeds();
  wireFilters();
  wireModalButtons();
  wireManualForm();
});

// ── OlaMaps key ──────────────────────────────────────────────
async function loadOlaMapsKey() {
  try {
    const res  = await fetch('/api/get_ola_maps_key');
    const data = await res.json();
    OLA_MAPS_API_KEY = data.OLA_MAPS_API_KEY;
  } catch {}
}

// ══════════════════════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════════════════════

async function loadNeeds() {
  showSkeletons();
  try {
    const res = await fetch('/api/ngo/needs');
    if (res.status === 401) { window.location.href = '/getstarted'; return; }
    if (!res.ok) throw new Error('Failed to load needs');
    const data = await res.json();
    // Exclude soft-deleted needs from the list
    allNeeds = (data.needs || []).filter(n => n.status !== 'deleted');
    applyFilters();
    updateStats();
  } catch (err) {
    console.error('loadNeeds error:', err);
    showError('Failed to load needs. Please refresh the page.');
  }
}

async function deleteNeed(id, btn) {
  if (!confirm('Are you sure you want to delete this need? This cannot be undone.')) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined text-xl">hourglass_empty</span>';

  try {
    const res = await fetch(`/api/ngo/need/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    // Remove from local state
    allNeeds = allNeeds.filter(n => n.id !== id);
    applyFilters();
    updateStats();
    showToast('Need deleted.', 'success');
  } catch {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined text-xl">delete</span>';
    showToast('Failed to delete. Please try again.', 'error');
  }
}

// ══════════════════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════════════════

function applyFilters() {
  filteredNeeds = allNeeds.filter(need => {
    // Status
    if (currentStatus !== 'All') {
      const s = (need.status || 'open').toLowerCase();
      if (currentStatus === 'Open'      && s !== 'open')       return false;
      if (currentStatus === 'Assigned'  && !['assigned','in_progress'].includes(s)) return false;
      if (currentStatus === 'Completed' && s !== 'completed')  return false;
    }
    // Category
    if (currentCategory !== 'All' && need.category !== currentCategory) return false;
    // Search
    const q = searchQuery.toLowerCase();
    if (q && !(
      (need.title       ||'').toLowerCase().includes(q) ||
      (need.description ||'').toLowerCase().includes(q) ||
      (need.category    ||'').toLowerCase().includes(q)
    )) return false;
    // Urgency
    const score = need.urgency_score || 0;
    if (currentUrgency === 'Low'      && score > 3)  return false;
    if (currentUrgency === 'Moderate' && (score < 4 || score > 6)) return false;
    if (currentUrgency === 'High'     && score < 7)  return false;

    return true;
  });

  renderNeeds(filteredNeeds);
  updateResultsCount();
}

function renderNeeds(needs) {
  const container = document.getElementById('needsContainer');
  if (!container) return;

  if (!needs.length) {
    container.innerHTML = `
      <div class="bg-white rounded-xl p-12 text-center shadow-sm border border-gray-100">
        <span class="material-symbols-outlined text-5xl text-slate-300 block mb-4">inbox</span>
        <p class="font-bold text-slate-700 text-lg">No needs found</p>
        <p class="text-slate-400 text-sm mt-1">
          ${allNeeds.length ? 'Try adjusting your filters.' : 'Post your first need using the button above.'}
        </p>
      </div>`;
    return;
  }

  container.innerHTML = needs.map(need => buildNeedCard(need)).join('');
}

function buildNeedCard(need) {
  const urgency    = need.urgency_score || 0;
  const urgencyBg  = urgency >= 7 ? 'bg-red-100 text-red-700' : urgency >= 4 ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700';
  const statusBg   = getStatusBadge(need.status);
  const locText    = getLocationText(need.location);
  const skills     = (need.required_skills || []).slice(0, 3);

  return `
    <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-2 mb-1">
            <h3 class="text-lg font-bold text-slate-800 truncate">${escHtml(need.title || 'Untitled')}</h3>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${urgencyBg}">
              Urgency ${urgency}/10
            </span>
            <span class="${statusBg} px-2 py-0.5 rounded-full text-[10px] font-bold uppercase">
              ${getStatusLabel(need.status)}
            </span>
          </div>
          <p class="text-sm text-slate-500 line-clamp-2 mt-1">${escHtml(need.description || '')}</p>
          <div class="flex flex-wrap gap-3 mt-2 text-[11px] font-medium text-slate-500">
            ${locText ? `<span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">location_on</span>${escHtml(locText)}</span>` : ''}
            <span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">category</span>${escHtml(need.category || 'General')}</span>
            ${need.estimated_people ? `<span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">groups</span>${need.estimated_people} people</span>` : ''}
            <span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">schedule</span>${timeAgo(need.created_at)}</span>
          </div>
          ${skills.length ? `
          <div class="flex flex-wrap gap-1.5 mt-2">
            ${skills.map(s => `<span class="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded-full">${escHtml(s)}</span>`).join('')}
          </div>` : ''}
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <button class="bg-emerald-600 text-white px-5 py-2 rounded-lg text-sm font-bold hover:bg-emerald-700 transition-colors"
                  onclick="viewNeedDetail('${need.id}')">
            Details
          </button>
          <button onclick="deleteNeed('${need.id}', this)"
                  class="p-2 text-slate-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
                  title="Delete need">
            <span class="material-symbols-outlined text-xl">delete</span>
          </button>
        </div>
      </div>
    </div>`;
}

function getLocationText(loc) {
  if (!loc) return '';
  if (typeof loc === 'string') return loc;
  if (typeof loc === 'object') return loc.city || loc.address || '';
  return '';
}

function getStatusBadge(status) {
  const map = {
    open:        'bg-blue-100 text-blue-700',
    assigned:    'bg-amber-100 text-amber-700',
    in_progress: 'bg-purple-100 text-purple-700',
    completed:   'bg-green-100 text-green-700',
  };
  return map[(status||'open').toLowerCase()] || 'bg-slate-100 text-slate-600';
}

function getStatusLabel(status) {
  const map = { open:'Open', assigned:'Assigned', in_progress:'In Progress', completed:'Completed' };
  return map[(status||'open').toLowerCase()] || status || 'Open';
}

function updateStats() {
  // Stats display elements are optional — only update if present in the DOM
  const open      = allNeeds.filter(n => n.status === 'open').length;
  const assigned  = allNeeds.filter(n => ['assigned','in_progress'].includes(n.status)).length;
  const completed = allNeeds.filter(n => n.status === 'completed').length;
  safeSet('statTotal',     allNeeds.length);
  safeSet('statOpen',      open);
  safeSet('statAssigned',  assigned);
  safeSet('statCompleted', completed);
}

function updateResultsCount() {
  const el = document.getElementById('resultsCount');
  if (el) el.textContent = `${filteredNeeds.length} need${filteredNeeds.length !== 1 ? 's' : ''}`;
}

function showSkeletons() {
  const container = document.getElementById('needsContainer');
  if (!container) return;
  container.innerHTML = [1,2,3].map(() => `
    <div class="bg-white p-5 rounded-xl border border-gray-100 animate-pulse">
      <div class="flex gap-4">
        <div class="flex-1 space-y-3">
          <div class="h-5 bg-gray-200 rounded w-2/3"></div>
          <div class="h-4 bg-gray-200 rounded w-full"></div>
          <div class="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
        <div class="h-9 w-20 bg-gray-200 rounded-lg self-start"></div>
      </div>
    </div>`).join('');
}

function viewNeedDetail(id) {
  // Placeholder — link to a detail page when implemented
  showToast('Need detail page coming soon.', 'success');
}

// ══════════════════════════════════════════════════════════════
// FILTERS
// ══════════════════════════════════════════════════════════════

function wireFilters() {
  // Category select
  const catFilter = document.getElementById('categoryFilter');
  if (catFilter) catFilter.addEventListener('change', e => {
    currentCategory = e.target.value;
    applyFilters();
  });

  // Urgency select
  const urgFilter = document.getElementById('urgencyFilter');
  if (urgFilter) urgFilter.addEventListener('change', e => {
    currentUrgency = e.target.value;
    applyFilters();
  });

  // Search
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.addEventListener('input', e => {
    searchQuery = e.target.value.toLowerCase();
    applyFilters();
  });

  // Status tabs
  document.querySelectorAll('.statusBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentStatus = btn.dataset.status;
      document.querySelectorAll('.statusBtn').forEach(b => {
        b.classList.remove('bg-surface-container-lowest', 'text-primary', 'font-bold');
        b.classList.add('text-on-surface-variant');
      });
      btn.classList.add('bg-surface-container-lowest', 'text-primary', 'font-bold');
      btn.classList.remove('text-on-surface-variant');
      applyFilters();
    });
  });
}

// ══════════════════════════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════════════════════════

function wireModalButtons() {
  // "Post a Need" opens the choice modal
  document.getElementById('openModalBtn')?.addEventListener('click', openChoice);

  // Choice modal buttons
  document.getElementById('openUpload')?.addEventListener('click', () => {
    closeChoice();
    // Redirect to the upload flow on the reports page
    window.location.href = '/ngo/reports';
  });

  document.getElementById('openManual')?.addEventListener('click', () => {
    closeChoice();
    openManualModal();
  });

  // Close manual modal button
  document.getElementById('closeManualModal')?.addEventListener('click', closeManualModal);

  // Close on backdrop click
  document.getElementById('choiceModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('choiceModal')) closeChoice();
  });
  document.getElementById('manualModal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('manualModal')) closeManualModal();
  });

  // ESC key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeChoice(); closeManualModal(); }
  });
}

function openChoice() {
  const modal = document.getElementById('choiceModal');
  if (modal) modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeChoice() {
  const modal = document.getElementById('choiceModal');
  if (modal) modal.classList.remove('open');
  document.body.style.overflow = '';
}
function openManualModal() {
  const modal = document.getElementById('manualModal');
  if (modal) modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  setTimeout(initManualMapOnce, 200);
}
function closeManualModal() {
  const modal = document.getElementById('manualModal');
  if (modal) modal.classList.remove('open');
  document.body.style.overflow = '';
}

// Expose globally for inline onclick handlers in the template
window.closeManualModal = closeManualModal;

// ══════════════════════════════════════════════════════════════
// OLA MAPS — MANUAL MODAL LOCATION PICKER
// ══════════════════════════════════════════════════════════════

function initManualMapOnce() {
  if (manualMapInitialized) return;
  const el = document.getElementById('manualMap');
  if (!el || typeof OlaMaps === 'undefined' || !OLA_MAPS_API_KEY) return;
  manualMapInitialized = true;

  const olaMaps = new OlaMaps({ apiKey: OLA_MAPS_API_KEY });

  manualMapInstance = olaMaps.init({
    style:     'https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json',
    container: 'manualMap',
    center:    [manualLng, manualLat],
    zoom:      13
  });

  const pinEl = document.createElement('div');
  pinEl.style.cssText = `
    width:26px;height:26px;background:#006c44;
    border-radius:50% 50% 50% 0;transform:rotate(-45deg);
    border:2.5px solid white;box-shadow:0 3px 10px rgba(0,108,68,.35);cursor:grab;
  `;

  manualMapInstance.on('load', () => {
    manualMarker = olaMaps
      .addMarker({ element: pinEl, draggable: true })
      .setLngLat([manualLng, manualLat])
      .addTo(manualMapInstance);

    manualMarker.on('dragend', () => {
      const pos = manualMarker.getLngLat();
      updateManualLocation(pos.lat, pos.lng);
    });

    manualMapInstance.on('click', e => {
      const { lat, lng } = e.lngLat;
      manualMarker.setLngLat([lng, lat]);
      updateManualLocation(lat, lng);
    });
  });
}

async function updateManualLocation(lat, lng) {
  manualLat = lat;
  manualLng = lng;
  safeSet('manualLat', lat.toFixed(6), true);
  safeSet('manualLng', lng.toFixed(6), true);

  // Reverse-geocode to fill the text field
  if (!OLA_MAPS_API_KEY) return;
  try {
    const res  = await fetch(
      `https://api.olamaps.io/places/v1/reverse-geocode?latlng=${lat},${lng}&api_key=${OLA_MAPS_API_KEY}`
    );
    const data = await res.json();
    const results = data.results || [];
    if (results.length) {
      const addr = results[0].formatted_address || '';
      const part = addr.split(',')[0];
      const locInput = document.getElementById('manualLocationText');
      if (locInput && !locInput.value) locInput.value = part;
      const tag = document.getElementById('manualMapTag');
      if (tag) tag.textContent = `📍 ${part}`;
    }
  } catch {}
}

window.useManualCurrentLocation = function() {
  if (!navigator.geolocation) return;
  const btn = document.getElementById('manualUseLocationBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Detecting…'; }

  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    manualMarker?.setLngLat([lng, lat]);
    manualMapInstance?.setCenter([lng, lat]);
    updateManualLocation(lat, lng);
    if (btn) { btn.disabled = false; btn.textContent = '⌖ Use my location'; }
  }, () => {
    if (btn) { btn.disabled = false; btn.textContent = '⌖ Use my location'; }
  }, { timeout: 8000 });
};

// ══════════════════════════════════════════════════════════════
// MANUAL FORM — SUBMIT
// ══════════════════════════════════════════════════════════════

function wireManualForm() {
  // Skills chip input
  const skillInput = document.getElementById('skillInput');
  const skillBox   = document.getElementById('skillBox');

  if (skillInput) {
    skillInput.addEventListener('keypress', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const val = skillInput.value.trim();
      if (val && !currentSkills.includes(val)) {
        currentSkills.push(val);
        const tag = document.createElement('span');
        tag.className = 'bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs flex items-center gap-1 cursor-pointer font-semibold';
        tag.innerHTML = `${escHtml(val)} <span class="opacity-60">✕</span>`;
        tag.onclick = () => { currentSkills = currentSkills.filter(s => s !== val); tag.remove(); };
        skillBox?.appendChild(tag);
        skillInput.value = '';
      }
    });
  }

  // Prevent Enter key from submitting unexpectedly in the title field
  document.getElementById('manualTitle')?.addEventListener('keypress', e => {
    if (e.key === 'Enter') e.preventDefault();
  });
}

window.handleManualSubmit = async function() {
  const title       = document.getElementById('manualTitle')?.value.trim();
  const category    = document.getElementById('manualCategory')?.value;
  const urgencyEl   = document.querySelector('input[name="urgency"]:checked');
  const urgency     = urgencyEl?.value;
  const locText     = document.getElementById('manualLocationText')?.value.trim();
  const description = document.getElementById('manualDescription')?.value.trim();
  const affected    = document.getElementById('manualAffected')?.value;
  const lat         = parseFloat(document.getElementById('manualLat')?.value || '0') || null;
  const lng         = parseFloat(document.getElementById('manualLng')?.value || '0') || null;

  if (!title)    { showToast('Please enter a title.',    'error'); return; }
  if (!category) { showToast('Please select a category.','error'); return; }
  if (!urgency)  { showToast('Please select an urgency level.','error'); return; }

  const submitBtn = document.getElementById('manualSubmitBtn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">sync</span> Submitting…'; }

  // Build location object — same format as dashboard manual modal
  const location = lat && lng
    ? { city: locText || '', lat, lng }
    : locText || '';

  try {
    const res = await fetch('/api/ngo/need/create', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        category,
        urgency_label:    urgency.toUpperCase(),
        urgency_score:    urgency === 'high' ? 8 : urgency === 'mid' ? 5 : 2,
        location,
        description,
        estimated_people: affected ? parseInt(affected) : null,
        required_skills:  [...currentSkills],
        source:           'manual',
      })
    });

    if (!res.ok) throw new Error('Failed to create need');

    closeManualModal();
    showToast('Need posted! Matching volunteers…', 'success');

    // Reset form state
    currentSkills = [];
    document.getElementById('skillBox').innerHTML  = '';
    document.getElementById('manualTitle').value   = '';
    document.getElementById('manualDescription').value = '';
    document.getElementById('manualLocationText').value = '';
    document.getElementById('manualAffected').value    = '';
    document.getElementById('manualLat').value = '';
    document.getElementById('manualLng').value = '';
    document.getElementById('manualMapTag').textContent = '📍 Click map or drag pin to set location';
    document.querySelectorAll('input[name="urgency"]').forEach(r => r.checked = false);

    // Reload needs
    await loadNeeds();

  } catch (err) {
    console.error('Manual submit error:', err);
    showToast('Failed to submit. Please try again.', 'error');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<span class="material-symbols-outlined text-lg">send</span> Submit Need'; }
  }
};

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════

function safeSet(id, value, isInput = false) {
  const el = document.getElementById(id);
  if (!el) return;
  if (isInput || el.tagName === 'INPUT') el.value = value;
  else el.textContent = value;
}

function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;bottom:80px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:10px;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.style.cssText = `background:white;border-left:4px solid ${type === 'success' ? '#006c44' : '#ba1a1a'};
    border-radius:.75rem;padding:14px 18px;box-shadow:0 8px 32px rgba(0,0,0,.12);
    font-size:.875rem;font-weight:500;max-width:320px;cursor:pointer;
    font-family:'Plus Jakarta Sans',sans-serif;color:#121c2a;`;
  toast.textContent = message;
  toast.addEventListener('click', () => toast.remove());
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0'; toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all .3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function showError(msg) {
  const container = document.getElementById('needsContainer');
  if (container) container.innerHTML = `
    <div class="bg-white rounded-xl p-12 text-center shadow-sm border border-red-100">
      <span class="material-symbols-outlined text-5xl text-red-300 block mb-4">error_outline</span>
      <p class="font-bold text-red-700">${escHtml(msg)}</p>
      <button onclick="loadNeeds()" class="mt-4 px-6 py-2 bg-primary text-white rounded-full font-bold text-sm">Retry</button>
    </div>`;
}

function timeAgo(timestamp) {
  if (!timestamp) return 'just now';
  let date;
  if (timestamp._seconds)           date = new Date(timestamp._seconds * 1000);
  else if (typeof timestamp === 'string') date = new Date(timestamp);
  else if (typeof timestamp === 'number') date = new Date(timestamp);
  else return 'just now';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60)    return 'just now';
  if (seconds < 3600)  return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}