from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from firebase_admin import auth, credentials
import firebase_admin
import os,logging
import json
from firebase_admin import firestore
from datetime import datetime, timezone
import math
from services import imagekit_services,firebase_services,gemini_service,matching_service,qstash_service



app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "super-secret-key-change-in-prod")
logger = logging.getLogger(__name__)
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
 
    allowed = {".pdf", ".docx", ".jpg", ".jpeg", ".png"}
    ext     = os.path.splitext(file.filename)[1].lower()
    if ext not in allowed:
        return jsonify({"error": f"File type {ext} not supported"}), 400
 
    # ── Step 1: Upload file to ImageKit ───────────────────────────────────────
    from services import imagekit_services
    upload_result = imagekit_services.upload_report(uid, file)
    if not upload_result:
        return jsonify({"error": "Upload to storage failed"}), 500
 
    image_url = upload_result["url"]
    file_id   = upload_result["fileId"]
 
    # ── Step 2: Create report doc in Firestore with status="processing" ───────
    data={
        "ngo_id":      uid,
        "image_url":   image_url,
        "thumb_url":   upload_result.get("thumb_url", image_url),
        "file_id":     file_id,
        "file_name":   file.filename,
        "file_size":   request.content_length or 0,
        "file_type":   ext.lstrip(".").upper(),  
    }
    _, report_ref = firebase_services.create_report_doc_ref(uid,data)
    report_id = report_ref.id
 
    # ── Step 3: Enqueue Gemini extraction via QStash ──────────────────────────
    # QStash will POST to /api/internal/process-report in ~2 seconds.
    # This call takes ~200ms — much faster than starting Gemini here.
    
    enqueued = qstash_service.enqueue_report_processing(
        report_id = report_id,
        ngo_uid   = uid,
        image_url = image_url,
        file_name = file.filename,
        file_type = ext.lstrip(".").upper(),
    )
 
    if not enqueued:
        # QStash publish failed — log it but don't fail the user request.
        # The processing page will show "failed" after polling times out.
        logger.error(
            f"[Upload] QStash enqueue failed for report_id={report_id!r}. "
            "The report was saved but Gemini extraction will not run automatically."
        )
        # Optionally mark as failed immediately so the user sees a clear error:
        # report_ref.update({"status": "failed", "error": "Job queue unavailable"})
 
    # ── Step 4: Return immediately — user goes to the polling page ────────────
    return jsonify({
        "redirect":    f"/ngo/upload/processing/{report_id}",
        "report_id":   report_id,
        "needs_count": 0,   # real count arrives after Gemini finishes
    })
 
 
@app.route("/ngo/reports")
def ngo_reports_page():
    if not session.get("user"):
        return redirect("/getstarted")
    if session["user"].get("role") != "ngo":
        return redirect("/select-role")
    return render_template("ngo_field_reports.html", user=session["user"])
 
 
@app.route("/ngo/upload/processing/<report_id>")
def ngo_upload_processing_page(report_id):
    if not session.get("user"):
        return redirect("/getstarted")
    return render_template("ngo_upload_processing.html",
                           report_id=report_id, user=session["user"])
 
 
@app.route("/ngo/upload/review/<report_id>")
def ngo_upload_review_page(report_id):
    if not session.get("user"):
        return redirect("/getstarted")
    return render_template("ngo_review_needs.html",
                           report_id=report_id, user=session["user"])
 





# ══════════════════════════════════════════════════════════════
# API — FIELD REPORTS LIST
# ══════════════════════════════════════════════════════════════
 
@app.route("/api/ngo/reports")
def api_ngo_reports():
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
 
    uid = session["user"]["uid"]
 
    docs=firebase_services.get_reports_by_uid(uid)
 
    reports   = []
    total     = 0
    processing = 0
    needs_created = 0
 
    for doc in docs:
        d          = doc.to_dict()
        d["id"]    = doc.id
        # Derive a clean file name from image_url if file_name not stored
        if not d.get("file_name") and d.get("image_url"):
            url_parts = d["image_url"].split("/")
            d["file_name"] = url_parts[-1].split("?")[0] if url_parts else "report"
        reports.append(d)
        total += 1
        if d.get("status") == "processing":
            processing += 1
        if d.get("needs_count"):
            needs_created += d["needs_count"]
 
    return jsonify({
        "reports":       reports,
        "total":         total,
        "processing":    processing,
        "needs_created": needs_created,
    })


# ══════════════════════════════════════════════════════════════
# API — SINGLE REPORT STATUS  (polled by processing page)
# ══════════════════════════════════════════════════════════════
 
