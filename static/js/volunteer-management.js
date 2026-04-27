document.addEventListener("DOMContentLoaded", () => {

    const container = document.getElementById("volunteerContainer");
    const detailsPanel = document.getElementById("detailsPanel");
    const closeBtn = document.getElementById("closeDetailsBtn");
    const searchInput = document.getElementById("searchInput");
    const skillFilter = document.getElementById("skillFilter");
    const customSkillInput = document.getElementById("customSkillInput");
    const availabilityFilter = document.getElementById("availabilityFilter");
    const statusFilter = document.getElementById("statusFilter");
    

    let volunteers = [];
    let selectedVolunteer = null;

    // =====================
    // SKELETON
    // =====================
   function showSkeleton() {
    container.innerHTML = "";

    for (let i = 0; i < 6; i++) {

        const sk = document.createElement("div");

        sk.className = "bg-white rounded-2xl p-5 shadow animate-pulse flex flex-col gap-4";

        sk.innerHTML = `
            <!-- TOP -->
            <div class="flex gap-3 items-center">
                <div class="w-14 h-14 bg-gray-300 rounded-full"></div>
                <div class="flex-1 space-y-2">
                    <div class="h-3 bg-gray-300 rounded w-32"></div>
                    <div class="h-2 bg-gray-200 rounded w-24"></div>
                </div>
            </div>

            <!-- LOCATION -->
            <div class="h-2 bg-gray-200 rounded w-24"></div>

            <!-- SKILLS -->
            <div class="flex gap-2">
                <div class="h-5 w-16 bg-gray-200 rounded-full"></div>
                <div class="h-5 w-12 bg-gray-200 rounded-full"></div>
            </div>

            <!-- STATS -->
            <div class="grid grid-cols-2 gap-2">
                <div class="h-10 bg-gray-200 rounded-xl"></div>
                <div class="h-10 bg-gray-200 rounded-xl"></div>
            </div>

            <!-- BUTTONS -->
            <div class="flex gap-2">
                <div class="h-8 bg-gray-300 rounded-full w-full"></div>
                <div class="h-8 bg-gray-300 rounded-full w-full"></div>
            </div>
        `;

        container.appendChild(sk);
    }
}

    // =====================
    // FETCH DATA
    // =====================
    function fetchVolunteers() {

        showSkeleton();

        // setTimeout(() => {

        //     volunteers = [
        //         {
        //             id: 1,
        //             name: "Rohan Gupta",
        //             email: "rohan@mail.com",
        //             city: "Bangalore",
        //             skills: ["Logistics", "First Aid"],
        //             availability: "Weekends",
        //             status: "Pending",
        //             tasks: 10,
        //             phone: "+91 9876543210",
        //             image: "",
        //              joined: "Oct 2023" 
        //         },
        //         {
        //             id: 2,
        //             name: "Anjali Sharma",
        //             email: "anjali@mail.com",
        //             city: "Mumbai",
        //             skills: ["Medical"],
        //             availability: "Weekdays",
        //             status: "Active",
        //             tasks: 25,
        //             phone: "+91 9123456789",
        //             image: "",
        //              joined: "Oct 2025" 
        //         },
        //         {
        //             id: 3,
        //             name: "Rahul Singh",
        //             email: "rahul@mail.com",
        //             city: "Delhi",
        //             skills: ["Education", "Logistics"],
        //             availability: "Any Time",
        //             status: "Active",
        //             tasks: 25,
        //             phone: "+91 9123456789",
        //             image: ""
        //         }
                
        //     ];

        //     renderVolunteers(volunteers);
        //     updatePendingCount(volunteers);   

        // }, 1000);
    }
    async function fetchVolunteers() {
    showSkeleton();

    try {
        const res = await fetch("/api/volunteers");
        const data = await res.json();

        volunteers = data;

        renderVolunteers(volunteers);
        updatePendingCount(volunteers);

    } catch (err) {
        console.error("Error fetching volunteers:", err);
    }
}

    // =====================
    // RENDER CARDS
    // =====================
    function renderVolunteers(data) {
        container.innerHTML = "";

        if (!data || !data.length) {
            container.innerHTML = `
                <div class="col-span-full flex flex-col items-center justify-center py-20 text-gray-400">
                    <span class="material-symbols-outlined text-6xl mb-4">person_search</span>
                    <p class="text-lg font-medium">No volunteers found</p>
                </div>`;
            return;
        }

        data.forEach(vol => {
            const card = document.createElement("div");
            card.className = "bg-white p-5 rounded-2xl shadow-sm border border-gray-100 hover:shadow-xl hover:border-green-100 transition-all duration-300 flex flex-col gap-4 group";

            const skills = Array.isArray(vol.skills) ? vol.skills : [];
            const skillsHtml = skills.slice(0, 3).map(skill => `
                <span class="px-2 py-1 bg-green-50 text-green-700 text-[10px] font-bold rounded-lg border border-green-100">
                    ${skill}
                </span>
            `).join("");

            card.innerHTML = `
                <div class="flex items-start justify-between">
                    <div class="flex gap-4">
                        <div class="relative">
                            <img src="${vol.image || '/static/images/avatar.png'}" 
                                 onerror="this.src='/static/images/avatar.png'"
                                 class="w-14 h-14 rounded-2xl object-cover shadow-sm group-hover:scale-105 transition-transform"/>
                            <div class="absolute -bottom-1 -right-1 w-4 h-4 ${vol.status === 'Active' ? 'bg-green-500' : 'bg-amber-500'} border-2 border-white rounded-full"></div>
                        </div>
                        <div>
                            <h3 class="font-bold text-slate-800 group-hover:text-green-700 transition-colors">${vol.name || 'Anonymous'}</h3>
                            <p class="text-[11px] text-gray-400 font-medium">${vol.email || 'No email'}</p>
                            <div class="flex items-center gap-1 mt-1">
                                <span class="material-symbols-outlined text-[14px] text-yellow-500" style="font-variation-settings:'FILL' 1">star</span>
                                <span class="text-[11px] font-bold text-gray-600">${vol.rating || '0.0'}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="flex flex-col gap-2">
                    <div class="flex items-center gap-2 text-gray-500 text-xs font-medium">
                        <span class="material-symbols-outlined text-sm text-green-600">location_on</span>
                        ${vol.city || 'India'}
                    </div>
                    <div class="flex flex-wrap gap-1.5">
                        ${skillsHtml}
                        ${skills.length > 3 ? `<span class="text-[10px] text-gray-400 font-bold px-1">+${skills.length - 3}</span>` : ''}
                        ${skills.length === 0 ? '<span class="text-[10px] text-gray-300 italic">No skills listed</span>' : ''}
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-2 mt-auto">
                    <button class="viewBtn bg-slate-50 hover:bg-slate-100 text-slate-600 py-2.5 rounded-xl text-xs font-bold transition-all">
                        View
                    </button>
                    <button class="assignBtn bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm shadow-green-100">
                        Assign
                    </button>
                </div>
            `;

            card.querySelector(".viewBtn").addEventListener("click", () => openDetails(vol));
            card.querySelector(".assignBtn").addEventListener("click", (e) => {
                e.stopPropagation();
                selectedVolunteer = vol;
                document.getElementById("assignBtn")?.click(); 
            });

            container.appendChild(card);
        });
    }
// FILTER FUNCTION
function applyFilters() {

    const searchValue = searchInput.value.toLowerCase().trim();

    const selectedSkill = skillFilter.value;
    const customSkill = customSkillInput.value.toLowerCase().trim();

    const selectedAvailability = availabilityFilter.value;
    const selectedStatus = statusFilter.value;

    const filtered = volunteers.filter(vol => {

        // 🔍 SEARCH
        const matchesSearch =
            vol.name.toLowerCase().includes(searchValue) ||
            vol.email.toLowerCase().includes(searchValue) ||
            vol.city.toLowerCase().includes(searchValue) ||
            vol.skills.join(" ").toLowerCase().includes(searchValue);

        // 🧠 SKILL (FIXED LOGIC)
        const matchesSkill =
            selectedSkill === "All Skills" ||
            (selectedSkill === "Other"
                ? customSkill === "" // if empty, don't block results
                    ? true
                    : vol.skills.some(skill =>
                        skill.toLowerCase().includes(customSkill)
                    )
                : vol.skills.some(skill =>
                    skill.toLowerCase() === selectedSkill.toLowerCase()
                ));

        // ⏰ AVAILABILITY
        const matchesAvailability =
            selectedAvailability === "All" ||
            vol.availability === selectedAvailability;

        // 📌 STATUS
        const matchesStatus =
            selectedStatus === "All" ||
            vol.status === selectedStatus;

        // ✅ FINAL COMBINED
        return (
            matchesSearch &&
            matchesSkill &&
            matchesAvailability &&
            matchesStatus
        );
    });
    renderVolunteers(filtered);
    updatePendingCount(volunteers);   // 🔥 ADD THIS
}
skillFilter.addEventListener("change", () => {

    if (skillFilter.value === "Other") {
        customSkillInput.classList.remove("hidden");
    } else {
        customSkillInput.classList.add("hidden");
        customSkillInput.value = "";
    }

    applyFilters();
});
searchInput.addEventListener("input", applyFilters);
customSkillInput.addEventListener("input", applyFilters);
availabilityFilter.addEventListener("change", applyFilters);
statusFilter.addEventListener("change", applyFilters);

const searchInputTop = document.getElementById("volSearchTop");
if (searchInputTop) {
    searchInputTop.addEventListener("input", (e) => {
        if (searchInput) {
            searchInput.value = e.target.value;
            applyFilters();
        }
    });
}
//  PENDING LOGIC
function updatePendingCount(data) {

    const pending = data.filter(v => v.status === "Pending").length;

    document.getElementById("pendingCount").textContent = pending;
}
    // =====================
    // OPEN SIDEBAR
    // =====================
    function openDetails(vol) {
        selectedVolunteer = vol;

        detailsPanel.classList.remove("hidden");
        container.classList.add("pr-[360px]", "lg:grid-cols-2");

        document.getElementById("volName").textContent = vol.name || "Anonymous";
        document.getElementById("volEmail").textContent = vol.email || "No email";
        document.getElementById("volPhone").textContent = vol.phone || "Not provided";
        document.getElementById("volCity").textContent = vol.city || "N/A";
        document.getElementById("volJoined").textContent = vol.joined || "N/A";
        document.getElementById("volImage").src = vol.image || "/static/images/avatar.png";

        const skillsContainer = document.getElementById("volSkills");
        const skills = Array.isArray(vol.skills) ? vol.skills : [];
        if (skills.length === 0) {
            skillsContainer.innerHTML = `<span class="text-xs text-gray-400 italic">No skills added</span>`;
        } else {
            skillsContainer.innerHTML = skills.map(skill => `
                <span class="px-3 py-1.5 bg-green-50 text-green-700 text-xs font-bold rounded-xl border border-green-100 shadow-sm">
                    ${skill}
                </span>
            `).join("");
        }
    }
// 1. APPROVE BUTTON
document.getElementById("approveBtn").addEventListener("click", async () => {

    if (!selectedVolunteer) return;

    try {
        await fetch(`/api/volunteers/${selectedVolunteer.id}/approve`, {
            method: "PATCH"
        });

        showToast("Approved ✅");

        fetchVolunteers(); // reload

    } catch (err) {
        console.error(err);
    }
});
// 2. SUSPEND BUTTON
document.getElementById("suspendBtn").addEventListener("click", async () => {

    if (!selectedVolunteer) return;

    try {
        await fetch(`/api/volunteers/${selectedVolunteer.id}/suspend`, {
            method: "PATCH"
        });

        showToast("Suspended ❌", "warning");

        fetchVolunteers();

    } catch (err) {
        console.error(err);
    }
});
// 3. ASSIGN BUTTON (SIDEBAR)
document.getElementById("assignBtn")?.addEventListener("click", async () => {

    if (!selectedVolunteer) return;

    try {
        await fetch(`/api/volunteers/${selectedVolunteer.id}/assign`, {
            method: "POST"
        });

        showToast("Task Assigned 🚀");

    } catch (err) {
        console.error(err);
    }
});

// 4. CHAT BUTTON
const chatBtn = document.getElementById("chatBtn");
chatBtn?.addEventListener("click", async () => {
    if (!selectedVolunteer) return;

    try {
        const res = await fetch("/api/admin/chat-start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ other_uid: selectedVolunteer.id })
        });
        const data = await res.json();
        if (data.success) {
            window.location.href = `/inbox?conv_id=${data.conversation_id}`;
        } else {
            alert("Failed to start chat: " + (data.error || "Unknown error"));
        }
    } catch (err) {
        console.error("Chat error:", err);
    }
});
    // CLOSE
    closeBtn.addEventListener("click", () => {
    detailsPanel.classList.add("hidden");

    // 🔥 RESTORE 3 COLUMN
    container.classList.remove("pr-[360px]", "lg:grid-cols-2");
});
    // INIT
    fetchVolunteers();

});