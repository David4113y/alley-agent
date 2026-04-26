"""
Alleyesonme-AI — Main Flask Application
Full-stack AI agent platform with membership, store, arcade, and autonomous agents.
"""
import os
from dotenv import load_dotenv

load_dotenv()

from flask import Flask, render_template, session
from flask_cors import CORS
from db_setup import init_db

# Import blueprints
from routes.auth import auth_bp
from routes.chat import chat_bp
from routes.admin import admin_bp
from routes.membership import membership_bp
from routes.support import support_bp
from routes.store import store_bp
from routes.arcade import arcade_bp
from routes.agent import agent_bp


def create_app():
    app = Flask(__name__, static_folder="static", template_folder="templates")
    app.secret_key = os.getenv("FLASK_SECRET_KEY", "alleyesonme-secret-change-me")
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_SECURE"] = os.getenv("FLASK_ENV") == "production"
    app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16MB

    CORS(app, supports_credentials=True)

    # Register blueprints
    app.register_blueprint(auth_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(membership_bp)
    app.register_blueprint(support_bp)
    app.register_blueprint(store_bp)
    app.register_blueprint(arcade_bp)
    app.register_blueprint(agent_bp)

    # Main SPA route
    @app.route("/")
    def index():
        user = session.get("user")
        return render_template("index.html", user=user)

    # Health check
    @app.route("/health")
    def health():
        from llm_provider import get_provider_status
        return {"status": "ok", "providers": get_provider_status()}

    # Initialize database
    with app.app_context():
        init_db()

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.getenv("PORT", 10000))
    app.run(host="0.0.0.0", port=port, debug=True)
