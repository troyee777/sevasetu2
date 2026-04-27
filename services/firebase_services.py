import firebase_admin
import math
from firebase_admin import credentials, firestore, auth, storage
import os,json
from flask import jsonify
from datetime import datetime, timedelta

firebase_creds = os.environ.get("FIREBASE_CONFIG")

if firebase_creds:
    cred_dict = json.loads(firebase_creds)
    cred = credentials.Certificate(cred_dict)
else:
    # fallback for local dev
    raise Exception("FIREBASE_SERVICE_ACCOUNT environment variable not set")

# ======================
# Firebase Init
# ======================

# Avoid 'app already exists' error if this file is imported more than once
if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)

db = firestore.client()

def get_db():
    return db

def get_user_by_uid(uid):
    doc = db.collection("users").document(uid).get()
    return doc.to_dict() if doc.exists else None
    
def add_user(uid,email,name,photo_url,role=None):
    user_ref = db.collection("users").document(uid)
    user_ref.set({
        "uid": uid,
        "name": name,
        "email": email,
        "createdAt": firestore.SERVER_TIMESTAMP,
        "photo_url":photo_url,
        "role":role,
        "phone":None
    })

def update_role(uid, role):
    db.collection("users").document(uid).update({
        "role": role,
        "createdAt": firestore.SERVER_TIMESTAMP
    })

def save_fcm_token(uid, token):
    """Save (or update) an FCM registration token for a user using ArrayUnion."""
    db.collection("users").document(uid).update({
        "fcm_tokens":             firestore.ArrayUnion([token]),
        "notifications_enabled":  True,
        "fcm_token_updated_at":   firestore.SERVER_TIMESTAMP,
    })

def remove_fcm_token(uid, token):
    """Remove a specific FCM token (e.g. on logout) from the user's array."""
    db.collection("users").document(uid).update({
        "fcm_tokens": firestore.ArrayRemove([token])
    })

def get_user_notification_state(uid):
    """Return (notifications_enabled, fcm_tokens) for a user."""
    doc = db.collection("users").document(uid).get()
    if not doc.exists:
        return False, []
    d = doc.to_dict()
    tokens = d.get("fcm_tokens", [])
    # Return enabled if notifications_enabled is True AND we have tokens
    return d.get("notifications_enabled", False), tokens


def create_volunteer_profile(uid,data):
    db.collection("volunteers").document(uid).set({

        "name": data["name"],
        "availability": data["availability"],
        "location": data["location"],
        "online": data["online"],
        "photo_url": data["photo_url"],
        "radius": data["radius"],
        "rating": 0,
        "totalTasks":0,
        "verified": False,
        "skills": data["skills"],
        "createdAt": firestore.SERVER_TIMESTAMP
    })
    db.collection("users").document(uid).update({
        "phone": data["phone"]
    })

def create_ngo_profile(uid,data):
    db.collection("ngos").document(uid).set({
        "org_name": data["org_name"],
        "contact_email": data["contact_email"],
        "phone": data["phone"],
        "logo_url": data["logo_url"],

        "description": data["description"],
        "location": data["location"],
        "createdAt": firestore.SERVER_TIMESTAMP
    })



# ══════════════════════════════════════════════
# NGO PROFILE
# ══════════════════════════════════════════════

def get_ngo_profile(uid):
    doc = db.collection("ngos").document(uid).get()
    return doc.to_dict() if doc.exists else {}


def update_ngo_profile(uid, data):
    db.collection("ngos").document(uid).set(data, merge=True)


# ══════════════════════════════════════════════
# NEEDS
# ══════════════════════════════════════════════

def get_needs_by_ngo(ngo_id):
    docs = (
        db.collection("needs")
          .where("ngo_id", "==", ngo_id)
          .stream()
    )
    result = []
    for doc in docs:
        d = doc.to_dict()
        d["id"] = doc.id
        result.append(d)
    return result


def create_need(need_data):
    ref = db.collection("needs").add(need_data)
    return ref[1].id

def get_need_by_need_id(need_id):
    need_doc = db.collection("needs").document(need_id).get()
    return need_doc

