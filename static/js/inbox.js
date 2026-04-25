/**
 * inbox.js  — Fixed version
 *
 * Fixes:
 * 1. Socket.IO forced to polling transport (Vercel serverless = no WebSocket)
 * 2. Right panel properly shown when a conversation is selected
 * 3. ?conv_id= URL param auto-opens conversation on page load
 * 4. Conversation header (name/avatar) always populated
 * 5. Sending messages works via both Socket.IO and REST fallback
 * 6. Mobile: left panel hides / right panel shows when conv open
 */

document.addEventListener("DOMContentLoaded", function () {

    let activeConversationId = null;
    let currentUserUid       = null;
    let currentUserName      = null;
    let socket               = null;
    let allConversations     = [];
    let typingTimeout        = null;

    // ─── Init ────────────────────────────────────────────────
    async function init() {
        const resp = await fetch("/api/check-auth");
        if (!resp.ok) { window.location.href = "/getstarted"; return; }

        const auth = await resp.json();
        if (!auth.authenticated) { window.location.href = "/getstarted"; return; }

        currentUserUid  = auth.user.uid;
        currentUserName = auth.user.name || "Me";

        // Set avatar in header
        const img = document.getElementById("userProfileImage");
        if (img && auth.user.photo_url) {
            img.src = auth.user.photo_url;
        }

        initSocket();
        await loadConversations();

        // Auto-open conversation if ?conv_id= is in URL
        const params = new URLSearchParams(window.location.search);
        const convId = params.get("conv_id");
        if (convId) {
            const conv = allConversations.find(c => c.id === convId);
            if (conv) {
                selectConversation(conv);
            } else {
                // Conv exists in DB but not yet in list (just created) — open it directly
                await openConversationById(convId);
            }
        }
    }

    // ─── Socket.IO ───────────────────────────────────────────
    function initSocket() {
        // IMPORTANT: force polling — Vercel serverless has no WebSocket support
        socket = io({
            transports: ["polling"],
            upgrade: false,
        });

        socket.on("connect", () => {
            console.log("✅ Socket connected (polling):", socket.id);
            // Rejoin active room if reconnecting
            if (activeConversationId) {
                socket.emit("join", { conversation_id: activeConversationId });
            }
        });

        socket.on("connect_error", (err) => {
            console.warn("Socket connect error:", err.message);
        });

        socket.on("receive_message", (msg) => {
            if (msg.conversation_id === activeConversationId || !msg.conversation_id) {
                appendMessageToUI(msg);
            }
            // Refresh conversation list to update last message preview
            loadConversations(false);
        });

        socket.on("display_typing", (data) => {
            const status = document.getElementById("chatUserStatus");
            if (status && data.user_id !== currentUserUid) {
                status.textContent = data.is_typing ? "Typing..." : "Online";
            }
        });
    }

    // ─── Load Conversations ──────────────────────────────────
    async function loadConversations(showSkeleton = true) {
        try {
            const resp = await fetch("/api/chat/conversations");
            if (!resp.ok) return;
            const data = await resp.json();
            allConversations = data.conversations || [];

            // Hide skeleton
            const skel = document.getElementById("convSkeleton");
            if (skel) skel.style.display = "none";

            renderConversations(allConversations);
        } catch (err) {
            console.error("Failed to load conversations:", err);
        }
    }

    function renderConversations(conversations) {
        const list = document.getElementById("messagesList");
        if (!list) return;

        // Remove old conversation items (keep skeleton node if present)
        list.querySelectorAll(".conv-item").forEach(el => el.remove());

        if (!conversations.length) {
            const empty = document.createElement("div");
            empty.className = "conv-item p-4 text-center text-outline text-sm";
            empty.textContent = "No conversations yet.";
            list.appendChild(empty);
            return;
        }

        conversations.forEach(conv => {
            const isActive = activeConversationId === conv.id;
            const item = document.createElement("div");
            item.className = `conv-item p-4 flex items-center gap-4 cursor-pointer hover:bg-white/60 rounded-2xl transition-all mb-1 ${isActive ? "bg-white shadow-sm ring-1 ring-emerald-100" : ""}`;
            item.dataset.convId = conv.id;

            const photo = conv.other_photo
                ? `<img src="${escapeHTML(conv.other_photo)}" class="w-12 h-12 rounded-full object-cover border">`
                : `<div class="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white font-bold text-lg flex-shrink-0">${(conv.other_name || "?")[0].toUpperCase()}</div>`;

            const lastMsg  = conv.last_message || "No messages yet";
            const timeText = formatTime(conv.updated_at);

            item.innerHTML = `
                <div class="relative flex-shrink-0">
                    ${photo}
                    <div class="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full"></div>
                </div>
                <div class="flex-1 overflow-hidden">
                    <div class="flex justify-between items-center">
                        <h4 class="font-bold text-sm truncate">${escapeHTML(conv.other_name || "User")}</h4>
                        <span class="text-[10px] text-outline flex-shrink-0 ml-2">${timeText}</span>
                    </div>
                    <p class="text-xs text-outline truncate mt-0.5">${escapeHTML(lastMsg)}</p>
                </div>`;

            item.addEventListener("click", () => selectConversation(conv));
            list.appendChild(item);
        });
    }

    // ─── Select Conversation ─────────────────────────────────
    async function selectConversation(conv) {
        if (activeConversationId === conv.id) return;

        // Leave old room
        if (activeConversationId && socket) {
            socket.emit("leave", { conversation_id: activeConversationId });
        }

        activeConversationId = conv.id;

        // Join new room
        if (socket) {
            socket.emit("join", { conversation_id: activeConversationId });
        }

        // Update header
        updateChatHeader(conv.other_name, conv.other_photo);

        // Show chat UI
        showChatPanel();

        // Mark active in list
        renderConversations(allConversations);

        // Load history
        await loadMessageHistory();
    }

    async function openConversationById(convId) {
        // Fetch conversation details directly from messages endpoint
        try {
            if (activeConversationId === convId) return;

            if (activeConversationId && socket) {
                socket.emit("leave", { conversation_id: activeConversationId });
            }

            activeConversationId = convId;
            if (socket) socket.emit("join", { conversation_id: convId });

            // Try to get details from allConversations first
            const existing = allConversations.find(c => c.id === convId);
            if (existing) {
                updateChatHeader(existing.other_name, existing.other_photo);
            } else {
                // Just show generic header while loading
                updateChatHeader("Loading...", null);
            }

            showChatPanel();
            await loadMessageHistory();

            // Refresh conversations list to pick up the new one
            await loadConversations(false);
            renderConversations(allConversations);

        } catch (err) {
            console.error("openConversationById error:", err);
        }
    }

    // ─── Show / Hide panels ──────────────────────────────────
    function showChatPanel() {
        document.getElementById("emptyState").style.display = "none";
        document.getElementById("chatUI").style.display     = "flex";
        document.getElementById("chatUI").classList.remove("hidden");
        // Mobile: swap panels
        document.body.classList.add("conv-open");
        const backBtn = document.getElementById("backBtn");
        if (backBtn) backBtn.classList.remove("hidden");
    }

    window.closeChatPanel = function () {
        document.body.classList.remove("conv-open");
        const backBtn = document.getElementById("backBtn");
        if (backBtn) backBtn.classList.add("hidden");
    };

    function updateChatHeader(name, photoUrl) {
        const nameEl     = document.getElementById("chatUserName");
        const imgEl      = document.getElementById("chatUserImage");
        const initEL     = document.getElementById("chatUserInitials");
        const statusEl   = document.getElementById("chatUserStatus");

        if (nameEl) nameEl.textContent = name || "User";
        if (statusEl) statusEl.textContent = "Online";

        if (photoUrl) {
            if (imgEl)  { imgEl.src = photoUrl; imgEl.classList.remove("hidden"); }
            if (initEL) initEL.classList.add("hidden");
        } else {
            const initial = (name || "?")[0].toUpperCase();
            if (initEL)  { initEL.textContent = initial; initEL.classList.remove("hidden"); }
            if (imgEl)   imgEl.classList.add("hidden");
        }
    }

    // ─── Load Message History ─────────────────────────────────
    async function loadMessageHistory() {
        const container = document.getElementById("messagesContainer");
        if (!container || !activeConversationId) return;

        container.innerHTML = `
            <div class="flex justify-center items-center py-8">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>`;

        try {
            const resp = await fetch(`/api/chat/messages/${activeConversationId}`);
            if (!resp.ok) throw new Error("Failed to load messages");
            const data = await resp.json();
            container.innerHTML = "";
            (data.messages || []).forEach(msg => appendMessageToUI(msg, false));
            scrollToBottom(container);
        } catch (err) {
            console.error("loadMessageHistory error:", err);
            container.innerHTML = `<p class="text-center text-outline text-sm py-8">Failed to load messages. Please try again.</p>`;
        }
    }

    // ─── Append Message to UI ────────────────────────────────
    function appendMessageToUI(msg, animate = true) {
        const container = document.getElementById("messagesContainer");
        if (!container) return;

        // Prevent duplicate messages
        if (msg.id && document.getElementById(`msg-${msg.id}`)) return;

        const isMe = msg.sender_id === currentUserUid;
        const wrap = document.createElement("div");
        if (msg.id) wrap.id = `msg-${msg.id}`;
        wrap.className = `flex ${isMe ? "justify-end" : "justify-start"} mb-3`;

        const bubbleClass = isMe
            ? "bg-primary text-white rounded-br-none"
            : "bg-[#eff4ff] text-on-surface rounded-bl-none";

        wrap.innerHTML = `
            <div class="${bubbleClass} px-4 py-2.5 rounded-2xl max-w-[80%] shadow-sm">
                <p class="text-sm whitespace-pre-wrap break-words">${escapeHTML(msg.text)}</p>
                <div class="flex items-center gap-1 justify-end mt-1 opacity-60">
                    <span class="text-[10px]">${formatTime(msg.created_at)}</span>
                    ${isMe ? '<span class="material-symbols-outlined" style="font-size:11px">done_all</span>' : ""}
                </div>
            </div>`;

        container.appendChild(wrap);
        scrollToBottom(container);
    }

    function scrollToBottom(container) {
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
        });
    }

    // ─── Send Message ────────────────────────────────────────
    async function sendMessage() {
        const input = document.getElementById("messageInput");
        if (!input) return;
        const text = input.value.trim();
        if (!text || !activeConversationId) return;

        input.value = "";

        // Send via Socket.IO if connected, otherwise fall back to REST
        if (socket && socket.connected) {
            socket.emit("send_message", {
                conversation_id: activeConversationId,
                sender_id: currentUserUid,
                text,
            });
        } else {
            // REST fallback for when socket isn't available
            try {
                const resp = await fetch("/api/chat/send", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ conversation_id: activeConversationId, text }),
                });
                const data = await resp.json();
                if (!resp.ok) throw new Error(data.error || "REST send failed");

                appendMessageToUI({
                    id: data.message_id,
                    text,
                    sender_id: currentUserUid,
                    conversation_id: activeConversationId,
                    created_at: new Date().toISOString(),
                });
                loadConversations(false);
            } catch (err) {
                console.error("REST send failed:", err);
                input.value = text;
            }
        }

        // Stop typing indicator
        if (socket && socket.connected) {
            socket.emit("typing", {
                conversation_id: activeConversationId,
                is_typing: false,
                user_id: currentUserUid,
            });
        }
    }

    // Wire send button and Enter key
    const sendBtn      = document.getElementById("sendBtn");
    const messageInput = document.getElementById("messageInput");

    if (sendBtn)      sendBtn.addEventListener("click", sendMessage);
    if (messageInput) {
        messageInput.addEventListener("keypress", e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });
        messageInput.addEventListener("input", () => {
            if (!activeConversationId || !socket || !socket.connected) return;
            socket.emit("typing", {
                conversation_id: activeConversationId,
                is_typing: true,
                user_id: currentUserUid,
            });
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                socket.emit("typing", {
                    conversation_id: activeConversationId,
                    is_typing: false,
                    user_id: currentUserUid,
                });
            }, 1500);
        });
    }

    // ─── Search ───────────────────────────────────────────────
    const searchInput = document.getElementById("searchMessages");
    if (searchInput) {
        searchInput.addEventListener("input", e => {
            const q = e.target.value.toLowerCase();
            const filtered = allConversations.filter(c =>
                (c.other_name || "").toLowerCase().includes(q) ||
                (c.last_message || "").toLowerCase().includes(q)
            );
            renderConversations(filtered);
        });
    }

    // ─── Helpers ─────────────────────────────────────────────
    function formatTime(val) {
        if (!val) return "";
        const d = val._seconds ? new Date(val._seconds * 1000) : new Date(val);
        if (isNaN(d)) return "";
        const now = new Date();
        const diffDays = Math.floor((now - d) / 86400000);
        if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        if (diffDays === 1) return "Yesterday";
        if (diffDays < 7)  return d.toLocaleDateString([], { weekday: "short" });
        return d.toLocaleDateString([], { day: "numeric", month: "short" });
    }

    function escapeHTML(str) {
        if (!str) return "";
        return String(str).replace(/[&<>"']/g, m => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[m]));
    }

    // ─── Boot ─────────────────────────────────────────────────
    init();
});
