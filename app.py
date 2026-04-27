from flask import Flask, render_template, request, redirect, url_for, session, jsonify, send_from_directory
from firebase_admin import auth, credentials
import firebase_admin
import os,logging
import json
from firebase_admin import firestore
from datetime import datetime, timezone
import math
from services import imagekit_services,firebase_services,gemini_service,matching_service,qstash_service,notification_service



app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "super-secret-key-change-in-prod")
from datetime import timedelta
app.permanent_session_lifetime = timedelta(days=30)

from flask_socketio import SocketIO, join_room, leave_room, emit
# Vercel serverless does NOT support WebSockets (no persistent connections).
# Force polling transport so Socket.IO works correctly on Vercel.
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    manage_session=True,
    async_mode="threading",
    transports=["polling"],
)
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

@app.route("/firebase-messaging-sw.js")
def serve_sw():
    return send_from_directory(app.static_folder, "firebase-messaging-sw.js", mimetype="application/javascript")

@app.route("/ngo/dashboard")
def ngo_dashboard():
    if not session.get("user"):
        return redirect("/getstarted")
    if session["user"].get("role") != "ngo":
        return redirect("/select-role")
    return render_template("ngo_dashboard.html", user=session["user"])

@app.route("/need/<need_id>/<role>")
def need_details(need_id, role):
    if not session.get("user"):
        return redirect("/getstarted")
    
    need = firebase_services.get_need_by_id(need_id)
    if not need:
        return "Need not found", 404

    # Check if NGO is verified
    ngo_id = need.get("ngo_id")
    if ngo_id:
        ngo_profile = firebase_services.get_ngo_profile(ngo_id)
        need["ngo_verified"] = ngo_profile.get("verified", False)
    else:
        need["ngo_verified"] = False
        
    return render_template("ngo&volunteerdetails.html", 
                           need=need, 
                           role=role, 
                           user=session["user"])


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
    # Exclude soft-deleted needs from all stats and recent lists
    all_needs = [n for n in all_needs if n.get("status") != "deleted"]


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
    enqueued = qstash_service.enqueue_report_processing(
        report_id = report_id,
        ngo_uid   = uid,
        image_url = image_url,
        file_name = file.filename,
        file_type = ext.lstrip(".").upper(),
    )
 
    if not enqueued:
        logger.error(
            f"[Upload] QStash enqueue failed for report_id={report_id!r}. "
            "The report was saved but Gemini extraction will not run automatically."
        )
 
    # ── Step 4: Return immediately — user goes to the polling page ────────────
    return jsonify({
        "redirect":    f"/ngo/upload/processing/{report_id}",
        "report_id":   report_id,
        "needs_count": 0,
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
 
    needs_docs = firebase_services.get_draft_needs_for_report(report_id)
    needs_count = sum(1 for _ in needs_docs)
 
    file_name = d.get("file_name") or (d.get("image_url","").split("/")[-1].split("?")[0])
 
    return jsonify({
        "status":      d.get("status", "processing"),
        "file_name":   file_name,
        "needs_count": needs_count,
        "processed":   d.get("processed", False),
    })
 
 
# ══════════════════════════════════════════════════════════════
# API — NEEDS FOR REVIEW
# ══════════════════════════════════════════════════════════════
 
@app.route("/api/ngo/report/<report_id>/needs")
def api_report_needs(report_id):
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
 
    uid = session["user"]["uid"]
 
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
 

@app.route("/api/ngo/report/<report_id>/publish", methods=["POST"])
def api_report_publish(report_id):
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
 
    uid  = session["user"]["uid"]
    data = request.get_json() or {}
    needs_to_publish = data.get("needs", [])
 
    report_doc = firebase_services.get_report_by_report_id(report_id)
    if not report_doc.exists or report_doc.to_dict().get("ngo_id") != uid:
        return jsonify({"error": "Forbidden"}), 403
 
    from services.geocoding_service import geocode_location_safe
 
    published_ids = []
 
    for need_data in needs_to_publish:
        need_id = need_data.get("id")
        if not need_id:
            continue
 
        raw_loc = need_data.get("location", "")
        if isinstance(raw_loc, dict) and raw_loc.get("lat") and raw_loc.get("lng"):
            location = raw_loc
        elif isinstance(raw_loc, dict):
            city_text = raw_loc.get("city", "")
            location  = geocode_location_safe(city_text) if city_text else raw_loc
        elif raw_loc and str(raw_loc).strip():
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
            "location":         location,
            "estimated_people": need_data.get("estimated_people"),
            "status":           "open",
            "updated_at":       firestore.SERVER_TIMESTAMP,
        }
        firebase_services.update_need(need_id, update)
        published_ids.append(need_id)
 
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
 
    need_payload = {**need, "created_at": None}
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


@app.route("/api/ngo/needs")
def api_ngo_needs():
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401

    uid = session["user"]["uid"]
    all_needs = firebase_services.get_needs_by_ngo(uid)
    all_needs = [n for n in all_needs if n.get("status") != "deleted"]

    for need in all_needs:
        ts = need.get("created_at")
        if ts and hasattr(ts, "timestamp"):
            need["created_at"] = ts.timestamp()
        ts2 = need.get("updated_at")
        if ts2 and hasattr(ts2, "timestamp"):
            need["updated_at"] = ts2.timestamp()

    return jsonify({"needs": all_needs})


@app.route("/api/ngo/need/<need_id>", methods=["DELETE"])
def api_delete_need(need_id):
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401

    uid = session["user"]["uid"]

    need = firebase_services.get_need_by_id(need_id)
    if not need:
        return jsonify({"error": "Not found"}), 404
    if need.get("ngo_id") != uid:
        return jsonify({"error": "Forbidden"}), 403

    firebase_services.update_need(need_id, {
        "status": "deleted",
        "updated_at": firestore.SERVER_TIMESTAMP,
    })

    return jsonify({"success": True})

# ══════════════════════════════════════════════

@app.route("/volunteer/onboarding", methods=["GET", "POST"])
def volunteer_onboarding():
    if not session.get("user"):
        return redirect("/getstarted")

    if request.method == "GET":
        return render_template("volunteer_onboarding.html", user=session["user"])

    uid = session["user"]["uid"]

    name         = request.form.get("name",         "").strip()
    phone        = request.form.get("phone",        "").strip()
    about        = request.form.get("about",        "").strip()
    availability = request.form.get("availability", "Anytime").strip()
    radius       = request.form.get("radius",       "10")
    latitude     = request.form.get("latitude",     "0")
    longitude    = request.form.get("longitude",    "0")

    import json as _json
    try:
        skills = _json.loads(request.form.get("skills", "[]"))
    except Exception:
        skills = []

    if not name:
        return jsonify({"error": "Name is required."}), 400
    if not skills:
        return jsonify({"error": "Please select at least one skill."}), 400

    photo_url = session["user"].get("photo_url", "")
    photo = request.files.get("photo")
    if photo and photo.filename:
        result = imagekit_services.upload_volunteer_avatar(uid, photo)
        if result:
            photo_url = result.get("url", photo_url)

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

    firebase_services.create_volunteer_profile(uid, volunteer_data)

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


@app.route("/api/volunteer/dashboard")
def api_volunteer_dashboard():
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401

    uid = session["user"]["uid"]

    vol = firebase_services.get_volunteer_profile(uid)

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

    proof_url = None
    proof = request.files.get("proof")
    if proof and proof.filename:
        result = imagekit_services.upload_task_proof(uid, task_id, proof)
        if result:
            proof_url = result.get("url")

    firebase_services.volunteer_complete_task(task_id, uid, proof_url)
    return jsonify({"success": True})


# ══════════════════════════════════════════════
# VOLUNTEER WORK TRACKING
# ══════════════════════════════════════════════

@app.route("/api/volunteer/work/start", methods=["POST"])
def api_volunteer_work_start():
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
    
    uid  = session["user"]["uid"]
    data = request.json or {}
    task_id = data.get("task_id")  # this is the match_id
    
    if not task_id:
        return jsonify({"error": "Task ID required"}), 400
        
    firebase_services.start_work_session(task_id, uid)
    return jsonify({"success": True})


@app.route("/api/volunteer/work/pause", methods=["POST"])
def api_volunteer_work_pause():
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
    
    uid  = session["user"]["uid"]
    data = request.json or {}
    task_id     = data.get("task_id")
    comment     = data.get("comment", "")
    duration_ms = data.get("duration_ms", 0)
    
    if not task_id:
        return jsonify({"error": "Task ID required"}), 400
        
    firebase_services.pause_work_session(task_id, uid, comment, duration_ms)
    return jsonify({"success": True})


@app.route("/api/volunteer/work/location", methods=["POST"])
def api_volunteer_work_location():
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
    
    uid  = session["user"]["uid"]
    data = request.json or {}
    task_id = data.get("task_id")
    lat     = data.get("lat")
    lng     = data.get("lng")
    
    if not task_id or lat is None or lng is None:
        return jsonify({"error": "Missing params"}), 400
        
    firebase_services.update_task_location(task_id, uid, lat, lng)
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
    if session.get("user"):
        role = session["user"].get("role")
        if role == "ngo":
            return redirect("/ngo/dashboard")
        elif role == "volunteer":
            return redirect("/volunteer/dashboard")
        else:
            return redirect("/select-role")

    role = request.args.get("role")
    return render_template("login.html", intended_role=role)


# ======================
# Firebase Auth Endpoint
# ======================

@app.route("/firebase-login", methods=["POST"])
def firebase_login():
    data       = request.json
    id_token   = data.get("idToken")
    intended_role = data.get("intendedRole")

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

    doc = firebase_services.get_user_by_uid(uid)

    if not doc:
        firebase_services.add_user(uid, email, name, photo, role=intended_role)

        role_to_save = intended_role

        session["user"] = {
            "uid":      uid,
            "name":     name,
            "photo_url": photo,
            "email":    email,
            "role":     role_to_save
        }
        session.permanent = True

        if role_to_save == "ngo":
            return jsonify({"status": "new", "redirect": "/ngo/onboarding"})
        elif role_to_save == "volunteer":
            return jsonify({"status": "new", "redirect": "/volunteer/onboarding"})
        else:
            return jsonify({"status": "new", "redirect": "/select-role"})

    role = doc.get("role")

    session["user"] = {
        "uid":      uid,
        "name":     name,
        "photo_url": photo,
        "email":    email,
        "role":     role
    }
    session.permanent = True

    if role == "ngo":
        return jsonify({"status": "existing", "redirect": "/ngo/dashboard"})
    elif role == "volunteer":
        return jsonify({"status": "existing", "redirect": "/volunteer/dashboard"})
    elif role == "admin":
        return jsonify({"status": "existing", "redirect": "/admin/dashboard"})
    else:
        return jsonify({"status": "existing", "redirect": "/select-role"})


# ======================
# Role Selection
# ======================

@app.route("/select-role")
def select_role_page():
    if not session.get("user"):
        return redirect("/getstarted")
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

    if not session.get("user"):
        return redirect("/getstarted")

    if request.method == "GET":
        return render_template("ngo_onboarding.html", user=session["user"])

    uid = session["user"]["uid"]

    org_name      = request.form.get("org_name", "").strip()
    description   = request.form.get("description", "").strip()
    contact_email = request.form.get("contact_email", "").strip()
    phone         = request.form.get("phone", "").strip()
    address       = request.form.get("address", "").strip()
    city          = request.form.get("city", "").strip()
    latitude      = request.form.get("latitude", "0")
    longitude     = request.form.get("longitude", "0")

    if not org_name or not description or not contact_email or not city:
        return jsonify({"error": "Please fill in all required fields."}), 400

    logo_url = None
    logo = request.files.get("logo")
    if logo and logo.filename:
        result   = imagekit_services.upload_ngo_logo(uid, logo)
        logo_url = result

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

    firebase_services.create_ngo_profile(uid, ngo_data)

    session["user"]["city"]     = city
    session["user"]["onboarded"] = True
    session.modified = True

    return jsonify({"redirect": "/ngo/dashboard"})

 
# ═════════════════════════════════════════════════════════════════════════════
# SHARED — signature guard
# ═════════════════════════════════════════════════════════════════════════════
 
def _verify_or_abort():
    secret = request.headers.get("X-QStash-Secret")
    if secret != os.environ.get("QSTASH_SECRET"):
        return jsonify({"error": "Unauthorized"}), 401
    return None
 
 
# ═════════════════════════════════════════════════════════════════════════════
# WORKER 1 — Report Processing
# ═════════════════════════════════════════════════════════════════════════════
 
@app.route("/api/internal/process-report", methods=["POST"])
def worker_process_report():
    guard = _verify_or_abort()
    if guard:
        return guard
 
    data = request.get_json(force=True) or {}
 
    report_id = data.get("report_id")
    ngo_uid   = data.get("ngo_uid")
    image_url = data.get("image_url")
    file_name = data.get("file_name", "report")
    file_type = data.get("file_type", "")
 
    if not report_id or not ngo_uid or not image_url:
        logger.error(f"[Worker:process-report] Missing fields: {data}")
        return jsonify({"error": "Missing required fields"}), 400
 
    logger.info(f"[Worker:process-report] Starting — report_id={report_id!r}")
 
    report_doc = firebase_services.get_report_by_report_id(report_id)
 
    if not report_doc.exists:
        logger.warning(f"[Worker:process-report] Report {report_id!r} not found — skipping.")
        return jsonify({"ok": True, "skipped": "not_found"}), 200
 
    current_status = report_doc.to_dict().get("status")
    if current_status not in ("processing", None):
        logger.info(f"[Worker:process-report] Already {current_status!r} — skipping.")
        return jsonify({"ok": True, "skipped": "already_done"}), 200
 
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
 
        firebase_services.update_report_status(report_id, {
            "status": "failed",
            "error":  str(exc)[:500],
        })
 
        return jsonify({"error": str(exc)}), 500
 
 
# ═════════════════════════════════════════════════════════════════════════════
# WORKER 2 — Volunteer Matching
# ═════════════════════════════════════════════════════════════════════════════
 
@app.route("/api/internal/run-matching", methods=["POST"])
def worker_run_matching():
    guard = _verify_or_abort()
    if guard:
        return guard
 
    data      = request.get_json(force=True) or {}
    need_id   = data.get("need_id")
    need_data = data.get("need_data", {})
 
    if not need_id:
        logger.error(f"[Worker:run-matching] Missing need_id in payload: {data}")
        return jsonify({"error": "Missing need_id"}), 400
 
    logger.info(f"[Worker:run-matching] Starting — need_id={need_id!r}")
 
    need_doc = firebase_services.get_need_by_need_id(need_id)
 
    if not need_doc.exists:
        logger.warning(f"[Worker:run-matching] Need {need_id!r} not found — skipping.")
        return jsonify({"ok": True, "skipped": "need_not_found"}), 200
 
    fresh_need = need_doc.to_dict()
    fresh_need["_id"] = need_id
    if fresh_need.get("status") == "deleted":
        logger.info(f"[Worker:run-matching] Need {need_id!r} is deleted — skipping.")
        return jsonify({"ok": True, "skipped": "need_deleted"}), 200
 
    merged_need = {**need_data, **fresh_need}
 
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
        return jsonify({"error": str(exc)}), 500

# ══════════════════════════════════════════════
# NEW ROUTES — paste these into app.py
# ══════════════════════════════════════════════

# ── GET /api/need/<need_id>  (JSON detail for details page) ──

@app.route("/api/need/<need_id>")
def api_need_detail(need_id):
    """
    Returns full need data + assigned volunteer profile (if any).
    Used by the ngo&volunteerdetails page JS.
    """
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401

    need = firebase_services.get_need_by_id(need_id)
    if not need:
        return jsonify({"error": "Not found"}), 404

    # Serialize Firestore timestamps
    for field in ("created_at", "updated_at"):
        ts = need.get(field)
        if ts and hasattr(ts, "timestamp"):
            need[field] = ts.timestamp()

    # Fetch assigned volunteer details if present
    assigned_volunteer = None
    vol_id = need.get("assigned_volunteer_id")
    if vol_id:
        vol = firebase_services.get_volunteer_profile(vol_id)
        if vol:
            assigned_volunteer = {
                "uid":       vol_id,
                "name":      vol.get("name", "Volunteer"),
                "photo_url": vol.get("photo_url", ""),
                "skills":    vol.get("skills", []),
                "rating":    vol.get("rating", 0),
                "phone":     vol.get("phone", ""),
            }

    ngo_id = need.get("ngo_id")
    if ngo_id:
        ngo_profile = firebase_services.get_ngo_profile(ngo_id)
        need["ngo_verified"] = ngo_profile.get("verified", False)
    else:
        need["ngo_verified"] = False

    return jsonify({
        "need":               need,
        "assigned_volunteer": assigned_volunteer,
    })


# ── POST /api/ngo/need/<need_id>/unassign ──

@app.route("/api/ngo/need/<need_id>/unassign", methods=["POST"])
def api_unassign_need(need_id):
    """
    NGO unassigns a volunteer from a need.
    Sets need back to open, marks the match as unassigned, logs activity.
    """
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401

    uid = session["user"]["uid"]

    need = firebase_services.get_need_by_id(need_id)
    if not need:
        return jsonify({"error": "Not found"}), 404
    if need.get("ngo_id") != uid:
        return jsonify({"error": "Forbidden"}), 403

    vol_id = need.get("assigned_volunteer_id")
    if not vol_id:
        return jsonify({"error": "No volunteer assigned"}), 400

    # Reset need to open
    firebase_services.update_need(need_id, {
        "status":                 "open",
        "assigned_volunteer_id":  firestore.DELETE_FIELD,
        "updated_at":             firestore.SERVER_TIMESTAMP,
    })

    # Find and update the accepted match doc
    db = firebase_services.get_db()
    matches = (
        db.collection("matches")
          .where("need_id",      "==", need_id)
          .where("volunteer_id", "==", vol_id)
          .where("status",       "==", "accepted")
          .limit(1)
          .stream()
    )
    for match_doc in matches:
        match_doc.reference.update({
            "status":       "unassigned",
            "unassigned_at": firestore.SERVER_TIMESTAMP,
        })

    # Log activity
    vol_profile = firebase_services.get_volunteer_profile(vol_id)
    vol_name    = vol_profile.get("name", "Volunteer") if vol_profile else "Volunteer"
    need_title  = need.get("title", "")

    firebase_services.log_activity(
        uid,
        "warning",
        f"{vol_name} unassigned from task",
        f'Need: "{need_title}"'
    )

    return jsonify({"success": True})


# ── GET /api/volunteer/match-for-need/<need_id> ──

@app.route("/api/volunteer/match-for-need/<need_id>")
def api_volunteer_match_for_need(need_id):
    """
    Returns the match doc id for the current volunteer + this need.
    Used by the completion form to know which match to mark complete.
    """
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401

    uid = session["user"]["uid"]
    db  = firebase_services.get_db()

    matches = (
        db.collection("matches")
          .where("need_id",      "==", need_id)
          .where("volunteer_id", "==", uid)
          .where("status",       "in", ["accepted", "in_progress"])
          .limit(1)
          .stream()
    )

    for doc in matches:
        return jsonify({"match_id": doc.id, "status": doc.to_dict().get("status")})

    return jsonify({"error": "Match not found"}), 404


# ── GET /volunteer/task/complete/<need_id> ──

@app.route("/volunteer/task/complete/<need_id>")
def volunteer_complete_page(need_id):
    """Completion form page for a volunteer."""
    if not session.get("user"):
        return redirect("/getstarted")
    if session["user"].get("role") != "volunteer":
        return redirect("/select-role")

    need = firebase_services.get_need_by_id(need_id)
    if not need:
        return "Need not found", 404

    return render_template("volunteer_complete.html",
                           need=need,
                           user=session["user"])

# ── Admin dashboard page ──────────────────────────────────────────
@app.route("/admin/dashboard")
def admin_dashboard():
    if not session.get("user") or session["user"].get("role") != "admin":
        return redirect("/getstarted")
    return render_template("admin_dashboard.html")


# ── Admin dashboard data API ──────────────────────────────────────
@app.route("/api/admin/dashboard")
def api_admin_dashboard():
    
    if not session.get("user") or session["user"].get("role") != "admin":
        return jsonify({"error": "Unauthorized"}), 401

    db = firebase_services.get_db()

    # ── 1. All NGOs ───────────────────────────────────────────────
    ngo_docs  = list(db.collection("ngos").stream())
    ngos      = [{"uid": d.id, **d.to_dict()} for d in ngo_docs]

    # ── 2. All Volunteers ─────────────────────────────────────────
    vol_docs  = list(db.collection("volunteers").stream())

    # ── 3. All Needs ─────────────────────────────────────────────
    need_docs = list(db.collection("needs").stream())
    needs     = [d.to_dict() for d in need_docs]

    # ── 4. Stats ──────────────────────────────────────────────────
    open_needs     = [n for n in needs if n.get("status") == "open"]
    resolved_needs = [n for n in needs if n.get("status") == "completed"]
    urgent_needs   = [n for n in needs if n.get("urgency_score", 0) >= 7]

    stats = {
        "total_ngos":        len(ngos),
        "total_volunteers":  len(vol_docs),
        "total_needs":       len(needs),
        "open_needs":        len(open_needs),
        "resolved_needs":    len(resolved_needs),
        "urgent_needs":      len(urgent_needs),
    }

    # ── 5. Recent NGOs (latest 10) ────────────────────────────────
    def _sort_key(n):
        ts = n.get("createdAt")
        if ts and hasattr(ts, "timestamp"):
            return ts.timestamp()
        return 0

    recent_ngos = sorted(ngos, key=_sort_key, reverse=True)[:10]

    # Serialize Firestore timestamps in NGO docs
    for ngo in recent_ngos:
        ts = ngo.get("createdAt")
        if ts and hasattr(ts, "timestamp"):
            ngo["createdAt"] = {"_seconds": int(ts.timestamp())}

    # ── 6. Pending (unverified) NGOs ──────────────────────────────
    pending_ngos = [n for n in ngos if not n.get("verified")]

    for ngo in pending_ngos:
        ts = ngo.get("createdAt")
        if ts and hasattr(ts, "timestamp"):
            ngo["createdAt"] = {"_seconds": int(ts.timestamp())}

    # ── 7. Category breakdown ─────────────────────────────────────
    category_breakdown = {}
    for need in needs:
        if need.get("status") == "deleted":
            continue
        cat = need.get("category", "Other") or "Other"
        category_breakdown[cat] = category_breakdown.get(cat, 0) + 1

    # ── 8. Recent activity (cross-NGO, latest 8) ──────────────────
    activity_items = []
    for ngo in ngos[:15]:                      # cap to avoid too many reads
        ngo_id = ngo.get("uid")
        if not ngo_id:
            continue
        act_docs = (
            db.collection("ngos")
              .document(ngo_id)
              .collection("activity")
              .order_by("created_at", direction=firestore.Query.DESCENDING)
              .limit(3)
              .stream()
        )
        for doc in act_docs:
            d = doc.to_dict()
            d["id"] = doc.id
            d["ngo_name"] = ngo.get("org_name", "")
            ts = d.get("created_at")
            if ts and hasattr(ts, "timestamp"):
                d["created_at"] = {"_seconds": int(ts.timestamp())}
            activity_items.append(d)

    # Sort by timestamp descending, take 8
    def _act_sort(a):
        ts = a.get("created_at")
        if isinstance(ts, dict):
            return ts.get("_seconds", 0)
        return 0

    activity_items.sort(key=_act_sort, reverse=True)
    activity_items = activity_items[:8]

    return jsonify({
        "stats":              stats,
        "recent_ngos":        recent_ngos,
        "pending_ngos":       pending_ngos[:6],
        "category_breakdown": category_breakdown,
        "activity":           activity_items,
    })
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

# ══════════════════════════════════════════════
# API — TOPBAR LAZY DATA
# ══════════════════════════════════════════════

@app.route("/api/user/topbar")
def api_user_topbar():
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
    uid = session["user"]["uid"]
    notif_enabled, fcm_tokens = firebase_services.get_user_notification_state(uid)
    return jsonify({
        "photo_url":             session["user"].get("photo_url", ""),
        "name":                  session["user"].get("name", ""),
        "notifications_enabled": notif_enabled and len(fcm_tokens) > 0,
    })

# ══════════════════════════════════════════════
# API — SAVE/REMOVE FCM TOKEN
# ══════════════════════════════════════════════

@app.route("/api/user/fcm-token", methods=["POST", "DELETE"])
def api_fcm_token_manage():
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
    uid   = session["user"]["uid"]
    token = (request.get_json() or {}).get("token", "").strip()
    if not token:
        return jsonify({"error": "No token provided"}), 400
    
    if request.method == "POST":
        firebase_services.save_fcm_token(uid, token)
    else:
        firebase_services.remove_fcm_token(uid, token)
        
    return jsonify({"success": True})



# ======================
# Auth Check
# ======================

@app.route("/api/check-auth")
def check_auth():
    if session.get("user"):
        return jsonify({"authenticated": True, "user": session["user"]})
    return jsonify({"authenticated": False}), 401


# ══════════════════════════════════════════════
# SOCKET.IO EVENTS
# ══════════════════════════════════════════════

@socketio.on('join')
def on_join(data):
    room = data.get('conversation_id')
    if room:
        join_room(room)
        logger.info(f"Socket: User joined room {room}")

@socketio.on('leave')
def on_leave(data):
    room = data.get('conversation_id')
    if room:
        leave_room(room)

@socketio.on('send_message')
def handle_send_message(data):
    conv_id = data.get('conversation_id')
    text    = data.get('text', '').strip()
    sender_id = data.get('sender_id')
    
    if not conv_id or not text or not sender_id:
        return
        
    msg_id = firebase_services.send_chat_message(conv_id, sender_id, text)
    
    emit('receive_message', {
        'id': msg_id,
        'text': text,
        'sender_id': sender_id,
        'conversation_id': conv_id,
        'created_at': datetime.now(timezone.utc).isoformat()
    }, room=conv_id)

@socketio.on('typing')
def handle_typing(data):
    conv_id = data.get('conversation_id')
    is_typing = data.get('is_typing')
    user_id = data.get('user_id')
    emit('display_typing', {'user_id': user_id, 'is_typing': is_typing}, room=conv_id, include_self=False)

@app.route("/inbox")
def inbox_page():
    if not session.get("user"):
        return redirect("/getstarted")
    return render_template("inbox.html", user=session["user"])

@app.route("/api/chat/conversations")
def api_chat_conversations():
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
    uid = session["user"]["uid"]
    conversations = firebase_services.get_conversations_for_user(uid)
    return jsonify({"conversations": conversations})

@app.route("/api/chat/messages/<conv_id>")
def api_chat_messages(conv_id):
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
    uid = session["user"]["uid"]
    conv = firebase_services.db.collection("conversations").document(conv_id).get()
    if not conv.exists or uid not in conv.to_dict().get("participants", []):
        return jsonify({"error": "Forbidden"}), 403
    
    messages = firebase_services.get_messages_for_conversation(conv_id)
    return jsonify({"messages": messages})

@app.route("/api/chat/send", methods=["POST"])
def api_chat_send():
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
    
    uid  = session["user"]["uid"]
    data = request.get_json() or {}
    conv_id = data.get("conversation_id")
    text    = data.get("text", "").strip()
    
    if not conv_id or not text:
        return jsonify({"error": "Invalid data"}), 400
        
    conv_doc = firebase_services.db.collection("conversations").document(conv_id).get()
    if not conv_doc.exists or uid not in conv_doc.to_dict().get("participants", []):
        return jsonify({"error": "Forbidden"}), 403
        
    msg_id = firebase_services.send_chat_message(conv_id, uid, text)
    return jsonify({"success": True, "message_id": msg_id})

@app.route("/api/chat/start", methods=["POST"])
def api_chat_start():
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
    
    data = request.get_json() or {}
    other_id = data.get("other_uid")
    need_id  = data.get("need_id")
    
    if not other_id:
        return jsonify({"error": "Missing other_uid"}), 400
        
    uid = session["user"]["uid"]
    conv_id = firebase_services.get_or_create_conversation([uid, other_id], need_id)
    return jsonify({"success": True, "conversation_id": conv_id})



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


# ══════════════════════════════════════════════
# ADMIN MANAGEMENT APIs
# ══════════════════════════════════════════════

@app.route("/api/ngos")
def api_get_all_ngos():
    if not session.get("user") or session["user"].get("role") != "admin":
        return jsonify({"error": "Unauthorized"}), 401
    
    db = firebase_services.get_db()
    
    # 1. Fetch all NGOs
    ngo_docs = db.collection("ngos").stream()
    
    # 2. Get counts for needs and matches in a more efficient way
    # Ideally, these are stored on the NGO doc, but if not, let's optimize
    # We'll fetch the IDs and ngo_ids only to minimize data transfer
    needs_docs = db.collection("needs").select(["ngo_id"]).stream()
    matches_docs = db.collection("matches").select(["ngo_id"]).stream()
    
    needs_map = {}
    for doc in needs_docs:
        nid = doc.to_dict().get("ngo_id")
        if nid: needs_map[nid] = needs_map.get(nid, 0) + 1
        
    matches_map = {}
    for doc in matches_docs:
        mid = doc.to_dict().get("ngo_id")
        if mid: matches_map[mid] = matches_map.get(mid, 0) + 1
    
    ngos = []
    for doc in ngo_docs:
        d = doc.to_dict()
        d["id"] = doc.id
        
        # Use existing count or from our optimized maps
        d["needs"] = d.get("needs", needs_map.get(doc.id, 0))
        d["matches"] = d.get("matches", matches_map.get(doc.id, 0))
            
        # Format createdAt
        ts = d.get("createdAt")
        if ts and hasattr(ts, "timestamp"):
            d["joined"] = ts.strftime("%b %d, %Y")
            d["createdAt"] = {"_seconds": int(ts.timestamp())}
        else:
            d["joined"] = "N/A"
            
        d["status"] = "Verified" if d.get("verified") else "Pending"
        ngos.append(d)
        
    return jsonify(ngos)

@app.route("/api/ngos/<id>/verify", methods=["PATCH"])
def api_verify_ngo(id):
    if not session.get("user") or session["user"].get("role") != "admin":
        return jsonify({"error": "Unauthorized"}), 401
    
    db = firebase_services.get_db()
    db.collection("ngos").document(id).update({"verified": True})
    return jsonify({"success": True})

@app.route("/api/ngos/<id>/suspend", methods=["PATCH"])
def api_suspend_ngo(id):
    if not session.get("user") or session["user"].get("role") != "admin":
        return jsonify({"error": "Unauthorized"}), 401
    
    db = firebase_services.get_db()
    db.collection("ngos").document(id).update({"verified": False})
    return jsonify({"success": True})

@app.route("/api/ngos/<id>", methods=["PATCH"])
def api_update_ngo(id):
    if not session.get("user") or session["user"].get("role") != "admin":
        return jsonify({"error": "Unauthorized"}), 401
    
    data = request.json
    db = firebase_services.get_db()
    db.collection("ngos").document(id).update(data)
    return jsonify({"success": True})

@app.route("/api/ngos", methods=["POST"])
def api_register_ngo_manual():
    if not session.get("user") or session["user"].get("role") != "admin":
        return jsonify({"error": "Unauthorized"}), 401
    
    # Handle both JSON and Multipart (from JS FormData)
    if request.is_json:
        data = request.json
    else:
        data = request.form.to_dict()
        
    email = data.get("email")
    # Generate a random password if not provided, or use a default one
    password = data.get("password", "SevaSetu123!") 
    name = data.get("name")
    
    try:
        # 1. Create Firebase Auth user
        user = auth.create_user(
            email=email,
            password=password,
            display_name=name
        )
        uid = user.uid
        
        # 2. Add to 'users' collection
        firebase_services.add_user(uid, email, name, photo_url="", role="ngo")
        
        # 3. Handle file uploads if any
        logo_url = ""
        logo_file = request.files.get("logo")
        if logo_file:
            res = imagekit_services.upload_ngo_logo(uid, logo_file)
            logo_url = res.get("url", "") if res else ""
            
        # 4. Create NGO profile
        ngo_data = {
            "org_name": name,
            "contact_email": email,
            "phone": data.get("phone"),
            "city": data.get("city"),
            "category": data.get("category"),
            "website": data.get("website"),
            "description": data.get("description"),
            "logo_url": logo_url,
            "verified": False,
            "location": {"city": data.get("city"), "lat": None, "lng": None},
            "createdAt": firestore.SERVER_TIMESTAMP
        }
        db = firebase_services.get_db()
        db.collection("ngos").document(uid).set(ngo_data)
        
        return jsonify({"success": True, "uid": uid})
        
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/volunteers")
def api_get_all_volunteers():
    if not session.get("user") or session["user"].get("role") != "admin":
        return jsonify({"error": "Unauthorized"}), 401
    
    db = firebase_services.get_db()
    vol_docs = db.collection("volunteers").stream()
    
    volunteers = []
    for doc in vol_docs:
        d = doc.to_dict()
        d["id"] = doc.id
        
        # Format createdAt
        ts = d.get("createdAt")
        if ts and hasattr(ts, "timestamp"):
            d["joined"] = ts.strftime("%b %Y")
            d["createdAt"] = {"_seconds": int(ts.timestamp())}
        else:
            d["joined"] = "N/A"
            
        d["status"] = "Active" if d.get("verified") else "Pending"
        # Map fields for JS
        d["image"] = d.get("photo_url", "")
        d["tasks"] = d.get("totalTasks", 0)
        
        volunteers.append(d)
        
    return jsonify(volunteers)

@app.route("/api/volunteers/<id>/approve", methods=["PATCH"])
def api_approve_volunteer(id):
    if not session.get("user") or session["user"].get("role") != "admin":
        return jsonify({"error": "Unauthorized"}), 401
    
    db = firebase_services.get_db()
    db.collection("volunteers").document(id).update({
        "verified": True,
        "online": True
    })
    return jsonify({"success": True})

@app.route("/api/volunteers/<id>/suspend", methods=["PATCH"])
def api_suspend_volunteer(id):
    if not session.get("user") or session["user"].get("role") != "admin":
        return jsonify({"error": "Unauthorized"}), 401
    
    db = firebase_services.get_db()
    db.collection("volunteers").document(id).update({"verified": False})
    return jsonify({"success": True})

@app.route("/admin/ngos")
def admin_ngos_page():
    if not session.get("user") or session["user"].get("role") != "admin":
        return redirect("/getstarted")
    return render_template("ngo-management.html", user=session["user"])

@app.route("/admin/volunteers")
def admin_volunteers_page():
    if not session.get("user") or session["user"].get("role") != "admin":
        return redirect("/getstarted")
    return render_template("volunteer-management.html", user=session["user"])

@app.route("/api/admin/chat-start", methods=["POST"])
def api_admin_chat_start():
    if not session.get("user") or session["user"].get("role") != "admin":
        return jsonify({"error": "Unauthorized"}), 401
    
    data = request.json
    other_uid = data.get("other_uid")
    if not other_uid:
        return jsonify({"error": "other_uid required"}), 400
        
    admin_uid = session["user"]["uid"]
    conv_id = firebase_services.get_or_create_conversation([admin_uid, other_uid])
    return jsonify({"success": True, "conversation_id": conv_id})

if __name__ == "__main__":
    socketio.run(app, debug=True)

@app.route("/api/chat/start-with-ngo/<need_id>", methods=["POST"])
def api_chat_start_with_ngo(need_id):
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
    
    need = firebase_services.get_need_by_id(need_id)
    if not need:
        return jsonify({"error": "Need not found"}), 404
        
    ngo_uid = need.get("ngo_id")
    if not ngo_uid:
        return jsonify({"error": "NGO not found"}), 404
        
    uid = session["user"]["uid"]
    conv_id = firebase_services.get_or_create_conversation([uid, ngo_uid], need_id)
    return jsonify({"success": True, "conversation_id": conv_id})

@app.route("/api/chat/start-with-vol/<need_id>", methods=["POST"])
def api_chat_start_with_vol(need_id):
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
    
    need = firebase_services.get_need_by_id(need_id)
    if not need or not need.get("assigned_volunteer_id"):
        return jsonify({"error": "Volunteer not assigned"}), 404
        
    vol_uid = need.get("assigned_volunteer_id")
    uid = session["user"]["uid"]
    conv_id = firebase_services.get_or_create_conversation([uid, vol_uid], need_id)
    return jsonify({"success": True, "conversation_id": conv_id})

@app.route("/api/volunteer/task/complete", methods=["POST"])
def api_volunteer_task_complete():
    """Handle volunteer completion report submission."""
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
    
    uid = session["user"]["uid"]
    need_id = request.form.get("need_id")
    if not need_id:
        return jsonify({"error": "Need ID required"}), 400
    
    # Process file upload
    proof_file = request.files.get("proof")
    proof_url = ""
    if proof_file:
        result = imagekit_services.upload_task_proof(uid, need_id, proof_file)
        if result:
            proof_url = result.get("url")
    
    # Update need status to 'in_review' and store report data
    report_data = {
        "volunteer_id": uid,
        "completion_status": request.form.get("completion_status"),
        "hours": float(request.form.get("hours", 0)),
        "description": request.form.get("description"),
        "impact": request.form.get("impact"),
        "notes": request.form.get("notes"),
        "proof_url": proof_url,
        "submitted_at": firestore.SERVER_TIMESTAMP
    }
    
    db = firebase_services.get_db()
    db.collection("needs").document(need_id).update({
        "status": "in_review",
        "completion_report": report_data
    })
    
    # Update match status if exists
    matches = db.collection("matches").where("need_id", "==", need_id).where("volunteer_id", "==", uid).limit(1).stream()
    for doc in matches:
        doc.reference.update({"status": "in_review"})

    # ── Notify NGO ──
    try:
        from services import notification_service
        need_doc = db.collection("needs").document(need_id).get()
        if need_doc.exists:
            need_data = need_doc.to_dict()
            ngo_id = need_data.get("ngo_id")
            need_title = need_data.get("title", "a task")
            
            vol_profile = firebase_services.get_volunteer_profile(uid)
            vol_name = vol_profile.get("name", "A volunteer")
            
            if ngo_id:
                notification_service.notify_ngo_report_submitted(ngo_id, vol_name, need_title, need_id)
                
                # Log activity for NGO
                firebase_services.log_activity(
                    ngo_id,
                    "warning",
                    f"{vol_name} submitted completion report",
                    f'For: "{need_title}"'
                )
    except Exception as e:
        print(f"Report submission notification failed: {e}")

    return jsonify({"success": True, "redirect": "/volunteer/task/success"})

@app.route("/volunteer/task/success")
def volunteer_task_success():
    if not session.get("user"):
        return redirect("/getstarted")
    return render_template("completion-success-state.html", user=session["user"])

@app.route("/ngo/report/review/<need_id>")
def ngo_report_review_page(need_id):
    """NGO page to review a submitted task report."""
    if not session.get("user"):
        return redirect("/getstarted")
    if session["user"].get("role") != "ngo":
        return redirect("/select-role")
    
    need = firebase_services.get_need_by_id(need_id)
    if not need or need.get("status") != "in_review":
        return "Report not found or not in review", 404
    
    # Get volunteer details for the report
    report = need.get("completion_report", {})
    vol_id = report.get("volunteer_id")
    vol_profile = firebase_services.get_volunteer_profile(vol_id) if vol_id else {}
    
    return render_template("ngo_review_report.html", 
                           need=need, 
                           report=report, 
                           volunteer=vol_profile,
                           user=session["user"])

@app.route("/api/ngo/report/action", methods=["POST"])
def api_ngo_report_action():
    """Approve or Reject/Request Changes on a report."""
    if not session.get("user"):
        return jsonify({"error": "Unauthorized"}), 401
    
    data = request.json
    need_id = data.get("need_id")
    action = data.get("action") # 'approve' or 'reject'
    
    if not need_id or not action:
        return jsonify({"error": "Missing data"}), 400
        
    db = firebase_services.get_db()
    need_ref = db.collection("needs").document(need_id)
    need = need_ref.get().to_dict()
    
    if action == "approve":
        need_ref.update({"status": "completed"})
        # Update match
        vol_id = need.get("completion_report", {}).get("volunteer_id")
        if vol_id:
            matches = db.collection("matches").where("need_id", "==", need_id).where("volunteer_id", "==", vol_id).limit(1).stream()
            for doc in matches:
                doc.reference.update({"status": "completed"})
    else:
        # Revert to in_progress or assigned if rejected
        need_ref.update({"status": "in_progress"})
        # Add a note maybe?
        
    return jsonify({"success": True})