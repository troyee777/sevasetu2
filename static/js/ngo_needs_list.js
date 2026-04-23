// ================= DATA MANAGEMENT =================
let needsData = [
    { id: 1, title: "Emergency Food Distribution", description: "Need volunteers for food packing", category: "Food", urgency: 9, location: "Sector 4", people: 5, status: "Open", skills: ["Logistics"] },
    { id: 2, title: "Digital Literacy Workshop", description: "Teach seniors basic smartphone skills", category: "Education", urgency: 5, location: "Lakeside Center", people: 3, status: "Assigned", skills: ["Teaching"] }
];

const saved = JSON.parse(localStorage.getItem("needs"));
if (saved) needsData = [...needsData, ...saved];

// ================= STATE VARIABLES =================
let currentCategory = "All";
let currentStatus = "All";
let searchQuery = "";
let currentUrgency = "All";
let currentPeopleCount = 1;
let currentSkills = []; // NEW: Track skills for manual form

// ================= ELEMENTS =================
const needsContainer = document.getElementById("needsContainer");
const choiceModal = document.getElementById("choiceModal");
const needModal = document.getElementById("needModal");
const form = document.getElementById("needForm");
const uploadSection = document.getElementById("uploadSection");
const peopleCountDisplay = document.getElementById("peopleCount");
const skillInput = document.getElementById("skillInput"); // NEW
const skillBox = document.getElementById("skillBox");     // NEW

// Filter Elements
const categoryFilter = document.getElementById("categoryFilter");
const searchInput = document.getElementById("searchInput");
const urgencyFilter = document.getElementById("urgencyFilter");
const statusButtons = document.querySelectorAll(".statusBtn");

// ================= 1. DELETE LOGIC =================
function deleteNeed(id) {
    const confirmed = confirm("Are you sure you want to delete this?");
    if (confirmed) {
        // Remove from memory
        needsData = needsData.filter(need => need.id !== id);
        
        // Remove from local storage
        const localSaves = JSON.parse(localStorage.getItem("needs") || "[]");
        const updatedLocal = localSaves.filter(need => need.id !== id);
        localStorage.setItem("needs", JSON.stringify(updatedLocal));
        
        applyFilters(); // Refresh UI
    }
}

// ================= 2. RENDER & FILTER LOGIC =================
function renderNeeds(data) {
    if (!needsContainer) return;
    needsContainer.innerHTML = "";
    const displayData = [...data].reverse();

    displayData.forEach(need => {
        const card = document.createElement("div");
        card.className = "bg-white p-5 rounded-xl shadow-sm border border-gray-100 mb-4 hover:shadow-md transition-shadow relative group";
        card.innerHTML = `
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div class="flex-1">
                    <div class="flex items-center gap-3">
                        <h3 class="text-lg font-bold text-slate-800">${need.title || "Untitled"}</h3>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${need.urgency >= 7 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}">
                            Urgency: ${need.urgency || 0}
                        </span>
                    </div>
                    <p class="text-sm text-slate-600 mt-1">${need.description || ""}</p>
                    <div class="flex flex-wrap gap-4 mt-3 text-[11px] font-medium text-slate-500">
                        <span class="flex items-center gap-1">📍 ${need.location || ""}</span>
                        <span class="flex items-center gap-1">📂 ${need.category || ""}</span>
                        <span class="flex items-center gap-1">👥 ${need.people || 0} Volunteers</span>
                    </div>
                </div>
                <div class="flex flex-row md:flex-col items-center gap-2">
                    <span class="text-xs font-bold px-3 py-1 bg-slate-100 rounded-full">${need.status || "Open"}</span>
                    <button class="bg-emerald-600 text-white px-5 py-2 rounded-lg text-sm font-bold">Details</button>
                    <button onclick="deleteNeed(${need.id})" class="text-red-500 hover:text-red-700 p-1">
                        <span class="material-symbols-outlined text-xl">delete</span>
                    </button>
                </div>
            </div>`;
        needsContainer.appendChild(card);
    });
}

function applyFilters() {
    const filtered = needsData.filter(need => {
        const matchCategory = currentCategory === "All" || need.category === currentCategory;
        const matchStatus = currentStatus === "All" || need.status === currentStatus;
        const matchSearch = (need.title || "").toLowerCase().includes(searchQuery) || (need.description || "").toLowerCase().includes(searchQuery);
        let matchUrgency = true;
        if (currentUrgency === "Low") matchUrgency = need.urgency <= 3;
        else if (currentUrgency === "Moderate") matchUrgency = need.urgency >= 4 && need.urgency <= 6;
        else if (currentUrgency === "High") matchUrgency = need.urgency >= 7;
        return matchCategory && matchStatus && matchSearch && matchUrgency;
    });
    renderNeeds(filtered);
}

