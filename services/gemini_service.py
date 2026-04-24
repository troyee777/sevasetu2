"""
services/gemini_service.py
════════════════════════════════════════════════════════════════════
Extracts community needs from NGO field reports using Gemini 2.5 Flash.

Supported file types
────────────────────
  PDF   → sent as native PDF via Part.from_uri  (all pages, up to 1000)
  JPG / PNG → sent as image via Part.from_uri
  DOCX  → downloaded, text extracted, sent as plain text prompt

FIX LOG
───────
v2  Single SDK: google.genai only (not mixed with google.generativeai).
    generation_config was built but never passed to generate_content — fixed.
    Thinking budget (8192) now actually applied.
    DOCX path now also passes generation_config.
    Removed dead _pdf_first_page_bytes() helper (no longer needed).
"""

import os
import json
import logging
import re

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-1.5-flash"   # cheaper, faster, and better at structured output than 2.5 for our use case


# ══════════════════════════════════════════════════════════════
# PUBLIC ENTRY POINT
# ══════════════════════════════════════════════════════════════

def extract_needs_from_url(image_url: str, file_type: str = "") -> list[dict]:
    """
    Main entry point called by the QStash worker.

    Parameters
    ----------
    image_url : str   Public URL of the uploaded report (ImageKit CDN)
    file_type : str   Extension without dot, e.g. "PDF", "JPG", "DOCX"
                      (already stored in Firestore by the upload route)

    Returns
    -------
    list[dict]  List of extracted need dicts (may be empty on error)
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.error("[Gemini] GEMINI_API_KEY not set.")
        return []

    # ── Only import the new SDK ────────────────────────────────────────────
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    ft = (file_type or "").lower().strip(".")

    # ── Resolve MIME type from the stored file_type ────────────────────────
    # Prefer the stored file_type over URL sniffing — ImageKit URLs often
    # have query params or transformation segments that obscure the extension.
    if ft == "pdf":
        mime_type = "application/pdf"
    elif ft == "png":
        mime_type = "image/png"
    else:
        # jpg / jpeg / unknown image → JPEG is the safe default for ImageKit
        mime_type = "image/jpeg"

    # Fallback: if file_type was empty, sniff from the URL
    if not ft:
        lower_url = image_url.lower().split("?")[0]
        mime_type = _detect_image_mime(lower_url)

    # ── Generation config: JSON output + thinking ON ──────────────────────
    # Thinking (budget=8192) is critical for vague field reports where
    # urgency / skills are implied rather than stated explicitly.
    generation_config = types.GenerateContentConfig(
        response_mime_type = "application/json",
        thinking_config    = types.ThinkingConfig(thinking_budget=8192),
    )

    try:
        # ── DOCX: download + extract text, then send as plain text ────────
        if ft == "docx":
            text = _extract_docx_text(image_url)
            prompt = f"Field report content:\n\n{text}\n\n{_build_prompt()}"
            response = client.models.generate_content(
                model    = GEMINI_MODEL,
                contents = [prompt],
                config   = generation_config,      # ← was missing before
            )
            return _parse_response(response.text.strip())

        # ── PDF / Image: let Gemini fetch the URL directly ─────────────────
        response = client.models.generate_content(
            model    = GEMINI_MODEL,
            contents = [
                types.Part.from_uri(
                    file_uri  = image_url,   # Gemini fetches this — no download needed
                    mime_type = mime_type,
                ),
                _build_prompt(),
            ],
            config = generation_config,            # ← was missing before
        )
        return _parse_response(response.text.strip())

    except Exception as exc:
        logger.error(f"[Gemini] Extraction error: {exc}", exc_info=True)
        return []


# ══════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════

def _detect_image_mime(url: str) -> str:
    """Fallback MIME detection from URL extension (no query params)."""
    if url.endswith(".png"):
        return "image/png"
    if url.endswith(".jpg") or url.endswith(".jpeg"):
        return "image/jpeg"
    return "image/jpeg"   # safe default for ImageKit CDN URLs


def _extract_docx_text(url: str) -> str:
    """Download a DOCX from a URL and return its plain text (max 8000 chars)."""
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
    """
    Safely parse Gemini's response.
    Handles accidental markdown fences and trailing commas.
    """
    if not raw:
        return []

    text = raw.strip()

    # Strip markdown code fences if present
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)

    # Find the outermost JSON array
    match = re.search(r'\[.*\]', text, re.DOTALL)
    if not match:
        logger.warning(f"[Gemini] No JSON array in response: {text[:200]}")
        return []

    json_str = match.group(0)

    # Fix trailing commas before } or ]
    json_str = re.sub(r',\s*([}\]])', r'\1', json_str)

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