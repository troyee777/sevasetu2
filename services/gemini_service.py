"""
services/gemini_service.py
════════════════════════════════════════════════════════════════════
Extracts community needs from NGO field reports using Gemini.

Supported file types
────────────────────
  PDF   → sent as native PDF via Part.from_uri (all pages, up to 1000)
  JPG / PNG → sent as image via Part.from_uri
  DOCX  → downloaded, text extracted, sent as plain text prompt

Model choice
────────────
We use gemini-1.5-flash (not 2.5-flash) because:
  • Free tier: 15 RPM vs 5 RPM for 2.5-flash — 3x more headroom
  • Daily quota: 1M TPM vs 250K TPM — 4x more
  • Thinking via budget works on 1.5-flash too
  • For structured extraction from documents, 1.5-flash is more
    than sufficient and far more reliable under load

On quota errors (429)
─────────────────────
A 429 is RE-RAISED so the worker route returns HTTP 500.
QStash treats 5xx as a transient failure and retries automatically
(up to the retry limit set when the job was enqueued, with backoff).
This is correct behaviour — we want the job to retry later, not
silently succeed with 0 needs and mark the report as processed.
"""

import os
import json
import logging
import re

logger = logging.getLogger(__name__)

# ── Model ─────────────────────────────────────────────────────────────────────
# gemini-1.5-flash: 15 RPM / 1M TPM free tier — much more generous than 2.5-flash
GEMINI_MODEL = "gemini-2.5-flash"


# ══════════════════════════════════════════════════════════════
# PUBLIC ENTRY POINT
# ══════════════════════════════════════════════════════════════

def extract_needs_from_url(image_url: str, file_type: str = "") -> list[dict]:
    """
    Called by the QStash worker after a report is uploaded.

    Parameters
    ----------
    image_url : str   Public URL of the uploaded report (ImageKit CDN)
    file_type : str   Extension without dot, uppercase e.g. "PDF", "JPG", "DOCX"

    Returns
    -------
    list[dict]  Extracted need dicts (raises on quota/API errors so QStash retries)
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.error("[Gemini] GEMINI_API_KEY not set.")
        return []

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    ft = (file_type or "").lower().strip(".")

    # ── Resolve MIME type ──────────────────────────────────────────────────
    if ft == "pdf":
        mime_type = "application/pdf"
    elif ft == "png":
        mime_type = "image/png"
    else:
        mime_type = "image/jpeg"   # safe default for JPG / ImageKit URLs

    # Fallback: sniff from URL if file_type is missing
    if not ft:
        lower_url = image_url.lower().split("?")[0]
        mime_type = _detect_image_mime(lower_url)

    # ── Generation config ──────────────────────────────────────────────────
    # JSON output enforced + thinking budget for vague report inference.
    # gemini-1.5-flash supports thinking_budget via the new SDK.
    generation_config = types.GenerateContentConfig(
        response_mime_type = "application/json",
        thinking_config    = types.ThinkingConfig(thinking_budget=2048),
    )

    # ── Call Gemini ────────────────────────────────────────────────────────
    # NOTE: 429 and other API errors are NOT caught here — they propagate
    # up to the caller (worker_process_report in app.py).
    # The worker's except block catches them and returns HTTP 500,
    # which causes QStash to retry the job automatically.
    if ft == "docx":
        text = _extract_docx_text(image_url)
        prompt = f"Field report content:\n\n{text}\n\n{_build_prompt()}"
        response = client.models.generate_content(
            model    = GEMINI_MODEL,
            contents = [prompt],
            config   = generation_config,
        )
    else:
        # PDF and images: Gemini fetches the URL directly
        response = client.models.generate_content(
            model    = GEMINI_MODEL,
            contents = [
                types.Part.from_uri(
                    file_uri  = image_url,
                    mime_type = mime_type,
                ),
                _build_prompt(),
            ],
            config = generation_config,
        )

    return _parse_response(response.text.strip())


# ══════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════

def _detect_image_mime(url: str) -> str:
    if url.endswith(".png"):
        return "image/png"
    if url.endswith(".jpg") or url.endswith(".jpeg"):
        return "image/jpeg"
    return "image/jpeg"


def _extract_docx_text(url: str) -> str:
    import urllib.request
    import io
    from docx import Document

    with urllib.request.urlopen(url, timeout=15) as resp:
        data = resp.read()
    doc = Document(io.BytesIO(data))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())[:8000]


# ══════════════════════════════════════════════════════════════
# PROMPT
# ══════════════════════════════════════════════════════════════

def _build_prompt() -> str:
    return """
