/* ═══════════════════════════════════════════════════════════════
   admin_dashboard.js — Complete rewrite
   - Fetches from real API endpoints
   - Skeleton → real content transitions
   - Chart.js donut/bar
   - Modal open/close with fresh data
   - NGO Verification Flow
 ═══════════════════════════════════════════════════════════════ */
 
 'use strict';
 
 // ── State ────────────────────────────────────────────────────────
 let dashData = null;
 let chartInstance = null;
 let currentChartType = 'doughnut';
 const COLORS = ['#006c44','#fea619','#fa7272','#7c9cff','#4dd4ac','#f97316'];
 
 // ── Boot ─────────────────────────────────────────────────────────
 document.addEventListener('DOMContentLoaded', () => {
   setDateLabel();
   loadDashboard();
   wireModals();
   wireChartTabs();
 });
 
 // ── Set current date ─────────────────────────────────────────────
 function setDateLabel() {
   const el = document.getElementById('welcomeDate');
   if (!el) return;
   el.textContent = new Date().toLocaleDateString('en-IN', {
     weekday: 'long', day: 'numeric', month: 'long'
   });
 }
 
 // ══════════════════════════════════════════════════════════════════
 // MAIN LOADER
 // ══════════════════════════════════════════════════════════════════
 async function loadDashboard() {
   const refreshBtn = document.getElementById('welcomeRefreshBtn');
   const globalBtn  = document.getElementById('globalRefreshBtn');
   if (refreshBtn) refreshBtn.classList.add('spinning');
   if (globalBtn)  globalBtn.classList.add('spinning');
 
   try {
     const res = await fetch('/api/admin/dashboard');
 
     if (res.status === 401) {
       window.location.href = '/getstarted';
       return;
     }
 
     if (!res.ok) throw new Error('API error ' + res.status);
 
     dashData = await res.json();
 
     renderWelcome(dashData);
     renderStats(dashData.stats);
     renderNgoTable(dashData.recent_ngos || []);
     renderActivity(dashData.activity || []);
     renderVerifQueue(dashData.pending_ngos || []);
     renderChart(dashData.category_breakdown || {});
     updateTopbarBadge(dashData.stats);
 
   } catch (err) {
     console.error('Dashboard load error:', err);
     showError('Failed to load dashboard data. Retrying…');
     setTimeout(loadDashboard, 5000);
   } finally {
     if (refreshBtn) refreshBtn.classList.remove('spinning');
     if (globalBtn)  globalBtn.classList.remove('spinning');
   }
 }
 
 // ══════════════════════════════════════════════════════════════════
 // WELCOME BAR
 // ══════════════════════════════════════════════════════════════════
 function renderWelcome(data) {
   const titleEl = document.getElementById('welcomeTitle');
   const subEl   = document.getElementById('welcomeSub');
   if (!titleEl || !subEl) return;
 
   const hour = new Date().getHours();
   const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
   titleEl.textContent = `${greeting}, Admin 👋`;
   subEl.textContent   = `Platform overview — ${(data.stats?.total_ngos || 0).toLocaleString('en-IN')} NGOs, ${(data.stats?.total_volunteers || 0).toLocaleString('en-IN')} volunteers active`;
 }
 
 function updateTopbarBadge(stats) {
   const el = document.getElementById('topbar-live-label');
   if (el) el.textContent = `${(stats?.open_needs || 0)} open needs`;
 }
 
 // ══════════════════════════════════════════════════════════════════
 // STATS
 // ══════════════════════════════════════════════════════════════════
 function renderStats(stats) {
   if (!stats) return;
 
   const cards = [
     {
       id:      'statNgos',
       icon:    'apartment',
       iconBg:  'rgba(147,247,191,.25)',
       iconClr: '#006c44',
       label:   'Total NGOs',
       value:   stats.total_ngos || 0,
       badge:   '+12%',
       badgeCls:'green',
       decoClr: '#006c44',
     },
     {
       id:      'statVols',
       icon:    'groups',
       iconBg:  'rgba(255,221,184,.35)',
       iconClr: '#855300',
       label:   'Volunteers',
       value:   stats.total_volunteers || 0,
       badge:   '+8%',
       badgeCls:'amber',
       decoClr: '#855300',
     },
     {
       id:      'statOpenNeeds',
       icon:    'campaign',
       iconBg:  'rgba(255,218,216,.35)',
       iconClr: '#a83639',
       label:   'Open Needs',
       value:   stats.open_needs || 0,
       badge:   null,
       badgeCls:'',
       barVal:  stats.open_needs || 0,
       barMax:  Math.max(stats.total_needs || 1, 1),
       barClr:  '#a83639',
       decoClr: '#a83639',
     },
     {
       id:      'statCompleted',
       icon:    'task_alt',
       iconBg:  'rgba(147,247,191,.25)',
       iconClr: '#006c44',
       label:   'Completed Tasks',
       value:   stats.resolved_needs || 0,
       badge:   '94%',
       badgeCls:'green',
       decoClr: '#006c44',
     },
   ];
 
   const grid = document.getElementById('statsGrid');
   grid.innerHTML = cards.map(c => `
     <div class="stat-card">
       <div class="stat-icon" style="background:${c.iconBg}">
         <span class="material-symbols-outlined" style="color:${c.iconClr};font-size:22px;font-variation-settings:'FILL' 1">${c.icon}</span>
       </div>
       <div class="stat-label">${escHtml(c.label)}</div>
       <div class="stat-value" id="${c.id}">0</div>
       <div class="stat-footer">
         ${c.badge
           ? `<span class="stat-badge ${c.badgeCls}">${escHtml(c.badge)}</span>`
           : c.barVal !== undefined
             ? `<div class="stat-bar"><div class="stat-bar-fill" id="${c.id}Bar" style="background:${c.barClr};width:0%;"></div></div>`
             : '<span></span>'
         }
       </div>
       <div class="stat-deco" style="background:${c.decoClr};"></div>
     </div>
   `).join('');
 
   // Animate counters
   cards.forEach(c => {
     animateCounter(c.id, c.value);
     if (c.barVal !== undefined) {
       const pct = Math.min(Math.round((c.barVal / c.barMax) * 100), 100);
       setTimeout(() => {
         const barEl = document.getElementById(c.id + 'Bar');
         if (barEl) barEl.style.width = pct + '%';
       }, 300);
     }
   });
 }
 
 function animateCounter(id, target) {
   const el = document.getElementById(id);
   if (!el) return;
   let start = 0;
   const steps = 45;
   const inc = target / steps;
   const timer = setInterval(() => {
     start += inc;
     if (start >= target) {
       el.textContent = target.toLocaleString('en-IN');
       clearInterval(timer);
     } else {
       el.textContent = Math.floor(start).toLocaleString('en-IN');
     }
   }, 900 / steps);
 }
 
 // ══════════════════════════════════════════════════════════════════
 // NGO TABLE
 // ══════════════════════════════════════════════════════════════════
 function renderNgoTable(ngos) {
   const tbody = document.getElementById('ngoTableBodyInner');
   if (!tbody) return;
 
   if (!ngos.length) {
     tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><span class="material-symbols-outlined">inbox</span>No NGOs registered yet.</td></tr>`;
     return;
   }
 
   tbody.innerHTML = ngos.slice(0, 5).map(ngo => buildNgoRow(ngo)).join('');
 }
 
 function buildNgoRow(ngo) {
   const initials = (ngo.org_name || 'NG').substring(0, 2).toUpperCase();
   const colors   = [
     {bg:'#d1fae5',clr:'#006c44'},
     {bg:'#fef3c7',clr:'#855300'},
     {bg:'#fde8e8',clr:'#a83639'},
     {bg:'#ede9fe',clr:'#6d28d9'},
     {bg:'#dbeafe',clr:'#1e40af'},
   ];
   const col  = colors[initials.charCodeAt(0) % colors.length];
   const spill = getStatusPill(ngo.verified);
 
   return `<tr>
     <td>
       <div style="display:flex;align-items:center;gap:10px;">
         <div class="ngo-avatar" style="background:${col.bg};color:${col.clr};">${escHtml(initials)}</div>
         <span class="ngo-name">${escHtml(ngo.org_name || 'Unknown NGO')}</span>
       </div>
     </td>
     <td class="ngo-meta">${escHtml(ngo.city || ngo.location?.city || 'India')}</td>
     <td class="ngo-meta">${formatDate(ngo.createdAt)}</td>
     <td>${spill}</td>
     <td style="text-align:right;"><button class="review-btn" onclick="openVerifModal()">Review</button></td>
   </tr>`;
 }
 
 function getStatusPill(verified) {
   if (verified === true)  return `<span class="status-pill s-v"><span class="dot"></span>Verified</span>`;
   if (verified === false) return `<span class="status-pill s-p"><span class="dot"></span>Pending</span>`;
   return `<span class="status-pill s-p"><span class="dot"></span>Pending</span>`;
 }
 
 // ══════════════════════════════════════════════════════════════════
 // ACTIVITY FEED
 // ══════════════════════════════════════════════════════════════════
 function renderActivity(activities) {
   const el = document.getElementById('activityFeed');
   if (!el) return;
 
   if (!activities || !activities.length) {
     el.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">history</span><p style="font-size:.85rem;font-weight:600;">No recent activity yet.</p></div>`;
     return;
   }
 
   const iconMap = {
     completed: { bg: '#006c44', icon: 'check' },
     matched:   { bg: '#855300', icon: 'handshake' },
     created:   { bg: '#4c6ef5', icon: 'add' },
     warning:   { bg: '#a83639', icon: 'warning' },
     donation:  { bg: '#855300', icon: 'currency_rupee' },
     default:   { bg: '#6e7a71', icon: 'info' },
   };
 
   el.innerHTML = activities.slice(0, 6).map(item => {
     const cfg = iconMap[item.type] || iconMap.default;
     return `<div class="activity-item">
       <div class="activity-icon" style="background:${cfg.bg};">
         <span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1">${cfg.icon}</span>
       </div>
       <div>
         <div class="activity-text">${escHtml(item.title || '')}</div>
         <div class="activity-time">${escHtml(item.subtitle || '')} · ${timeAgo(item.created_at)}</div>
       </div>
     </div>`;
   }).join('');
 }
 
 // ══════════════════════════════════════════════════════════════════
 // VERIFICATION QUEUE
 // ══════════════════════════════════════════════════════════════════
 function renderVerifQueue(ngos) {
   const list    = document.getElementById('verifList');
   const badge   = document.getElementById('pendingBadge');
 
   if (badge) badge.textContent = `${ngos.length} Pending`;
 
   if (!list) return;
 
   if (!ngos.length) {
     list.innerHTML = `<div class="empty-state" style="padding:24px 0;"><span class="material-symbols-outlined">check_circle</span><p style="font-size:.85rem;font-weight:600;">Queue is clear!</p></div>`;
     return;
   }
 
   list.innerHTML = ngos.slice(0, 3).map(ngo => buildVerifCard(ngo)).join('');
 }
 
 function buildVerifCard(ngo) {
   const initials = (ngo.org_name || 'NG').substring(0, 2).toUpperCase();
   const id = ngo.uid || ngo.id || Math.random().toString(36).slice(2);
   const logoHtml = ngo.logo_url
     ? `<img class="verif-img" src="${escHtml(ngo.logo_url)}" alt="${escHtml(ngo.org_name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div class="verif-img" style="display:none;background:#d1fae5;color:#006c44;align-items:center;justify-content:center;font-weight:800;font-size:.85rem;">${escHtml(initials)}</div>`
     : `<div class="verif-img" style="background:#d1fae5;color:#006c44;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.85rem;">${escHtml(initials)}</div>`;
 
   return `<div class="verif-card" data-ngo-id="${escHtml(id)}">
     ${logoHtml}
     <div style="flex:1;">
       <div class="verif-name">${escHtml(ngo.org_name || 'Unknown NGO')}</div>
       <div class="verif-meta">${escHtml(ngo.city || 'India')} · ${escHtml(ngo.description?.slice(0,40) || 'NGO')}…</div>
       <div class="verif-btns">
         <button class="btn-verify" onclick="handleVerify('${escHtml(id)}', this)"><span class="material-symbols-outlined" style="font-size:14px;font-variation-settings:'FILL' 1">check_circle</span> Verify</button>
         <button class="btn-reject" onclick="handleReject('${escHtml(id)}', this)"><span class="material-symbols-outlined" style="font-size:14px;">cancel</span> Reject</button>
       </div>
     </div>
   </div>`;
 }
 
 async function handleVerify(ngoId, btn) {
   btn.disabled = true;
   const originalText = btn.textContent;
   btn.textContent = '…';
   try {
     const res = await fetch(`/api/ngos/${ngoId}/verify`, { method: 'PATCH' });
     if (!res.ok) throw new Error('API failed');
 
     btn.textContent = '✓ Verified';
     btn.style.background = '#059669';
     btn.style.color = '#fff';
     btn.nextElementSibling.disabled = true;
     showToast('NGO verified successfully.', 'success');
     
     // Remove from queue after short delay
     setTimeout(() => {
       const card = btn.closest('.verif-card');
       if (card) { 
         card.style.opacity = '0'; 
         card.style.transition = 'opacity .3s'; 
         setTimeout(() => card.remove(), 300); 
       }
     }, 1200);
   } catch (err) {
     console.error('Verification failed:', err);
     btn.disabled = false; 
     btn.textContent = originalText;
     showToast('Failed to verify NGO.', 'error');
   }
 }
 
 async function handleReject(ngoId, btn) {
   btn.disabled = true;
   const originalText = btn.textContent;
   btn.textContent = '…';
   try {
     const res = await fetch(`/api/ngos/${ngoId}/suspend`, { method: 'PATCH' });
     if (!res.ok) throw new Error('API failed');
 
     btn.textContent = '✗ Rejected';
     btn.style.background = '#fee2e2';
     btn.style.color = '#7f1d1d';
     btn.previousElementSibling.disabled = true;
     showToast('NGO marked as rejected.', 'error');
     
     setTimeout(() => {
       const card = btn.closest('.verif-card');
       if (card) { 
         card.style.opacity = '0'; 
         card.style.transition = 'opacity .3s'; 
         setTimeout(() => card.remove(), 300); 
       }
     }, 1200);
   } catch (err) {
     console.error('Rejection failed:', err);
     btn.disabled = false; 
     btn.textContent = originalText;
     showToast('Failed to reject NGO.', 'error');
   }
 }
 
 // ══════════════════════════════════════════════════════════════════
 // CHART.JS
 // ══════════════════════════════════════════════════════════════════
 function renderChart(breakdown) {
   const wrap     = document.getElementById('chartWrap');
   const statsEl  = document.getElementById('chartStats');
   const footerEl = document.getElementById('chartFooter');
   const skelEl   = document.getElementById('chartSkeleton');
 
   if (!wrap) return;
 
   const categories = Object.keys(breakdown);
   const labels     = categories.length ? categories : ['Medical','Education','Food','Logistics','Other'];
   const values     = categories.length ? categories.map(k => breakdown[k]) : [0,0,0,0,0];
   const total      = values.reduce((a,b) => a+b, 0);
 
   if (skelEl) {
     wrap.innerHTML = `<div style="position:relative;height:220px;padding:10px 0;"><canvas id="needsChart"></canvas></div>`;
   }
 
   if (statsEl) {
     statsEl.innerHTML = labels.map((lbl, i) => `
       <div class="chart-stat-item" style="border-color:${COLORS[i % COLORS.length]};">
         <div class="chart-stat-num">${(values[i] || 0).toLocaleString('en-IN')}</div>
         <div class="chart-stat-lbl">${escHtml(lbl)}</div>
       </div>`).join('');
   }
 
   if (footerEl) footerEl.textContent = `${total.toLocaleString('en-IN')} total needs across all categories`;
 
   buildChart(currentChartType, labels, values);
 }
 
 function buildChart(type, labels, values) {
   const canvas = document.getElementById('needsChart');
   if (!canvas) return;
 
   if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
 
   const ctx = canvas.getContext('2d');
   const isDoughnut = type === 'doughnut';
 
   chartInstance = new Chart(ctx, {
     type: isDoughnut ? 'doughnut' : 'bar',
     data: {
       labels,
       datasets: [{
         label: 'Needs',
         data:  values,
         backgroundColor: COLORS.slice(0, labels.length),
         borderWidth: isDoughnut ? 2 : 0,
         borderColor: 'white',
         borderRadius: isDoughnut ? 0 : 8,
         hoverOffset: isDoughnut ? 8 : 0,
       }],
     },
     options: {
       responsive: true,
       maintainAspectRatio: false,
       cutout: isDoughnut ? '68%' : undefined,
       animation: { duration: 700, easing: 'easeOutQuart' },
       plugins: {
         legend: { display: false },
         tooltip: {
           backgroundColor: '#064e35',
           titleColor: '#fff',
           bodyColor: '#b7e8ce',
           padding: 10, cornerRadius: 8,
           callbacks: {
             label: ctx => {
               const t = ctx.dataset.data.reduce((a,b) => a+b, 0);
               const pct = t ? ((ctx.raw / t) * 100).toFixed(0) : 0;
               return ` ${ctx.raw} needs (${pct}%)`;
             }
           }
         },
       },
       ...(!isDoughnut ? {
         indexAxis: 'y',
         scales: {
           x: {
             grid: { color: 'rgba(0,108,68,.06)' },
             ticks: { color: '#6e7a71', font: { size: 11, family: 'Plus Jakarta Sans' } },
             border: { display: false },
           },
           y: {
             grid: { display: false },
             ticks: { color: '#3e4942', font: { size: 11, weight: '700', family: 'Plus Jakarta Sans' } },
             border: { display: false },
           },
         },
       } : {}),
     },
     plugins: isDoughnut ? [{
       id: 'centerLabel',
       afterDraw(chart) {
         const { ctx, chartArea } = chart;
         const cx = (chartArea.left + chartArea.right) / 2;
         const cy = (chartArea.top + chartArea.bottom) / 2;
         const total = chart.data.datasets[0].data.reduce((a,b) => a+b, 0);
         ctx.save();
         ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
         ctx.font = '800 1.4rem Plus Jakarta Sans, sans-serif';
         ctx.fillStyle = '#064e35';
         ctx.fillText(total.toLocaleString('en-IN'), cx, cy - 10);
         ctx.font = '700 .58rem Plus Jakarta Sans, sans-serif';
         ctx.fillStyle = '#6e7a71';
         ctx.letterSpacing = '.1em';
         ctx.fillText('TOTAL', cx, cy + 12);
         ctx.restore();
       }
     }] : [],
   });
 }
 
 function wireChartTabs() {
   document.querySelectorAll('.chart-tab').forEach(btn => {
     btn.addEventListener('click', () => {
       document.querySelectorAll('.chart-tab').forEach(b => b.classList.remove('active'));
       btn.classList.add('active');
       currentChartType = btn.dataset.type;
       if (dashData?.category_breakdown) {
         const breakdown = dashData.category_breakdown;
         const labels = Object.keys(breakdown).length ? Object.keys(breakdown) : ['Medical','Education','Food','Logistics','Other'];
         const values = Object.keys(breakdown).length ? Object.keys(breakdown).map(k => breakdown[k]) : [0,0,0,0,0];
         buildChart(currentChartType, labels, values);
       }
     });
   });
 }
 
 // ══════════════════════════════════════════════════════════════════
 // MODALS
 // ══════════════════════════════════════════════════════════════════
 function wireModals() {
   document.getElementById('ngo-viewall-btn')?.addEventListener('click', openNgoModal);
   document.getElementById('close-ngo-modal')?.addEventListener('click', () => closeModal('ngo-list-modal'));
   document.getElementById('ngo-list-modal')?.addEventListener('click', e => {
     if (e.target === document.getElementById('ngo-list-modal')) closeModal('ngo-list-modal');
   });
 
   document.getElementById('verif-viewall-btn')?.addEventListener('click', openVerifModal);
   document.getElementById('close-verif-modal')?.addEventListener('click', () => closeModal('verif-modal'));
   document.getElementById('verif-modal')?.addEventListener('click', e => {
     if (e.target === document.getElementById('verif-modal')) closeModal('verif-modal');
   });
 
   document.addEventListener('keydown', e => {
     if (e.key === 'Escape') { closeModal('ngo-list-modal'); closeModal('verif-modal'); }
   });
 }
 
 function openNgoModal() {
   openModal('ngo-list-modal');
   const tbody = document.getElementById('ngoModalTableBody');
   if (!tbody) return;
   const ngos = dashData?.recent_ngos || [];
   if (!ngos.length) {
     tbody.innerHTML = `<tr><td colspan="5" class="empty-state" style="padding:32px;">No NGOs found.</td></tr>`;
     return;
   }
   tbody.innerHTML = ngos.map(ngo => buildNgoRow(ngo)).join('');
 }
 
 function openVerifModal() {
   openModal('verif-modal');
   const grid = document.getElementById('verifModalGrid');
   if (!grid) return;
   const ngos = dashData?.pending_ngos || [];
   if (!ngos.length) {
     grid.innerHTML = `<div style="grid-column:1/-1;" class="empty-state"><span class="material-symbols-outlined">check_circle</span><p style="font-size:.85rem;font-weight:600;">No pending NGOs.</p></div>`;
     return;
   }
   grid.innerHTML = ngos.map(ngo => buildVerifCard(ngo)).join('');
 }
 
 function openModal(id) {
   const el = document.getElementById(id);
   if (el) { el.classList.add('open'); document.body.style.overflow = 'hidden'; }
 }
 function closeModal(id) {
   const el = document.getElementById(id);
   if (el) { el.classList.remove('open'); document.body.style.overflow = ''; }
 }
 
 // ══════════════════════════════════════════════════════════════════
 // TOAST
 // ══════════════════════════════════════════════════════════════════
 function showToast(msg, type='success') {
   const container = document.getElementById('toast-container');
   if (!container) return;
   const t = document.createElement('div');
   t.className = `toast-item ${type === 'error' ? 'error' : ''}`;
   t.textContent = msg;
   t.onclick = () => t.remove();
   container.appendChild(t);
   setTimeout(() => {
     t.style.transition = 'all .3s'; t.style.opacity = '0'; t.style.transform = 'translateX(60px)';
     setTimeout(() => t.remove(), 300);
   }, 4000);
 }
 
 function showError(msg) { showToast(msg, 'error'); }
 
 // ══════════════════════════════════════════════════════════════════
 // HELPERS
 // ══════════════════════════════════════════════════════════════════
 function formatDate(ts) {
   if (!ts) return '—';
   const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
   if (isNaN(d)) return '—';
   return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
 }
 
 function timeAgo(ts) {
   if (!ts) return 'just now';
   const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
   if (isNaN(d)) return 'just now';
   const s = Math.floor((Date.now() - d) / 1000);
   if (s < 60)    return 'just now';
   if (s < 3600)  return `${Math.floor(s/60)}m ago`;
   if (s < 86400) return `${Math.floor(s/3600)}h ago`;
   return `${Math.floor(s/86400)}d ago`;
 }
 
 function escHtml(str) {
   if (!str) return '';
   return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 }
 
 function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
