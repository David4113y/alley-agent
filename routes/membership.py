"""Membership routes — plans, subscribe, Stripe checkout, trial status."""
import os
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, session, redirect
from db_setup import get_db

membership_bp = Blueprint("membership", __name__)

PLANS = [
    {"id": "weekly", "label": "1 Week", "price": 25, "cents": 2500, "days": 7},
    {"id": "monthly", "label": "1 Month", "price": 50, "cents": 5000, "days": 30},
    {"id": "quarterly", "label": "3 Months", "price": 100, "cents": 10000, "days": 90},
    {"id": "semiannual", "label": "6 Months", "price": 200, "cents": 20000, "days": 180},
    {"id": "annual", "label": "1 Year", "price": 300, "cents": 30000, "days": 365},
]


def require_auth(f):
    from functools import wraps
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("user"):
            return jsonify({"error": "Not authenticated"}), 401
        return f(*args, **kwargs)
    return wrapper


@membership_bp.route("/api/membership/plans")
def get_plans():
    return jsonify({
        "plans": PLANS,
        "paypal": os.getenv("PAYPAL_ME_LINK", "https://paypal.me/DavidAlleyWay"),
        "crypto": {
            "ltc": {"currency": "LTC", "address": os.getenv("CRYPTO_WALLET_LTC", "ltc1qqkznja520xrwaqmc54vk84prfdtnxnmkceh6kq")},
            "btc": {"currency": "BTC", "address": os.getenv("CRYPTO_WALLET_BTC", "bc1qa3u30zsr34ha0q9kaqlf4rnhhcjn5raeuthysm")},
        },
    })


@membership_bp.route("/api/membership/subscribe", methods=["POST"])
@require_auth
def subscribe():
    data = request.get_json(force=True) or {}
    plan_id = data.get("plan_id")
    payment_method = data.get("payment_method")
    payment_ref = (data.get("payment_ref") or "").strip()

    plan = next((p for p in PLANS if p["id"] == plan_id), None)
    if not plan:
        return jsonify({"error": "Invalid plan"}), 400
    if payment_method not in ("paypal", "crypto_ltc", "crypto_btc"):
        return jsonify({"error": "Invalid payment method"}), 400
    if not payment_ref:
        return jsonify({"error": "Payment reference/transaction ID required"}), 400

    user = session["user"]
    db = get_db()
    now = datetime.utcnow().isoformat()

    db.execute(
        """INSERT INTO memberships (user_id, plan, amount_cents, payment_method, payment_ref, status, starts_at, expires_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)""",
        (user["id"], plan["id"], plan["cents"], payment_method, payment_ref, now),
    )
    db.commit()

    return jsonify({"ok": True, "message": "Payment submitted! Membership pending approval."})


@membership_bp.route("/api/membership/status")
@require_auth
def status():
    user = session["user"]
    db = get_db()

    active = db.execute(
        "SELECT plan, status, starts_at, expires_at FROM memberships WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 1",
        (user["id"],),
    ).fetchone()

    pending = db.execute(
        "SELECT plan, status, created_at FROM memberships WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
        (user["id"],),
    ).fetchone()

    return jsonify({
        "active": {"plan": active[0], "status": active[1], "starts_at": active[2], "expires_at": active[3]} if active else None,
        "pending": {"plan": pending[0], "status": pending[1], "created_at": pending[2]} if pending else None,
    })


@membership_bp.route("/api/membership/seen-store", methods=["POST"])
@require_auth
def seen_store():
    db = get_db()
    db.execute("UPDATE users SET has_seen_store = 1 WHERE id = ?", (session["user"]["id"],))
    db.commit()
    return jsonify({"ok": True})


@membership_bp.route("/api/membership/trial-status")
@require_auth
def trial_status():
    db = get_db()
    row = db.execute(
        "SELECT free_prompt_used, has_seen_store FROM users WHERE id = ?",
        (session["user"]["id"],),
    ).fetchone()
    return jsonify({
        "hasSeenStore": bool(row[1]) if row else False,
        "freePromptUsed": bool(row[0]) if row else False,
        "canTrial": bool(row and row[1] and not row[0]),
    })


@membership_bp.route("/api/membership/stripe-checkout", methods=["POST"])
@require_auth
def stripe_checkout():
    data = request.get_json(force=True) or {}
    plan_id = data.get("plan_id")
    plan = next((p for p in PLANS if p["id"] == plan_id), None)
    if not plan:
        return jsonify({"error": "Invalid plan"}), 400

    try:
        import stripe
        stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
        origin = request.host_url.rstrip("/")

        checkout_session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            mode="payment",
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "product_data": {
                        "name": f"Alleyesonme-AI — {plan['label']} Membership",
                        "description": f"{plan['label']} of unlimited AI assistant access",
                    },
                    "unit_amount": plan["cents"],
                },
                "quantity": 1,
            }],
            metadata={"plan_id": plan["id"], "user_id": str(session["user"]["id"])},
            success_url=f"{origin}/api/membership/stripe-success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{origin}/#membership",
        )
        return jsonify({"url": checkout_session.url})
    except Exception as e:
        print(f"Stripe error: {e}")
        return jsonify({"error": "Failed to create checkout session"}), 500


@membership_bp.route("/api/membership/stripe-success")
@require_auth
def stripe_success():
    session_id = request.args.get("session_id")
    if not session_id:
        return redirect("/#membership")

    try:
        import stripe
        stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
        checkout = stripe.checkout.Session.retrieve(session_id)

        if checkout.payment_status != "paid":
            return redirect("/#membership")

        plan_id = checkout.metadata.get("plan_id")
        user_id = checkout.metadata.get("user_id")
        plan = next((p for p in PLANS if p["id"] == plan_id), None)

        if not plan or not user_id:
            return redirect("/#membership")

        db = get_db()
        existing = db.execute(
            "SELECT id FROM memberships WHERE payment_ref = ? AND payment_method = 'stripe'",
            (checkout.id,),
        ).fetchone()

        if not existing:
            now = datetime.utcnow()
            expires = now + timedelta(days=plan["days"])
            db.execute(
                """INSERT INTO memberships (user_id, plan, amount_cents, payment_method, payment_ref, status, starts_at, expires_at)
                   VALUES (?, ?, ?, 'stripe', ?, 'active', ?, ?)""",
                (user_id, plan["id"], checkout.amount_total or plan["cents"], checkout.id, now.isoformat(), expires.isoformat()),
            )
            db.commit()

        return redirect("/#app")
    except Exception as e:
        print(f"Stripe success error: {e}")
        return redirect("/#membership")
