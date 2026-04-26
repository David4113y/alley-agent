"""Arcade routes — game listing, play, upload."""
from flask import Blueprint, request, jsonify, session
from db_setup import get_db

arcade_bp = Blueprint("arcade", __name__)


@arcade_bp.route("/api/arcade/games")
def list_games():
    db = get_db()
    rows = db.execute("""
        SELECT g.id, g.title, g.description, COALESCE(u.username, 'Alleyesonme') as author, g.play_count, g.created_at
        FROM arcade_games g LEFT JOIN users u ON g.author_id = u.id
        WHERE g.is_approved = 1
        ORDER BY g.play_count DESC
    """).fetchall()
    return jsonify([
        {"id": r[0], "title": r[1], "description": r[2], "author": r[3], "play_count": r[4], "created_at": r[5]}
        for r in rows
    ])


@arcade_bp.route("/api/arcade/games/<int:gid>")
def get_game(gid):
    db = get_db()
    game = db.execute(
        "SELECT id, title, description, html_content, play_count FROM arcade_games WHERE id = ? AND is_approved = 1",
        (gid,),
    ).fetchone()
    if not game:
        return jsonify({"error": "Game not found"}), 404

    # Increment play count
    db.execute("UPDATE arcade_games SET play_count = play_count + 1 WHERE id = ?", (gid,))
    db.commit()

    return jsonify({
        "id": game[0], "title": game[1], "description": game[2],
        "html_content": game[3], "play_count": game[4] + 1,
    })


@arcade_bp.route("/api/arcade/upload", methods=["POST"])
def upload_game():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401

    data = request.get_json(force=True) or {}
    title = (data.get("title") or "").strip()
    description = (data.get("description") or "").strip()
    html_content = (data.get("html_content") or "").strip()

    if not title or not html_content:
        return jsonify({"error": "Title and HTML content required"}), 400

    db = get_db()

    # Admin games auto-approve
    is_approved = 1 if user.get("role") == "admin" else 0

    # Check membership for non-admin
    if user.get("role") != "admin":
        active = db.execute(
            "SELECT id FROM memberships WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now')",
            (user["id"],),
        ).fetchone()
        if not active:
            return jsonify({"error": "Active membership required to upload games"}), 403

    db.execute(
        "INSERT INTO arcade_games (title, description, html_content, author_id, is_approved) VALUES (?, ?, ?, ?, ?)",
        (title, description, html_content, user["id"], is_approved),
    )
    db.commit()

    msg = "Game published!" if is_approved else "Game submitted for admin approval!"
    return jsonify({"ok": True, "message": msg})