def get_need_by_id(need_id):
    doc = db.collection("needs").document(need_id).get()
    if not doc.exists:
        return None
    d = doc.to_dict()
    d["id"] = doc.id

    # If assigned, fetch the match/task details for work tracking
    vol_id = d.get("assigned_volunteer_id")
    if vol_id:
        match_docs = (
            db.collection("matches")
              .where("need_id", "==", need_id)
              .where("volunteer_id", "==", vol_id)
              .limit(1)
              .stream()
        )
        for m_doc in match_docs:
            m_data = m_doc.to_dict()
            d["match_id"] = m_doc.id
            d["work_status"] = m_data.get("work_status", "idle")
            d["current_session_start"] = m_data.get("current_session_start")
            d["total_work_ms"] = m_data.get("total_work_ms", 0)
            d["volunteer_location"] = m_data.get("volunteer_location")
            
            # Fetch work logs/milestones
            logs = (
                db.collection("matches")
                  .document(m_doc.id)
                  .collection("work_log")
                  .order_by("timestamp", direction=firestore.Query.DESCENDING)
                  .stream()
            )
            d["work_log"] = [l.to_dict() for l in logs]

    return d


def update_need_status(need_id, status):
    db.collection("needs").document(need_id).update({
        "status": status,
        "updated_at": firestore.SERVER_TIMESTAMP
    })


# ══════════════════════════════════════════════
# MATCHES
# ══════════════════════════════════════════════

 
def get_suggested_matches_for_ngo(ngo_id, limit=5):
    """
    Returns suggested matches for NGO dashboard.
    Now includes AI reasoning fields from matching_service v2.
    """
    from firebase_admin import firestore as _fs
    db = _fs.client()
 
    docs = (
        db.collection("matches")
          .where("ngo_id", "==", ngo_id)
          .where("status", "==", "suggested")
          .order_by("match_score", direction=_fs.Query.DESCENDING)
          .limit(limit)
          .stream()
    )
 
    matches = []
    for doc in docs:
        d           = doc.to_dict()
        d["match_id"] = doc.id
 
        # Fetch volunteer details
        vol_id  = d.get("volunteer_id")
        vol_doc = db.collection("volunteers").document(vol_id).get()
 
        if vol_doc.exists:
            vol = vol_doc.to_dict()
            d["volunteer_name"]  = vol.get("name", "Volunteer")
            d["volunteer_photo"] = vol.get("photo_url") or vol.get("avatar_url", "")
            d["skills"]          = vol.get("skills", [])
            d["distance"]        = (
                f"{d.get('distance_km', '?')} km away"
                if d.get("distance_km") is not None
                else "Nearby"
            )
            d["volunteer_was_online"] = d.get("volunteer_was_online", True)
        else:
            d["volunteer_name"]  = "Volunteer"
            d["volunteer_photo"] = ""
            d["skills"]          = []
            d["distance"]        = "Nearby"
 
        # ── AI reasoning fields ──────────────────────────────
        d.setdefault("match_confidence", "MEDIUM")
        d.setdefault("match_reason",     "")
        d.setdefault("match_strengths",  [])
        d.setdefault("match_concerns",   [])
 
        matches.append(d)
 
    return matches


def update_match_status(match_id, status):
    db.collection("matches").document(match_id).update({
        "status":       status,
        "responded_at": firestore.SERVER_TIMESTAMP
    })

    # If accepted, update the corresponding need status too
    if status == "accepted":
        match_doc = db.collection("matches").document(match_id).get()
        if match_doc.exists:
            match = match_doc.to_dict()
            need_id  = match.get("need_id")
            vol_id   = match.get("volunteer_id")
            if need_id:
                db.collection("needs").document(need_id).update({
                    "status":                  "assigned",
                    "assigned_volunteer_id":   vol_id,
                    "updated_at":              firestore.SERVER_TIMESTAMP
                })
                # ── Notify Volunteer ──
                try:
                    from services import notification_service
                    need_doc = db.collection("needs").document(need_id).get()
                    need_title = need_doc.to_dict().get("title", "a need") if need_doc.exists else "a need"
                    ngo_id = match.get("ngo_id")
                    ngo_name = "An NGO"
                    if ngo_id:
                        ngo_data = db.collection("ngos").document(ngo_id).get().to_dict()
                        ngo_name = ngo_data.get("org_name", "An NGO") if ngo_data else "An NGO"
                    
                    notification_service.notify_volunteer_assigned(vol_id, need_title, ngo_name)
                except Exception as e:
                    print(f"Match approval notification failed: {e}")


