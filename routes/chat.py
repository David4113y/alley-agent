"""Chat routes — conversation CRUD and LLM proxy with SSE streaming."""
import json
from flask import Blueprint, request, jsonify, session, Response, stream_with_context
from db_setup import get_db
from llm_provider import chat_with_llm

chat_bp = Blueprint("chat", __name__)


def require_membership(f):
    """Decorator: require active membership or allow free trial."""
    from functools import wraps

    @wraps(f)
    def wrapper(*args, **kwargs):
        user = session.get("user")
        if not user:
            return jsonify({"error": "Not authenticated"}), 401

        # Admin always has access
        if user.get("role") == "admin":
            request.is_trial_prompt = False
            return f(*args, **kwargs)

        db = get_db()
        # Check active membership
        active = db.execute(
            "SELECT id FROM memberships WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now')",
            (user["id"],),
        ).fetchone()

        if active:
            request.is_trial_prompt = False
            return f(*args, **kwargs)

        # Free trial check
        trial = db.execute(
            "SELECT free_prompt_used, has_seen_store FROM users WHERE id = ?",
            (user["id"],),
        ).fetchone()

        if trial and trial[1] and not trial[0]:
            request.is_trial_prompt = True
            return f(*args, **kwargs)

        return jsonify({"error": "Active membership required", "code": "MEMBERSHIP_REQUIRED"}), 403

    return wrapper


@chat_bp.route("/api/conversations")
def list_conversations():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    db = get_db()
    rows = db.execute(
        "SELECT id, title, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50",
        (user["id"],),
    ).fetchall()
    return jsonify([{"id": r[0], "title": r[1], "updated_at": r[2]} for r in rows])


@chat_bp.route("/api/conversations", methods=["POST"])
def create_conversation():
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    data = request.get_json(force=True) or {}
    title = data.get("title", "New Chat")
    db = get_db()
    cursor = db.execute(
        "INSERT INTO conversations (user_id, title) VALUES (?, ?)",
        (user["id"], title),
    )
    db.commit()
    return jsonify({"id": cursor.lastrowid})


@chat_bp.route("/api/conversations/<int:cid>", methods=["DELETE"])
def delete_conversation(cid):
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    db = get_db()
    db.execute("DELETE FROM messages WHERE conversation_id = ? AND conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)", (cid, user["id"]))
    db.execute("DELETE FROM conversations WHERE id = ? AND user_id = ?", (cid, user["id"]))
    db.commit()
    return jsonify({"ok": True})


@chat_bp.route("/api/conversations/<int:cid>/messages")
def get_messages(cid):
    user = session.get("user")
    if not user:
        return jsonify({"error": "Not authenticated"}), 401
    db = get_db()
    convo = db.execute(
        "SELECT id, title, summary FROM conversations WHERE id = ? AND user_id = ?",
        (cid, user["id"]),
    ).fetchone()
    if not convo:
        return jsonify({"error": "Not found"}), 404

    msgs = db.execute(
        "SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id",
        (cid,),
    ).fetchall()
    return jsonify({
        "conversation": {"id": convo[0], "title": convo[1], "summary": convo[2]},
        "messages": [{"role": m[0], "content": m[1], "created_at": m[2]} for m in msgs],
    })


