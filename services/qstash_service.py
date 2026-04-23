"""
services/qstash_service.py
════════════════════════════════════════════════════════════════════
Thin wrapper around the Upstash QStash HTTP API.

QStash acts like a managed background job queue.  Instead of
threading.Thread(...).start(), you call qstash_service.enqueue(...)
and QStash makes a POST request to your own endpoint after the
current request has already returned to the user.

Environment variables required
───────────────────────────────
  QSTASH_TOKEN          — from Upstash console → QStash → Tokens
  QSTASH_CURRENT_SIGNING_KEY  — for verifying incoming callbacks
  QSTASH_NEXT_SIGNING_KEY     — for key rotation
  APP_BASE_URL          — e.g. https://sevasetu.vercel.app
                          (no trailing slash)

How it works
────────────
  1. Your route calls  enqueue_report_processing(report_id, ...)
  2. This function POSTs to https://qstash.upstash.io/v2/publish/...
     telling QStash: "call MY endpoint /api/internal/process-report
     with this JSON body in 2 seconds"
  3. QStash calls your endpoint.  Vercel spins up a fresh instance.
  4. Your worker runs Gemini, updates Firestore, done.

Retry behaviour (built into QStash)
────────────────────────────────────
  QStash automatically retries failed callbacks up to 3 times with
  exponential backoff.  You don't need to implement any retry logic.

Local development
─────────────────
  QStash can't reach localhost.  Use ngrok or set
  APP_BASE_URL to your ngrok tunnel.  Alternatively, call the
  worker functions directly (bypassing QStash) in dev — the same
  functions are imported by both routes.
"""

import os
import hmac
import hashlib
import base64
import json
import logging
from typing import Any
from upstash_qstash import Receiver

import requests   # pip install requests  (already used in most Flask projects)

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
QSTASH_PUBLISH_URL = "https://qstash-us-east-1.upstash.io/v2/publish"
_TOKEN             = None   # loaded lazily so import doesn't fail at cold start


def _token() -> str:
    global _TOKEN
    if not _TOKEN:
        _TOKEN = os.environ.get("QSTASH_TOKEN", "")
        if not _TOKEN:
            raise RuntimeError(
                "QSTASH_TOKEN environment variable is not set. "
                "Get it from https://console.upstash.com/qstash"
            )
    return _TOKEN


def _base_url() -> str:
    url = os.environ.get("APP_BASE_URL", "").rstrip("/")
    if not url:
        raise RuntimeError(
            "APP_BASE_URL environment variable is not set. "
            "Set it to your Vercel deployment URL, e.g. https://sevasetu.vercel.app"
        )
    return url


# ═════════════════════════════════════════════════════════════════════════════
# PUBLIC HELPERS — one function per job type
# ═════════════════════════════════════════════════════════════════════════════

def enqueue_report_processing(report_id: str, ngo_uid: str, image_url: str, file_name: str, file_type: str) -> bool:
    """
    Tell QStash to call  POST /api/internal/process-report  in ~2 seconds.
    Returns True if the message was accepted, False on error.
    """
    return _publish(
        endpoint  = "/api/internal/process-report",
        body      = {
            "report_id":  report_id,
            "ngo_uid":    ngo_uid,
            "image_url":  image_url,
            "file_name":  file_name,
            "file_type": file_type,   # "pdf", "jpg", "docx" etc — already stored in Firestore
        },
        delay_secs = 2,
        retries    = 3,
    )


def enqueue_matching(need_id: str, need_data: dict) -> bool:
    """
    Tell QStash to call  POST /api/internal/run-matching  in ~3 seconds.
    Returns True if the message was accepted, False on error.

    We delay 3 seconds so Firestore has time to finish writing
    the need document before the matching worker reads it.
    """
    # need_data may contain Firestore SERVER_TIMESTAMP sentinel which
    # is not JSON-serialisable.  Replace it with None.
    safe_need = {
        k: (None if hasattr(v, "__class__") and "Sentinel" in type(v).__name__ else v)
        for k, v in need_data.items()
    }

    return _publish(
        endpoint  = "/api/internal/run-matching",
        body      = {
            "need_id":   need_id,
            "need_data": safe_need,
        },
        delay_secs = 3,
        retries    = 2,   # matching is less critical to retry aggressively
    )


# ═════════════════════════════════════════════════════════════════════════════
# SIGNATURE VERIFICATION  (call this in your worker routes)
# ═════════════════════════════════════════════════════════════════════════════
"""
    Verify that an incoming request to /api/internal/* actually came from
    QStash and not a random external caller.

    Usage in a Flask route:
        raw_body = request.get_data()
        sig      = request.headers.get("Upstash-Signature", "")
        if not qstash_service.verify_qstash_signature(raw_body, sig):
            return jsonify({"error": "Invalid signature"}), 401

    How it works:
        QStash signs the request body with your signing key using HMAC-SHA256.
        We verify the signature here before trusting the payload.
"""


# Initialize once at the top
receiver = Receiver(
    current_signing_key=os.environ.get("QSTASH_CURRENT_SIGNING_KEY", ""),
    next_signing_key=os.environ.get("QSTASH_NEXT_SIGNING_KEY", "")
)

def verify_qstash_signature(request_body: bytes, signature_header: str) -> bool:
    if not os.environ.get("QSTASH_CURRENT_SIGNING_KEY"):
        return True # Skip in local dev
        
    try:
        # The official SDK handles all the HMAC/Canonicalization logic
        return receiver.verify(
            body=request_body,
            signature=signature_header
        )
    except Exception as e:
        logger.error(f"Signature verification error: {e}")
        return False

# ═════════════════════════════════════════════════════════════════════════════
# INTERNAL — low-level publish call
# ═════════════════════════════════════════════════════════════════════════════

def _publish(endpoint: str, body: dict, delay_secs: int = 0, retries: int = 3) -> bool:
    """
    POST a message to QStash.

    QStash will then make a POST request to:
        {APP_BASE_URL}{endpoint}
    with the given body after `delay_secs` seconds.
    """
    destination = f"{_base_url()}{endpoint}"

    headers = {
        "Authorization":        f"Bearer {_token()}",
        "Content-Type":         "application/json",
        "Upstash-Retries":      str(retries),
    }

    if delay_secs > 0:
        headers["Upstash-Delay"] = f"{delay_secs}s"

    try:
        resp = requests.post(
            f"{QSTASH_PUBLISH_URL}/{destination}",
            headers = headers,
            data    = json.dumps(body),
            timeout = 10,
        )

        if resp.status_code in (200, 201, 202):
            msg_id = resp.json().get("messageId", "?")
            logger.info(f"[QStash] Enqueued → {endpoint}  messageId={msg_id}")
            return True
        else:
            logger.error(
                f"[QStash] Failed to enqueue → {endpoint} "
                f"status={resp.status_code} body={resp.text[:200]}"
            )
            return False

    except Exception as exc:
        logger.error(f"[QStash] Exception while publishing to {endpoint}: {exc}")
        return False
