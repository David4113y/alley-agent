"""Admin routes — user management, membership approval, stats, memories."""
import json
from flask import Blueprint, request, jsonify, session
import bcrypt
from db_setup import get_db

admin_bp = Blueprint("admin", __name__)


def require_admin(f):
    from functools import wraps
    @wraps(f)
    def wrapper(*args, **kwargs):
        user = session.get("user")
        if not user or user.get("role") != "admin":
            return jsonify({"error": "Admin access required"}), 403
        return f(*args, **kwargs)
    return wrapper


@admin_bp.route("/api/admin/stats")
@require_admin
def stats():
    db = get_db()
    users = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    active_memberships = db.execute(
        "SELECT COUNT(*) FROM memberships WHERE status = 'active' AND expires_at > datetime('now')"
    ).fetchone()[0]
    pending = db.execute("SELECT COUNT(*) FROM memberships WHERE status = 'pending'").fetchone()[0]
    conversations = db.execute("SELECT COUNT(*) FROM conversations").fetchone()[0]
    messages = db.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
    tickets = db.execute("SELECT COUNT(*) FROM support_tickets WHERE status = 'open'").fetchone()[0]
    tasks = db.execute("SELECT COUNT(*) FROM agent_tasks WHERE status = 'pending'").fetchone()[0]
    return jsonify({
        "users": users,
        "active_memberships": active_memberships,
        "pending_memberships": pending,
        "conversations": conversations,
        "messages": messages,
        "open_tickets": tickets,
        "pending_tasks": tasks,
    })


@admin_bp.route("/api/admin/users")
@require_admin
def list_users():
    db = get_db()
    rows = db.execute(
        "SELECT id, username, email, role, created_at, is_active FROM users ORDER BY id"
    ).fetchall()
    return jsonify([
        {"id": r[0], "username": r[1], "email": r[2], "role": r[3], "created_at": r[4], "is_active": r[5]}
        for r in rows
    ])


@admin_bp.route("/api/admin/users/<int:uid>/toggle", methods=["POST"])
@require_admin
def toggle_user(uid):
    db = get_db()
    user = db.execute("SELECT is_active FROM users WHERE id = ?", (uid,)).fetchone()
    if not user:
        return jsonify({"error": "User not found"}), 404
    new_status = 0 if user[0] else 1
    db.execute("UPDATE users SET is_active = ? WHERE id = ?", (new_status, uid))
    db.commit()
    return jsonify({"ok": True, "is_active": new_status})


@admin_bp.route("/api/admin/users/<int:uid>/role", methods=["POST"])
@require_admin
def change_role(uid):
    data = request.get_json(force=True) or {}
    role = data.get("role", "user")
    if role not in ("user", "admin", "vip"):
        return jsonify({"error": "Invalid role"}), 400
    db = get_db()
    db.execute("UPDATE users SET role = ? WHERE id = ?", (role, uid))
    db.commit()
    return jsonify({"ok": True})


@admin_bp.route("/api/admin/memberships")
@require_admin
def list_memberships():
    db = get_db()
    rows = db.execute("""
        SELECT m.id, u.username, m.plan, m.amount_cents, m.payment_method,
               m.payment_ref, m.status, m.starts_at, m.expires_at, m.created_at
        FROM memberships m JOIN users u ON m.user_id = u.id
        ORDER BY m.created_at DESC LIMIT 100
    """).fetchall()
    return jsonify([
        {"id": r[0], "username": r[1], "plan": r[2], "amount_cents": r[3],
         "payment_method": r[4], "payment_ref": r[5], "status": r[6],
         "starts_at": r[7], "expires_at": r[8], "created_at": r[9]}
        for r in rows
    ])


@admin_bp.route("/api/admin/memberships/<int:mid>/approve", methods=["POST"])
@require_admin
def approve_membership(mid):
    db = get_db()
    membership = db.execute("SELECT plan, status FROM memberships WHERE id = ?", (mid,)).fetchone()
    if not membership:
        return jsonify({"error": "Not found"}), 404
    if membership[1] != "pending":
        return jsonify({"error": "Not pending"}), 400

    plans_days = {"weekly": 7, "monthly": 30, "quarterly": 90, "semiannual": 180, "annual": 365}
    days = plans_days.get(membership[0], 30)

    from datetime import datetime, timedelta
    now = datetime.utcnow()
    expires = now + timedelta(days=days)

    db.execute(
        "UPDATE memberships SET status = 'active', starts_at = ?, expires_at = ? WHERE id = ?",
        (now.isoformat(), expires.isoformat(), mid),
    )
    db.commit()
    return jsonify({"ok": True})


