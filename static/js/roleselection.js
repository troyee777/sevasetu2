// ─────────────────────────────────────────────
// roleselection.js
// Only shown when user signed up without a role
// (i.e. came directly to /getstarted with no ?role=)
// ─────────────────────────────────────────────

async function selectRole(role) {

  // Visual feedback — highlight selected card
  const ngoCard  = document.getElementById("ngoCard");
  const volCard  = document.getElementById("volunteerCard");

  if (role === "ngo") {
    ngoCard.style.borderColor  = "#006c44";
    ngoCard.style.boxShadow    = "0 0 0 3px rgba(0,108,68,0.2)";
    volCard.style.opacity      = "0.5";
  } else {
    volCard.style.borderColor  = "#006c44";
    volCard.style.boxShadow    = "0 0 0 3px rgba(0,108,68,0.2)";
    ngoCard.style.opacity      = "0.5";
  }

  // Disable both buttons to prevent double click
  document.querySelectorAll(".card-btn").forEach(btn => {
    btn.disabled     = true;
    btn.textContent  = "Please wait...";
  });

  try {
    const res = await fetch("/select-role", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ role })
    });

    if (!res.ok) {
      throw new Error("Failed to save role");
    }

    const data = await res.json();

    if (data.redirect) {
      window.location.href = data.redirect;
    }

  } catch (err) {
    console.error("Role selection error:", err);
    alert("Something went wrong. Please try again.");

    // Reset UI
    document.querySelectorAll(".card-btn").forEach(btn => {
      btn.disabled = false;
    });
    document.getElementById("ngoCard").style.cssText  = "";
    document.getElementById("volunteerCard").style.cssText = "";
    document.querySelectorAll(".card-btn")[0].textContent  = "Join as NGO";
    document.querySelectorAll(".card-btn")[1].textContent  = "Join as Volunteer";
  }
}