You are an AI assistant for SevaSetu, an NGO volunteer coordination platform.

Analyze this field report and extract ALL distinct community needs mentioned.
For each need, output a JSON object.

Return ONLY a valid JSON array. No markdown, no code fences, no explanations.
If no needs are found, return an empty array: []

Each object must have these exact fields:
{
  "title":               "Short descriptive title (max 10 words)",
  "description":         "Detailed description of the need (2-4 sentences)",
  "category":            "One of: Healthcare | Education | Logistics | Food & Nutrition | Shelter | Mental Health | Water & Sanitation | Environment | Other",
  "urgency_score":       8,
  "urgency_label":       "HIGH",
  "urgency_inferred":    true,
  "urgency_reason":      "Brief reason why this urgency was inferred",
  "required_skills":     ["Skill 1", "Skill 2"],
  "location":            "Specific location mentioned, or empty string",
  "beneficiaries":       "Who will benefit (e.g. '120 families', 'elderly residents')",
  "estimated_people":    120,
  "deadline_suggestion": "immediate | urgent | planned"
}

Urgency scoring guide:
- 9-10: Life-threatening, immediate medical/food/water crisis
- 7-8:  Serious issue affecting health or safety
- 5-6:  Moderate issue with near-term impact
- 3-4:  Planning-stage or non-urgent
- 1-2:  Long-term / informational

Required skills should be practical volunteer skills such as:
First Aid, Medical, Teaching, Driving, Logistics, Counseling,
Construction, Cooking, IT Support, Translation, etc.

IMPORTANT: Use your full reasoning ability to infer urgency and skills from context.
A report saying "children haven't eaten in two days" implies urgency 9, Food & Nutrition,
skills: Cooking, Logistics, Child Welfare — even if none of those words appear explicitly.

Extract as many distinct needs as mentioned in the report. Be specific.
"""


# ══════════════════════════════════════════════════════════════
# RESPONSE PARSER
# ══════════════════════════════════════════════════════════════

def _parse_response(raw: str) -> list[dict]:
    """Parse Gemini JSON response, handling markdown fences and trailing commas."""
    if not raw:
        return []

    text = raw.strip()

    # Strip markdown code fences
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)

    match = re.search(r'\[.*\]', text, re.DOTALL)
    if not match:
        logger.warning(f"[Gemini] No JSON array in response: {text[:200]}")
        return []

    json_str = match.group(0)
    json_str = re.sub(r',\s*([}\]])', r'\1', json_str)  # fix trailing commas

    try:
        needs = json.loads(json_str)
    except json.JSONDecodeError as exc:
        logger.error(f"[Gemini] JSON parse failed: {exc}\nRaw: {json_str[:400]}")
        return []

    if not isinstance(needs, list):
        return []

    sanitized = []
    for n in needs:
        if not isinstance(n, dict) or not n.get("title"):
            continue
        sanitized.append({
            "title":               str(n.get("title", ""))[:120],
            "description":         str(n.get("description", "")),
            "category":            str(n.get("category", "Other")),
            "urgency_score":       int(n.get("urgency_score", 5)),
            "urgency_label":       str(n.get("urgency_label", "MEDIUM")).upper(),
            "urgency_inferred":    bool(n.get("urgency_inferred", True)),
            "urgency_reason":      str(n.get("urgency_reason", "")),
            "required_skills":     [str(s) for s in (n.get("required_skills") or [])],
            "location":            str(n.get("location", "")),
            "beneficiaries":       str(n.get("beneficiaries", "")),
            "estimated_people":    _to_int(n.get("estimated_people")),
            "deadline_suggestion": str(n.get("deadline_suggestion", "planned")),
        })

    logger.info(f"[Gemini] Extracted {len(sanitized)} needs.")
    return sanitized


def _to_int(val):
    try:
        return int(val) if val is not None else None
    except (TypeError, ValueError):
        return None