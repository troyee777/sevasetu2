"""
SevaSetu - Firebase/Firestore Backend Query Module
Collections: needs, ngos, users, volunteers, matches, reports, conversations
"""

import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime
from typing import Optional

# ─── INIT ────────────────────────────────────────────────────────────────────

def init_firebase(service_account_path: str = "serviceAccountKey.json"):
    """Initialize Firebase Admin SDK."""
    if not firebase_admin._apps:
        cred = credentials.Certificate(service_account_path)
        firebase_admin.initialize_app(cred)
    return firestore.client()

db = None  # Call init_firebase() before using any query


# ═══════════════════════════════════════════════════════════════════════════════
#  NEEDS
# ═══════════════════════════════════════════════════════════════════════════════

def get_all_needs(status: Optional[str] = None, category: Optional[str] = None,
                  urgency_min: float = 0.0):
    """
    Fetch needs with optional filters.
    status: 'open' | 'assigned' | 'resolved'
    category: 'Healthcare' | 'Food Security' | 'Education' | etc.
    urgency_min: minimum urgency_score (0–10)
    """
    ref = db.collection("needs")

    if status:
        ref = ref.where("status", "==", status)
    if category:
        ref = ref.where("category", "==", category)

    docs = ref.stream()
    needs = []
    for doc in docs:
        data = doc.to_dict()
        data["id"] = doc.id
        if data.get("urgency_score", 0) >= urgency_min:
            needs.append(data)

    # Sort by urgency_score descending (client-side after filter)
    needs.sort(key=lambda x: x.get("urgency_score", 0), reverse=True)
    return needs


def get_need_by_id(need_id: str):
    """Fetch a single need document by ID."""
    doc = db.collection("needs").document(need_id).get()
    if doc.exists:
        data = doc.to_dict()
        data["id"] = doc.id
        return data
    return None


def create_need(ngo_id: str, title: str, description: str, category: str,
                location: str, estimated_people: int,
                required_skills: list = None, urgency_score: int = 5,
                urgency_label: str = "MID", source: str = "manual"):
    """Create a new assistance need."""
    payload = {
        "ngo_id": ngo_id,
        "title": title,
        "description": description,
        "category": category,
        "location": location,
        "estimated_people": estimated_people,
        "required_skills": required_skills or [],
        "urgency_score": urgency_score,
        "urgency_label": urgency_label,
        "urgency_inferred": False,
        "status": "open",
        "source": source,
        "created_at": firestore.SERVER_TIMESTAMP,
    }
    _, ref = db.collection("needs").add(payload)
    return ref.id


def update_need_status(need_id: str, status: str):
    """Update the status of a need: open | assigned | resolved."""
    db.collection("needs").document(need_id).update({"status": status})


def assign_volunteer_to_need(need_id: str, volunteer_id: str):
    """Assign a volunteer to a need and mark it assigned."""
    db.collection("needs").document(need_id).update({
        "volunteer_id": volunteer_id,
        "status": "assigned",
    })


def delete_need(need_id: str):
    """Delete (close) a need document."""
    db.collection("needs").document(need_id).delete()


# ═══════════════════════════════════════════════════════════════════════════════
#  NGOs
# ═══════════════════════════════════════════════════════════════════════════════

def get_all_ngos(verified_only: bool = False):
    """Fetch all NGOs. Pass verified_only=True to filter verified ones."""
    ref = db.collection("ngos")
    if verified_only:
        ref = ref.where("verified", "==", True)
    return [{**doc.to_dict(), "id": doc.id} for doc in ref.stream()]


def get_ngo_by_id(ngo_id: str):
    """Fetch a single NGO by its document ID."""
    doc = db.collection("ngos").document(ngo_id).get()
    if doc.exists:
        return {**doc.to_dict(), "id": doc.id}
    return None


def get_ngo_needs(ngo_id: str, status: Optional[str] = None):
    """Get all needs posted by a specific NGO."""
    ref = db.collection("needs").where("ngo_id", "==", ngo_id)
    if status:
        ref = ref.where("status", "==", status)
    return [{**doc.to_dict(), "id": doc.id} for doc in ref.stream()]


