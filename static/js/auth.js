import { initializeApp }        from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

// ─────────────────────────────────────────────
// 1. Read the intended role from the URL
//    e.g. /getstarted?role=volunteer
//    This was set when the user clicked a CTA
//    on the landing page
// ─────────────────────────────────────────────
const params       = new URLSearchParams(window.location.search);
const intendedRole = params.get("role"); // "ngo" | "volunteer" | null

// ─────────────────────────────────────────────
// 2. Init Firebase
// ─────────────────────────────────────────────
async function fetchFirebaseConfig() {
  const res = await fetch("/api/get_firebase_config");
  return await res.json();
}

const firebaseConfig = await fetchFirebaseConfig();
const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const provider = new GoogleAuthProvider();

// ─────────────────────────────────────────────
// 3. Send token + intendedRole to Flask
//    Flask will decide where to redirect
// ─────────────────────────────────────────────
async function sendTokenToBackend(user) {
  const idToken = await user.getIdToken();

  const res = await fetch("/firebase-login", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      idToken,
      intendedRole  // "ngo", "volunteer", or null
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Login failed");
  }

  const data = await res.json();

  // Flask always sends a redirect URL — just follow it
  if (data.redirect) {
    window.location.href = data.redirect;
  }
}

// ─────────────────────────────────────────────
// 4. Google Login
// ─────────────────────────────────────────────
const googleBtn = document.getElementById("google-login-btn");

if (googleBtn) {
  googleBtn.addEventListener("click", async () => {
    try {
      const result = await signInWithPopup(auth, provider);
      await sendTokenToBackend(result.user);
    } catch (err) {
      console.error("Google login error:", err);
      showError(err.message);
    }
  });
}

// ─────────────────────────────────────────────
// 5. Email Sign Up
// ─────────────────────────────────────────────
const signupForm = document.getElementById("emailSignUpForm");

if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email    = document.getElementById("emailSignUpInput").value.trim();
    const password = document.getElementById("passwordSignUpInput").value;

    if (!email || !password) {
      showError("Please fill in all fields.");
      return;
    }
    if (password.length < 6) {
      showError("Password must be at least 6 characters.");
      return;
    }

    try {
      setLoading(true);
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await sendTokenToBackend(cred.user);
    } catch (err) {
      console.error("Signup error:", err);
      showError(friendlyError(err.code));
    } finally {
      setLoading(false);
    }
  });
}

// ─────────────────────────────────────────────
// 6. Email Sign In
// ─────────────────────────────────────────────
const signinForm = document.getElementById("emailSignInForm");

if (signinForm) {
  signinForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email    = document.getElementById("emailSignInInput").value.trim();
    const password = document.getElementById("passwordSignInInput").value;

    if (!email || !password) {
      showError("Please fill in all fields.");
      return;
    }

    try {
      setLoading(true);
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await sendTokenToBackend(cred.user);
    } catch (err) {
      console.error("Signin error:", err);
      showError(friendlyError(err.code));
    } finally {
      setLoading(false);
    }
  });
}

// ─────────────────────────────────────────────
// 7. Helpers
// ─────────────────────────────────────────────

function showError(message) {
  // Try to find an error div on the page, else alert
  const errDiv = document.getElementById("auth-error");
  if (errDiv) {
    errDiv.textContent = message;
    errDiv.style.display = "block";
    setTimeout(() => { errDiv.style.display = "none"; }, 5000);
  } else {
    alert(message);
  }
}

function setLoading(isLoading) {
  const submitBtn = document.querySelector(".submit-btn");
  if (!submitBtn) return;
  submitBtn.disabled    = isLoading;
  submitBtn.textContent = isLoading ? "Please wait..." : submitBtn.dataset.label;
}

function friendlyError(code) {
  const map = {
    "auth/user-not-found":        "No account found with this email.",
    "auth/wrong-password":        "Incorrect password. Please try again.",
    "auth/email-already-in-use":  "An account with this email already exists.",
    "auth/weak-password":         "Password should be at least 6 characters.",
    "auth/invalid-email":         "Please enter a valid email address.",
    "auth/too-many-requests":     "Too many attempts. Please try again later.",
    "auth/network-request-failed":"Network error. Please check your connection.",
    "auth/popup-closed-by-user":  "Login cancelled. Please try again.",
  };
  return map[code] || "Something went wrong. Please try again.";
}