# ══════════════════════════════════════════════
# ACTIVITY FEED
# ══════════════════════════════════════════════

def get_activity_for_ngo(ngo_id, limit=5):
    """
    Reads from a dedicated 'activity' subcollection on the NGO document.
    Each activity has: type, title, subtitle, created_at
    """
    docs = (
        db.collection("ngos")
          .document(ngo_id)
          .collection("activity")
          .order_by("created_at", direction=firestore.Query.DESCENDING)
          .limit(limit)
          .stream()
    )

    activities = []
    for doc in docs:
        d = doc.to_dict()
        d["id"] = doc.id
        activities.append(d)

    return activities


def log_activity(ngo_id, activity_type, title, subtitle=""):
    """
    Call this whenever something notable happens:
    create need, approve match, task completed, etc.
    """
    db.collection("ngos") \
      .document(ngo_id) \
      .collection("activity") \
      .add({
          "type":       activity_type,   # "completed"|"matched"|"created"|"warning"
          "title":      title,
          "subtitle":   subtitle,
          "created_at": firestore.SERVER_TIMESTAMP
      })


# ══════════════════════════════════════════════
# REPORTS
# ══════════════════════════════════════════════

def save_report(ngo_id, image_url, file_id):
    ref = db.collection("reports").add({
        "ngo_id":     ngo_id,
        "image_url":  image_url,
        "file_id":    file_id,
        "processed":  False,
        "uploaded_at": firestore.SERVER_TIMESTAMP
    })
    return ref[1].id


def save_extracted_needs_draft(ngo_id, report_id, needs):
    """
    Save AI-extracted needs as drafts pending NGO review.

    Location strings extracted by Gemini (e.g. "vidyasagapur durga mandir,
    kharagpur") are forward-geocoded via OlaMaps so they are stored as
    structured objects  { city, lat, lng }  — exactly the same format used
    when an NGO pins a location manually on the map.

    If geocoding fails (API error, no results, key missing) the raw text is
    preserved as the `city` field and lat/lng are set to None, so the need
    still saves and the NGO can edit the location on the review screen.
    """
    from services.geocoding_service import geocode_location_safe   # lazy import

    batch = db.batch()
    for need in needs:
        raw_location = need.get("location", "")

        # ── Geocode the plain-text location ──────────────────────────
        if raw_location and isinstance(raw_location, str) and raw_location.strip():
            # Get NGO city for context
            ngo_profile = get_ngo_profile(ngo_id)
            context_city = ngo_profile.get("location", {}).get("city") if isinstance(ngo_profile.get("location"), dict) else None
            
            # Forward-geocode: "vidyasagapur durga mandir, kharagpur"
            #                → { city: "Kharagpur", lat: 22.368, lng: 87.249 }
            structured_location = geocode_location_safe(raw_location, context=context_city)
        elif isinstance(raw_location, dict):
            # Gemini returned a dict already (shouldn't happen, but be safe)
            structured_location = raw_location
        else:
            structured_location = {"city": "", "lat": None, "lng": None}

        ref = db.collection("needs").document()
        batch.set(ref, {
            "ngo_id":              ngo_id,
            "report_id":           report_id,
            "title":               need.get("title", ""),
            "description":         need.get("description", ""),
            "category":            need.get("category", "OTHER"),
            "urgency_score":       need.get("urgency_score", 5),
            "urgency_label":       need.get("urgency_label", "MEDIUM"),
            "urgency_inferred":    need.get("urgency_inferred", True),
            "urgency_reason":      need.get("urgency_reason", ""),
            "required_skills":     need.get("required_skills", []),
            "location":            structured_location,   # ← { city, lat, lng }
            "beneficiaries":       need.get("beneficiaries", ""),
            "deadline_suggestion": need.get("deadline_suggestion", "planned"),
            "estimated_people":    need.get("estimated_people"),
            "status":              "draft",               # pending NGO confirmation
            "source":              "ai_extracted",
            "created_at":          firestore.SERVER_TIMESTAMP,
        })
    batch.commit()


