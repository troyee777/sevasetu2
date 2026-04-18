// ─────────────────────────────────────────────
// login.js — Tab switching UI only
// All actual auth logic is in auth.js
// ─────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {

  const signinTab     = document.getElementById("signinTab");
  const signupTab     = document.getElementById("signupTab");
  const formTitle     = document.getElementById("formTitle");
  const formSubtext   = document.getElementById("formSubtext");
  const signinForm    = document.getElementById("emailSignInForm");
  const signupForm    = document.getElementById("emailSignUpForm");

  // ── Switch to Sign In ──
  function showSignIn() {
    signinTab.classList.add("active");
    signupTab.classList.remove("active");

    formTitle.textContent   = "Welcome Back";
    formSubtext.textContent = "Access your community dashboard and needs.";

    signinForm.style.display = "block";
    signupForm.style.display = "none";

    // Update submit button label + data-label
    const btn = signinForm.querySelector(".submit-btn");
    btn.textContent    = "Sign In to SevaSetu";
    btn.dataset.label  = "Sign In to SevaSetu";
  }

  // ── Switch to Sign Up ──
  function showSignUp() {
    signupTab.classList.add("active");
    signinTab.classList.remove("active");

    formTitle.textContent   = "Join SevaSetu";
    formSubtext.textContent = "Start helping your community today.";

    signinForm.style.display = "none";
    signupForm.style.display = "block";

    // Update submit button label + data-label
    const btn = signupForm.querySelector(".submit-btn");
    btn.textContent   = "Create My Account";
    btn.dataset.label = "Create My Account";
  }

  signinTab.addEventListener("click", showSignIn);
  signupTab.addEventListener("click", showSignUp);

  // ── Auto-switch to Sign Up if user came from
  //    a CTA that implies they are new
  //    (optional — remove if you don't want this)
  const params = new URLSearchParams(window.location.search);
  const role   = params.get("role");
  if (role) {
    // User clicked "I want to Volunteer" or "I represent an NGO"
    // They are likely new — default to Sign Up tab
    showSignUp();
  } else {
    showSignIn();
  }

});
