/* ================================================================
   topbar.js  — Fixed version
   
   Fixes over original:
   1. SW registration now waits for activation before calling getToken
      (original sent postMessage to registration.active which could be null)
   2. Single dynamic import block — onMessage reuses same messaging instance
   3. Foreground notifications properly displayed via showNotification
   4. Graceful degradation when SW or notification permission unavailable
   ================================================================ */

'use strict';

let foregroundHandlerReady = false;
let lastForegroundNotificationKey = '';
let lastForegroundNotificationAt = 0;

(async function initTopBar() {
    _setupServiceWorkerMessageHandler();

    // ── 0. Fetch topbar data (avatar + notification state) ──────
    let topbarData = {};
    try {
        const res = await fetch('/api/user/topbar');
        if (res.ok) topbarData = await res.json();
    } catch (e) {
        console.warn('[topbar] /api/user/topbar failed:', e);
    }

    // ── 1. Lazy-load avatar ──────────────────────────────────────
    const avatarEl = document.getElementById('topbar-avatar');
    if (avatarEl) {
        if (topbarData.photo_url) {
            avatarEl.src = topbarData.photo_url;
            avatarEl.alt = topbarData.name || 'Profile';
        } else {
            avatarEl.style.display = 'none';
            const fallback = document.getElementById('topbar-avatar-fallback');
            if (fallback) {
                const initials = (topbarData.name || 'U').charAt(0).toUpperCase();
                fallback.textContent = initials;
                fallback.style.display = 'flex';
            }
        }
    }

    // ── 2. Chat inbox icon — always shown ───────────────────────
    const chatIcon = document.getElementById('topbar-chat-btn');
    if (chatIcon) chatIcon.style.display = 'flex';

    // ── 3. Notification bell logic ───────────────────────────────
    const bellBtn = document.getElementById('topbar-bell-btn');
    _setupLogoutHandler();
    if (!bellBtn) return;

    // If already enabled in Firestore, still set up foreground handler
    // but hide the bell (user already opted in)
    if (topbarData.notifications_enabled) {
        bellBtn.style.display = 'none';
        // Still need to set up this browser's token and foreground handler.
        if ('Notification' in window && Notification.permission === 'granted') {
            await _requestAndSaveFcmToken(null, false);
        } else {
            await _setupForegroundHandler();
        }
        return;
    }

    // Browser doesn't support notifications or already denied — hide bell
    if (!('Notification' in window) || Notification.permission === 'denied') {
        bellBtn.style.display = 'none';
        return;
    }

    // Permission already granted at browser level — save token silently
    if (Notification.permission === 'granted') {
        await _requestAndSaveFcmToken(bellBtn, false);
        return;
    }

    // Permission is 'default' — show bell as invite
    bellBtn.style.display = 'flex';
    bellBtn.title = 'Enable push notifications';
    bellBtn.addEventListener('click', async () => {
        await _requestAndSaveFcmToken(bellBtn, true);
    });

    // ── 4. Firestore Real-time Notifications ────────────────────
    _setupFirestoreNotificationListener(topbarData.uid);

})();

function _setupServiceWorkerMessageHandler() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type !== 'SEVASETU_PUSH') return;
        _showForegroundNotification(event.data.payload || {});
    });
}

// ────────────────────────────────────────────────────────────────
// Internal: Intercept logout to remove current FCM token
// ────────────────────────────────────────────────────────────────
function _setupLogoutHandler() {
    const logoutLinks = document.querySelectorAll('a[href="/logout"]');
    logoutLinks.forEach(link => {
        link.addEventListener('click', async (e) => {
            const token = localStorage.getItem('current_fcm_token');
            if (token) {
                e.preventDefault();
                try {
                    await fetch('/api/user/fcm-token', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token })
                    });
                    localStorage.removeItem('current_fcm_token');
                } catch (err) {
                    console.error('[topbar] Logout token removal failed:', err);
                }
                window.location.href = '/logout';
            }
        });
    });
}

// ────────────────────────────────────────────────────────────────
// Internal: Wait for SW to be fully active
// ────────────────────────────────────────────────────────────────
async function _waitForSWActivation(registration) {
    if (registration.active) return registration.active;

    return new Promise((resolve) => {
        const sw = registration.installing || registration.waiting;
        if (!sw) { resolve(null); return; }

        sw.addEventListener('statechange', function handler() {
            if (sw.state === 'activated') {
                sw.removeEventListener('statechange', handler);
                resolve(sw);
            }
        });

        // Timeout after 10s
        setTimeout(() => resolve(null), 10000);
    });
}

