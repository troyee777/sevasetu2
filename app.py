from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from firebase_admin import auth, credentials
import firebase_admin
import os
import json
from firebase_admin import firestore
from datetime import datetime, timezone
import math
from services import imagekit_services
from services import firebase_services


app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "super-secret-key-change-in-prod")

# ======================
# Firebase Init
# ======================
firebase_creds = os.environ.get("FIREBASE_CONFIG")
if firebase_creds:
    cred_dict = json.loads(firebase_creds)
    cred = credentials.Certificate(cred_dict)
else:
    raise Exception("FIREBASE_CONFIG environment variable not set")

if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)


# ======================
# Public Pages
# ======================

# ══════════════════════════════════════════════
# PAGE ROUTE
# ══════════════════════════════════════════════

@app.route("/ngo/dashboard")
def ngo_dashboard():
    if not session.get("user"):
        return redirect("/getstarted")
    if session["user"].get("role") != "ngo":
        return redirect("/select-role")
    return render_template("ngo_dashboard.html", user=session["user"])


# ══════════════════════════════════════════════
# API — DASHBOARD DATA
# ══════════════════════════════════════════════

@app.route("/api/ngo/dashboard")
def api_ngo_dashboard():
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401

    uid = session["user"]["uid"]

    # ── Stats ──────────────────────────────────
    all_needs   = firebase_services.get_needs_by_ngo(uid)

    open_needs       = [n for n in all_needs if n.get("status") == "open"]
    assigned_needs   = [n for n in all_needs if n.get("status") in ("assigned","in_progress")]
    completed_needs  = [n for n in all_needs if n.get("status") == "completed"]

    # Active volunteers = unique volunteers assigned to this NGO's needs
    assigned_vols = set(
        n.get("assigned_volunteer_id")
        for n in all_needs
        if n.get("assigned_volunteer_id")
    )

    stats = {
        "open_needs":         len(open_needs),
        "assigned_needs":     len(assigned_needs),
        "completed_month":    len(completed_needs),
        "active_volunteers":  len(assigned_vols)
    }

    # ── Recent Needs (latest 5) ─────────────────
    recent_needs = sorted(
        all_needs,
        key=lambda x: x.get("created_at") or 0,
        reverse=True
    )[:5]

    # ── Suggested Matches ───────────────────────
    matches = firebase_services.get_suggested_matches_for_ngo(uid)

    # ── Recent Activity ─────────────────────────
    activity = firebase_services.get_activity_for_ngo(uid, limit=5)

    # ── NGO org name ────────────────────────────
    ngo_doc  = firebase_services.get_ngo_profile(uid)
    org_name = ngo_doc.get("org_name", session["user"].get("name", "Your Organization"))

    return jsonify({
        "org_name":          org_name,
        "stats":             stats,
        "recent_needs":      recent_needs,
        "suggested_matches": matches,
        "recent_activity":   activity
    })


# ══════════════════════════════════════════════
# API — UPLOAD FIELD REPORT
# ══════════════════════════════════════════════

@app.route("/api/ngo/upload-report", methods=["POST"])
def api_upload_report():
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401

    uid  = session["user"]["uid"]
    file = request.files.get("report")

    if not file or not file.filename:
        return jsonify({"error": "No file provided"}), 400

    # Validate file type
    allowed = {".pdf", ".docx", ".jpg", ".jpeg", ".png"}
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in allowed:
        return jsonify({"error": f"File type {ext} not supported"}), 400

    # Upload to ImageKit
    from services import imagekit_services
    upload_result = imagekit_services.upload_report(uid, file)
    if not upload_result:
        return jsonify({"error": "Upload failed"}), 500

    image_url = upload_result["url"]
    file_id   = upload_result["fileId"]

    # Save report record to Firestore
    report_id = firebase_services.save_report(uid, image_url, file_id)

    # Run Gemini extraction
    from services import gemini_service
    needs = gemini_service.extract_needs_from_url(image_url)

    # Save each extracted need as a draft
    firebase_services.save_extracted_needs_draft(uid, report_id, needs)

    return jsonify({
        "redirect":    f"/ngo/upload/review/{report_id}",
        "needs_count": len(needs)
    })


# ══════════════════════════════════════════════
# API — MANUAL NEED CREATION
# ══════════════════════════════════════════════