def get_reports_by_uid(uid):
    docs = (
        db.collection("reports")
          .where("ngo_id", "==", uid)
          .order_by("uploaded_at", direction=firestore.Query.DESCENDING)
          .limit(50)
          .stream()
    )
    return docs

def get_report_by_report_id(report_id):
    doc = db.collection("reports").document(report_id).get()
    return doc


def get_draft_needs_for_report(report_id):
    needs_docs = (
        db.collection("needs")
          .where("report_id", "==", report_id)
          .where("status",    "==", "draft")
          .stream()
    )
    return needs_docs

def get_needs_for_report(report_id):
    needs_docs = (
        db.collection("needs")
          .where("report_id", "==", report_id)
          .stream()
    )
    return needs_docs


def create_report_doc_ref(uid,data):
    ref=db.collection("reports").add({
        "ngo_id":      uid,
        "image_url":   data["image_url"],
        "thumb_url":   data["thumb_url"],
        "file_id":     data["file_id"],
        "file_name":   data["file_name"],
        "file_size":   data["file_size"],
        "file_type":   data["file_type"],
        "processed":   False,
        "status":      "processing",
        "needs_count": 0,
        "uploaded_at": firestore.SERVER_TIMESTAMP,
    })
    return ref

def update_report_status(report_id,update):
    db.collection("reports").document(report_id).update(update)


def update_need(need_id,update):
    db.collection("needs").document(need_id).update(update)


# ══════════════════════════════════════════════
# VOLUNTEER PROFILE
# ══════════════════════════════════════════════

def get_volunteer_profile(uid):
    doc = db.collection("volunteers").document(uid).get()
    return doc.to_dict() if doc.exists else {}


def update_volunteer_online(uid, online):
    db.collection("volunteers").document(uid).update({
        "online":     online,
        "updated_at": firestore.SERVER_TIMESTAMP
    })

    # When a volunteer comes online, notify them of queued matches
    if online:
        _notify_queued_matches(db, uid)


def _notify_queued_matches(db, vol_id: str):
    """
    When a volunteer comes online, find any suggested matches that were
    created while they were offline and flip notify_immediately = True.
    """
    pending = (
        db.collection("matches")
          .where("volunteer_id",    "==", vol_id)
          .where("status",          "==", "suggested")
          .where("notify_immediately", "==", False)
          .stream()
    )
    batch = db.batch()
    for doc in pending:
        batch.update(doc.reference, {
            "notify_immediately":  True,
            "notified_at":         firestore.SERVER_TIMESTAMP,
        })
    batch.commit()


# ══════════════════════════════════════════════
# MATCHES FOR VOLUNTEER
# ══════════════════════════════════════════════

def get_matches_for_volunteer(vol_id, limit=20):
    docs = (
        db.collection("matches")
          .where("volunteer_id", "==", vol_id)
          .order_by("created_at", direction=firestore.Query.DESCENDING)
          .limit(limit)
          .stream()
    )
    result = []
    for doc in docs:
        d = doc.to_dict()
        d["id"] = doc.id
        result.append(d)
    return result