// ────────────────────────────────────────────────────────────────
// Internal: Set up foreground message handler (no bell interaction needed)
// ────────────────────────────────────────────────────────────────
async function _setupForegroundHandler() {
    if (foregroundHandlerReady) return;
    if (!('serviceWorker' in navigator)) return;

    try {
        const { firebaseConfig } = await _getFirebaseConfig();
        if (!firebaseConfig) return;

        const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
        const { getMessaging, onMessage } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js');

        let app;
        if (getApps().length === 0) {
            app = initializeApp(firebaseConfig);
        } else {
            app = getApps()[0];
        }

        const messaging = getMessaging(app);

        // Handle messages while app is in foreground
        onMessage(messaging, (payload) => {
            console.log('[topbar] Foreground message:', payload);
            _showForegroundNotification(payload);
        });
        foregroundHandlerReady = true;

    } catch (err) {
        console.error('[topbar] Foreground handler setup failed:', err);
    }
}

// ────────────────────────────────────────────────────────────────
// Internal: Request FCM token, save it, wire foreground handler
// ────────────────────────────────────────────────────────────────
async function _requestAndSaveFcmToken(bellBtn, showSuccessToast = true) {
    try {
        // Step 1 — ask for permission
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            if (bellBtn) bellBtn.style.display = 'none';
            return;
        }

        // Step 2 — get Firebase config
        const { firebaseConfig } = await _getFirebaseConfig();
        if (!firebaseConfig) {
            console.error('[topbar] Could not get Firebase config');
            return;
        }

        // Step 3 — import Firebase modules (single import block)
        const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
        const { getMessaging, getToken, onMessage } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js');

        let app;
        if (getApps().length === 0) {
            app = initializeApp(firebaseConfig);
        } else {
            app = getApps()[0];
        }

        const messaging = getMessaging(app);

        // Step 4 — Register SW and wait for it to be ACTIVE before calling getToken
        let swRegistration = null;
        if ('serviceWorker' in navigator) {
            try {
                swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
                console.log('[topbar] SW registered, waiting for activation...');

                // Critical: getToken fails if SW isn't active yet
                await _waitForSWActivation(swRegistration);
                console.log('[topbar] SW activated');

            } catch (swErr) {
                console.error('[topbar] SW registration failed:', swErr);
                // Continue anyway — getToken may still work with existing SW
            }
        }

        // Step 5 — Get FCM token
        const tokenOptions = { vapidKey: firebaseConfig.vapidKey };
        if (swRegistration) {
            tokenOptions.serviceWorkerRegistration = swRegistration;
        }

        const fcmToken = await getToken(messaging, tokenOptions);

        if (!fcmToken) {
            console.warn('[topbar] getToken returned empty — check VAPID key and SW');
            return;
        }

        console.log('[topbar] FCM token obtained');

        // Step 6 — Set up foreground message handler
        if (!foregroundHandlerReady) {
            onMessage(messaging, (payload) => {
                console.log('[topbar] Foreground message received:', payload);
                _showForegroundNotification(payload);
            });
            foregroundHandlerReady = true;
        }

        // Step 7 — Save token locally and to backend
        localStorage.setItem('current_fcm_token', fcmToken);

        await fetch('/api/user/fcm-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: fcmToken }),
        });

        // Step 8 — hide bell
        if (bellBtn) bellBtn.style.display = 'none';

        if (showSuccessToast) {
            _showTopbarToast('Push notifications enabled!');
        }

    } catch (err) {
        console.error('[topbar] FCM registration failed:', err);
    }
}

// ────────────────────────────────────────────────────────────────
// Internal: Show a notification while the app is in the foreground
// (SW-based background notifications handled in firebase-messaging-sw.js)
// ────────────────────────────────────────────────────────────────
function _showForegroundNotification(payload) {
    const notification = payload.notification || payload.webpush?.notification || {};
    const data  = payload.data || notification.data || payload.webpush?.data || {};
    const title = notification.title || data.title || 'SevaSetu';
    const body  = notification.body || data.body || data.message_preview || '';

    if (data.type === 'new_message' && window.location.pathname.startsWith('/inbox')) {
        return;
    }

    const clickUrl = data.click_action || (data.conversation_id ? `/inbox?conv_id=${data.conversation_id}` : null);
    const notificationKey = `${data.type || ''}:${data.conversation_id || ''}:${title}:${body}`;
    const now = Date.now();
    if (notificationKey === lastForegroundNotificationKey && now - lastForegroundNotificationAt < 3000) {
        return;
    }
    lastForegroundNotificationKey = notificationKey;
    lastForegroundNotificationAt = now;

    // Show as an in-app toast
    _showTopbarToast(`${title}: ${body}`, clickUrl);
}

