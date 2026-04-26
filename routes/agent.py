"""Agent task routes — autonomous task execution for members."""
import json
import threading
from flask import Blueprint, request, jsonify, session
from db_setup import get_db
from llm_provider import chat_with_llm

agent_bp = Blueprint("agent", __name__)


def require_auth(f):
    from functools import wraps
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("user"):
            return jsonify({"error": "Not authenticated"}), 401
        return f(*args, **kwargs)
    return wrapper


AGENT_CAPABILITIES = [
    {"id": "research", "name": "Research", "description": "Deep research on any topic with sources and analysis", "icon": "search"},
    {"id": "write", "name": "Content Writing", "description": "Blog posts, articles, social media content, emails", "icon": "edit"},
    {"id": "code", "name": "Code Generation", "description": "Write, review, and debug code in any language", "icon": "code"},
    {"id": "analyze", "name": "Data Analysis", "description": "Analyze data, generate insights, create summaries", "icon": "chart"},
    {"id": "plan", "name": "Project Planning", "description": "Create project plans, timelines, task breakdowns", "icon": "calendar"},
    {"id": "translate", "name": "Translation", "description": "Translate text between languages accurately", "icon": "globe"},
    {"id": "summarize", "name": "Summarization", "description": "Summarize documents, articles, or conversations", "icon": "compress"},
    {"id": "brainstorm", "name": "Brainstorming", "description": "Generate ideas, creative solutions, strategies", "icon": "lightbulb"},
]


@agent_bp.route("/api/agent/capabilities")
def capabilities():
    return jsonify(AGENT_CAPABILITIES)


@agent_bp.route("/api/agent/tasks")
@require_auth
def list_tasks():
    user = session["user"]
    db = get_db()
    rows = db.execute(
        "SELECT id, task_type, description, status, result, created_at, updated_at FROM agent_tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
        (user["id"],),
    ).fetchall()
    return jsonify([
        {"id": r[0], "task_type": r[1], "description": r[2], "status": r[3],
         "result": r[4], "created_at": r[5], "updated_at": r[6]}
        for r in rows
    ])


@agent_bp.route("/api/agent/tasks", methods=["POST"])
@require_auth
def create_task():
    user = session["user"]
    data = request.get_json(force=True) or {}
    task_type = data.get("task_type", "")
    description = (data.get("description") or "").strip()

    if not task_type or not description:
        return jsonify({"error": "Task type and description required"}), 400

    # Verify capability
    valid_types = [c["id"] for c in AGENT_CAPABILITIES]
    if task_type not in valid_types:
        return jsonify({"error": "Invalid task type"}), 400

    # Check membership (admin always allowed)
    db = get_db()
    if user.get("role") != "admin":
        active = db.execute(
            "SELECT id FROM memberships WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now')",
            (user["id"],),
        ).fetchone()
        if not active:
            return jsonify({"error": "Active membership required", "code": "MEMBERSHIP_REQUIRED"}), 403

    cursor = db.execute(
        "INSERT INTO agent_tasks (user_id, task_type, description, status) VALUES (?, ?, ?, 'processing')",
        (user["id"], task_type, description),
    )
    db.commit()
    task_id = cursor.lastrowid

    # Process task in background thread
    thread = threading.Thread(target=_process_task, args=(task_id, user["id"], task_type, description))
    thread.daemon = True
    thread.start()

    return jsonify({"ok": True, "task_id": task_id, "status": "processing"})


@agent_bp.route("/api/agent/tasks/<int:tid>")
@require_auth
def get_task(tid):
    user = session["user"]
    db = get_db()
    row = db.execute(
        "SELECT id, task_type, description, status, result, created_at, updated_at FROM agent_tasks WHERE id = ? AND user_id = ?",
        (tid, user["id"]),
    ).fetchone()
    if not row:
        return jsonify({"error": "Task not found"}), 404
    return jsonify({
        "id": row[0], "task_type": row[1], "description": row[2], "status": row[3],
        "result": row[4], "created_at": row[5], "updated_at": row[6],
    })


def _process_task(task_id, user_id, task_type, description):
    """Process an agent task in background."""
    from db_setup import get_db as _get_db
    try:
        db = _get_db()

        # Build specialized system prompt based on task type
        system_prompts = {
            "research": "You are a thorough research agent. Provide comprehensive, well-structured research with key findings, analysis, and actionable insights. Cite sources where possible. Use markdown formatting.",
            "write": "You are a professional content writer. Create polished, engaging content tailored to the user's needs. Use appropriate tone and formatting.",
            "code": "You are an expert software engineer. Write clean, well-documented code. Include comments, handle edge cases, and follow best practices. Provide the code in markdown code blocks.",
            "analyze": "You are a data analyst. Provide structured analysis with key metrics, trends, insights, and recommendations. Use tables and lists for clarity.",
            "plan": "You are a project manager. Create detailed project plans with milestones, timelines, task breakdowns, dependencies, and resource estimates.",
            "translate": "You are a professional translator. Provide accurate, natural-sounding translations preserving meaning and tone.",
            "summarize": "You are a summarization specialist. Create concise, accurate summaries that capture key points, main arguments, and important details.",
            "brainstorm": "You are a creative strategist. Generate diverse, innovative ideas. Organize by category, evaluate feasibility, and provide implementation suggestions.",
        }

        system_content = system_prompts.get(task_type, "You are a helpful AI agent. Complete the task thoroughly and professionally.")
        system_content += "\n\nYou are working as an autonomous agent for the Alleyesonme-AI platform. Complete the task fully and deliver a comprehensive result."

        # Load user memory for personalization
        memory_row = db.execute("SELECT memory_text FROM user_memories WHERE user_id = ?", (user_id,)).fetchone()
        if memory_row and memory_row[0]:
            system_content += f"\n\nContext about this user:\n{memory_row[0]}"

        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": f"Task: {description}"},
        ]

        result = chat_with_llm(messages)

        db.execute(
            "UPDATE agent_tasks SET status = 'completed', result = ?, updated_at = datetime('now') WHERE id = ?",
            (result, task_id),
        )
        db.commit()

    except Exception as e:
        print(f"Agent task {task_id} failed: {e}")
        try:
            db = _get_db()
            db.execute(
                "UPDATE agent_tasks SET status = 'failed', result = ?, updated_at = datetime('now') WHERE id = ?",
                (f"Error: {str(e)}", task_id),
            )
            db.commit()
        except Exception:
            pass