def enrich_tasks_with_needs(matches, vol_uid):
    """
    Given a list of match dicts, fetch the corresponding need document
    and merge fields useful for the dashboard.
    """
    if not matches:
        return []

    vol_doc = db.collection("volunteers").document(vol_uid).get()
    vol     = vol_doc.to_dict() if vol_doc.exists else {}
    vol_loc = vol.get("location", {})
    vol_lat = vol_loc.get("lat")
    vol_lng = vol_loc.get("lng")

    enriched = []
    for match in matches:
        need_id = match.get("need_id")
        if not need_id:
            continue

        need_doc = db.collection("needs").document(need_id).get()
        if not need_doc.exists:
            continue

        need = need_doc.to_dict()
        need["id"] = need_doc.id

        ngo_id  = need.get("ngo_id", "")
        ngo_doc = db.collection("ngos").document(ngo_id).get()
        ngo_name = ngo_doc.to_dict().get("org_name", "NGO") if ngo_doc.exists else "NGO"

        distance_km = None
        need_loc = need.get("location", {})
        # location is now always a dict; handle legacy string gracefully
        if isinstance(need_loc, str):
            need_loc = {"city": need_loc, "lat": None, "lng": None}
        if vol_lat and vol_lng and need_loc.get("lat") and need_loc.get("lng"):
            distance_km = round(
                haversine(vol_lat, vol_lng, need_loc["lat"], need_loc["lng"]),
                1
            )

        deadline = need.get("deadline")
        deadline_text = ""
        if deadline:
            try:
                from datetime import datetime, timezone
                if hasattr(deadline, "timestamp"):
                    dt = datetime.fromtimestamp(deadline.timestamp(), tz=timezone.utc)
                else:
                    dt = datetime.fromisoformat(str(deadline))
                days_left = (dt - datetime.now(tz=timezone.utc)).days
                deadline_text = (
                    f"Due in {days_left} day{'s' if days_left != 1 else ''}"
                    if days_left > 0
                    else "Due today"
                )
            except Exception:
                pass

        status   = match.get("status", need.get("status", "open"))
        progress = {"suggested": 10, "accepted": 30, "in_progress": 60,
                    "completed": 100}.get(status, 10)

        enriched.append({
            "id":             match["id"],
            "need_id":        need_id,
            "title":          need.get("title", ""),
            "description":    need.get("description", ""),
            "category":       need.get("category", ""),
            "urgency_label":  need.get("urgency_label", "MEDIUM"),
            "urgency_score":  need.get("urgency_score", 5),
            "required_skills":need.get("required_skills", []),
            "location":       need_loc.get("city") or need.get("location", ""),
            "lat":            need_loc.get("lat"),
            "lng":            need_loc.get("lng"),
            "ngo_name":       ngo_name,
            "distance_km":    distance_km,
            "status":         status,
            "deadline_text":  deadline_text,
            "progress_pct":   progress,
            "phase":          "Setup Phase" if progress < 50 else "In Progress",
            "created_at":     need.get("created_at"),
        })

    return enriched


# ══════════════════════════════════════════════
# VOLUNTEER TASK ACTIONS
# ══════════════════════════════════════════════

def volunteer_respond_to_match(match_id, vol_id, response):
    """response: "accepted" | "declined" """
    db.collection("matches").document(match_id).update({
        "status":       response,
        "responded_at": firestore.SERVER_TIMESTAMP
    })

    if response == "accepted":
        match_doc = db.collection("matches").document(match_id).get()
        if match_doc.exists:
            match = match_doc.to_dict()
            need_id = match.get("need_id")
            ngo_id  = match.get("ngo_id")
            if need_id:
                db.collection("needs").document(need_id).update({
                    "status":                 "assigned",
                    "assigned_volunteer_id":  vol_id,
                    "updated_at":             firestore.SERVER_TIMESTAMP
                })
            if ngo_id:
                need_doc = db.collection("needs").document(need_id).get()
                need_title = need_doc.to_dict().get("title", "a need") if need_doc.exists else "a need"
                vol_doc    = db.collection("volunteers").document(vol_id).get()
                vol_name   = vol_doc.to_dict().get("name", "A volunteer") if vol_doc.exists else "A volunteer"
                log_activity(
                    ngo_id,
                    "matched",
                    f"{vol_name} accepted task",
                    f'For need: "{need_title}"'
                )
                # ── Notify NGO ──
                try:
                    from services import notification_service
                    notification_service.notify_ngo_volunteer_accepted(ngo_id, vol_name, need_title)
                except Exception as e:
                    print(f"Volunteer acceptance notification failed: {e}")

    elif response == "declined":
        pass


def volunteer_complete_task(match_id, vol_id, proof_url=None):
    """Mark a task as completed by the volunteer."""
    update_data = {
        "status":       "completed",
        "completed_at": firestore.SERVER_TIMESTAMP
    }
    if proof_url:
        update_data["proof_url"] = proof_url

    db.collection("matches").document(match_id).update(update_data)

    match_doc = db.collection("matches").document(match_id).get()
    if match_doc.exists:
        match   = match_doc.to_dict()
        need_id = match.get("need_id")
        ngo_id  = match.get("ngo_id")

        if need_id:
            db.collection("needs").document(need_id).update({
                "status":     "completed",
                "updated_at": firestore.SERVER_TIMESTAMP
            })

        db.collection("volunteers").document(vol_id).update({
            "totalTasks": firestore.Increment(1),
            "updated_at": firestore.SERVER_TIMESTAMP
        })

        if ngo_id:
            need_doc   = db.collection("needs").document(need_id).get()
            need_title = need_doc.to_dict().get("title", "a need") if need_doc.exists else "a need"
            vol_doc    = db.collection("volunteers").document(vol_id).get()
            vol_name   = vol_doc.to_dict().get("name", "A volunteer") if vol_doc.exists else "A volunteer"
            log_activity(
                ngo_id,
                "completed",
                f'"{need_title}" completed',
                f"Verified by {vol_name}"
            )