@app.route("/api/ngo/need/create", methods=["POST"])
def api_create_need():
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401

    uid  = session["user"]["uid"]
    data = request.json

    if not data.get("title") or not data.get("category"):
        return jsonify({"error": "Title and category are required"}), 400

    need = {
        "ngo_id":           uid,
        "title":            data.get("title"),
        "description":      data.get("description", ""),
        "category":         data.get("category"),
        "urgency_label":    data.get("urgency_label", "MEDIUM"),
        "urgency_score":    data.get("urgency_score", 5),
        "urgency_inferred": False,
        "location":         data.get("location", ""),
        "estimated_people": data.get("estimated_people"),
        "required_skills":  data.get("required_skills", []),
        "status":           "open",
        "source":           data.get("source", "manual"),
        "created_at":       firestore.SERVER_TIMESTAMP
    }

    need_id = firebase_services.create_need(need)

    # Run matching engine for this new need
    # firebase_services.run_matching_for_need(need_id, need)

    return jsonify({"success": True, "need_id": need_id})


# ══════════════════════════════════════════════
# API — MATCH ACTIONS
# ══════════════════════════════════════════════

@app.route("/api/ngo/match/<match_id>/approve", methods=["POST"])
def api_approve_match(match_id):
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401

    firebase_services.update_match_status(match_id, "accepted")
    return jsonify({"success": True})


@app.route("/api/ngo/match/<match_id>/skip", methods=["POST"])
def api_skip_match(match_id):
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401

    firebase_services.update_match_status(match_id, "skipped")
    return jsonify({"success": True})


















@app.route("/")
def landing():
    return render_template("home.html", user=session.get("user"))


@app.route("/getstarted")
def get_started():
    # If already logged in, skip login and go to dashboard
    if session.get("user"):
        role = session["user"].get("role")
        if role == "ngo":
            return redirect("/ngo/dashboard")
        elif role == "volunteer":
            return redirect("/volunteer/dashboard")
        else:
            # Logged in but no role yet → role selection
            return redirect("/select-role")

    # Pass the intended role so login page can carry it forward
    role = request.args.get("role")  # "ngo" or "volunteer"
    return render_template("login.html", intended_role=role)


# ======================
# Firebase Auth Endpoint
# ======================

@app.route("/firebase-login", methods=["POST"])
def firebase_login():
    data       = request.json
    id_token   = data.get("idToken")
    # The role the user clicked on the landing page
    # Sent from auth.js along with the token
    intended_role = data.get("intendedRole")  # "ngo" | "volunteer" | None

    if not id_token:
        return jsonify({"error": "No token provided"}), 400

    try:
        decoded = auth.verify_id_token(id_token)
    except Exception as e:
        return jsonify({"error": "Invalid token", "detail": str(e)}), 401

    uid   = decoded["uid"]
    email = decoded.get("email", "")
    name  = decoded.get("name") or "User"
    photo = decoded.get("picture", "")

    # ── Temporary stub until firebase_services is wired up ──
    # Replace this block with real Firestore reads when ready:
    doc = firebase_services.get_user_by_uid(uid)

    # ── NEW USER ─────────────────────────────────────────────
    if not doc:
        firebase_services.add_user(uid, email, name, photo, role=intended_role)

        # If they came with an intended role (from landing page CTA),
        # save it immediately — no need to show role selection
        role_to_save = intended_role  # "ngo", "volunteer", or None

        session["user"] = {
            "uid":      uid,
            "name":     name,
            "photo_url": photo,
            "email":    email,
            "role":     role_to_save
        }

        if role_to_save == "ngo":
            return jsonify({"status": "new", "redirect": "/ngo/onboarding"})
        elif role_to_save == "volunteer":
            return jsonify({"status": "new", "redirect": "/volunteer/onboarding"})
        else:
            # No intended role (user came directly to /getstarted)
            # Show role selection page
            return jsonify({"status": "new", "redirect": "/select-role"})

    # ── EXISTING USER ────────────────────────────────────────
    role = doc.get("role")

    session["user"] = {
        "uid":      uid,
        "name":     name,
        "photo_url": photo,
        "email":    email,
        "role":     role
    }

    # Route to correct dashboard based on saved role
    if role == "ngo":
        return jsonify({"status": "existing", "redirect": "/ngo/dashboard"})
    elif role == "volunteer":
        return jsonify({"status": "existing", "redirect": "/volunteer/dashboard"})
    else:
        # Somehow existing user with no role — send to role selection
        return jsonify({"status": "existing", "redirect": "/select-role"})


# ======================
# Role Selection
# ======================

