"""
services/matching_service.py
════════════════════════════════════════════════════════════════════
SevaSetu — AI-First Volunteer Matching Engine  (v2)

Architecture
────────────
The old engine used heuristic scoring as primary and Gemini as an
optional re-ranker.  This version flips that completely:

  1. HARD FILTER      — Geography only.  Any volunteer outside their
                        own stated service radius is eliminated.
                        This is the only rule-based gate.

  2. LIGHTWEIGHT PRE-SORT  — A cheap keyword-overlap pass trims a
                        large pool to ~25 candidates before the LLM
                        call.  No weights, no tuning — just "does any
                        word from the need appear in this volunteer's
                        skills + bio?"

  3. GEMINI FULL EVALUATION  — The trimmed pool goes to Gemini 1.5
                        Flash in ONE batched call.  Gemini receives
                        the full need context AND full volunteer
                        profile (skills, bio, availability, distance,
                        rating, task history) and returns for each:
                          • A 0-100 match score
                          • A one-sentence reason
                          • A confidence label (HIGH / MEDIUM / LOW)
                          • Strengths list
                          • Concerns list
                        This is AI-as-judge, not AI-as-re-ranker.

  4. FALLBACK         — If Gemini times out or fails, the pre-sort
                        score is used so matching never breaks.

  5. WRITE            — Top MAX_MATCHES_PER_NEED docs written to the
                        `matches` Firestore collection, with full AI
                        reasoning stored for the NGO dashboard.

Why AI-first is better
──────────────────────
• A retired nurse who listed only "Driving" as a skill will score
  high for a medical logistics need because Gemini reads her bio.
• A volunteer who wrote "I love working with kids" in their about
  section scores higher for a school task than someone with "Teaching"
  listed but no context.
• Urgency is understood semantically — Gemini knows "critical oxygen
  shortage" means immediate availability, not just "anytime".
• No synonym map to maintain, no weight tuning, no edge cases.
"""

import math
import json
import os
import re
import logging
from services import firebase_services
from firebase_admin import firestore


logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
MAX_MATCHES_PER_NEED  = 5    # final match docs to write to Firestore
PRE_SORT_POOL_SIZE    = 25   # max candidates forwarded to Gemini
DEFAULT_RADIUS_KM     = 30   # fallback if volunteer has no radius set
GEMINI_MODEL          = "gemini-2.5-flash"   # cheaper, faster, and better at structured output than 2.5 for our use case


# ═════════════════════════════════════════════════════════════════════════════
# PUBLIC ENTRY POINT
# ════════════════════╗


