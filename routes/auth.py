"""Auth routes — register, login, logout, me."""
from flask import Blueprint, request, jsonify, session
import bcrypt
from db_setup import get_db

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/api/auth/register", methods=["POST"])
def register():
    data = request.get_json(force=True)
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    email = (data.get("email") or "").strip() or None

    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400
    if len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if existing:
        return jsonify({"error": "Username already taken"}), 409

    if email:
        existing_email = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing_email:
            return jsonify({"error": "Email already in use"}), 409

    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(12)).decode()
    db.execute(
        "INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, 'user')",
        (username, email, pw_hash),
    )
    db.commit()

    user = db.execute(
        "SELECT id, username, role, email FROM users WHERE username = ?", (username,)
    ).fetchone()

    session["user"] = {"id": user[0], "username": user[1], "role": user[2], "email": user[3]}
    return jsonify({"ok": True, "user": session["user"]})


@auth_bp.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json(force=True)
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400

    db = get_db()
    user = db.execute(
        "SELECT id, username, password_hash, role, email, is_active FROM users WHERE username = ?",
        (username,),
    ).fetchone()

    if not user:
        return jsonify({"error": "Invalid credentials"}), 401

    if not user[5]:
        return jsonify({"error": "Account is disabled"}), 403

    if not bcrypt.checkpw(password.encode(), user[2].encode()):
        return jsonify({"error": "Invalid credentials"}), 401

    session["user"] = {"id": user[0], "username": user[1], "role": user[3], "email": user[4]}
    return jsonify({"ok": True, "user": session["user"]})


@auth_bp.route("/api/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@auth_bp.route("/api/auth/me")
def me():
    user = session.get("user")
    if not user:
        return jsonify({"user": None})
    return jsonify({"user": user})