@app.route("/api/ngo/report/<report_id>/status")
def api_report_status(report_id):
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
 
    uid = session["user"]["uid"]
 
    doc = firebase_services.get_report_by_report_id(report_id)
    if not doc.exists:
        return jsonify({"error": "Not found"}), 404
 
    d = doc.to_dict()
    if d.get("ngo_id") != uid:
        return jsonify({"error": "Forbidden"}), 403
 
    # Count draft needs for this report
    needs_docs = firebase_services.get_draft_needs_for_report(report_id)
    needs_count = sum(1 for _ in needs_docs)
 
    # Derive file name
    file_name = d.get("file_name") or (d.get("image_url","").split("/")[-1].split("?")[0])
 
    return jsonify({
        "status":      d.get("status", "processing"),
        "file_name":   file_name,
        "needs_count": needs_count,
        "processed":   d.get("processed", False),
    })
 
 
# ══════════════════════════════════════════════════════════════
# API — NEEDS FOR REVIEW  (review page loads these)
# ══════════════════════════════════════════════════════════════
 
@app.route("/api/ngo/report/<report_id>/needs")
def api_report_needs(report_id):
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
 
    uid = session["user"]["uid"]
 
    # Verify ownership
    report_doc = firebase_services.get_report_by_report_id(report_id)
    if not report_doc.exists or report_doc.to_dict().get("ngo_id") != uid:
        return jsonify({"error": "Forbidden"}), 403
 
    report = report_doc.to_dict()
 
    needs_docs = firebase_services.get_needs_for_report(report_id)
 
    needs = []
    for doc in needs_docs:
        d = doc.to_dict()
        d["id"] = doc.id
        needs.append(d)
 
    file_name = report.get("file_name") or (report.get("image_url","").split("/")[-1].split("?")[0])
 
    return jsonify({
        "needs":     needs,
        "file_name": file_name,
        "report_id": report_id,
    })
 

 
# ══════════════════════════════════════════════════════════════
# API — PUBLISH REVIEWED NEEDS
# Called from review page "Confirm & Post All Needs" button
# ══════════════════════════════════════════════════════════════
 
 
@app.route("/api/ngo/report/<report_id>/publish", methods=["POST"])
def api_report_publish(report_id):
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
 
    uid  = session["user"]["uid"]
    data = request.get_json() or {}
    needs_to_publish = data.get("needs", [])
 
    # Verify the NGO owns this report
    report_doc = firebase_services.get_report_by_report_id(report_id)
    if not report_doc.exists or report_doc.to_dict().get("ngo_id") != uid:
        return jsonify({"error": "Forbidden"}), 403
 
    from services.geocoding_service import geocode_location_safe
 
    published_ids = []
 
    for need_data in needs_to_publish:
        need_id = need_data.get("id")
        if not need_id:
            continue
 
        # ── Resolve location ─────────────────────────────────────────
        # The review page sends location as:
        #   { city, lat, lng }  — if the NGO did NOT edit the field
        #   "plain string"      — if the NGO typed a new/edited location
        raw_loc = need_data.get("location", "")
        if isinstance(raw_loc, dict) and raw_loc.get("lat") and raw_loc.get("lng"):
            # Already a geocoded dict — use as-is
            location = raw_loc
        elif isinstance(raw_loc, dict):
            # Dict but missing coords (e.g. fallback from geocoding_safe)
            # Try re-geocoding using the city text
            city_text = raw_loc.get("city", "")
            location  = geocode_location_safe(city_text) if city_text else raw_loc
        elif raw_loc and str(raw_loc).strip():
            # NGO edited the location field → re-geocode
            location = geocode_location_safe(str(raw_loc).strip())
        else:
            location = {"city": "", "lat": None, "lng": None}
 
        update = {
            "title":            need_data.get("title", ""),
            "description":      need_data.get("description", ""),
            "category":         need_data.get("category", "Other"),
            "urgency_score":    need_data.get("urgency_score", 5),
            "urgency_label":    need_data.get("urgency_label", "MEDIUM"),
            "required_skills":  need_data.get("required_skills", []),
            "location":         location,           # always { city, lat, lng }
            "estimated_people": need_data.get("estimated_people"),
            "status":           "open",
            "updated_at":       firestore.SERVER_TIMESTAMP,
        }
        firebase_services.update_need(need_id, update)
        published_ids.append(need_id)
 
        # ── Enqueue AI matching ───────────────────────────────────────
        need_payload = {
            **update,
            "ngo_id":     uid,
            "created_at": None,
        }
        enqueued = qstash_service.enqueue_matching(
            need_id   = need_id,
            need_data = need_payload,
        )
        if not enqueued:
            logger.error(
                f"[Publish] QStash enqueue failed for matching need_id={need_id!r}."
            )
 
    firebase_services.log_activity(
        uid,
        "created",
        f"{len(published_ids)} need{'s' if len(published_ids) != 1 else ''} published",
        "AI matching in progress…"
    )
 
    return jsonify({"success": True, "published": len(published_ids)})
 