def run_matching_for_need(need_id: str, need: dict) -> list[str]:
    """
    Called by app.py (always in a background thread) after a need is
    created or published.

    Parameters
    ----------
    need_id : str   Firestore document ID of the need
    need    : dict  The need document dict

    Returns
    -------
    list[str]  IDs of the created match documents
    """
    db = firebase_services.get_db()
    logger.info(f"[Matching v2] Starting — need={need_id!r} title={need.get('title')!r}")

    # ── 1. Load online volunteers ─────────────────────────────────────────────
    volunteers = _get_online_volunteers(db)
    if not volunteers:
        logger.info("[Matching v2] No online volunteers found.")
        return []

    # ── 2. Hard geo filter ────────────────────────────────────────────────────
    candidates = _geo_filter(volunteers, need)
    if not candidates:
        logger.info("[Matching v2] No volunteers within radius.")
        return []

    logger.info(f"[Matching v2] {len(candidates)} candidates after geo filter.")

    # ── 3. Lightweight pre-sort → trim pool to send to AI ────────────────────
    pool = _presort(candidates, need)[:PRE_SORT_POOL_SIZE]
    logger.info(f"[Matching v2] {len(pool)} candidates going to Gemini.")

    # ── 4. AI scoring (Gemini) ────────────────────────────────────────────────
    api_key = os.environ.get("GEMINI_API_KEY")
    if api_key:
        try:
            scored = _gemini_score_all(pool, need, api_key)
            logger.info(f"[Matching v2] Gemini scored {len(scored)} candidates.")
        except Exception as exc:
            logger.warning(f"[Matching v2] Gemini failed ({exc}), using fallback scores.")
            scored = _attach_fallback_scores(pool, need)
    else:
        logger.warning("[Matching v2] GEMINI_API_KEY not set — using keyword fallback.")
        scored = _attach_fallback_scores(pool, need)

    # Sort by AI score, take top N
    scored.sort(key=lambda v: v["_ai_score"], reverse=True)
    
    # Filter out irrelevant matches (score <= 10)
    final = [v for v in scored if v["_ai_score"] > 10][:MAX_MATCHES_PER_NEED]
    # ── 5. Write match documents ──────────────────────────────────────────────
    match_ids = _write_matches(db, need_id, need, final)

    # ── 6. Notify Volunteers ──────────────────────────────────────────────────
    from services import notification_service
    for vol in final:
        try:
            notification_service.notify_volunteer_matched(
                vol_id=vol["_vol_id"],
                need_title=need.get("title", "a new need"),
                need_id=need_id
            )
        except Exception as exc:
            logger.warning(f"[Matching v2] Notification failed for vol {vol['_vol_id']}: {exc}")

    # ── 7. Log NGO activity ───────────────────────────────────────────────────
    ngo_id = need.get("ngo_id")
    if ngo_id and match_ids:

        try:
            firebase_services.log_activity(
                ngo_id, "matched",
                f"{len(match_ids)} volunteer{'s' if len(match_ids) != 1 else ''} matched by AI",
                f'For need: "{need.get("title", "")}"'
            )
        except Exception as exc:
            logger.warning(f"[Matching v2] Activity log failed: {exc}")

    logger.info(f"[Matching v2] Done — {len(match_ids)} matches written for need={need_id!r}")
    return match_ids


# ═════════════════════════════════════════════════════════════════════════════
# STEP 2 — GEO FILTER  (only hard rule)
# ═════════════════════════════════════════════════════════════════════════════

def _geo_filter(volunteers: list[dict], need: dict) -> list[dict]:
    """
    Remove any volunteer whose service radius doesn't reach the need location.
    Volunteers with missing location data are kept — AI will factor that in.
    """
    need_loc = need.get("location", {})
    need_lat = need_loc.get("lat") if isinstance(need_loc, dict) else None
    need_lng = need_loc.get("lng") if isinstance(need_loc, dict) else None

    result = []
    for vol in volunteers:
        vol_loc = vol.get("location", {})
        vol_lat = vol_loc.get("lat")
        vol_lng = vol_loc.get("lng")

        if need_lat and need_lng and vol_lat and vol_lng:
            dist_km = _haversine(vol_lat, vol_lng, need_lat, need_lng)
            if dist_km > vol.get("radius", DEFAULT_RADIUS_KM):
                continue
            result.append({**vol, "_dist_km": round(dist_km, 2)})
        else:
            # Unknown location — keep, mark as unknown
            result.append({**vol, "_dist_km": None})

    return result


# ═════════════════════════════════════════════════════════════════════════════
# STEP 3 — LIGHTWEIGHT PRE-SORT  (trim before LLM call)
# ═════════════════════════════════════════════════════════════════════════════

