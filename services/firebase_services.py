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


def get_need_by_id(need_id):
    doc = db.collection("needs").document(need_id).get()
    if not doc.exists:
        return None
    d = doc.to_dict()
    d["id"] = doc.id
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
    Returns suggested matches that are pending approval
    for any need belonging to this NGO.
    """
    docs = (
        db.collection("matches")
          .where("ngo_id",  "==", ngo_id)
          .where("status",  "==", "suggested")
          .order_by("match_score", direction=firestore.Query.DESCENDING)
          .limit(limit)
          .stream()
    )

    matches = []
    for doc in docs:
        d = doc.to_dict()
        d["match_id"] = doc.id

        # Fetch volunteer details
        vol_id  = d.get("volunteer_id")
        vol_doc = db.collection("volunteers").document(vol_id).get()
        if vol_doc.exists:
            vol = vol_doc.to_dict()
            d["volunteer_name"]  = vol.get("name", "Volunteer")
            d["volunteer_photo"] = vol.get("avatar_url", "")
            d["skills"]          = vol.get("skills", [])
            d["distance"]        = f"{d.get('distance_km', '?')} km away"
        else:
            d["volunteer_name"]  = "Volunteer"
            d["volunteer_photo"] = ""
            d["skills"]          = []
            d["distance"]        = "Nearby"

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
    """Save AI-extracted needs as drafts pending NGO review."""
    batch = db.batch()
    for need in needs:
        ref = db.collection("needs").document()
        batch.set(ref, {
            "ngo_id":           ngo_id,
            "report_id":        report_id,
            "title":            need.get("title", ""),
            "description":      need.get("description", ""),
            "category":         need.get("category", "OTHER"),
            "urgency_score":    need.get("urgency_score", 5),
            "urgency_label":    need.get("urgency_label", "MEDIUM"),
            "urgency_inferred": need.get("urgency_inferred", True),
            "urgency_reason":   need.get("urgency_reason", ""),
            "required_skills":  need.get("required_skills", []),
            "location":         need.get("location", ""),
            "beneficiaries":    need.get("beneficiaries", ""),
            "deadline_suggestion": need.get("deadline_suggestion", "planned"),
            "status":           "draft",   # pending NGO confirmation
            "source":           "ai_extracted",
            "created_at":       firestore.SERVER_TIMESTAMP
        })
    batch.commit()