# ══════════════════════════════════════════════
# API — MANUAL NEED CREATION
# ══════════════════════════════════════════════

@app.route("/api/ngo/need/create", methods=["POST"])
def api_create_need():
    """
    Manual need creation from the dashboard modal.
    Same as before but uses QStash instead of threading for matching.
    """
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
 
    uid  = session["user"]["uid"]
    data = request.get_json() or {}
 
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
        "created_at":       firestore.SERVER_TIMESTAMP,
    }
 
    need_id = firebase_services.create_need(need)
 
    # Enqueue matching via QStash (no threading)
    need_payload = {**need, "created_at": None}   # strip SERVER_TIMESTAMP sentinel
    enqueued = qstash_service.enqueue_matching(need_id=need_id, need_data=need_payload)
 
    if not enqueued:
        logger.error(f"[CreateNeed] QStash enqueue failed for need_id={need_id!r}")
 
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

# ══════════════════════════════════════════════
# NGO NEEDS PAGE
# ══════════════════════════════════════════════
 
@app.route("/ngo/needs")
def ngo_needs_page():
    if not session.get("user"):
        return redirect("/getstarted")
    if session["user"].get("role") != "ngo":
        return redirect("/select-role")
    return render_template("ngo_needs_list.html", user=session["user"])


# ══════════════════════════════════════════════

@app.route("/volunteer/onboarding", methods=["GET", "POST"])
def volunteer_onboarding():
    if not session.get("user"):
        return redirect("/getstarted")

    # ── GET → show form ──
    if request.method == "GET":
        return render_template("volunteer_onboarding.html", user=session["user"])

    # ── POST → save data ──
    uid = session["user"]["uid"]

    name         = request.form.get("name",         "").strip()
    phone        = request.form.get("phone",        "").strip()
    about        = request.form.get("about",        "").strip()
    availability = request.form.get("availability", "Anytime").strip()
    radius       = request.form.get("radius",       "10")
    latitude     = request.form.get("latitude",     "0")
    longitude    = request.form.get("longitude",    "0")

    # Skills come as JSON string: '["First Aid","Teaching"]'
    import json as _json
    try:
        skills = _json.loads(request.form.get("skills", "[]"))
    except Exception:
        skills = []

    # Server-side validation
    if not name:
        return jsonify({"error": "Name is required."}), 400
    if not skills:
        return jsonify({"error": "Please select at least one skill."}), 400

    # Handle profile photo upload
    photo_url = session["user"].get("photo_url", "")
    photo = request.files.get("photo")
    if photo and photo.filename:
        result = imagekit_services.upload_volunteer_avatar(uid, photo)
        if result:
            photo_url = result.get("url", photo_url)

    # Build volunteer profile data
    volunteer_data = {
        "name":         name,
        "phone":        phone,
        "about":        about,
        "skills":       skills,
        "availability": availability,
        "radius":       int(radius),
        "location": {
            "lat": float(latitude),
            "lng": float(longitude),
        },
        "photo_url":    photo_url,
        "online":       True,
    }

    # Save to Firestore
    firebase_services.create_volunteer_profile(uid, volunteer_data)

    # Update session
    session["user"]["name"]      = name
    session["user"]["photo_url"] = photo_url
    session["user"]["onboarded"] = True
    session.modified = True

    return jsonify({"redirect": "/volunteer/dashboard"})


# ══════════════════════════════════════════════
# VOLUNTEER DASHBOARD — PAGE
# ══════════════════════════════════════════════

@app.route("/volunteer/dashboard")
def volunteer_dashboard():
    if not session.get("user"):
        return redirect("/getstarted")
    if session["user"].get("role") != "volunteer":
        return redirect("/select-role")
    return render_template("volunteer_dashboard.html", user=session["user"])


# ══════════════════════════════════════════════
# VOLUNTEER DASHBOARD — API DATA
# ══════════════════════════════════════════════