def _presort(candidates: list[dict], need: dict) -> list[dict]:
    """
    Score by raw keyword overlap between the need text and the volunteer's
    combined skills + bio.  Used only to pick the top ~25 for Gemini.
    This does NOT produce the final score.
    """
    need_tokens = _tokenize(
        " ".join(need.get("required_skills") or []) + " " +
        need.get("category", "") + " " +
        need.get("description", "")[:200]
    )

    for vol in candidates:
        vol_text = " ".join([
            " ".join(vol.get("skills") or []),
            vol.get("about", ""),
        ])
        vol_tokens   = _tokenize(vol_text)
        overlap      = len(need_tokens & vol_tokens)
        dist         = vol.get("_dist_km") or DEFAULT_RADIUS_KM
        dist_bonus   = max(0.0, 1.0 - dist / DEFAULT_RADIUS_KM) * 0.5
        vol["_presort_score"] = overlap + dist_bonus

    candidates.sort(key=lambda v: v["_presort_score"], reverse=True)
    return candidates


def _tokenize(text: str) -> set[str]:
    """Lower-cased word tokens, 3+ chars, stop-words removed."""
    STOP = {
        "the","and","for","with","this","that","from","have","will",
        "need","are","was","were","been","has","had","not","but","its",
        "our","can","they","their","there","also","some","each","into"
    }
    return {w for w in re.findall(r'[a-z]+', text.lower())
            if len(w) >= 3 and w not in STOP}


# ═════════════════════════════════════════════════════════════════════════════
# STEP 4 — GEMINI AI SCORING  (the core evaluation)
# ═════════════════════════════════════════════════════════════════════════════

def _gemini_score_all(candidates: list[dict], need: dict, api_key: str) -> list[dict]:
    """
    Sends all candidates to Gemini in ONE call.
    Gemini evaluates every volunteer holistically and returns a score,
    reason, confidence, strengths, and concerns for each.

    Uses google.genai (new SDK) to match gemini_service.py.
    Thinking is OFF (budget=0) — matching data is already structured,
    no ambiguous inference needed here (that's gemini_service's job).
    """
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    generation_config = types.GenerateContentConfig(
        response_mime_type = "application/json",
        thinking_config    = types.ThinkingConfig(thinking_budget=0),
    )

    # Build compact need context
    need_ctx = {
        "title":            need.get("title", ""),
        "category":         need.get("category", ""),
        "description":      need.get("description", "")[:400],
        "required_skills":  need.get("required_skills", []),
        "urgency_label":    need.get("urgency_label", "MEDIUM"),
        "urgency_score":    need.get("urgency_score", 5),
        "location":         _location_str(need.get("location")),
        "estimated_people": need.get("estimated_people"),
    }

    # Build volunteer profiles — include bio (about) as the richest signal
    vol_profiles = []
    for i, vol in enumerate(candidates):
        vol_profiles.append({
            "index":            i,
            "skills":           vol.get("skills", []),
            "about":            (vol.get("about") or "")[:300],
            "availability":     vol.get("availability", ""),
            "distance_km":      vol.get("_dist_km"),
            "rating":           round(float(vol.get("rating", 0)), 1),
            "tasks_done":       int(vol.get("totalTasks", 0)),
            "verified":         bool(vol.get("verified", False)),
            "currently_online": vol.get("_is_online", False),
        })

    prompt = _build_prompt(need_ctx, vol_profiles)

    response = client.models.generate_content(
        model    = GEMINI_MODEL,
        contents = [prompt],
        #config   = generation_config,
    )

    results = _parse_response(response.text.strip(), len(candidates))

    # Merge AI results back onto volunteer dicts
    scored    = []
    seen_idx  = set()

    for r in results:
        idx = r.get("index")
        if idx is None or not (0 <= idx < len(candidates)):
            continue
        seen_idx.add(idx)
        scored.append({
            **candidates[idx],
            "_ai_score":      r["score"],
            "_ai_reason":     r["reason"],
            "_ai_confidence": r["confidence"],
            "_ai_strengths":  r["strengths"],
            "_ai_concerns":   r["concerns"],
        })

    # Safety net: any volunteer Gemini didn't mention gets a fallback entry
    for i, vol in enumerate(candidates):
        if i not in seen_idx:
            norm = round(vol.get("_presort_score", 0) * 3)
            scored.append({
                **vol,
                "_ai_score":      min(norm, 40),
                "_ai_reason":     _fallback_reason(vol, need),
                "_ai_confidence": "LOW",
                "_ai_strengths":  [],
                "_ai_concerns":   ["Not individually evaluated by AI"],
            })

    return scored


