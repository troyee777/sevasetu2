/* =====================================================
   volunteer_onboarding.js
   Handles: skills, availability, radius slider,
            photo upload, Ola Maps location picker,
            form submit to Flask backend
   ===================================================== */

let OLA_MAPS_API_KEY = null;

async function loadOlaMapsKey() {
  try {
    const res = await fetch("/api/get_ola_maps_key");
    if (!res.ok) throw new Error("Failed to fetch key");
    const data = await res.json();
    OLA_MAPS_API_KEY = data.OLA_MAPS_API_KEY;
  } catch (err) {
    console.error("Error loading Ola Maps key:", err);
  }
}

// ─────────────────────────────────────────────
// DOM REFERENCES
// ─────────────────────────────────────────────
const slider           = document.getElementById("radiusSlider");
const radiusValue      = document.getElementById("radiusValue");
const skillsGroup      = document.getElementById("skillsGroup");
const availabilityGroup= document.getElementById("availabilityGroup");
const form             = document.getElementById("onboardingForm");
const saveLaterBtn     = document.getElementById("saveLaterBtn");
const photoBtn         = document.querySelector(".photo-add");
const photoInput       = document.getElementById("photoInput");
const photoCircle      = document.querySelector(".photo-circle");
const submitBtn        = document.getElementById("submitBtn");

// Location state
let selectedLat = 12.9716;  // Default: Bengaluru
let selectedLng = 77.5946;
let mapInstance   = null;
let markerInstance = null;

// ─────────────────────────────────────────────
// 1. PHOTO UPLOAD + PREVIEW
// ─────────────────────────────────────────────

photoBtn?.addEventListener("click", () => photoInput.click());

