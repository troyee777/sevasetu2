/* =====================================================
   ngo_onboarding.js
   Handles: Ola Maps location picker, reverse geocoding, 
            logo upload preview, validation, and submission.
   ===================================================== */

document.addEventListener("DOMContentLoaded", async () => {

  let OLA_MAPS_API_KEY = null;
  let mapInstance = null;
  let markerInstance = null;
  let selectedLat = 22.5726;  // Default: Kolkata
  let selectedLng = 88.3639;

  // ── 1. LOAD OLA MAPS KEY ──
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

  await loadOlaMapsKey();

  // ── 2. OLA MAPS SETUP ──
  function initMap() {
    if (!OLA_MAPS_API_KEY || typeof OlaMaps === "undefined") return;

    const olaMaps = new OlaMaps({ apiKey: OLA_MAPS_API_KEY });

    mapInstance = olaMaps.init({
      style: "https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json",
      container: "ngoMap",
      center: [selectedLng, selectedLat],
      zoom: 13
    });

    // Custom marker element
    const el = document.createElement("div");
    el.style.cssText = `
      width:32px;height:32px;background:#006c44;
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
    const input = document.getElementById("ngoLocationSearch");
    const suggestions = document.getElementById("ngoLocationSuggestions");
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
    document.getElementById("latitude").value = lat.toFixed(6);
    document.getElementById("longitude").value = lng.toFixed(6);
    reverseGeocode(lat, lng);
    updateProgress();
  }

  async function reverseGeocode(lat, lng) {
    try {
      const res = await fetch(
        `https://api.olamaps.io/places/v1/reverse-geocode?latlng=${lat},${lng}&api_key=${OLA_MAPS_API_KEY}`
      );
      const data = await res.json();
      const results = data.results || [];
      if (results.length > 0) {
        const address = results[0].formatted_address;
        const comp = results[0].address_components || [];
        
        // Find city/locality
        const cityComp = comp.find(c => 
          (c.types || []).includes("locality") || 
          (c.types || []).includes("administrative_area_level_2")
        );
        
        if (cityComp) {
          const cityInput = document.getElementById("city");
          if (!cityInput.value) cityInput.value = cityComp.long_name;
        }
        
        const addressInput = document.getElementById("address");
        if (!addressInput.value) addressInput.value = address;
        
        const mapTag = document.getElementById("mapTag");
        if (mapTag) {
          mapTag.innerHTML = `<span class="material-symbols-outlined text-sm">location_on</span> ${cityComp ? cityComp.long_name : 'Location set'}`;
        }
      }
    } catch (err) {
      console.error("Reverse geocoding error:", err);
    }
  }

  // Use current location button
  const useLocationBtn = document.getElementById("useLocationBtn");
  useLocationBtn?.addEventListener("click", () => {
    if (!navigator.geolocation) return;

    useLocationBtn.disabled = true;
    useLocationBtn.innerHTML = `<span class="material-symbols-outlined text-lg animate-spin">sync</span> Detecting...`;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        updateLocation(lat, lng);
        mapInstance?.flyTo({ center: [lng, lat], zoom: 15 });
        markerInstance?.setLngLat([lng, lat]);
        
        useLocationBtn.disabled = false;
        useLocationBtn.innerHTML = `<span class="material-symbols-outlined text-lg">my_location</span> Use Current Location`;
      },
      () => {
        useLocationBtn.disabled = false;
        useLocationBtn.innerHTML = `<span class="material-symbols-outlined text-lg">my_location</span> Use Current Location`;
        showGlobalError("Could not detect location. Please select it manually.");
      },
      { timeout: 8000 }
    );
  });

  initMap();
  initLocationSearch();

  // ── 3. LOGO UPLOAD & PREVIEW ──
  const logoInput = document.getElementById("logoInput");
  const uploadZone = document.getElementById("uploadZone");
  const previewRow = document.getElementById("previewRow");
  const logoPreview = document.getElementById("logoPreview");
  const logoFileName = document.getElementById("logoFileName");
  const removeLogoBtn = document.getElementById("removeLogoBtn");

  logoInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });

  function handleFile(file) {
    if (file.size > 5 * 1024 * 1024) {
      showGlobalError("Logo must be under 5MB.");
      logoInput.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      logoPreview.src = e.target.result;
      logoFileName.textContent = file.name;
      previewRow.classList.remove("hidden");
      previewRow.classList.add("flex");
      uploadZone.classList.add("hidden");
      updateProgress();
    };
    reader.readAsDataURL(file);
  }

  removeLogoBtn.addEventListener("click", () => {
    logoInput.value = "";
    previewRow.classList.add("hidden");
    previewRow.classList.remove("flex");
    uploadZone.classList.remove("hidden");
    updateProgress();
  });

  // ── 4. FORM VALIDATION & PROGRESS ──
  const form = document.getElementById("ngoForm");
  const progressFill = document.getElementById("progressFill");

  function updateProgress() {
    const fields = ['orgName', 'orgDesc', 'contactEmail', 'city'];
    let filledCount = 0;
    
    fields.forEach(id => {
      if (document.getElementById(id).value.trim()) filledCount++;
    });

    if (logoInput.files.length > 0) filledCount++;
    
    // Total steps logic: 4 fields + 1 logo + 1 location (approx)
    const totalSteps = 6;
    const percentage = Math.min((filledCount / totalSteps) * 100 + 33, 100);
    progressFill.style.width = `${percentage}%`;
  }

  // Real-time validation
  ['orgName', 'orgDesc', 'contactEmail', 'city'].forEach(id => {
    document.getElementById(id).addEventListener("input", (e) => {
      e.target.classList.remove("input-error");
      const err = document.getElementById(id + "Err") || document.getElementById("emailErr");
      if (err) err.classList.remove("show");
      updateProgress();
    });
  });

  function validate() {
    let valid = true;
    const name = document.getElementById("orgName").value.trim();
    const desc = document.getElementById("orgDesc").value.trim();
    const email = document.getElementById("contactEmail").value.trim();
    const city = document.getElementById("city").value.trim();

    if (!name) {
      document.getElementById("orgName").classList.add("input-error");
      document.getElementById("orgNameErr").classList.add("show");
      valid = false;
    }
    if (!desc) {
      document.getElementById("orgDesc").classList.add("input-error");
      document.getElementById("orgDescErr").classList.add("show");
      valid = false;
    }
    if (!city) {
      document.getElementById("city").classList.add("input-error");
      document.getElementById("cityErr").classList.add("show");
      valid = false;
    }
    if (!email || !email.includes("@")) {
      document.getElementById("contactEmail").classList.add("input-error");
      document.getElementById("emailErr").classList.add("show");
      valid = false;
    }

    return valid;
  }

  // ── 5. FORM SUBMISSION ──
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validate()) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const submitBtn = document.getElementById("submitBtn");
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Processing...";

    const formData = new FormData(form);

    try {
      const res = await fetch("/ngo/onboarding", {
        method: "POST",
        body: formData
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save profile.");
      }

      const data = await res.json();
      window.location.href = data.redirect || "/ngo/dashboard";

    } catch (err) {
      showGlobalError(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });

  function showGlobalError(msg) {
    const err = document.getElementById("globalError");
    err.textContent = msg;
    err.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(() => err.classList.add("hidden"), 5000);
  }

});