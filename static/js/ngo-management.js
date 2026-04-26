// =======================
// NGO MANAGEMENT SYSTEM
// =======================

document.addEventListener("DOMContentLoaded", () => {

    // =======================
    // ELEMENTS
    // =======================
    const tableBody = document.getElementById("ngoTableBody");
     const searchInput = document.getElementById("ngoSearch");
     const statusFilter = document.getElementById("statusFilter");
    const detailsPanel = document.getElementById("detailsPanel");
    const tableSection = document.getElementById("tableSection");
    const closeBtn = document.getElementById("closeDetailsBtn");

    let ngosData = []; // store fetched data
    let selectedNgo = null;
    let currentPage = 1;
    let itemsPerPage = 5; // can change
     
       
 
function updateStats(data) {

    const active = data.filter(n => n.status === "Verified").length;
    const pending = data.filter(n => n.status === "Pending").length;

    const regions = new Set(data.map(n => n.city)).size;

    document.getElementById("activeCount").textContent = active;
    document.getElementById("pendingCount").textContent = pending;
    document.getElementById("regionCount").textContent = regions;
}
    // =======================
    // FETCH DATA (GET)
    // =======================
    async function fetchNGOs() {
        try {
            const res = await fetch("/api/ngos"); // 🔥 backend route
            const data = await res.json();

            ngosData = data;

            renderNGOs(ngosData);

        } catch (err) {
            console.error("Error fetching NGOs:", err);
        }
    }

    // =======================
    // REMOVE SKELETON
    // =======================
    function clearSkeleton() {
        tableBody.innerHTML = "";
    }

    // =======================
    // RENDER NGO TABLE
    // =======================
    function renderNGOs(data) {
    clearSkeleton();

    // 👉 EMPTY STATE
    if (!data.length) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-6">No NGOs found</td>
            </tr>
        `;
        updateStats([]);
        return;
    }

    // 🔥 PAGINATION LOGIC
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const paginatedData = data.slice(start, end);

    tableBody.innerHTML = ""; // clear before render

    paginatedData.forEach(ngo => {

        const row = document.createElement("tr");
        row.className = "hover:bg-surface-container-low/50 cursor-pointer";

        row.innerHTML = `
            <td class="px-6 py-5">
                <div class="flex items-center gap-4">
                    <div class="w-12 h-12 rounded-2xl bg-gray-200 overflow-hidden">
                       <img src="${ngo.logo && ngo.logo !== '' ? ngo.logo : 'ngologo.png'}"
     class="w-full h-full object-cover"
     onerror="this.src='/static/images/ngologo.png'" />
                    </div>
                    <div>
                        <p class="font-bold">${ngo.name}</p>
                        <p class="text-xs text-gray-500">${ngo.city || "N/A"}</p>
                    </div>
                </div>
            </td>

            <td class="px-6 py-5 text-sm">${ngo.email}</td>
            <td class="px-6 py-5 text-sm">${ngo.needs || 0}</td>
            <td class="px-6 py-5 text-center">${ngo.matches || 0}</td>
            <td class="px-6 py-5 text-sm">${ngo.joined || "-"}</td>
            <td class="px-6 py-5 text-sm font-semibold">${ngo.status}</td>

            <td class="px-6 py-5 text-right">
                <button class="viewBtn px-2 text-blue-500">View</button>
            </td>
        `;

        row.addEventListener("click", () => openDetails(ngo));

        tableBody.appendChild(row);
    });

    updateStats(data);

    // 🔥 UPDATE PAGINATION UI
    updatePagination(data.length);
}
function updatePagination(totalItems) {
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    const pagination = document.getElementById("pagination");
    const info = document.getElementById("paginationInfo");
    const prevBtn = document.getElementById("prevPageBtn");
    const nextBtn = document.getElementById("nextPageBtn");

    if (!pagination || !info) return;

    // 🔥 CLEAR OLD PAGE BUTTONS (KEEP PREV/NEXT)
    pagination.querySelectorAll(".page-btn").forEach(btn => btn.remove());

    // 🔥 INFO TEXT
    const start = (currentPage - 1) * itemsPerPage + 1;
    const end = Math.min(currentPage * itemsPerPage, totalItems);

    info.innerHTML = `Showing <span class="font-bold">${start}-${end}</span> of <span class="font-bold">${totalItems}</span> NGOs`;

    // 🔥 ADD PAGE BUTTONS
    for (let i = 1; i <= totalPages; i++) {
        const btn = document.createElement("button");

        btn.textContent = i;
        btn.className = `
            page-btn w-8 h-8 rounded-lg text-xs font-bold transition-colors
            ${i === currentPage ? "bg-primary text-white" : "hover:bg-white text-on-surface-variant"}
        `;

        btn.addEventListener("click", () => {
            currentPage = i;
            renderNGOs(ngosData);
        });

        nextBtn.before(btn);
    }

    // 🔥 PREV BUTTON
    prevBtn.disabled = currentPage === 1;
    prevBtn.onclick = () => {
        if (currentPage > 1) {
            currentPage--;
            renderNGOs(ngosData);
        }
    };

    // 🔥 NEXT BUTTON
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.onclick = () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderNGOs(ngosData);
        }
    };
}
    
    // =======================
    // CLOSE PANEL
    // =======================
    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            detailsPanel.classList.add("hidden");
            detailsPanel.classList.remove("flex");
        });
    }


// FILTER SYSTEM and SEARCH SYSTEM combined
function applyFilters() {

    const searchValue = searchInput ? searchInput.value.toLowerCase() : "";
    const selectedStatus = statusFilter ? statusFilter.value : "All Statuses";

    const filtered = ngosData.filter(ngo => {

        const matchesSearch =
            ngo.name.toLowerCase().includes(searchValue) ||
            ngo.email.toLowerCase().includes(searchValue) ||
            (ngo.city || "").toLowerCase().includes(searchValue);

        const matchesStatus =
            selectedStatus === "All Statuses" ||
            ngo.status === selectedStatus;

        return matchesSearch && matchesStatus;
    });

    renderNGOs(filtered);
}
if (searchInput) {
    searchInput.addEventListener("input", applyFilters);
}

if (statusFilter) {
    statusFilter.addEventListener("change", applyFilters);
}
    // =======================
    // POST (ADD NGO)
    // =======================
    async function addNGO(newNgo) {
        try {
            await fetch("/api/ngos", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(newNgo)
            });

            fetchNGOs(); // refresh

        } catch (err) {
            console.error("Error adding NGO:", err);
        }
    }
    //   ngo sidebar 
    function openDetails(ngo) {

        selectedNgo = ngo; // 🔥 THIS LINE IS MISSING

    const panel = document.getElementById("detailsPanel");

    panel.classList.remove("hidden");
    panel.classList.add("flex");

    document.getElementById("ngoName").textContent = ngo.name;
    document.getElementById("ngoEmail").textContent = ngo.email;
    document.getElementById("ngoEmail2").textContent = "📧 " + ngo.email;
    document.getElementById("ngoCity").textContent = ngo.city;

    document.getElementById("ngoNeeds").textContent = ngo.needs;
    document.getElementById("ngoMatches").textContent = ngo.matches;
    document.getElementById("ngoJoined").textContent = ngo.joined;
    document.getElementById("ngoStatus").textContent = ngo.status;

    document.getElementById("ngoDescription").textContent =
        ngo.description || "No description available";

    document.getElementById("ngoPhone").textContent =
        "📞 " + (ngo.phone || "N/A");

    document.getElementById("ngoWebsite").textContent =
        "🌐 " + (ngo.website || "N/A");

   document.getElementById("ngoLogo").src =
    (ngo.logo && ngo.logo !== "")
        ? ngo.logo
        : "/static/images/ngologo.png";
   }

//    
   // =======================
// BUTTON LOGIC
// =======================

// VERIFY NGO
const verifyModal = document.getElementById("verifyModal");
const regFrame = document.getElementById("regDocFrame");
const taxFrame = document.getElementById("taxDocFrame");
const verifyBtn = document.getElementById("verifyBtn");
if (verifyBtn) {
    verifyBtn.addEventListener("click", () => {

        if (!selectedNgo) return;

        if (!selectedNgo.registrationDoc && !selectedNgo.taxDoc) {
            alert("No documents available");
            return;
        }

        // Load documents into modal
      if (selectedNgo.registrationDoc) {
    regFrame.src = `https://docs.google.com/gview?url=${encodeURIComponent(selectedNgo.registrationDoc)}&embedded=true`;
} else {
    regFrame.src = "";
}

if (selectedNgo.taxDoc) {
    taxFrame.src = `https://docs.google.com/gview?url=${encodeURIComponent(selectedNgo.taxDoc)}&embedded=true`;
} else {
    taxFrame.src = "";
    taxFrame.parentElement.innerHTML =
        `<div class="text-center text-sm text-gray-400">No Tax Document</div>`;
}
        // Show modal
        verifyModal.classList.remove("hidden");
        verifyModal.classList.add("flex");
    });
}
const approveBtn = document.getElementById("approveBtn");
const rejectBtn = document.getElementById("rejectBtn");
const closeVerifyModal = document.getElementById("closeVerifyModal");