@app.route("/select-role")
def select_role_page():
    if not session.get("user"):
        return redirect("/getstarted")
    # If they already have a role, skip
    if session["user"].get("role"):
        role = session["user"]["role"]
        if role == "ngo":
            return redirect("/ngo/dashboard")
        return redirect("/volunteer/dashboard")
    return render_template("roleselection.html", user=session.get("user"))


@app.route("/select-role", methods=["POST"])
def select_role():
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401

    role = request.json.get("role")
    if role not in ["ngo", "volunteer"]:
        return jsonify({"error": "Invalid role"}), 400

    uid = session["user"]["uid"]
    firebase_services.update_role(uid, role)

    session["user"]["role"] = role
    session.modified = True

    if role == "ngo":
        return jsonify({"redirect": "/ngo/onboarding"})
    return jsonify({"redirect": "/volunteer/onboarding"})


# ======================
# Onboarding Pages
# ======================
# ─────────────────────────────────────────────
# ADD THESE ROUTES TO YOUR app.py
# ─────────────────────────────────────────────

# You need these imports at the top of app.py:
#   (when ready)

@app.route("/ngo/onboarding", methods=["GET", "POST"])
def ngo_onboarding():

    # Must be logged in
    if not session.get("user"):
        return redirect("/getstarted")

    # ── GET → Show the form ──
    if request.method == "GET":
        return render_template("ngo_onboarding.html", user=session["user"])

    # ── POST → Save the data ──
    uid = session["user"]["uid"]

    # Collect text fields
    org_name      = request.form.get("org_name", "").strip()
    description   = request.form.get("description", "").strip()
    contact_email = request.form.get("contact_email", "").strip()
    phone         = request.form.get("phone", "").strip()
    address       = request.form.get("address", "").strip()
    city          = request.form.get("city", "").strip()
    latitude      = request.form.get("latitude", "0")
    longitude     = request.form.get("longitude", "0")

    # Basic server-side validation
    if not org_name or not description or not contact_email or not city:
        return jsonify({"error": "Please fill in all required fields."}), 400

    # Handle logo upload
    logo_url = None
    logo = request.files.get("logo")
    if logo and logo.filename:
        # TODO: upload to ImageKit
        result   = imagekit_services.upload_ngo_logo(uid, logo)
        logo_url = result

    # Build the data dict
    ngo_data = {
        "org_name":      org_name,
        "description":   description,
        "contact_email": contact_email,
        "phone":         phone,
        "address":       address,
        "city":          city,
        "location": {
            "lat":     float(latitude),
            "lng":     float(longitude),
            "city":    city,
            "address": address
        },
        "logo_url":      logo_url,
        "onboarded":     True,
    }

    # TODO: Save to Firestore
    firebase_services.create_ngo_profile(uid, ngo_data)

    # Update session
    session["user"]["city"]     = city
    session["user"]["onboarded"] = True
    session.modified = True

    return jsonify({"redirect": "/ngo/dashboard"})

@app.route("/volunteer/onboarding")
def volunteer_onboarding():
    if not session.get("user"):
        return redirect("/getstarted")
    return render_template("volunteer_onboarding.html", user=session["user"])


# ======================
# Dashboards
# ======================

@app.route("/volunteer/dashboard")
def volunteer_dashboard():
    if not session.get("user"):
        return redirect("/getstarted")
    if session["user"].get("role") != "volunteer":
        return redirect("/select-role")
    return render_template("volunteer_dashboard.html", user=session["user"])


# ======================
# Firebase Config API
# ======================

@app.route("/api/get_firebase_config", methods=["GET"])
def get_firebase_config():
    return jsonify({
        "apiKey":            os.environ.get("FIREBASE_API_KEY"),
        "authDomain":        os.environ.get("FIREBASE_AUTH_DOMAIN"),
        "projectId":         os.environ.get("FIREBASE_PROJECT_ID"),
        "storageBucket":     os.environ.get("FIREBASE_STORAGE_BUCKET"),
        "messagingSenderId": os.environ.get("FIREBASE_MESSAGING_SENDER_ID"),
        "appId":             os.environ.get("FIREBASE_APP_ID"),
        "vapidKey":          os.environ.get("FIREBASE_VAPID_KEY")
    })


# ======================
# Auth Check
# ======================

@app.route("/api/check-auth")
def check_auth():
    if session.get("user"):
        return jsonify({"authenticated": True, "user": session["user"]})
    return jsonify({"authenticated": False}), 401


# ======================
# Logout
# ======================

@app.route("/logout")
def logout():
    session.clear()
    return redirect("/")


# ======================
# Run
# ======================

if __name__ == "__main__":
    app.run(debug=True)
