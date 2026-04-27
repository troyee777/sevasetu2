// =======================
// NGO MANAGEMENT SYSTEM
// =======================

document.addEventListener("DOMContentLoaded", () => {

    // =======================
    // ELEMENTS
    // =======================
    const tableBody    = document.getElementById("ngoTableBody");
    const searchInput  = document.getElementById("ngoSearch");
    const statusFilter = document.getElementById("statusFilter");
    const detailsPanel = document.getElementById("detailsPanel");
    const tableSection = document.getElementById("tableSection");
    const closeBtn     = document.getElementById("closeDetailsBtn");

    let ngosData    = [];
    let selectedNgo = null;
    let currentPage = 1;
    const itemsPerPage = 8;

    // =======================
    // TOAST (local fallback — admin_dashboard.js may not be loaded on this page)
    // =======================
    function showToast(msg, type = "success") {
        let container = document.getElementById("toast-container");
        if (!container) {
            container = document.createElement("div");
            container.id = "toast-container";
            container.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;";
            document.body.appendChild(container);
        }
        const t = document.createElement("div");
        t.style.cssText = `
            background:${type === "error" ? "#ba1a1a" : type === "warning" ? "#855300" : "#006c44"};
            color:#fff;padding:12px 20px;border-radius:12px;font-size:13px;font-weight:600;
            box-shadow:0 4px 20px rgba(0,0,0,.18);cursor:pointer;transition:all .3s;
        `;
        t.textContent = msg;
        t.onclick = () => t.remove();
        container.appendChild(t);
        setTimeout(() => {
            t.style.opacity = "0";
            t.style.transform = "translateX(60px)";
            setTimeout(() => t.remove(), 300);
        }, 4000);
    }

    // =======================
    // STATS BAR
    // =======================
    function updateStats(data) {
        const active  = data.filter(n => n.status === "Verified").length;
        const pending = data.filter(n => n.status === "Pending").length;
        const regions = new Set(data.map(n => n.city).filter(Boolean)).size;

        const el_active  = document.getElementById("activeCount");
        const el_pending = document.getElementById("pendingCount");
        const el_region  = document.getElementById("regionCount");
        if (el_active)  el_active.textContent  = active;
        if (el_pending) el_pending.textContent = pending;
        if (el_region)  el_region.textContent  = regions;
    }

    // =======================
    // SKELETON
    // =======================
    function showSkeleton() {
        tableBody.innerHTML = "";
        for (let i = 0; i < 5; i++) {
            tableBody.innerHTML += `
            <tr>
                <td class="px-6 py-5">
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 rounded-2xl bg-gray-200 animate-pulse"></div>
                        <div class="space-y-2">
                            <div class="h-3 w-36 bg-gray-200 animate-pulse rounded"></div>
                            <div class="h-2 w-24 bg-gray-100 animate-pulse rounded"></div>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-5"><div class="h-3 w-40 bg-gray-200 animate-pulse rounded"></div></td>
                <td class="px-6 py-5"><div class="h-3 w-16 bg-gray-200 animate-pulse rounded"></div></td>
                <td class="px-6 py-5 text-center"><div class="h-6 w-6 bg-gray-200 animate-pulse rounded-full mx-auto"></div></td>
                <td class="px-6 py-5"><div class="h-3 w-24 bg-gray-200 animate-pulse rounded"></div></td>
                <td class="px-6 py-5"><div class="h-3 w-20 bg-gray-200 animate-pulse rounded"></div></td>
                <td class="px-6 py-5"><div class="flex items-center justify-end gap-2">
                    <div class="w-8 h-8 bg-gray-200 animate-pulse rounded-full"></div>
                </div></td>
            </tr>`;
        }
    }

    // =======================
    // FETCH DATA (GET)
    // =======================
    async function fetchNGOs() {
        showSkeleton();
        try {
            const res  = await fetch("/api/ngos");

            if (res.status === 401) {
                window.location.href = "/getstarted";
                return;
            }

            const data = await res.json();

            // ── FIX: API returns org_name / contact_email / logo_url ──
            // Normalise each record so the rest of the code uses consistent keys
            ngosData = data.map(ngo => ({
                ...ngo,
                // prefer normalised keys; fall back to raw API keys
                name  : ngo.org_name      || ngo.name  || "Unnamed NGO",
                email : ngo.contact_email || ngo.email || "—",
                logo  : ngo.logo_url      || ngo.logo  || "",
            }));

            renderNGOs(ngosData);

        } catch (err) {
            console.error("Error fetching NGOs:", err);
            tableBody.innerHTML = `
                <tr><td colspan="7" class="text-center py-10 text-red-500 font-bold">
                    Failed to load NGOs.
                    <button onclick="location.reload()" class="underline ml-2">Retry</button>
                </td></tr>`;
        }
    }

    // =======================
    // RENDER NGO TABLE
    // =======================
    function renderNGOs(data) {
        tableBody.innerHTML = "";

        if (!data || !data.length) {
            tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-10 text-gray-400 font-medium">No NGOs found</td></tr>`;
            updateStats([]);
            renderPagination(0);
            return;
        }

        // Pagination slice
        const start         = (currentPage - 1) * itemsPerPage;
        const end           = start + itemsPerPage;
        const paginatedData = data.slice(start, end);

        paginatedData.forEach(ngo => {
            const row = document.createElement("tr");
            row.className = "hover:bg-surface-container-low/50 cursor-pointer transition-colors";

            const statusColor = ngo.status === "Verified"
                ? "text-emerald-600 bg-emerald-50"
                : "text-amber-600 bg-amber-50";

            row.innerHTML = `
                <td class="px-6 py-5">
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 rounded-2xl bg-gray-100 overflow-hidden flex-shrink-0">
                            <img src="${ngo.logo || '/static/images/ngologo.png'}"
                                 class="w-full h-full object-cover"
                                 onerror="this.src='/static/images/ngologo.png'" />
                        </div>
                        <div>
                            <p class="font-bold text-slate-800">${escHtml(ngo.name)}</p>
                            <p class="text-xs text-gray-500">${escHtml(ngo.city || "N/A")}</p>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-5 text-sm text-slate-600">${escHtml(ngo.email)}</td>
                <td class="px-6 py-5 text-sm font-semibold text-slate-700">${ngo.needs || 0}</td>
                <td class="px-6 py-5 text-center text-sm font-semibold text-slate-700">${ngo.matches || 0}</td>
                <td class="px-6 py-5 text-sm text-slate-500">${ngo.joined || "—"}</td>
                <td class="px-6 py-5">
                    <span class="px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${statusColor}">
                        ${ngo.status}
                    </span>
                </td>
                <td class="px-6 py-5 text-right">
                    <button class="viewBtn px-4 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold transition-all">
                        View
                    </button>
                </td>
            `;

            // Both the row click AND the view button open the details panel
            row.addEventListener("click", () => openDetails(ngo));
            row.querySelector(".viewBtn").addEventListener("click", (e) => {
                e.stopPropagation();
                openDetails(ngo);
            });

            tableBody.appendChild(row);
        });

        updateStats(data);
        renderPagination(data.length);
    }

    // =======================
    // PAGINATION
    // =======================
    function renderPagination(totalItems) {
        const pagination = document.getElementById("pagination");
        const info       = document.getElementById("paginationInfo");
        const prevBtn    = document.getElementById("prevPageBtn");
        const nextBtn    = document.getElementById("nextPageBtn");

        if (!pagination || !info || !prevBtn || !nextBtn) return;

        const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));

        // Remove old page buttons
        pagination.querySelectorAll(".page-btn").forEach(b => b.remove());

        const start = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
        const end   = Math.min(currentPage * itemsPerPage, totalItems);
        info.innerHTML = `Showing <span class="font-bold">${start}–${end}</span> of <span class="font-bold">${totalItems}</span> NGOs`;

        for (let i = 1; i <= totalPages; i++) {
            const btn = document.createElement("button");
            btn.textContent = i;
            btn.className = `page-btn w-8 h-8 rounded-lg text-xs font-bold transition-colors
                ${i === currentPage ? "bg-primary text-white" : "hover:bg-white text-on-surface-variant"}`;
            btn.addEventListener("click", () => {
                currentPage = i;
                renderNGOs(ngosData);
            });
            nextBtn.before(btn);
        }

        prevBtn.disabled = currentPage === 1;
        prevBtn.onclick  = () => { if (currentPage > 1) { currentPage--; renderNGOs(ngosData); } };

        nextBtn.disabled = currentPage === totalPages;
        nextBtn.onclick  = () => { if (currentPage < totalPages) { currentPage++; renderNGOs(ngosData); } };
    }

    // =======================
    // OPEN DETAILS PANEL
    // =======================
    function openDetails(ngo) {
        selectedNgo = ngo;

        // Make panel visible (uses flex layout)
        detailsPanel.classList.remove("hidden");
        detailsPanel.classList.add("flex");

        // Populate fields
        document.getElementById("ngoName").textContent        = ngo.name  || "—";
        document.getElementById("ngoEmail").textContent       = ngo.email || "—";
        document.getElementById("ngoCity").textContent        = ngo.city  || "N/A";
        document.getElementById("ngoNeeds").textContent       = ngo.needs   || 0;
        document.getElementById("ngoMatches").textContent     = ngo.matches  || 0;
        document.getElementById("ngoJoined").textContent      = ngo.joined   || "—";
        document.getElementById("ngoDescription").textContent = ngo.description || "No description available.";

        // Status badge
        const statusEl = document.getElementById("ngoStatus");
        const badgeEl  = document.getElementById("ngoStatusBadge");
        if (statusEl) statusEl.textContent = ngo.status;
        if (badgeEl)  badgeEl.textContent  = ngo.status;

        if (ngo.status === "Verified") {
            if (statusEl) statusEl.className = "text-sm font-bold text-primary";
            if (badgeEl)  badgeEl.className  = "absolute -bottom-1 right-[-10px] px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider shadow-sm bg-primary-fixed text-on-primary-fixed";
        } else if (ngo.status === "Pending") {
            if (statusEl) statusEl.className = "text-sm font-bold text-amber-600";
            if (badgeEl)  badgeEl.className  = "absolute -bottom-1 right-[-10px] px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider shadow-sm bg-amber-100 text-amber-700";
        } else {
            if (statusEl) statusEl.className = "text-sm font-bold text-red-600";
            if (badgeEl)  badgeEl.className  = "absolute -bottom-1 right-[-10px] px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider shadow-sm bg-red-100 text-red-700";
        }

        // Contact info
        const emailEl2  = document.getElementById("ngoEmail2");
        const phoneEl   = document.getElementById("ngoPhone");
        const websiteEl = document.getElementById("ngoWebsite");

        if (emailEl2)  emailEl2.textContent  = ngo.email || "—";
        if (phoneEl)   phoneEl.textContent   = ngo.phone || "Not provided";

        if (websiteEl) {
            if (ngo.website) {
                websiteEl.textContent = ngo.website.replace(/^https?:\/\//, "");
                websiteEl.href        = ngo.website.startsWith("http") ? ngo.website : "https://" + ngo.website;
            } else {
                websiteEl.textContent = "No website";
                websiteEl.href        = "#";
            }
        }

        // Logo
        const logoEl = document.getElementById("ngoLogo");
        if (logoEl) logoEl.src = ngo.logo || "/static/images/ngologo.png";
    }

    // =======================
    // CLOSE PANEL
    // =======================
    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            detailsPanel.classList.add("hidden");
            detailsPanel.classList.remove("flex");
            selectedNgo = null;
        });
    }

    // =======================
    // FILTER & SEARCH
    // =======================
    function applyFilters() {
        const searchValue    = searchInput  ? searchInput.value.toLowerCase().trim() : "";
        const selectedStatus = statusFilter ? statusFilter.value : "All Statuses";

        const filtered = ngosData.filter(ngo => {
            const matchesSearch =
                (ngo.name  || "").toLowerCase().includes(searchValue) ||
                (ngo.email || "").toLowerCase().includes(searchValue) ||
                (ngo.city  || "").toLowerCase().includes(searchValue);

            const matchesStatus =
                selectedStatus === "All Statuses" ||
                ngo.status === selectedStatus;

            return matchesSearch && matchesStatus;
        });

        currentPage = 1;
        renderNGOs(filtered);
    }

    if (searchInput)  searchInput.addEventListener("input",  applyFilters);
    if (statusFilter) statusFilter.addEventListener("change", applyFilters);

    const searchInputTop = document.getElementById("ngoSearchTop");
    if (searchInputTop) {
        searchInputTop.addEventListener("input", (e) => {
            if (searchInput) {
                searchInput.value = e.target.value;
                applyFilters();
            }
        });
    }

    // =======================
    // CHAT WITH NGO
    // =======================
    const chatBtn = document.getElementById("chatBtn");
    chatBtn?.addEventListener("click", async () => {
        if (!selectedNgo) return;
        try {
            const res  = await fetch("/api/admin/chat-start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ other_uid: selectedNgo.id })
            });
            const data = await res.json();
            if (data.success) {
                window.location.href = `/inbox?conv_id=${data.conversation_id}`;
            } else {
                showToast("Failed to start chat: " + (data.error || "Unknown error"), "error");
            }
        } catch (err) {
            console.error("Chat error:", err);
            showToast("Could not start chat.", "error");
        }
    });

    // =======================
    // VERIFY MODAL
    // =======================
    const verifyModal      = document.getElementById("verifyModal");
    const regFrame         = document.getElementById("regDocFrame");
    const taxFrame         = document.getElementById("taxDocFrame");
    const verifyBtn        = document.getElementById("verifyBtn");
    const approveBtn       = document.getElementById("approveBtn");
    const rejectBtn        = document.getElementById("rejectBtn");
    const closeVerifyModal = document.getElementById("closeVerifyModal");

    if (verifyBtn) {
        verifyBtn.addEventListener("click", () => {
            if (!selectedNgo) return;

            if (!selectedNgo.registrationDoc && !selectedNgo.taxDoc) {
                showToast("No documents available", "warning");
                return;
            }

            if (regFrame) {
                regFrame.src = selectedNgo.registrationDoc
                    ? `https://docs.google.com/gview?url=${encodeURIComponent(selectedNgo.registrationDoc)}&embedded=true`
                    : "";
            }
            if (taxFrame) {
                if (selectedNgo.taxDoc) {
                    taxFrame.src = `https://docs.google.com/gview?url=${encodeURIComponent(selectedNgo.taxDoc)}&embedded=true`;
                } else {
                    taxFrame.src = "";
                    if (taxFrame.parentElement) {
                        taxFrame.parentElement.innerHTML =
                            `<div class="text-center text-sm text-gray-400 py-10">No Tax Document uploaded</div>`;
                    }
                }
            }

            // ── FIX: show modal correctly ──
            verifyModal.classList.remove("hidden");
            verifyModal.classList.add("flex");
        });
    }

    approveBtn?.addEventListener("click", async () => {
        if (!selectedNgo) return;
        try {
            await fetch(`/api/ngos/${selectedNgo.id}/verify`, { method: "PATCH" });
            showToast("NGO Approved ✅");
            verifyModal.classList.add("hidden");
            verifyModal.classList.remove("flex");
            fetchNGOs();
        } catch (err) {
            console.error(err);
            showToast("Failed to approve NGO", "error");
        }
    });

    rejectBtn?.addEventListener("click", async () => {
        if (!selectedNgo) return;
        try {
            await fetch(`/api/ngos/${selectedNgo.id}/suspend`, { method: "PATCH" });
            showToast("NGO Suspended ❌", "warning");
            verifyModal.classList.add("hidden");
            verifyModal.classList.remove("flex");
            fetchNGOs();
        } catch (err) {
            console.error(err);
            showToast("Failed to suspend NGO", "error");
        }
    });

    closeVerifyModal?.addEventListener("click", () => {
        verifyModal.classList.add("hidden");
        verifyModal.classList.remove("flex");
    });

    // Close verify modal on backdrop click
    verifyModal?.addEventListener("click", (e) => {
        if (e.target === verifyModal) {
            verifyModal.classList.add("hidden");
            verifyModal.classList.remove("flex");
        }
    });

    // =======================
    // SUSPEND NGO (from panel)
    // =======================
    const suspendBtn = document.getElementById("suspendBtn");
    suspendBtn?.addEventListener("click", async () => {
        if (!selectedNgo) return;
        try {
            await fetch(`/api/ngos/${selectedNgo.id}/suspend`, { method: "PATCH" });
            showToast("NGO Suspended ❌", "warning");
            detailsPanel.classList.add("hidden");
            detailsPanel.classList.remove("flex");
            fetchNGOs();
        } catch (err) {
            console.error(err);
            showToast("Failed to suspend NGO", "error");
        }
    });

    // =======================
    // EDIT NGO (from panel)
    // =======================
    const editBtn = document.getElementById("editBtn");
    editBtn?.addEventListener("click", async () => {
        if (!selectedNgo) return;
        const newName = prompt("Edit NGO Name:", selectedNgo.name);
        if (!newName) return;
        try {
            await fetch(`/api/ngos/${selectedNgo.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ org_name: newName })
            });
            showToast("NGO name updated ✅");
            fetchNGOs();
        } catch (err) {
            console.error(err);
            showToast("Failed to update NGO", "error");
        }
    });

    // =======================
    // REGISTER NGO MODAL
    // =======================
    const ngoModal     = document.getElementById("ngoModal");
    const addNgoBtn    = document.getElementById("addNgoBtn");
    const closeModalBtn = document.getElementById("closeModalBtn");

    addNgoBtn?.addEventListener("click", () => {
        ngoModal.classList.remove("hidden");
        ngoModal.classList.add("flex");
    });

    closeModalBtn?.addEventListener("click", () => {
        ngoModal.classList.add("hidden");
        ngoModal.classList.remove("flex");
    });

    ngoModal?.addEventListener("click", (e) => {
        if (e.target === ngoModal) {
            ngoModal.classList.add("hidden");
            ngoModal.classList.remove("flex");
        }
    });

    // =======================
    // FORM SUBMIT
    // =======================
    const ngoForm = document.getElementById("ngoForm");
    if (ngoForm) {
        ngoForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const submitBtn = ngoForm.querySelector("[type=submit]");
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Submitting…"; }

            const formData = new FormData();
            formData.append("name",        document.getElementById("formName").value);
            formData.append("email",       document.getElementById("formEmail").value);
            formData.append("phone",       document.getElementById("formPhone").value);
            formData.append("city",        document.getElementById("formCity").value);
            formData.append("category",    document.getElementById("formCategory").value);
            formData.append("website",     document.getElementById("formWebsite").value);
            formData.append("description", document.getElementById("formDescription").value);

            const logoFile = document.getElementById("formLogo")?.files[0];
            const regDoc   = document.getElementById("formRegistrationDoc")?.files[0];
            const taxDoc   = document.getElementById("formTaxDoc")?.files[0];
            if (logoFile) formData.append("logo", logoFile);
            if (regDoc)   formData.append("registrationDoc", regDoc);
            if (taxDoc)   formData.append("taxDoc", taxDoc);

            try {
                const res = await fetch("/api/ngos", { method: "POST", body: formData });
                if (res.ok) {
                    showToast("NGO Registered ✅ (Pending Approval)");
                    ngoModal.classList.add("hidden");
                    ngoModal.classList.remove("flex");
                    ngoForm.reset();
                    fetchNGOs();
                } else {
                    const errData = await res.json();
                    showToast(errData.error || "Failed to register NGO", "error");
                }
            } catch (err) {
                console.error("Error:", err);
                showToast("An error occurred. Please try again.", "error");
            } finally {
                if (submitBtn) {
                    submitBtn.disabled    = false;
                    submitBtn.textContent = "Submit Application";
                }
            }
        });
    }

    // =======================
    // EXPORT DATA
    // =======================
    const exportBtn = document.getElementById("exportBtn");
    exportBtn?.addEventListener("click", () => {
        if (!ngosData.length) { showToast("No data to export", "warning"); return; }

        let csv = "Name,Email,City,Status,Needs,Matches,Joined\n";
        ngosData.forEach(ngo => {
            csv += `"${ngo.name}","${ngo.email}","${ngo.city || ""}",${ngo.status},${ngo.needs || 0},${ngo.matches || 0},"${ngo.joined || ""}"\n`;
        });

        const blob = new Blob([csv], { type: "text/csv" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = "ngos_data.csv";
        a.click();
        URL.revokeObjectURL(url);
    });

    // =======================
    // UTILS
    // =======================
    function escHtml(str) {
        if (!str) return "";
        return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    // =======================
    // INIT
    // =======================
    fetchNGOs();
});