// Filter Listeners
if (categoryFilter) categoryFilter.onchange = (e) => { currentCategory = e.target.value; applyFilters(); };
if (searchInput) searchInput.oninput = (e) => { searchQuery = e.target.value.toLowerCase(); applyFilters(); };
if (urgencyFilter) urgencyFilter.onchange = (e) => { currentUrgency = e.target.value; applyFilters(); };
statusButtons.forEach(btn => {
    btn.onclick = () => {
        currentStatus = btn.dataset.status;
        statusButtons.forEach(b => b.classList.remove("bg-surface-container-lowest", "text-primary"));
        btn.classList.add("bg-surface-container-lowest", "text-primary");
        applyFilters();
    };
});

// ================= 3. MODAL & NAVIGATION =================
const postBtn = document.getElementById("openModalBtn");
const closeModalBtn = document.getElementById("closeModal");

postBtn.onclick = () => choiceModal.classList.remove("hidden");

function closeAll() {
    choiceModal.classList.add("hidden");
    needModal.classList.add("hidden");
    form.reset();
    skillBox.innerHTML = ""; // Clear skills UI
    currentSkills = [];      // Reset skills data
    currentPeopleCount = 1;
    peopleCountDisplay.innerText = 1;
}

closeModalBtn.onclick = closeAll;

document.getElementById("openManual").onclick = () => {
    choiceModal.classList.add("hidden");
    needModal.classList.remove("hidden");
    form.classList.remove("hidden");
    uploadSection.classList.add("hidden");
};

document.getElementById("openUpload").onclick = () => {
    choiceModal.classList.add("hidden");
    needModal.classList.remove("hidden");
    form.classList.add("hidden");
    uploadSection.classList.remove("hidden");
};

// ================= 4. UPLOAD PORTION =================
const cancelBtn = document.getElementById("uploadCancelBtn");
const submitBtn = document.getElementById("uploadSubmitBtn");

if (cancelBtn) { cancelBtn.onclick = () => { needModal.classList.add("hidden"); }; }
if (submitBtn) { submitBtn.onclick = () => { alert("Report submitted (AI extraction coming next)"); needModal.classList.add("hidden"); }; }

// ================= 5. SKILLS TAG SYSTEM =================
skillInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        const val = skillInput.value.trim();
        if (val && !currentSkills.includes(val)) {
            currentSkills.push(val);
            const tag = document.createElement("span");
            tag.className = "bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs flex items-center gap-1 cursor-pointer";
            tag.innerHTML = `${val} ✕`;
            tag.onclick = () => { 
                currentSkills = currentSkills.filter(s => s !== val); 
                tag.remove(); 
            };
            skillBox.appendChild(tag);
            skillInput.value = "";
        }
    }
});
// 3. Auto-height Textarea
const tx = document.getElementsByTagName("textarea");
for (let i = 0; i < tx.length; i++) {
    tx[i].setAttribute("style", "height:" + (tx[i].scrollHeight) + "px;overflow-y:hidden;");
    tx[i].addEventListener("input", OnInput, false);
}
function OnInput() {
    this.style.height = "auto";
    this.style.height = (this.scrollHeight) + "px";
}
// ================= 6. MANUAL FORM & PEOPLE COUNTER =================
document.getElementById("plusBtn").onclick = (e) => {
    e.preventDefault();
    currentPeopleCount++;
    peopleCountDisplay.innerText = currentPeopleCount;
};

document.getElementById("minusBtn").onclick = (e) => {
    e.preventDefault();
    if (currentPeopleCount > 1) {
        currentPeopleCount--;
        peopleCountDisplay.innerText = currentPeopleCount;
    }
};

form.onsubmit = function(e) {
    e.preventDefault();
    const newNeed = {
        id: Date.now(),
        title: document.getElementById("title").value,
        description: document.getElementById("description").value,
        category: form.querySelector('[name="category"]').value,
        urgency: parseInt(document.getElementById("urgency").value),
        location: document.getElementById("location").value,
        people: currentPeopleCount,
        skills: [...currentSkills], // Store current skills
        status: "Open"
    };
    needsData.push(newNeed);
    const localSaves = JSON.parse(localStorage.getItem("needs") || "[]");
    localSaves.push(newNeed);
    localStorage.setItem("needs", JSON.stringify(localSaves));
    closeAll();
    applyFilters();
};

// Initialize
renderNeeds(needsData);