@app.route("/api/volunteer/dashboard")
def api_volunteer_dashboard():
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401

    uid = session["user"]["uid"]

    # Get volunteer profile
    vol = firebase_services.get_volunteer_profile(uid)

    # Stats
    all_matches = firebase_services.get_matches_for_volunteer(uid)

    matched_tasks  = [m for m in all_matches if m.get("status") == "suggested"]
    accepted_tasks = [m for m in all_matches
                      if m.get("status") in ("accepted", "in_progress")]
    completed      = [m for m in all_matches if m.get("status") == "completed"]

    stats = {
        "tasks_matched":   len(matched_tasks) + len(accepted_tasks),
        "tasks_completed": len(completed),
        "rating":          vol.get("rating", 0) if vol else 0
    }

    # Enrich matched tasks with need details
    enriched_matched  = firebase_services.enrich_tasks_with_needs(
        matched_tasks, uid
    )
    enriched_accepted = firebase_services.enrich_tasks_with_needs(
        accepted_tasks, uid
    )

    return jsonify({
        "volunteer_name": vol.get("name", session["user"].get("name", "Volunteer"))
                          if vol else session["user"].get("name", "Volunteer"),
        "stats":          stats,
        "matched_tasks":  enriched_matched,
        "accepted_tasks": enriched_accepted,
    })


# ══════════════════════════════════════════════
# TASK ACTIONS
# ══════════════════════════════════════════════

@app.route("/api/volunteer/task/<task_id>/accept", methods=["POST"])
def api_volunteer_accept_task(task_id):
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401

    uid = session["user"]["uid"]
    firebase_services.volunteer_respond_to_match(task_id, uid, "accepted")
    return jsonify({"success": True})


@app.route("/api/volunteer/task/<task_id>/decline", methods=["POST"])
def api_volunteer_decline_task(task_id):
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401

    uid = session["user"]["uid"]
    firebase_services.volunteer_respond_to_match(task_id, uid, "declined")
    return jsonify({"success": True})


@app.route("/api/volunteer/task/<task_id>/complete", methods=["POST"])
def api_volunteer_complete_task(task_id):
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401

    uid  = session["user"]["uid"]
    data = request.json or {}

    # Handle proof photo upload if provided
    proof_url = None
    proof = request.files.get("proof")
    if proof and proof.filename:
        result = imagekit_services.upload_task_proof(uid, task_id, proof)
        if result:
            proof_url = result.get("url")

    firebase_services.volunteer_complete_task(task_id, uid, proof_url)
    return jsonify({"success": True})


# ══════════════════════════════════════════════
# VOLUNTEER ONLINE STATUS
# ══════════════════════════════════════════════

@app.route("/api/volunteer/status", methods=["POST"])
def api_volunteer_status():
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401

    uid    = session["user"]["uid"]
    online = request.json.get("online", True)
    firebase_services.update_volunteer_online(uid, online)
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

 
# ═════════════════════════════════════════════════════════════════════════════
# SHARED — signature guard
# ═════════════════════════════════════════════════════════════════════════════
 
def _verify_or_abort():
    # Check for the custom secret header
    secret = request.headers.get("X-QStash-Secret")
    if secret != os.environ.get("QSTASH_SECRET"):
        return jsonify({"error": "Unauthorized"}), 401
    return None
 
 
# ═════════════════════════════════════════════════════════════════════════════
# WORKER 1 — Report Processing  (Gemini extraction)
# Called by QStash ~2 seconds after the user uploads a file
# ═════════════════════════════════════════════════════════════════════════════
 
