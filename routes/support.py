"""Support ticket routes."""
from flask import Blueprint, request, jsonify, session
from db_setup import get_db

support_bp = Blueprint("support", __name__)


def require_auth(f):
    from functools import wraps
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("user"):
            return jsonify({"error": "Not authenticated"}), 401
        return f(*args, **kwargs)
    return wrapper


@support_bp.route("/api/support/tickets")
@require_auth
def list_tickets():
    user = session["user"]
    db = get_db()
    rows = db.execute(
        "SELECT id, subject, message, status, admin_reply, created_at FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC",
        (user["id"],),
    ).fetchall()
    return jsonify([
        {"id": r[0], "subject": r[1], "message": r[2], "status": r[3], "admin_reply": r[4], "created_at": r[5]}
        for r in rows
    ])


@support_bp.route("/api/support/tickets", methods=["POST"])
@require_auth
def create_ticket():
    data = request.get_json(force=True) or {}
    subject = (data.get("subject") or "").strip()
    message = (data.get("message") or "").strip()

    if not subject or not message:
        return jsonify({"error": "Subject and message required"}), 400

    user = session["user"]
    db = get_db()
    db.execute(
        "INSERT INTO support_tickets (user_id, subject, message) VALUES (?, ?, ?)",
        (user["id"], subject, message),
    )
    db.commit()
    return jsonify({"ok": True, "message": "Ticket submitted!"})