def start_work_session(match_id, vol_id):
    """Start a work session for a task."""
    batch = db.batch()
    
    match_ref = db.collection("matches").document(match_id)
    batch.update(match_ref, {
        "status":                "in_progress",
        "work_status":           "working",
        "current_session_start": firestore.SERVER_TIMESTAMP,
        "updated_at":            firestore.SERVER_TIMESTAMP
    })
    
    match_doc = match_ref.get()
    if match_doc.exists:
        need_id = match_doc.to_dict().get("need_id")
        if need_id:
            batch.update(db.collection("needs").document(need_id), {
                "status":     "in_progress",
                "updated_at": firestore.SERVER_TIMESTAMP
            })
    
    batch.commit()


def pause_work_session(match_id, vol_id, comment, duration_ms):
    """Pause a work session and log the duration."""
    # 1. Add milestone to subcollection
    milestone = {
        "comment":    comment,
        "duration_ms": duration_ms,
        "timestamp":  firestore.SERVER_TIMESTAMP,
        "type":       "pause"
    }
    db.collection("matches").document(match_id).collection("work_log").add(milestone)
    
    # 2. Update match status
    db.collection("matches").document(match_id).update({
        "work_status":   "paused",
        "total_work_ms": firestore.Increment(duration_ms),
        "updated_at":    firestore.SERVER_TIMESTAMP
    })


def update_task_location(match_id, vol_id, lat, lng):
    """Update live location of a volunteer for a specific task."""
    db.collection("matches").document(match_id).update({
        "volunteer_location": {
            "lat":        lat,
            "lng":        lng,
            "updated_at": firestore.SERVER_TIMESTAMP
        }
    })


# ══════════════════════════════════════════════
# HAVERSINE
# ══════════════════════════════════════════════

def haversine(lat1, lon1, lat2, lon2):
    """Distance between two lat/lng points in km."""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) *
         math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

# ══════════════════════════════════════════════
# CHAT / MESSAGING
# ══════════════════════════════════════════════

def get_or_create_conversation(participant_ids, need_id=None):
    """
    Finds an existing conversation between exactly these participants, 
    or creates a new one.
    """
    participant_ids = sorted(participant_ids)
    
    # Try to find existing
    query = (
        db.collection("conversations")
          .where("participants", "==", participant_ids)
    )
    if need_id:
        query = query.where("need_id", "==", need_id)
    
    docs = query.limit(1).stream()
    for doc in docs:
        return doc.id
    
    # Create new
    _, ref = db.collection("conversations").add({
        "participants":  participant_ids,
        "need_id":       need_id,
        "last_message":  "",
        "updated_at":    firestore.SERVER_TIMESTAMP,
        "created_at":    firestore.SERVER_TIMESTAMP,
    })
    return ref.id

def send_chat_message(conversation_id, sender_id, text):
    """
    Saves a message and notifies other participants via FCM.
    """
    # 1. Save Message
    msg_ref = (
        db.collection("conversations")
          .document(conversation_id)
          .collection("messages")
          .add({
              "sender_id":  sender_id,
              "text":       text,
              "created_at": firestore.SERVER_TIMESTAMP,
              "read_by":    [sender_id]
          })
    )
    
    # 2. Update conversation summary
    db.collection("conversations").document(conversation_id).update({
        "last_message": text,
        "updated_at":   firestore.SERVER_TIMESTAMP
    })
    
    # 3. Trigger FCM Notifications
    try:
        conv_doc = db.collection("conversations").document(conversation_id).get()
        if conv_doc.exists:
            participants = conv_doc.to_dict().get("participants", [])
            sender_doc   = db.collection("users").document(sender_id).get()
            sender_name  = sender_doc.to_dict().get("name", "Someone") if sender_doc.exists else "Someone"
            
            from services import notification_service
            for pid in participants:
                if pid != sender_id:
                    notification_service.notify_new_message(sender_name, pid, text, conversation_id)
    except Exception as e:
        print(f"Chat notification failed: {e}")
    
    return msg_ref[1].id