photoInput?.addEventListener("change", () => {
  const file = photoInput.files[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    showError("Photo must be under 5MB.");
    photoInput.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    photoCircle.innerHTML = `
      <img src="${reader.result}"
           style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
  };
  reader.readAsDataURL(file);
});


// ─────────────────────────────────────────────
// 2. SKILLS CHIP TOGGLE
// ─────────────────────────────────────────────

skillsGroup?.addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;

  // "+ Other" — prompt for custom skill
  if (btn.dataset.skill === "Other" && !btn.classList.contains("active")) {
    const newSkill = prompt("Enter a custom skill:");
    if (newSkill && newSkill.trim()) {
      btn.classList.add("active");
      btn.innerHTML = `${newSkill.trim()} ✕`;
      btn.dataset.skill = newSkill.trim();
    }
    return;
  }

  btn.classList.toggle("active");
  const isActive = btn.classList.contains("active");

  if (isActive && btn.dataset.skill !== "Other") {
    btn.innerHTML = `${btn.dataset.skill} ✕`;
  } else if (!isActive && btn.dataset.skill !== "Other") {
    btn.textContent = btn.dataset.skill;
  } else if (!isActive) {
    btn.textContent = "+ Other";
    btn.dataset.skill = "Other";
  }
});

function getSelectedSkills() {
  return [...skillsGroup.querySelectorAll(".chip.active")]
    .map(b => b.dataset.skill)
    .filter(s => s && s !== "Other");
}


// ─────────────────────────────────────────────
// 3. AVAILABILITY SEGMENTED CONTROL
// ─────────────────────────────────────────────

availabilityGroup?.addEventListener("click", (e) => {
  const btn = e.target.closest(".segment");
  if (!btn) return;
  availabilityGroup.querySelectorAll(".segment")
    .forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
});

function getSelectedAvailability() {
  return availabilityGroup?.querySelector(".segment.active")?.dataset.value || "Anytime";
}


// ─────────────────────────────────────────────
// 4. RADIUS SLIDER
// ─────────────────────────────────────────────

function updateSlider() {
  if (!slider) return;
  const value   = slider.value;
  radiusValue.textContent = value;
  const percent = ((value - slider.min) / (slider.max - slider.min)) * 100;
  slider.style.background =
    `linear-gradient(to right, #006c44 ${percent}%, #d8e0ee ${percent}%)`;
}

slider?.addEventListener("input", updateSlider);
updateSlider();


// ─────────────────────────────────────────────
// 5. OLA MAPS LOCATION PICKER
// ─────────────────────────────────────────────

function initMap() {
  const mapEl = document.getElementById("locationMap");
  if (!mapEl || typeof OlaMaps === "undefined") return;

  if (!OLA_MAPS_API_KEY) {
    mapEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#6e7a71;font-size:.85rem;">Map unavailable — location key not loaded</div>`;
    return;
  }

  const olaMaps = new OlaMaps({ apiKey: OLA_MAPS_API_KEY });

  mapInstance = olaMaps.init({
    style:     "https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json",
    container: "locationMap",
    center:    [selectedLng, selectedLat],
    zoom:      13
  });

  // Custom marker element
  const el = document.createElement("div");
  el.style.cssText = `
    width:28px;height:28px;background:#006c44;
    border-radius:50% 50% 50% 0;transform:rotate(-45deg);
    border:3px solid white;box-shadow:0 4px 12px rgba(0,108,68,.4);
    cursor:grab;
  `;

  mapInstance.on("load", () => {
    markerInstance = olaMaps
      .addMarker({ element: el, draggable: true })
      .setLngLat([selectedLng, selectedLat])
      .addTo(mapInstance);

    markerInstance.on("dragend", () => {
      const { lat, lng } = markerInstance.getLngLat();
      updateLocation(lat, lng);
    });
  });

  mapInstance.on("click", (e) => {
    const { lat, lng } = e.lngLat;
    updateLocation(lat, lng);
    markerInstance?.setLngLat([lng, lat]);
  });
}

function initLocationSearch() {
  const input = document.getElementById("locationSearchInput");
  const suggestions = document.getElementById("locationSuggestions");
  if (!input || !suggestions) return;

  let debounceTimer;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (query.length < 3) {
      suggestions.style.display = "none";
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.olamaps.io/places/v1/autocomplete?input=${encodeURIComponent(query)}&api_key=${OLA_MAPS_API_KEY}`
        );
        const data = await res.json();
        const predictions = data.predictions || [];
        
        if (predictions.length > 0) {
          suggestions.innerHTML = predictions.map(p => `
            <div class="suggestion-item" 
                 style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f0f0f0;font-size:.85rem;"
                 data-placeid="${p.place_id}">
              ${p.description}
            </div>
          `).join("");
          suggestions.style.display = "block";

          suggestions.querySelectorAll(".suggestion-item").forEach(item => {
            item.addEventListener("click", async () => {
              const placeId = item.dataset.placeid;
              input.value = item.textContent.trim();
              suggestions.style.display = "none";
              await selectPlace(placeId);
            });
          });
        } else {
          suggestions.style.display = "none";
        }
      } catch (err) {
        console.error("Autocomplete error:", err);
      }
    }, 300);
  });

  // Close suggestions on click outside
  document.addEventListener("click", (e) => {
    if (!input.contains(e.target) && !suggestions.contains(e.target)) {
      suggestions.style.display = "none";
    }
  });
}

async function selectPlace(placeId) {
  if (!OLA_MAPS_API_KEY) return;
  try {
    const res = await fetch(
      `https://api.olamaps.io/places/v1/details?place_id=${placeId}&api_key=${OLA_MAPS_API_KEY}`
    );
    const data = await res.json();
    if (data.result && data.result.geometry && data.result.geometry.location) {
      const { lat, lng } = data.result.geometry.location;
      updateLocation(lat, lng);
      mapInstance?.flyTo({ center: [lng, lat], zoom: 15 });
      markerInstance?.setLngLat([lng, lat]);
    }
  } catch (err) {
    console.error("Place details error:", err);
  }
}

function updateLocation(lat, lng) {
  selectedLat = lat;
  selectedLng = lng;
  document.getElementById("latitude").value  = lat.toFixed(6);
  document.getElementById("longitude").value = lng.toFixed(6);
  reverseGeocode(lat, lng);
}

async function reverseGeocode(lat, lng) {
  if (!OLA_MAPS_API_KEY) return;
  try {
    const res  = await fetch(
      `https://api.olamaps.io/places/v1/reverse-geocode?latlng=${lat},${lng}&api_key=${OLA_MAPS_API_KEY}`
    );
    const data = await res.json();
    const results = data.results || [];
    if (results.length > 0) {
      const comp   = results[0].address_components || [];
      const city   = comp.find(c =>
        (c.types||[]).includes("locality") ||
        (c.types||[]).includes("administrative_area_level_2")
      );
      const mapTag = document.getElementById("mapLocationTag");
      if (mapTag) {
        if (city) {
          mapTag.innerHTML = `📍 <strong>${city.long_name}</strong>`;
        } else {
          const addr = results[0].formatted_address?.split(",")[0] || "Location selected";
          mapTag.innerHTML = `📍 ${addr}`;
        }
      }
    }
  } catch (err) {
    console.error("Reverse geocoding error:", err);
  }
}

// "Use current location" button
document.getElementById("useMyLocationBtn")?.addEventListener("click", () => {
  if (!navigator.geolocation) return;

  const btn = document.getElementById("useMyLocationBtn");
  btn.disabled   = true;
  btn.textContent = "Detecting...";

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      updateLocation(lat, lng);
      mapInstance?.flyTo({ center: [lng, lat], zoom: 15 });
      markerInstance?.setLngLat([lng, lat]);
      btn.disabled   = false;
      btn.textContent = "⌖ Use my location";
    },
    () => {
      btn.disabled   = false;
      btn.textContent = "⌖ Use my location";
    },
    { timeout: 8000 }
  );
});


