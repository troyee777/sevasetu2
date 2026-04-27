/* firebase-messaging-sw.js
 *
 * Background push notification handler for SevaSetu.
 *
 * Why we fetch config here instead of using postMessage:
 * - The old approach sent a SET_CONFIG message to registration.active, but if the
 *   SW was still installing/waiting that reference would be null and the message
 *   would be silently lost, leaving Firebase uninitialised and killing all background
 *   push notifications.
 * - Fetching from /api/get_firebase_config is simpler and always works because the
 *   SW has network access even when the page is closed.
 */

function getPayloadJson(event) {
    if (!event.data) return {};

    try {
        return event.data.json();
    } catch (err) {
        try {
            return JSON.parse(event.data.text());
        } catch {
            return {};
        }
    }
}

function getPushData(payload) {
    return payload.data || payload.notification?.data || payload.webpush?.data || {};
}

function getNotificationOptions(payload) {
    const data = getPushData(payload);
    const notification = payload.notification || payload.webpush?.notification || {};
    const title = notification.title || data.title || "SevaSetu";
    const body = notification.body || data.body || data.message_preview || "You have a new notification";

    return {
        title,
        options: {
            body,
            icon: notification.icon || "/static/images/only_logo.png",
            badge: notification.badge || "/static/images/only_logo.png",
            tag: notification.tag || data.type || "sevasetu-notification",
            data,
            requireInteraction: false,
        },
    };
}

self.addEventListener("push", (event) => {
    event.stopImmediatePropagation();

    const payload = getPayloadJson(event);
    const { title, options } = getNotificationOptions(payload);

    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
            const appClients = windowClients.filter(client => client.url.startsWith(self.location.origin));

            if (appClients.length > 0) {
                appClients.forEach(client => {
                    client.postMessage({
                        type: "SEVASETU_PUSH",
                        payload,
                    });
                });
                return;
            }

            return self.registration.showNotification(title, options);
        })
    );
});

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

let messagingInitialized = false;

async function initFirebase() {
    if (messagingInitialized) return;

    try {
        // Fetch config from the Flask API — same endpoint the page uses
        const resp = await fetch("/api/get_firebase_config");
        if (!resp.ok) throw new Error("Config fetch failed: " + resp.status);

        const config = await resp.json();

        // Validate we have the minimum required fields
        if (!config.apiKey || !config.projectId) {
            throw new Error("Incomplete Firebase config received");
        }

        if (!firebase.apps.length) {
            firebase.initializeApp(config);
        }

        const messaging = firebase.messaging();

        messaging.onBackgroundMessage((payload) => {
            console.log("[SW] Background message received:", payload);

            const title   = payload.notification?.title   || "SevaSetu";
            const body    = payload.notification?.body    || "You have a new notification";
            const iconUrl = payload.notification?.icon    || "/static/images/only_logo.png";
            const data    = payload.data || {};

            self.registration.showNotification(title, {
                body,
                icon:  iconUrl,
                badge: "/static/images/only_logo.png",
                data,
                // Keep notification in tray until dismissed
                requireInteraction: false,
            });
        });

        messagingInitialized = true;
        console.log("[SW] Firebase Messaging initialized successfully");

    } catch (err) {
        console.error("[SW] Firebase init failed:", err);
    }
}

self.addEventListener("install", (event) => {
    console.log("[SW] Installing");
    // Skip waiting so the new SW activates immediately
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    console.log("[SW] Activating");
    event.waitUntil(
        clients.claim().then(() => initFirebase())
    );
});

// Also init on fetch so the SW wakes up if it was sleeping
self.addEventListener("fetch", (event) => {
    // Only handle our own origin, ignore cross-origin requests
    if (!event.request.url.startsWith(self.location.origin)) return;
    // Don't intercept — just use this event as a wake-up trigger for lazy init
    if (!messagingInitialized) {
        event.waitUntil(initFirebase());
    }
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const data = event.notification.data || {};

    let urlToOpen = "/";
    if (data.click_action) {
        urlToOpen = data.click_action;
    } else if (data.conversation_id) {
        urlToOpen = `/inbox?conv_id=${data.conversation_id}`;
    } else if (data.need_id) {
        urlToOpen = `/need/${data.need_id}/volunteer`;
    }

    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
            // Focus existing tab if open
            for (const client of windowClients) {
                if (client.url.includes(urlToOpen) && "focus" in client) {
                    return client.focus();
                }
            }
            // Otherwise open new tab
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