def _build_prompt(need: dict, volunteers: list[dict]) -> str:
    return f"""You are SevaSetu's AI volunteer matching engine for an NGO platform in India.

Your task: evaluate how well each volunteer fits the community need below, and assign a match score.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMMUNITY NEED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{json.dumps(need, indent=2, ensure_ascii=False)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VOLUNTEER PROFILES  ({len(volunteers)} candidates)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{json.dumps(volunteers, indent=2, ensure_ascii=False)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EVALUATION CRITERIA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Evaluate holistically. Do NOT mechanically add sub-scores. Consider:

1. SKILL INFERENCE FROM BIO  ← most important
   Read the "about" field carefully. A volunteer who writes "I'm a retired
   doctor running a community clinic" is far more suitable for a healthcare
   need than someone who just listed "First Aid". Infer real-world capability
   from what people write about themselves.

2. URGENCY ALIGNMENT
   urgency_score 8-10 = life-critical. Only give HIGH confidence to
   volunteers who are available anytime AND have real experience (tasks_done > 5,
   rating ≥ 4, or strong relevant bio).

3. PROXIMITY
   For physical/logistics needs, distance_km matters a lot.
   For remote/advisory needs (counseling, IT), it matters less.

4. RELIABILITY SIGNALS
   verified=true, high rating, many completed tasks = trustworthy.
   A new volunteer with a compelling bio can still score well.

5. AVAILABILITY FIT
   "Anytime" > "Weekends" for urgent needs.
   "Weekdays" is fine for planned/educational tasks.

Confidence levels:
  HIGH   — strong alignment on skills + availability + proximity
  MEDIUM — decent fit but some gaps
  LOW    — weak match, included only as a last resort

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return ONLY a valid JSON array. No markdown. No text outside the array.
Include ALL {len(volunteers)} volunteers (even poor fits — give them a low score).

Each element must have EXACTLY these fields:
{{
  "index":      0,
  "score":      85,
  "confidence": "HIGH",
  "reason":     "Single sentence max 20 words explaining the top reason for this score.",
  "strengths":  ["Strength 1", "Strength 2"],
  "concerns":   ["Concern if any, else empty array"]
}}

Scores must be integers 0–100.
"""


def _parse_response(raw: str, n_candidates: int) -> list[dict]:
    """Robustly parse Gemini's JSON response."""
    text = raw.strip()

    # Strip markdown fences
    for fence in ("```json", "```"):
        if text.startswith(fence):
            text = text[len(fence):]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    # Extract outermost JSON array
    match = re.search(r'\[.*\]', text, re.DOTALL)
    if not match:
        logger.error(f"[Matching v2] No JSON array in Gemini response: {text[:300]}")
        return []

    clean = re.sub(r',\s*([}\]])', r'\1', match.group(0))   # fix trailing commas

    try:
        data = json.loads(clean)
    except json.JSONDecodeError as exc:
        logger.error(f"[Matching v2] JSON parse failed: {exc} — raw={clean[:300]}")
        return []

    if not isinstance(data, list):
        return []

    results = []
    for item in data:
        if not isinstance(item, dict):
            continue
        results.append({
            "index":      int(item.get("index", 0)),
            "score":      max(0, min(100, int(item.get("score", 0)))),
            "confidence": str(item.get("confidence", "MEDIUM")).upper(),
            "reason":     str(item.get("reason", ""))[:200],
            "strengths":  [str(s) for s in (item.get("strengths") or [])[:3]],
            "concerns":   [str(c) for c in (item.get("concerns") or [])[:3]],
        })

    return results


