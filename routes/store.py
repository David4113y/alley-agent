"""Store routes — product listing, purchase."""
import os
from flask import Blueprint, request, jsonify, session
from db_setup import get_db

store_bp = Blueprint("store", __name__)


def require_auth(f):
    from functools import wraps
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("user"):
            return jsonify({"error": "Not authenticated"}), 401
        return f(*args, **kwargs)
    return wrapper


@store_bp.route("/api/store/products")
def list_products():
    db = get_db()
    rows = db.execute(
        "SELECT id, name, description, price_cents, category FROM store_products WHERE is_active = 1 ORDER BY id"
    ).fetchall()
    return jsonify([
        {"id": r[0], "name": r[1], "description": r[2], "price_cents": r[3], "category": r[4]}
        for r in rows
    ])


@store_bp.route("/api/store/purchase", methods=["POST"])
@require_auth
def purchase():
    data = request.get_json(force=True) or {}
    product_id = data.get("product_id")
    payment_method = data.get("payment_method")
    payment_ref = (data.get("payment_ref") or "").strip()

    if not product_id:
        return jsonify({"error": "Product ID required"}), 400
    if payment_method not in ("paypal", "crypto_ltc", "crypto_btc", "stripe"):
        return jsonify({"error": "Invalid payment method"}), 400

    db = get_db()
    product = db.execute(
        "SELECT id, price_cents FROM store_products WHERE id = ? AND is_active = 1", (product_id,)
    ).fetchone()
    if not product:
        return jsonify({"error": "Product not found"}), 404

    user = session["user"]
    db.execute(
        "INSERT INTO store_purchases (user_id, product_id, amount_cents, payment_method, payment_ref, status) VALUES (?, ?, ?, ?, ?, 'pending')",
        (user["id"], product[0], product[1], payment_method, payment_ref),
    )
    db.commit()
    return jsonify({"ok": True, "message": "Purchase submitted! Access will be granted once payment is verified."})


@store_bp.route("/api/store/my-purchases")
@require_auth
def my_purchases():
    user = session["user"]
    db = get_db()
    rows = db.execute("""
        SELECT sp.id, p.name, sp.amount_cents, sp.payment_method, sp.status, sp.created_at
        FROM store_purchases sp JOIN store_products p ON sp.product_id = p.id
        WHERE sp.user_id = ? ORDER BY sp.created_at DESC
    """, (user["id"],)).fetchall()
    return jsonify([
        {"id": r[0], "product_name": r[1], "amount_cents": r[2], "payment_method": r[3], "status": r[4], "created_at": r[5]}
        for r in rows
    ])