def get_conversations_for_user(uid):
    """Fetch all conversations where the user is a participant."""
    docs = (
        db.collection("conversations")
          .where("participants", "array_contains", uid)
          .order_by("updated_at", direction=firestore.Query.DESCENDING)
          .stream()
    )
    result = []
    for doc in docs:
        d = doc.to_dict()
        d["id"] = doc.id
        
        # Identify the other person
        other_id = next((p for p in d.get("participants", []) if p != uid), None)
        if other_id:
            # Try to get their details
            other_user = db.collection("users").document(other_id).get()
            if other_user.exists:
                udata = other_user.to_dict()
                d["other_name"] = udata.get("name", "User")
                d["other_photo"] = udata.get("photo_url", "")
            else:
                d["other_name"] = "Deleted User"
                d["other_photo"] = ""
        
        result.append(d)
    return result

def get_messages_for_conversation(conversation_id, limit=50):
    """Fetch message history for a conversation."""
    docs = (
        db.collection("conversations")
          .document(conversation_id)
          .collection("messages")
          .order_by("created_at", direction=firestore.Query.ASCENDING)
          .limit(limit)
          .stream()
    )
    messages = []
    for doc in docs:
        d = doc.to_dict()
        d["id"] = doc.id
        # Convert timestamp to ISO string for JSON
        ts = d.get("created_at")
        if ts and hasattr(ts, "isoformat"):
            d["created_at"] = ts.isoformat()
        messages.append(d)
    return messages


# ══════════════════════════════════════════════
# WORK TRACKING
# ══════════════════════════════════════════════

def start_work_session(match_id, vol_id):
    """Marks the task as in_progress and records start time."""
    match_ref = db.collection("matches").document(match_id)
    match_doc = match_ref.get()
    
    if not match_doc.exists:
        return False
        
    match_data = match_doc.to_dict()
    if match_data.get("volunteer_id") != vol_id:
        return False

    now = datetime.now(timezone.utc)
    
    # Update match status and start time if not already started
    update_data = {
        "status": "in_progress",
        "updated_at": firestore.SERVER_TIMESTAMP
    }
    
    if not match_data.get("work_started_at"):
        update_data["work_started_at"] = firestore.SERVER_TIMESTAMP
    
    # Also record this specific session start
    match_ref.collection("work_sessions").add({
        "start_time": firestore.SERVER_TIMESTAMP,
        "type": "start"
    })
    
    match_ref.update(update_data)
    
    # Update the need status as well
    need_id = match_data.get("need_id")
    if need_id:
        db.collection("needs").document(need_id).update({
            "status": "in_progress",
            "updated_at": firestore.SERVER_TIMESTAMP
        })
        
    return True

def pause_work_session(match_id, vol_id, comment):
    """Records a pause event with milestone comments."""
    match_ref = db.collection("matches").document(match_id)
    match_doc = match_ref.get()
    
    if not match_doc.exists:
        return False
        
    match_data = match_doc.to_dict()
    if match_data.get("volunteer_id") != vol_id:
        return False

    # Record the pause event
    match_ref.collection("work_sessions").add({
        "time": firestore.SERVER_TIMESTAMP,
        "type": "pause",
        "comment": comment
    })
    
    # Update match with last comment
    match_ref.update({
        "last_milestone_comment": comment,
        "updated_at": firestore.SERVER_TIMESTAMP
    })
    
    return True

def update_task_location(match_id, vol_id, lat, lng):
    """Updates the live location of the volunteer for this task."""
    match_ref = db.collection("matches").document(match_id)
    match_doc = match_ref.get()
    
    if not match_doc.exists:
        return False
        
    match_data = match_doc.to_dict()
    if match_data.get("volunteer_id") != vol_id:
        return False

    match_ref.update({
        "live_location": {
            "lat": lat,
            "lng": lng,
            "updated_at": firestore.SERVER_TIMESTAMP
        }
    })
    
    return True