# ═════════════════════════════════════════════════════════════════════════════
# FALLBACK — when Gemini is unavailable
# ═════════════════════════════════════════════════════════════════════════════

def _attach_fallback_scores(candidates: list[dict], need: dict) -> list[dict]:
    """
    Normalise pre-sort keyword scores to 0-70 range (capped below 75
    to signal to the NGO dashboard that these are not AI-evaluated).
    """
    max_s = max((v.get("_presort_score", 0) for v in candidates), default=1) or 1
    result = []
    for vol in candidates:
        norm = round((vol.get("_presort_score", 0) / max_s) * 70)
        result.append({
            **vol,
            "_ai_score":      norm,
            "_ai_reason":     _fallback_reason(vol, need),
            "_ai_confidence": "LOW",
            "_ai_strengths":  [],
            "_ai_concerns":   ["AI matching unavailable — scored by keyword overlap only"],
        })
    return result


def _fallback_reason(vol: dict, need: dict) -> str:
    parts = []
    vol_skills  = [s.lower() for s in (vol.get("skills") or [])]
    need_skills = [s.lower() for s in (need.get("required_skills") or [])]
    overlap = [s for s in need_skills if any(s in vs or vs in s for vs in vol_skills)]
    if overlap:
        parts.append(f"Skills match: {', '.join(overlap[:2])}")
    dist = vol.get("_dist_km")
    if dist is not None:
        parts.append(f"{dist:.1f} km away")
    if vol.get("rating", 0) >= 4.0:
        parts.append(f"Rated {vol['rating']:.1f}★")
    return (", ".join(parts) + ".") if parts else "Nearby volunteer with relevant profile."


# ═════════════════════════════════════════════════════════════════════════════
# FIRESTORE WRITE
# ═════════════════════════════════════════════════════════════════════════════

def _write_matches(db, need_id: str, need: dict, volunteers: list[dict]) -> list[str]:
    """
    Write one `matches` document per volunteer.
    Stores full AI reasoning so the NGO dashboard can show it.
    Schema is backward-compatible with firebase_services.get_suggested_matches_for_ngo().
    """
    batch     = db.batch()
    match_ids = []

    for rank, vol in enumerate(volunteers):
        ref = db.collection("matches").document()
        match_ids.append(ref.id)

        doc = {
            # Core identifiers
            "need_id":      need_id,
            "ngo_id":       need.get("ngo_id"),
            "volunteer_id": vol["_vol_id"],
            "status":       "suggested",
            "rank":         rank + 1,

            # AI evaluation — displayed in NGO dashboard
            "match_score":      vol["_ai_score"],          # 0-100
            "match_confidence": vol["_ai_confidence"],     # HIGH / MEDIUM / LOW
            "match_reason":     vol["_ai_reason"],         # one sentence for the NGO
            "match_strengths":  vol["_ai_strengths"],      # bullet points
            "match_concerns":   vol["_ai_concerns"],       # bullet points

            # Logistics
            "distance_km": vol.get("_dist_km"),

            # Timestamps
            "created_at": firestore.SERVER_TIMESTAMP,
        }
        batch.set(ref, doc)

    batch.commit()
    return match_ids


# ═════════════════════════════════════════════════════════════════════════════
# UTILITIES
# ═════════════════════════════════════════════════════════════════════════════

def _get_online_volunteers(db) -> list[dict]:
    docs = db.collection("volunteers").where("online", "==", True).stream()
    result = []
    for doc in docs:
        d = doc.to_dict()
        d["_vol_id"] = doc.id
        result.append(d)
    return result


def _location_str(loc) -> str:
    if not loc:
        return ""
    if isinstance(loc, str):
        return loc
    parts = [loc.get("city", ""), loc.get("address", "")]
    return ", ".join(p for p in parts if p)


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R    = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a    = (math.sin(dlat / 2) ** 2 +
            math.cos(math.radians(lat1)) *
            math.cos(math.radians(lat2)) *
            math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))