// ─────────────────────────────────────────────
// 6. FORM SUBMIT → Flask Backend
// ─────────────────────────────────────────────

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name   = document.getElementById("fullName")?.value.trim();
  const phone  = document.getElementById("phone")?.value.trim();
  const about  = document.getElementById("about")?.value.trim();
  const skills = getSelectedSkills();

  // Basic validation
  if (!name) { showError("Please enter your full name."); return; }
  if (skills.length === 0) { showError("Please select at least one skill."); return; }

  const formData = new FormData();
  formData.append("name",         name);
  formData.append("phone",        phone);
  formData.append("about",        about);
  formData.append("skills",       JSON.stringify(skills));
  formData.append("availability", getSelectedAvailability());
  formData.append("radius",       slider.value);
  formData.append("latitude",     selectedLat.toFixed(6));
  formData.append("longitude",    selectedLng.toFixed(6));

  // Photo file
  const photoFile = photoInput?.files[0];
  if (photoFile) formData.append("photo", photoFile);

  setLoading(true);

  try {
    const res = await fetch("/volunteer/onboarding", {
      method: "POST",
      body:   formData
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Server error. Please try again.");
    }

    const data = await res.json();
    // Clear draft
    localStorage.removeItem("seva_vol_draft");
    window.location.href = data.redirect || "/volunteer/dashboard";

  } catch (err) {
    showError(err.message);
    setLoading(false);
  }
});


// ─────────────────────────────────────────────
// 7. SAVE FOR LATER (localStorage draft)
// ─────────────────────────────────────────────

saveLaterBtn?.addEventListener("click", () => {
  const draft = {
    name:         document.getElementById("fullName")?.value,
    phone:        document.getElementById("phone")?.value,
    about:        document.getElementById("about")?.value,
    skills:       getSelectedSkills(),
    availability: getSelectedAvailability(),
    radius:       slider?.value,
    lat:          selectedLat,
    lng:          selectedLng,
    savedAt:      new Date().toISOString()
  };
  localStorage.setItem("seva_vol_draft", JSON.stringify(draft));
  showSuccess("Progress saved! You can continue later.");
});

function restoreDraft() {
  try {
    const raw = localStorage.getItem("seva_vol_draft");
    if (!raw) return;
    const d = JSON.parse(raw);

    if (d.name  && document.getElementById("fullName"))
      document.getElementById("fullName").value = d.name;
    if (d.phone && document.getElementById("phone"))
      document.getElementById("phone").value = d.phone;
    if (d.about && document.getElementById("about"))
      document.getElementById("about").value = d.about;

    if (d.radius && slider) {
      slider.value = d.radius;
      updateSlider();
    }

    if (d.skills && Array.isArray(d.skills)) {
      skillsGroup?.querySelectorAll(".chip").forEach(chip => {
        if (d.skills.includes(chip.dataset.skill)) {
          chip.classList.add("active");
          chip.innerHTML = `${chip.dataset.skill} ✕`;
        }
      });
    }

    if (d.availability) {
      availabilityGroup?.querySelectorAll(".segment").forEach(seg => {
        seg.classList.toggle("active", seg.dataset.value === d.availability);
      });
    }

    if (d.lat && d.lng) {
      selectedLat = d.lat;
      selectedLng = d.lng;
      document.getElementById("latitude").value  = d.lat;
      document.getElementById("longitude").value = d.lng;
      
      // If map is already init, move it
      if (mapInstance && markerInstance) {
        mapInstance.setCenter([selectedLng, selectedLat]);
        markerInstance.setLngLat([selectedLng, selectedLat]);
      }
      reverseGeocode(selectedLat, selectedLng);
    }
  } catch {}
}


// ─────────────────────────────────────────────
// 8. BOOT — load key first, then init map
// ─────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  await loadOlaMapsKey();
  restoreDraft(); // Load values first
  initMap();      // Init map with loaded values
  initLocationSearch();
});


// ─────────────────────────────────────────────
// 9. UI HELPERS
// ─────────────────────────────────────────────

function setLoading(loading) {
  if (!submitBtn) return;
  submitBtn.disabled    = loading;
  submitBtn.textContent = loading ? "Setting up your profile..." : "Complete Profile";
}

function showError(msg) {
  const el = document.getElementById("formError");
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.style.display    = "block";
  el.style.background = "#fee2e2";
  el.style.color      = "#991b1b";
  el.style.borderRadius = "10px";
  el.style.padding    = "12px 16px";
  el.style.fontWeight = "600";
  el.style.fontSize   = ".875rem";
  el.style.marginBottom = "16px";
  setTimeout(() => { el.style.display = "none"; }, 5000);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showSuccess(msg) {
  const el = document.getElementById("formError");
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.style.display    = "block";
  el.style.background = "#d1fae5";
  el.style.color      = "#065f46";
  el.style.borderRadius = "10px";
  el.style.padding    = "12px 16px";
  el.style.fontWeight = "600";
  el.style.fontSize   = ".875rem";
  el.style.marginBottom = "16px";
  setTimeout(() => { el.style.display = "none"; }, 3000);
}