def update_ngo_profile(ngo_id: str, updates: dict):
    """
    Update NGO profile fields.
    Example updates: {"phone": "9876543210", "description": "Updated desc"}
    """
    db.collection("ngos").document(ngo_id).update(updates)


# ═══════════════════════════════════════════════════════════════════════════════
#  USERS
# ═══════════════════════════════════════════════════════════════════════════════

def get_user_by_id(user_id: str):
    """Fetch a user document by UID."""
    doc = db.collection("users").document(user_id).get()
    if doc.exists:
        return {**doc.to_dict(), "id": doc.id}
    return None


def get_users_by_role(role: str):
    """
    Fetch all users with a specific role.
    role: 'admin' | 'ngo' | 'volunteer'
    """
    ref = db.collection("users").where("role", "==", role)
    return [{**doc.to_dict(), "id": doc.id} for doc in ref.stream()]


def create_user(uid: str, name: str, email: str, role: str, photo_url: str = None):
    """Create/register a new user document."""
    payload = {
        "uid": uid,
        "name": name,
        "email": email,
        "role": role,
        "phone": None,
        "photo_url": photo_url,
        "createdAt": firestore.SERVER_TIMESTAMP,
    }
    db.collection("users").document(uid).set(payload)


def update_user(user_id: str, updates: dict):
    """Update user profile fields."""
    db.collection("users").document(user_id).update(updates)


# ═══════════════════════════════════════════════════════════════════════════════
#  VOLUNTEERS
# ═══════════════════════════════════════════════════════════════════════════════

def get_all_volunteers(skill: Optional[str] = None):
    """
    Fetch all volunteers. Optionally filter by a skill tag.
    skill: e.g. 'medical', 'teaching', 'logistics'
    """
    ref = db.collection("volunteers")
    if skill:
        ref = ref.where("skills", "array_contains", skill)
    return [{**doc.to_dict(), "id": doc.id} for doc in ref.stream()]


def get_volunteer_by_id(volunteer_id: str):
    """Fetch a single volunteer document."""
    doc = db.collection("volunteers").document(volunteer_id).get()
    if doc.exists:
        return {**doc.to_dict(), "id": doc.id}
    return None


def get_nearby_volunteers(lat: float, lng: float, radius_km: float = 5.0):
    """
    Rough bounding-box filter for volunteers near a coordinate.
    For precise geo-queries, use a geohash library (e.g. pygeohash).
    """
    delta = radius_km / 111.0  # ~1 deg ≈ 111 km
    ref = (db.collection("volunteers")
             .where("location.lat", ">=", lat - delta)
             .where("location.lat", "<=", lat + delta))
    volunteers = [{**doc.to_dict(), "id": doc.id} for doc in ref.stream()]
    # Secondary lng filter (Firestore can't do two range fields simultaneously)
    return [v for v in volunteers
            if abs(v.get("location", {}).get("lng", 0) - lng) <= delta]


def update_volunteer_availability(volunteer_id: str, available: bool):
    """Toggle volunteer availability."""
    db.collection("volunteers").document(volunteer_id).update({"available": available})


# ═══════════════════════════════════════════════════════════════════════════════
#  MATCHES
# ═══════════════════════════════════════════════════════════════════════════════

def get_matches_for_need(need_id: str):
    """Fetch all AI/manual matches for a given need."""
    ref = db.collection("matches").where("need_id", "==", need_id)
    return [{**doc.to_dict(), "id": doc.id} for doc in ref.stream()]


def create_match(need_id: str, volunteer_id: str, confidence: float,
                 reason: str = "", source: str = "ai"):
    """
    Record a volunteer-need match.
    confidence: 0.0–1.0 (e.g. 0.98 = 98% match)
    source: 'ai' | 'manual'
    """
    payload = {
        "need_id": need_id,
        "volunteer_id": volunteer_id,
        "confidence": confidence,
        "reason": reason,
        "source": source,
        "status": "pending",   # pending | accepted | rejected
        "created_at": firestore.SERVER_TIMESTAMP,
    }
    _, ref = db.collection("matches").add(payload)
    return ref.id