// APPROVE
approveBtn?.addEventListener("click", async () => {
    if (!selectedNgo) return;

    try {
        await fetch(`/api/ngos/${selectedNgo.id}/verify`, {
            method: "PATCH"
        });

        alert("NGO Approved ✅");

        verifyModal.classList.add("hidden");

        fetchNGOs(); // 🔥 reload from backend

    } catch (err) {
        console.error(err);
    }
});

// REJECT
rejectBtn?.addEventListener("click", async () => {
    if (!selectedNgo) return;

    try {
        await fetch(`/api/ngos/${selectedNgo.id}/suspend`, {
            method: "PATCH"
        });

        alert("NGO Suspended ❌");

        verifyModal.classList.add("hidden");

        fetchNGOs();

    } catch (err) {
        console.error(err);
    }
});

// CLOSE
closeVerifyModal?.addEventListener("click", () => {
    verifyModal.classList.add("hidden");
});
// SUSPEND NGO
const suspendBtn = document.getElementById("suspendBtn");
suspendBtn?.addEventListener("click", async () => {
    if (!selectedNgo) return;

    try {
        await fetch(`/api/ngos/${selectedNgo.id}/suspend`, {
            method: "PATCH"
        });

        alert("NGO Suspended ❌");

        fetchNGOs();

    } catch (err) {
        console.error(err);
    }
});
// EDIT NGO
const editBtn = document.getElementById("editBtn");
editBtn?.addEventListener("click", async () => {
    if (!selectedNgo) return;

    const newName = prompt("Edit NGO Name:", selectedNgo.name);
    if (!newName) return;

    try {
        await fetch(`/api/ngos/${selectedNgo.id}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ name: newName })
        });

        fetchNGOs();

    } catch (err) {
        console.error(err);
    }
});
// =======================
// MODAL OPEN / CLOSE
// =======================

const modal = document.getElementById("ngoModal");
const openBtn = document.getElementById("addNgoBtn");
const closeModalBtn = document.getElementById("closeModalBtn");

if (openBtn && modal) {
    openBtn.addEventListener("click", () => {
        modal.classList.remove("hidden");
        modal.classList.add("flex");
    });
}

if (closeModalBtn && modal) {
    closeModalBtn.addEventListener("click", () => {
        modal.classList.add("hidden");
    });
}

// Close when clicking outside modal
if (modal) {
    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.classList.add("hidden");
        }
    });
}
// =======================
// FORM SUBMIT
// =======================

const ngoForm = document.getElementById("ngoForm");

if (ngoForm) {
    ngoForm.addEventListener("submit", function (e) {
        e.preventDefault();

        // GET VALUES
        const name = document.getElementById("formName").value;
        const email = document.getElementById("formEmail").value;
        const phone = document.getElementById("formPhone").value;
        const city = document.getElementById("formCity").value;
        const category = document.getElementById("formCategory").value;
        const website = document.getElementById("formWebsite").value;
        const description = document.getElementById("formDescription").value;
        const logoFile = document.getElementById("formLogo").files[0];
        const regDoc = document.getElementById("formRegistrationDoc").files[0];
        const taxDoc = document.getElementById("formTaxDoc").files[0];
        // =======================
        // FORM SUBMIT
        // =======================
        const formData = new FormData();

        formData.append("name", name);
        formData.append("email", email);
        formData.append("phone", phone);
        formData.append("city", city);
        formData.append("category", category);
        formData.append("website", website);
        formData.append("description", description);

        if (logoFile) formData.append("logo", logoFile);
        if (regDoc) formData.append("registrationDoc", regDoc);
        if (taxDoc) formData.append("taxDoc", taxDoc);
         try {
            await fetch("/api/ngos", {
                method: "POST",
                body: formData
            });
             fetchNGOs(); // reload
        // CLOSE MODAL
        modal.classList.add("hidden");

        // RESET FORM
        ngoForm.reset();

        // SUCCESS MESSAGE
        alert("NGO Registered Successfully (Pending Approval)");
   
        } catch (err) {
            console.error("Error:", err);
        }
    });
}
     // =======================
    // BUTTON ACTIONS
    // =======================
    document.addEventListener("click", function (e) {

        // VIEW BUTTON
        if (e.target.classList.contains("viewBtn")) {
            e.stopPropagation();
            alert("Viewing NGO details");
        }

    });
    // =======================
// EXPORT DATA
// =======================

const exportBtn = document.getElementById("exportBtn");

if (exportBtn) {
    exportBtn.addEventListener("click", () => {

        if (!ngosData.length) {
            alert("No data to export");
            return;
        }

        let csv = "Name,Email,City,Status,Needs,Matches,Joined\n";

        ngosData.forEach(ngo => {
            csv += `${ngo.name},${ngo.email},${ngo.city},${ngo.status},${ngo.needs},${ngo.matches},${ngo.joined}\n`;
        });

        const blob = new Blob([csv], { type: "text/csv" });
        const url = window.URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = "ngos_data.csv";
        a.click();

        window.URL.revokeObjectURL(url);
    });
}

    // =======================
    // INITIAL LOAD
    // =======================
    fetchNGOs();
    
}); 