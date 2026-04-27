import logging
import os
import firebase_admin
from firebase_admin import messaging, firestore
from services import firebase_services

logger = logging.getLogger(__name__)

def send_fcm_notification(uid, title, body, data=None):
    """
    Sends a push notification to all registered FCM tokens for a specific user.
    If a token is invalid (expired/uninstalled), it is removed from the user's document.
    """
    db = firebase_services.get_db()
    
    # 1. Get user notification state and tokens
    notif_enabled, tokens = firebase_services.get_user_notification_state(uid)
    
    if not notif_enabled or not tokens:
        logger.info(f"[FCM] Notifications disabled or no tokens for user {uid}")
        return False

    # 2. Prepare the notification
    # Ensure all data values are strings (required by FCM)
    fcm_data = {}
    if data:
        for k, v in data.items():
            fcm_data[str(k)] = str(v)

    click_action = fcm_data.get("click_action") or "/"
    app_base_url = os.environ.get("APP_BASE_URL", "").rstrip("/")
    webpush_link = (
        f"{app_base_url}{click_action}"
        if app_base_url.startswith(("https://", "http://")) and click_action.startswith("/")
        else click_action
    )
    webpush_options = None
    if webpush_link.startswith(("https://", "http://")):
        webpush_options = messaging.WebpushFCMOptions(link=webpush_link)

    message = messaging.MulticastMessage(
        notification=messaging.Notification(
            title=title,
            body=body,
        ),
        data=fcm_data,
        webpush=messaging.WebpushConfig(
            notification=messaging.WebpushNotification(
                title=title,
                body=body,
                icon="/static/images/only_logo.png",
                badge="/static/images/only_logo.png",
                tag=fcm_data.get("type", "sevasetu-notification"),
                data=fcm_data,
            ),
            fcm_options=webpush_options,
        ),
        tokens=tokens,
    )

    # 3. Send
    try:
        response = messaging.send_each_for_multicast(message)
        logger.info(f"[FCM] Sent to {uid}. Success: {response.success_count}, Failure: {response.failure_count}")

        # 4. Clean up invalid tokens
        if response.failure_count > 0:
            invalid_tokens = []
            for idx, res in enumerate(response.responses):
                if not res.success:
                    # Token is either invalid or expired
                    invalid_tokens.append(tokens[idx])
            
            if invalid_tokens:
                logger.info(f"[FCM] Removing {len(invalid_tokens)} stale tokens for user {uid}")
                db.collection("users").document(uid).update({
                    "fcm_tokens": firestore.ArrayRemove(invalid_tokens)
                })

        return response.success_count > 0
    except Exception as e:
        logger.error(f"[FCM] Error sending to user {uid}: {e}")
        return False

def notify_volunteer_matched(vol_id, need_title, need_id):
    """Notify a volunteer that they have been matched with a new need."""
    return send_fcm_notification(
        uid=vol_id,
        title="New Potential Match! 🤝",
        body=f"You've been matched with: {need_title}. Check it out on your dashboard!",
        data={
            "type": "match_suggested",
            "need_id": need_id,
            "click_action": "/volunteer/dashboard"
        }
    )

def notify_volunteer_assigned(vol_id, need_title, ngo_name):
    """Notify a volunteer that an NGO has approved them/assigned them."""
    return send_fcm_notification(
        uid=vol_id,
        title="You're Assigned! 🚀",
        body=f"{ngo_name} has approved your match for '{need_title}'. You can start now!",
        data={
            "type": "match_assigned",
            "click_action": "/volunteer/dashboard"
        }
    )

def notify_ngo_volunteer_accepted(ngo_id, vol_name, need_title):
    """Notify an NGO that a volunteer has accepted a match."""
    return send_fcm_notification(
        uid=ngo_id,
        title="Volunteer Accepted! ✅",
        body=f"{vol_name} has accepted the task: '{need_title}'.",
        data={
            "type": "volunteer_accepted",
            "click_action": "/ngo/dashboard"
        }
    )

def notify_new_message(sender_name, recipient_uid, message_text, conversation_id):
    """Notify a user about a new chat message."""
    preview = message_text if len(message_text) < 100 else f"{message_text[:97]}..."
    return send_fcm_notification(
        uid=recipient_uid,
        title=f"New message from {sender_name}",
        body=preview,
        data={
            "type": "new_message",
            "conversation_id": conversation_id,
            "sender_name": sender_name,
            "message_preview": preview,
            "click_action": f"/inbox?conv_id={conversation_id}"
        }
    )
    
def notify_ngo_report_submitted(ngo_id, vol_name, need_title, need_id):
    """Notify an NGO that a volunteer has submitted a completion report."""
    return send_fcm_notification(
        uid=ngo_id,
        title="Completion Report Submitted! 📄",
        body=f"{vol_name} has submitted a report for '{need_title}'. Please review it.",
        data={
            "type": "report_submitted",
            "need_id": need_id,
            "click_action": f"/ngo/report/review/{need_id}"
        }
    )