@admin_bp.route("/api/admin/memberships/<int:mid>/reject", methods=["POST"])
@require_admin
def reject_membership(mid):
    db = get_db()
    db.execute("UPDATE memberships SET status = 'rejected' WHERE id = ?", (mid,))
    db.commit()
    return jsonify({"ok": True})


@admin_bp.route("/api/admin/change-password", methods=["POST"])
@require_admin
def change_password():
    data = request.get_json(force=True) or {}
    current = data.get("current_password", "")
    new_pw = data.get("new_password", "")

    if not current or not new_pw:
        return jsonify({"error": "Both passwords required"}), 400
    if len(new_pw) < 6:
        return jsonify({"error": "New password must be at least 6 characters"}), 400

    user = session.get("user")
    db = get_db()
    row = db.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],)).fetchone()

    if not bcrypt.checkpw(current.encode(), row[0].encode()):
        return jsonify({"error": "Current password is incorrect"}), 401

    new_hash = bcrypt.hashpw(new_pw.encode(), bcrypt.gensalt(12)).decode()
    db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, user["id"]))
    db.commit()
    return jsonify({"ok": True})


@admin_bp.route("/api/admin/memories")
@require_admin
def list_memories():
    db = get_db()
    rows = db.execute("""
        SELECT um.user_id, u.username, um.memory_text, um.updated_at
        FROM user_memories um JOIN users u ON um.user_id = u.id
        ORDER BY um.updated_at DESC
    """).fetchall()
    return jsonify([
        {"user_id": r[0], "username": r[1], "memory_text": r[2], "updated_at": r[3]}
        for r in rows
    ])


@admin_bp.route("/api/admin/memories/<int:uid>", methods=["DELETE"])
@require_admin
def delete_memory(uid):
    db = get_db()
    db.execute("DELETE FROM user_memories WHERE user_id = ?", (uid,))
    db.commit()
    return jsonify({"ok": True})


@admin_bp.route("/api/admin/tickets")
@require_admin
def list_all_tickets():
    db = get_db()
    rows = db.execute("""
        SELECT t.id, u.username, t.subject, t.message, t.status, t.admin_reply, t.created_at
        FROM support_tickets t JOIN users u ON t.user_id = u.id
        ORDER BY t.created_at DESC LIMIT 100
    """).fetchall()
    return jsonify([
        {"id": r[0], "username": r[1], "subject": r[2], "message": r[3],
         "status": r[4], "admin_reply": r[5], "created_at": r[6]}
        for r in rows
    ])


@admin_bp.route("/api/admin/tickets/<int:tid>/reply", methods=["POST"])
@require_admin
def reply_ticket(tid):
    data = request.get_json(force=True) or {}
    reply = (data.get("reply") or "").strip()
    if not reply:
        return jsonify({"error": "Reply required"}), 400
    db = get_db()
    db.execute(
        "UPDATE support_tickets SET admin_reply = ?, status = 'resolved', updated_at = datetime('now') WHERE id = ?",
        (reply, tid),
    )
    db.commit()
    return jsonify({"ok": True})


@admin_bp.route("/api/admin/arcade/pending")
@require_admin
def pending_games():
    db = get_db()
    rows = db.execute("""
        SELECT g.id, g.title, g.description, u.username, g.created_at
        FROM arcade_games g LEFT JOIN users u ON g.author_id = u.id
        WHERE g.is_approved = 0
        ORDER BY g.created_at DESC
    """).fetchall()
    return jsonify([
        {"id": r[0], "title": r[1], "description": r[2], "author": r[3], "created_at": r[4]}
        for r in rows
    ])


@admin_bp.route("/api/admin/arcade/<int:gid>/approve", methods=["POST"])
@require_admin
def approve_game(gid):
    db = get_db()
    db.execute("UPDATE arcade_games SET is_approved = 1 WHERE id = ?", (gid,))
    db.commit()
    return jsonify({"ok": True})


@admin_bp.route("/api/admin/arcade/<int:gid>/reject", methods=["POST"])
@require_admin
def reject_game(gid):
    db = get_db()
    db.execute("DELETE FROM arcade_games WHERE id = ?", (gid,))
    db.commit()
    return jsonify({"ok": True})