def update_match_status(match_id: str, status: str):
    """Update match status: pending | accepted | rejected."""
    db.collection("matches").document(match_id).update({"status": status})


# ═══════════════════════════════════════════════════════════════════════════════
#  REPORTS
# ═══════════════════════════════════════════════════════════════════════════════

def get_all_reports(report_type: Optional[str] = None):
    """Fetch reports. report_type: 'summary' | 'impact' | 'audit' | etc."""
    ref = db.collection("reports")
    if report_type:
        ref = ref.where("type", "==", report_type)
    return [{**doc.to_dict(), "id": doc.id} for doc in ref.stream()]


def create_report(title: str, report_type: str, data: dict, created_by: str):
    """Create a new report document."""
    payload = {
        "title": title,
        "type": report_type,
        "data": data,
        "created_by": created_by,
        "created_at": firestore.SERVER_TIMESTAMP,
    }
    _, ref = db.collection("reports").add(payload)
    return ref.id


# ═══════════════════════════════════════════════════════════════════════════════
#  CONVERSATIONS
# ═══════════════════════════════════════════════════════════════════════════════

def get_conversation(conversation_id: str):
    """Fetch a conversation thread by ID."""
    doc = db.collection("conversations").document(conversation_id).get()
    if doc.exists:
        return {**doc.to_dict(), "id": doc.id}
    return None


def get_conversations_for_user(user_id: str):
    """Get all conversations where a user is a participant."""
    ref = db.collection("conversations").where("participants", "array_contains", user_id)
    return [{**doc.to_dict(), "id": doc.id} for doc in ref.stream()]


def send_message(conversation_id: str, sender_id: str, text: str):
    """Append a message to a conversation's messages sub-collection."""
    msg = {
        "sender_id": sender_id,
        "text": text,
        "timestamp": firestore.SERVER_TIMESTAMP,
        "read": False,
    }
    db.collection("conversations").document(conversation_id)\
      .collection("messages").add(msg)


def create_conversation(participant_ids: list, need_id: str = None):
    """Start a new conversation between participants."""
    payload = {
        "participants": participant_ids,
        "need_id": need_id,
        "created_at": firestore.SERVER_TIMESTAMP,
        "last_message": None,
    }
    _, ref = db.collection("conversations").add(payload)
    return ref.id


# ═══════════════════════════════════════════════════════════════════════════════
#  DASHBOARD AGGREGATIONS
# ═══════════════════════════════════════════════════════════════════════════════

def get_dashboard_stats():
    """
    Returns high-level counts for the admin dashboard.
    Note: Firestore doesn't support COUNT natively in free tier —
    this fetches docs and counts client-side. Use counters/aggregations
    in production for large datasets.
    """
    needs      = list(db.collection("needs").stream())
    volunteers = list(db.collection("volunteers").stream())
    ngos       = list(db.collection("ngos").stream())

    open_needs     = sum(1 for n in needs if n.to_dict().get("status") == "open")
    urgent_needs   = sum(1 for n in needs if n.to_dict().get("urgency_label") == "HIGH")
    resolved_needs = sum(1 for n in needs if n.to_dict().get("status") == "resolved")

    return {
        "total_needs":      len(needs),
        "open_needs":       open_needs,
        "urgent_needs":     urgent_needs,
        "resolved_needs":   resolved_needs,
        "total_volunteers": len(volunteers),
        "total_ngos":       len(ngos),
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  QUICK TEST / USAGE DEMO
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    global db
    db = init_firebase("serviceAccountKey.json")

    # ── Needs ──
    print("=== All Open Needs ===")
    for need in get_all_needs(status="open"):
        print(f"  [{need['urgency_score']}] {need['title']} — {need['status']}")

    print("\n=== Dashboard Stats ===")
    stats = get_dashboard_stats()
    for k, v in stats.items():
        print(f"  {k}: {v}")

    print("\n=== Nearby Volunteers (Kolkata centre) ===")
    nearby = get_nearby_volunteers(lat=22.5726, lng=88.3639, radius_km=10)
    for v in nearby:
        print(f"  {v.get('name')} — {v.get('location')}")