@chat_bp.route("/api/conversations/<int:cid>/messages", methods=["POST"])
@require_membership
def send_message(cid):
    data = request.get_json(force=True) or {}
    content = (data.get("content") or "").strip()
    if not content:
        return jsonify({"error": "Message content required"}), 400

    user = session.get("user")
    db = get_db()

    convo = db.execute(
        "SELECT id, summary FROM conversations WHERE id = ? AND user_id = ?",
        (cid, user["id"]),
    ).fetchone()
    if not convo:
        return jsonify({"error": "Not found"}), 404

    def generate():
        def send_step(label, detail=""):
            yield f"data: {json.dumps({'type': 'step', 'label': label, 'detail': detail})}\n\n"

        try:
            yield from send_step("Saving your message...")

            db.execute(
                "INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)",
                (cid, content),
            )
            db.commit()

            yield from send_step("Loading conversation history...")

            history = db.execute(
                "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id",
                (cid,),
            ).fetchall()

            # Conversation length management
            if len(history) > 30:
                older = history[: len(history) - 10]
                recent = history[len(history) - 10 :]

                summary = convo[1]  # stored summary
                if not summary:
                    yield from send_step("Summarizing earlier messages...", f"{len(older)} messages condensed")
                    summary_prompt = [
                        {"role": "system", "content": "You are a conversation summarizer. Summarize concisely, preserving key facts, decisions, and context. Output 2-4 paragraphs. No fluff."},
                        {"role": "user", "content": "\n".join(f"{m[0]}: {m[1]}" for m in older)},
                    ]
                    summary = chat_with_llm(summary_prompt)
                    db.execute("UPDATE conversations SET summary = ? WHERE id = ?", (summary, cid))
                    db.commit()

                effective = [
                    {"role": "user", "content": f"[Summary of earlier conversation]\n{summary}"},
                    {"role": "assistant", "content": "Understood, I have context from our earlier conversation."},
                ] + [{"role": m[0], "content": m[1]} for m in recent]
            else:
                effective = [{"role": m[0], "content": m[1]} for m in history]

            # Per-user memory
            yield from send_step("Recalling what I know about you...")
            memory_row = db.execute(
                "SELECT memory_text FROM user_memories WHERE user_id = ?",
                (user["id"],),
            ).fetchone()
            existing_memory = memory_row[0] if memory_row else ""

            system_content = "You are Alleyesonme-AI, a helpful and knowledgeable AI assistant. Be concise, accurate, and helpful. Use markdown formatting when appropriate."
            if existing_memory:
                system_content += f"\n\nHere are things you remember about this user:\n{existing_memory}"
                yield from send_step("Personalizing with your preferences...")

            llm_messages = [{"role": "system", "content": system_content}] + effective

            yield from send_step("Generating response...", f"{len(llm_messages)} messages in context")

            reply = chat_with_llm(llm_messages)

            yield from send_step("Saving response...")

            db.execute(
                "INSERT INTO messages (conversation_id, role, content) VALUES (?, 'assistant', ?)",
                (cid, reply),
            )

            # Update title from first message
            if len(history) <= 1:
                title = content[:60] + ("..." if len(content) > 60 else "")
                db.execute("UPDATE conversations SET title = ? WHERE id = ?", (title, cid))

            db.execute("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?", (cid,))

            # Invalidate cached summary
            if convo[1] and len(history) > 30:
                db.execute("UPDATE conversations SET summary = NULL WHERE id = ?", (cid,))

            # Mark trial used
            if getattr(request, "is_trial_prompt", False):
                db.execute("UPDATE users SET free_prompt_used = 1 WHERE id = ?", (user["id"],))

            db.commit()

            # Background memory update every 6 messages
            if len(history) % 6 == 0 and len(history) > 0:
                yield from send_step("Updating memory...")
                try:
                    _update_memory(db, user["id"], history, existing_memory)
                except Exception as e:
                    print(f"Memory update error: {e}")

            yield f"data: {json.dumps({'type': 'response', 'role': 'assistant', 'content': reply, 'trialUsed': bool(getattr(request, 'is_trial_prompt', False))})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        except Exception as e:
            print(f"Chat error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'error': 'Failed to get response from AI'})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


def _update_memory(db, user_id, history, existing_memory):
    """Extract and update per-user memory."""
    recent = history[-10:] if len(history) > 10 else history
    conversation_text = "\n".join(f"{m[0]}: {m[1]}" for m in recent)

    prompt = [
        {"role": "system", "content": "Extract key facts about the user from this conversation. Include: name, preferences, projects, skills, goals. Output a concise bullet list. If there's existing memory, merge and deduplicate."},
        {"role": "user", "content": f"Existing memory:\n{existing_memory or '(none)'}\n\nRecent conversation:\n{conversation_text}"},
    ]

    new_memory = chat_with_llm(prompt)

    existing_row = db.execute("SELECT id FROM user_memories WHERE user_id = ?", (user_id,)).fetchone()
    if existing_row:
        db.execute(
            "UPDATE user_memories SET memory_text = ?, updated_at = datetime('now') WHERE user_id = ?",
            (new_memory, user_id),
        )
    else:
        db.execute(
            "INSERT INTO user_memories (user_id, memory_text) VALUES (?, ?)",
            (user_id, new_memory),
        )
    db.commit()