@app.route("/api/internal/process-report", methods=["POST"])
def worker_process_report():
    """
    Payload from QStash (set by qstash_service.enqueue_report_processing):
    {
        "report_id":  "abc123",
        "ngo_uid":    "uid_of_ngo",
        "image_url":  "https://ik.imagekit.io/...",
        "file_name":  "community_survey.pdf"
        "file_type":  "PDF"
    }
    """
    # ── 1. Verify signature ───────────────────────────────────────────────────
    guard = _verify_or_abort()
    if guard:
        return guard
 
    # ── 2. Parse payload ──────────────────────────────────────────────────────
    data = request.get_json(force=True) or {}
 
    report_id = data.get("report_id")
    ngo_uid   = data.get("ngo_uid")
    image_url = data.get("image_url")
    file_name = data.get("file_name", "report")
    file_type = data.get("file_type", "")
 
    if not report_id or not ngo_uid or not image_url:
        logger.error(f"[Worker:process-report] Missing fields: {data}")
        # Return 400 — QStash will NOT retry 4xx responses by default
        return jsonify({"error": "Missing required fields"}), 400
 
    logger.info(f"[Worker:process-report] Starting — report_id={report_id!r}")
 
 
    # ── 3. Sanity check — report still exists and is still "processing" ───────
    
    report_doc = firebase_services.get_report_by_report_id(report_id)
 
    if not report_doc.exists:
        logger.warning(f"[Worker:process-report] Report {report_id!r} not found — skipping.")
        return jsonify({"ok": True, "skipped": "not_found"}), 200
 
    current_status = report_doc.to_dict().get("status")
    if current_status not in ("processing", None):
        logger.info(f"[Worker:process-report] Already {current_status!r} — skipping.")
        return jsonify({"ok": True, "skipped": "already_done"}), 200
 
    # ── 4. Run Gemini extraction ───────────────────────────────────────────────
    try:
        needs = gemini_service.extract_needs_from_url(image_url, file_type=file_type)
        logger.info(f"[Worker:process-report] Gemini found {len(needs)} needs.")
 
        firebase_services.save_extracted_needs_draft(ngo_uid, report_id, needs)
 
        firebase_services.update_report_status(report_id, {
            "processed":   True,
            "status":      "processed",
            "needs_count": len(needs),
        })
 
        firebase_services.log_activity(
            ngo_uid,
            "created",
            f"Report processed — {len(needs)} need{'s' if len(needs) != 1 else ''} found",
            f"From: {file_name}"
        )
 
        logger.info(f"[Worker:process-report] Done — report_id={report_id!r}")
        return jsonify({"ok": True, "needs_count": len(needs)}), 200
 
    except Exception as exc:
        logger.error(f"[Worker:process-report] Failed — {exc}", exc_info=True)
 
        # ── FIXED: use firebase_services, not undefined report_ref ──
        # Also: 429 quota errors now reach here (not swallowed in gemini_service)
        # so QStash will retry this job automatically after backoff.
        firebase_services.update_report_status(report_id, {
            "status": "failed",
            "error":  str(exc)[:500],
        })
 
        # Return 500 → QStash retries (up to the retry count set at enqueue time)
        return jsonify({"error": str(exc)}), 500
 
 
# ═════════════════════════════════════════════════════════════════════════════
# WORKER 2 — Volunteer Matching  (AI matching engine)
# Called by QStash ~3 seconds after a need is published
# ═════════════════════════════════════════════════════════════════════════════
 
@app.route("/api/internal/run-matching", methods=["POST"])
def worker_run_matching():
    """
    Payload from QStash (set by qstash_service.enqueue_matching):
    {
        "need_id":   "xyz789",
        "need_data": { ...full need dict... }
    }
    """
    # ── 1. Verify signature ───────────────────────────────────────────────────
    guard = _verify_or_abort()
    if guard:
        return guard
 
    # ── 2. Parse payload ──────────────────────────────────────────────────────
    data      = request.get_json(force=True) or {}
    need_id   = data.get("need_id")
    need_data = data.get("need_data", {})
 
    if not need_id:
        logger.error(f"[Worker:run-matching] Missing need_id in payload: {data}")
        return jsonify({"error": "Missing need_id"}), 400
 
    logger.info(f"[Worker:run-matching] Starting — need_id={need_id!r}")
 
 
    # ── 3. Re-fetch the need from Firestore ───────────────────────────────────
    # The payload may be slightly stale — always use the freshest data.
    need_doc = firebase_services.get_need_by_need_id(need_id)
 
    if not need_doc.exists:
        logger.warning(f"[Worker:run-matching] Need {need_id!r} not found — skipping.")
        return jsonify({"ok": True, "skipped": "need_not_found"}), 200
 
    fresh_need = need_doc.to_dict()
    fresh_need["_id"] = need_id  # convenience
 
    # Merge: use fresh Firestore data, fall back to payload for any missing fields
    merged_need = {**need_data, **fresh_need}
 
    # ── 4. Run the AI matching engine ─────────────────────────────────────────
    try:
        from services.matching_service import run_matching_for_need
        match_ids = run_matching_for_need(need_id, merged_need)
 
        logger.info(
            f"[Worker:run-matching] Done — need_id={need_id!r} "
            f"matches_created={len(match_ids)}"
        )
        return jsonify({"ok": True, "matches_created": len(match_ids)}), 200
 
    except Exception as exc:
        logger.error(f"[Worker:run-matching] Failed — {exc}", exc_info=True)
        # Return 500 → QStash will retry
        return jsonify({"error": str(exc)}), 500



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

@app.route("/api/get_ola_maps_key",methods=["GET"])
def get_ola_maps_key():
    return jsonify({
        "OLA_MAPS_API_KEY": os.environ.get("OLA_MAPS_API_KEY")
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