// ────────────────────────────────────────────────────────────────
// Internal: Real-time Firestore Notification Listener
// ────────────────────────────────────────────────────────────────
async function _setupFirestoreNotificationListener(uid) {
    if (!uid) return;

    try {
        const { firebaseConfig } = await _getFirebaseConfig();
        if (!firebaseConfig) return;

        const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
        const { getFirestore, collection, query, where, onSnapshot, orderBy, limit } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

        let app;
        if (getApps().length === 0) {
            app = initializeApp(firebaseConfig);
        } else {
            app = getApps()[0];
        }

        const db = getFirestore(app);
        const q = query(
            collection(db, "notifications"),
            where("recipient_id", "==", uid),
            where("read", "==", false),
            orderBy("created_at", "desc"),
            limit(5)
        );

        let initialLoad = true;
        onSnapshot(q, (snapshot) => {
            if (initialLoad) {
                initialLoad = false;
                // Update bell icon badge if we have unread count
                _updateNotificationBadge(snapshot.size);
                return;
            }

            snapshot.docChanges().forEach((change) => {
                if (change.type === "added") {
                    const data = change.doc.data();
                    _showFirestoreNotification(data);
                }
            });
            _updateNotificationBadge(snapshot.size);
        });

    } catch (err) {
        console.warn('[topbar] Firestore notification listener failed:', err);
    }
}

function _showFirestoreNotification(data) {
    const title = data.title || "New Notification";
    const body = data.message || "";
    const type = data.type || "info"; // success, warning, error, info
    
    // Sound effect
    try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        audio.volume = 0.4;
        audio.play();
    } catch {}

    window.showToast(body, type, 8000);
}

function _updateNotificationBadge(count) {
    const bellBtn = document.getElementById('topbar-bell-btn');
    if (!bellBtn) return;

    let badge = bellBtn.querySelector('.notification-badge');
    if (count > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'notification-badge';
            badge.style.cssText = `
                position: absolute; top: -2px; right: -2px;
                width: 18px; height: 18px; border-radius: 50%;
                background: #ba1a1a; color: white;
                font-size: 10px; font-weight: 800;
                display: flex; align-items: center; justify-content: center;
                border: 2px solid white;
            `;
            bellBtn.style.position = 'relative';
            bellBtn.appendChild(badge);
        }
        badge.textContent = count > 9 ? '9+' : count;
    } else if (badge) {
        badge.remove();
    }
}

// ────────────────────────────────────────────────────────────────
// Internal: Get Firebase config from backend
// ────────────────────────────────────────────────────────────────
async function _getFirebaseConfig() {
    try {
        const res = await fetch('/api/get_firebase_config');
        const firebaseConfig = await res.json();
        return { firebaseConfig };
    } catch {
        return { firebaseConfig: null };
    }
}

// ────────────────────────────────────────────────────────────────
// Public API: Show a premium toast notification
// ────────────────────────────────────────────────────────────────
window.showToast = function(message, type = 'success', duration = 4000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        // Basic container style if not in CSS
        container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:12px;';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const isError = type === 'error';
    const isWarning = type === 'warning';
    
    let bgColor = '#006c44'; // success
    if (isError) bgColor = '#ba1a1a';
    if (isWarning) bgColor = '#855300';

    toast.className = `toast-item ${type}`;
    toast.style.cssText = `
        background: white;
        border-left: 4px solid ${bgColor};
        border-radius: 12px;
        padding: 16px 20px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.02);
        font-size: 0.875rem;
        font-weight: 600;
        color: #121c2a;
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        min-width: 280px;
        max-width: 400px;
        transform: translateX(100%);
        opacity: 0;
        transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        font-family: 'Plus Jakarta Sans', sans-serif;
    `;

    const icon = isError ? 'error' : isWarning ? 'warning' : 'check_circle';
    toast.innerHTML = `
        <span class="material-symbols-outlined" style="color:${bgColor};font-variation-settings:'FILL' 1">${icon}</span>
        <span style="flex:1">${message}</span>
    `;

    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.style.transform = 'translateX(0)';
        toast.style.opacity = '1';
    });

    const removeToast = () => {
        toast.style.transform = 'translateX(20px)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 400);
    };

    toast.addEventListener('click', removeToast);
    
    if (duration > 0) {
        setTimeout(removeToast, duration);
    }
};

// Internal alias for backward compatibility within topbar.js
function _showTopbarToast(message, clickUrl) {
    window.showToast(message, 'info', 6000);
    // Note: clickUrl handling could be added to showToast if needed
}
