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

        if (!data.length) {
            container.innerHTML = `<p>No volunteers found</p>`;
            return;
        }

        data.forEach(vol => {

            const card = document.createElement("div");

            card.className = "bg-white p-6 rounded-xl shadow hover:shadow-lg";

card.innerHTML = `
<div class="bg-white rounded-2xl p-5 shadow-md hover:shadow-xl transition-all flex flex-col gap-4">

    <!-- TOP -->
    <div class="flex items-start justify-between">
        <div class="flex gap-3">
            <div class="relative">
                <img src="${vol.image || '/static/images/avatar.png'}"
                     onerror="this.src='/static/images/avatar.png'"
                     class="w-14 h-14 rounded-full object-cover"/>

                <div class="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
            </div>

            <div>
                <h3 class="font-bold text-sm">${vol.name}</h3>
                <p class="text-xs text-gray-500">${vol.email}</p>
                <p class="text-xs text-gray-500">${vol.joined}</p>
                <!-- ⭐ RATING -->
                <div class="flex items-center gap-1 text-yellow-500 text-xs mt-1">
                    <span class="material-symbols-outlined text-sm" style="font-variation-settings:'FILL' 1;">star</span>
                    <span>${vol.rating || 0.0}</span>
                </div>
            </div>
        </div>
    </div>

    <!-- LOCATION -->
    <div class="flex items-center gap-2 text-gray-500 text-xs">
        <span class="material-symbols-outlined text-sm">location_on</span>
        ${vol.city}
    </div>

    <!-- SKILLS -->
    <div class="flex flex-wrap gap-2">
        ${vol.skills.map(skill => `
            <span class="px-3 py-1 bg-green-100 text-green-700 text-[10px] font-bold rounded-full">
                ${skill}
            </span>
        `).join("")}
    </div>

    <!-- STATS -->
    <div class="grid grid-cols-2 gap-2 bg-gray-100 p-3 rounded-xl text-xs">
        <div>
            <p class="text-gray-400 text-[10px]">Availability</p>
            <p class="font-bold">${vol.availability}</p>
        </div>
        <div>
            <p class="text-gray-400 text-[10px]">Tasks</p>
            <p class="font-bold">${vol.tasks}</p>
        </div>
    </div>

    <!-- STATUS -->
    <div class="text-xs font-semibold ${vol.status === "Active" ? "text-green-600" : "text-orange-500"}">
        ${vol.status}
    </div>

    <!-- BUTTONS -->
    <div class="flex gap-2 pt-2 border-t">
        <button class="viewBtn flex-1 bg-gray-200 py-2 rounded-full text-xs font-bold">
            View
        </button>
        <button class="assignBtn flex-1 bg-green-600 text-white py-2 rounded-full text-xs font-bold">
          Assign
        </button>
    </div>

</div>
`;
// ADD EVENT LISTENER:
card.querySelector(".assignBtn").addEventListener("click", async () => {
    try {
        await fetch(`/api/volunteers/${vol.id}/assign`, {
            method: "POST"
        });

        alert("Task Assigned ✅");

    } catch (err) {
        console.error(err);
    }
});

  // 👉 OPEN SIDEBAR
            card.querySelector(".viewBtn").addEventListener("click", () => {
                openDetails(vol);
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

    document.getElementById("volName").textContent = vol.name;
    document.getElementById("volEmail").textContent = vol.email;
    document.getElementById("volPhone").textContent = vol.phone;
    document.getElementById("volCity").textContent = vol.city;
    document.getElementById("volJoined").textContent =
    vol.joined || "N/A";
    document.getElementById("volImage").src =
        vol.image && vol.image !== "" ? vol.image : "/static/images/avatar.png";

    // ✅ SKILLS FROM JS ONLY
    const skillsContainer = document.getElementById("volSkills");

if (!vol.skills || vol.skills.length === 0) {
    skillsContainer.innerHTML = `
        <span class="text-xs text-gray-400">No skills added</span>
    `;
} else {
    skillsContainer.innerHTML = vol.skills.map(skill => `
        <span class="px-3 py-1.5 bg-green-100 text-green-700 text-xs font-semibold rounded-full shadow-sm">
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

        alert("Approved ✅");

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

        alert("Suspended ❌");

        fetchVolunteers();

    } catch (err) {
        console.error(err);
    }
});
// 3. ASSIGN BUTTON (SIDEBAR)
document.getElementById("assignSidebarBtn").addEventListener("click", async () => {

    if (!selectedVolunteer) return;

    try {
        await fetch(`/api/volunteers/${selectedVolunteer.id}/assign`, {
            method: "POST"
        });

        alert("Task Assigned 🚀");

    } catch (err) {
        console.error(err);
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