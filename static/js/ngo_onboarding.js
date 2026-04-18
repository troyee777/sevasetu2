/* =====================================================
   ngo_onboarding.js
   Handles: Leaflet map, logo upload, validation, submit
   ===================================================== */

document.addEventListener("DOMContentLoaded", () => {

  // ─────────────────────────────────────────────
  // 1. LEAFLET MAP SETUP
  // ─────────────────────────────────────────────

  let selectedLat = 22.5726;  // Default: Kolkata
  let selectedLng = 88.3639;
  let marker;

  const map = L.map("ngoMap").setView([selectedLat, selectedLng], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  // Custom green marker icon
  const greenIcon = L.divIcon({
    className: "",
    html: `<div style="
      width: 32px; height: 32px;
      background: #006c44;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 3px solid white;
      box-shadow: 0 4px 12px rgba(0,108,68,0.4);
    "></div>`,
    iconSize:   [32, 32],
    iconAnchor: [16, 32],
    popupAnchor:[0, -32]
  });

  marker = L.marker([selectedLat, selectedLng], {
    icon:      greenIcon,
    draggable: true
  }).addTo(map);

  marker.bindPopup(
    "<b>Your NGO Location</b><br>Drag to adjust.",
    { closeButton: false }
  ).openPopup();

  // Click map to move pin
  map.on("click", (e) => {
    updatePin(e.latlng.lat, e.latlng.lng);
  });

  // Drag marker to move pin
  marker.on("dragend", (e) => {
    const pos = e.target.getLatLng();
    updatePin(pos.lat, pos.lng);
  });

  function updatePin(lat, lng) {
    selectedLat = lat;
    selectedLng = lng;
    marker.setLatLng([lat, lng]);
    document.getElementById("latitude").value  = lat.toFixed(6);
    document.getElementById("longitude").value = lng.toFixed(6);
  }


  // ─────────────────────────────────────────────
  // 2. USE CURRENT LOCATION BUTTON
  // ─────────────────────────────────────────────

  const useLocationBtn  = document.getElementById("useLocationBtn");
  const locationStatus  = document.getElementById("locationStatus");

  useLocationBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      showLocationStatus("Geolocation is not supported by your browser.", "error");
      return;
    }

    showLocationStatus("Detecting your location...", "info");
    useLocationBtn.disabled  = true;
    useLocationBtn.innerHTML = `
      <span class="material-symbols-outlined text-lg animate-spin">sync</span>
      Detecting...
    `;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        updatePin(lat, lng);
        map.setView([lat, lng], 15);
        showLocationStatus("Location detected successfully.", "success");

        // Try to reverse geocode the city
        reverseGeocode(lat, lng);

        useLocationBtn.disabled  = false;
        useLocationBtn.innerHTML = `
          <span class="material-symbols-outlined text-lg">my_location</span>
          Use my current location
        `;
      },
      (err) => {
        showLocationStatus(
          "Could not detect location. Please pin it manually on the map.",
          "error"
        );
        useLocationBtn.disabled  = false;
        useLocationBtn.innerHTML = `
          <span class="material-symbols-outlined text-lg">my_location</span>
          Use my current location
        `;
      },
      { timeout: 8000 }
    );
  });

  function showLocationStatus(message, type) {
    locationStatus.textContent  = message;
    locationStatus.className    = "text-xs text-center px-1 mt-1 block";
    if (type === "error")   locationStatus.classList.add("text-error");
    if (type === "success") locationStatus.classList.add("text-primary");
    if (type === "info")    locationStatus.classList.add("text-on-surface-variant");
    locationStatus.classList.remove("hidden");
    setTimeout(() => locationStatus.classList.add("hidden"), 5000);
  }

  async function reverseGeocode(lat, lng) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
        { headers: { "User-Agent": "SevaSetu/1.0" } }
      );
      const data = await res.json();
      const addr = data.address || {};
      const city = addr.city || addr.town || addr.village || addr.county || "";
      if (city) {
        document.getElementById("city").value = city;
      }
    } catch (e) {
      // Silently fail — user can type city manually
    }
  }


  // ─────────────────────────────────────────────
  // 3. LOGO UPLOAD + PREVIEW
  // ─────────────────────────────────────────────

  const logoInput     = document.getElementById("logoInput");
  const uploadZone    = document.getElementById("uploadZone");
  const previewRow    = document.getElementById("previewRow");
  const logoPreview   = document.getElementById("logoPreview");
  const logoFileName  = document.getElementById("logoFileName");
  const removeLogoBtn = document.getElementById("removeLogoBtn");

  // Click to upload (zone click triggers hidden input)
  // Already handled by onclick in HTML

  // File selected
  logoInput.addEventListener("change", () => {
    handleFile(logoInput.files[0]);
  });

  // Drag & drop
  uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadZone.classList.add("upload-zone-active");
  });

  uploadZone.addEventListener("dragleave", () => {
    uploadZone.classList.remove("upload-zone-active");
  });

  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("upload-zone-active");
    const file = e.dataTransfer.files[0];
    if (file) {
      // Assign to the input so FormData picks it up
      const dt = new DataTransfer();
      dt.items.add(file);
      logoInput.files = dt.files;
      handleFile(file);
    }
  });

  function handleFile(file) {
    if (!file) return;

    // Type check
    const allowed = ["image/jpeg", "image/png", "image/svg+xml", "image/webp"];
    if (!allowed.includes(file.type)) {
      showGlobalError("Please upload a valid image file (JPG, PNG, or SVG).");
      logoInput.value = "";
      return;
    }

    // Size check (5MB)
    if (file.size > 5 * 1024 * 1024) {
      showGlobalError("File is too large. Maximum size is 5MB.");
      logoInput.value = "";
      return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => {
      logoPreview.src      = e.target.result;
      logoFileName.textContent = file.name;
      previewRow.classList.remove("hidden");
      previewRow.classList.add("flex");
      uploadZone.style.display = "none";
    };
    reader.readAsDataURL(file);
  }

  // Remove logo
  removeLogoBtn.addEventListener("click", () => {
    logoInput.value          = "";
    logoPreview.src          = "";
    previewRow.classList.add("hidden");
    previewRow.classList.remove("flex");
    uploadZone.style.display = "";
  });


  // ─────────────────────────────────────────────
  // 4. FORM VALIDATION
  // ─────────────────────────────────────────────

  function showFieldError(inputId, errId, show) {
    const input = document.getElementById(inputId);
    const err   = document.getElementById(errId);
    if (!input || !err) return;

    if (show) {
      input.classList.add("input-error");
      err.classList.add("show");
    } else {
      input.classList.remove("input-error");
      err.classList.remove("show");
    }
  }

  function validateForm() {
    let valid = true;

    // Org name
    const orgName = document.getElementById("orgName").value.trim();
    showFieldError("orgName", "orgNameErr", !orgName);
    if (!orgName) valid = false;

    // Description
    const desc = document.getElementById("orgDesc").value.trim();
    showFieldError("orgDesc", "orgDescErr", !desc);
    if (!desc) valid = false;

    // Email
    const email = document.getElementById("contactEmail").value.trim();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    showFieldError("contactEmail", "emailErr", !emailValid);
    if (!emailValid) valid = false;

    // City
    const city = document.getElementById("city").value.trim();
    showFieldError("city", "cityErr", !city);
    if (!city) valid = false;

    return valid;
  }

  // Clear error on input
  ["orgName", "orgDesc", "contactEmail", "city"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => {
        el.classList.remove("input-error");
        const errEl = document.getElementById(id + "Err");
        if (errEl) errEl.classList.remove("show");
      });
    }
  });


  // ─────────────────────────────────────────────
  // 5. FORM SUBMIT
  // ─────────────────────────────────────────────

  const ngoForm   = document.getElementById("ngoForm");
  const submitBtn = document.getElementById("submitBtn");

  ngoForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Clear any previous global error
    hideGlobalError();

    // Validate
    if (!validateForm()) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    // Build FormData
    const formData = new FormData(ngoForm);
    // Ensure lat/lng are in FormData
    formData.set("latitude",  document.getElementById("latitude").value);
    formData.set("longitude", document.getElementById("longitude").value);

    // Loading state
    setSubmitLoading(true);

    try {
      const res = await fetch("/ngo/onboarding", {
        method: "POST",
        body:   formData
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Server error. Please try again.");
      }

      const data = await res.json();

      // Success → redirect to NGO dashboard
      window.location.href = data.redirect || "/ngo/dashboard";

    } catch (err) {
      console.error("Onboarding error:", err);
      showGlobalError(err.message);
      setSubmitLoading(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });

  function setSubmitLoading(loading) {
    submitBtn.disabled     = loading;
    submitBtn.textContent  = loading ? "Setting up your profile..." : "Complete Setup";
    submitBtn.classList.toggle("btn-loading", loading);
  }

  function showGlobalError(message) {
    const el = document.getElementById("globalError");
    el.textContent = message;
    el.classList.remove("hidden");
  }

  function hideGlobalError() {
    const el = document.getElementById("globalError");
    el.classList.add("hidden");
    el.textContent = "";
  }

});