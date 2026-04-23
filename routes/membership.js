/**
 * Membership routes — plans, payment submission, Stripe checkout, status.
 */
const express = require("express");
const { getDb } = require("../db/setup");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

const PLANS = [
  { id: "weekly",      label: "1 Week",    price: 25,  cents: 2500,  days: 7   },
  { id: "monthly",     label: "1 Month",   price: 50,  cents: 5000,  days: 30  },
  { id: "quarterly",   label: "3 Months",  price: 100, cents: 10000, days: 90  },
  { id: "semiannual",  label: "6 Months",  price: 200, cents: 20000, days: 180 },
  { id: "annual",      label: "1 Year",    price: 300, cents: 30000, days: 365 },
];

// GET /api/membership/plans
router.get("/plans", (_req, res) => {
  res.json({
    plans: PLANS,
    paypal: process.env.PAYPAL_ME_LINK || "https://paypal.me/DavidAlleyWay",
    crypto: {
      ltc: {
        currency: "LTC",
        address: process.env.CRYPTO_WALLET_LTC || process.env.CRYPTO_WALLET_ADDRESS || "ltc1qqkznja520xrwaqmc54vk84prfdtnxnmkceh6kq",
      },
      btc: {
        currency: "BTC",
        address: process.env.CRYPTO_WALLET_BTC || "bc1qa3u30zsr34ha0q9kaqlf4rnhhcjn5raeuthysm",
      },
    },
  });
});

// --- Email helper for new membership notifications ---
async function sendNewMembershipAlert(username, plan, amount, paymentMethod, paymentRef) {
  const adminEmail = process.env.ADMIN_EMAIL || "davidalleyway@gmail.com";
  const resendKey = process.env.RESEND_API_KEY;

  if (!resendKey) {
    console.warn("RESEND_API_KEY not set — skipping new membership email alert.");
    return;
  }

  try {
    const methodLabel = paymentMethod === "paypal" ? "PayPal" : paymentMethod === "crypto_btc" ? "Bitcoin (BTC)" : "Litecoin (LTC)";
    const timestamp = new Date().toISOString();

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Alleyesonme-AI <onboarding@resend.dev>",
        to: [adminEmail],
        subject: `NEW MEMBERSHIP: ${username} — ${plan} ($${(amount / 100).toFixed(2)})`,
        html: `
          <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#0d1117;color:#e6edf3;border-radius:12px;">
            <h2 style="color:#58a6ff;margin-bottom:16px;">New Membership Pending Approval</h2>
            <p><strong>User:</strong> ${username}</p>
            <p><strong>Plan:</strong> ${plan}</p>
            <p><strong>Amount:</strong> $${(amount / 100).toFixed(2)}</p>
            <p><strong>Payment Method:</strong> ${methodLabel}</p>
            <p><strong>Reference/TX ID:</strong> ${paymentRef || "(none provided)"}</p>
            <p><strong>Submitted:</strong> ${timestamp}</p>
            <hr style="border-color:#30363d;margin:20px 0;">
            <p style="color:#f0b429;font-size:14px;">Log in to your admin dashboard to verify the payment and approve this membership.</p>
          </div>
        `,
      }),
    });

    if (resp.ok) {
      console.log("New membership alert email sent to", adminEmail);
    } else {
      const err = await resp.text();
      console.error("Resend API error:", resp.status, err);
    }
  } catch (err) {
    console.error("Failed to send new membership alert email:", err.message);
  }
}

// POST /api/membership/subscribe — user submits payment proof (pending until admin approves)
router.post("/subscribe", requireAuth, async (req, res) => {
  const { plan_id, payment_method, payment_ref } = req.body;

  const plan = PLANS.find((p) => p.id === plan_id);
  if (!plan) return res.status(400).json({ error: "Invalid plan" });

  if (!["paypal", "crypto_ltc", "crypto_btc"].includes(payment_method)) {
    return res.status(400).json({ error: "Invalid payment method" });
  }

  if (!payment_ref || !payment_ref.trim()) {
    return res.status(400).json({ error: "Payment reference or transaction ID is required so we can verify your payment." });
  }

  const db = getDb();
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO memberships (user_id, plan, amount_cents, payment_method, payment_ref, status, starts_at, expires_at)
          VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)`,
    args: [req.session.user.id, plan.id, plan.cents, payment_method, payment_ref.trim(), now],
  });

  // Send email notification to admin (non-blocking)
  sendNewMembershipAlert(req.session.user.username, plan.label, plan.cents, payment_method, payment_ref.trim()).catch(() => {});

  res.json({ ok: true, message: "Payment submitted! Your membership is pending approval. You'll be activated shortly once your payment is verified." });
});

// GET /api/membership/status
router.get("/status", requireAuth, async (req, res) => {
  const db = getDb();

  const activeResult = await db.execute({
    sql: `SELECT plan, status, starts_at, expires_at FROM memberships
          WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now')
          ORDER BY expires_at DESC LIMIT 1`,
    args: [req.session.user.id],
  });

  const pendingResult = await db.execute({
    sql: `SELECT plan, status, created_at FROM memberships
          WHERE user_id = ? AND status = 'pending'
          ORDER BY created_at DESC LIMIT 1`,
    args: [req.session.user.id],
  });

  res.json({
    active: activeResult.rows[0] || null,
    pending: pendingResult.rows[0] || null,
  });
});

// POST /api/membership/seen-store — mark that user has visited the store
router.post("/seen-store", requireAuth, async (req, res) => {
  const db = getDb();
  await db.execute({
    sql: "UPDATE users SET has_seen_store = 1 WHERE id = ?",
    args: [req.session.user.id],
  });
  res.json({ ok: true });
});

// GET /api/membership/trial-status — check if user can use free trial
router.get("/trial-status", requireAuth, async (req, res) => {
  const db = getDb();
  const result = await db.execute({
    sql: "SELECT free_prompt_used, has_seen_store FROM users WHERE id = ?",
    args: [req.session.user.id],
  });
  const user = result.rows[0];
  res.json({
    hasSeenStore: !!user?.has_seen_store,
    freePromptUsed: !!user?.free_prompt_used,
    canTrial: !!user?.has_seen_store && !user?.free_prompt_used,
  });
});

// ========== Stripe Checkout ==========

// POST /api/membership/stripe-checkout — create a Stripe Checkout Session
router.post("/stripe-checkout", requireAuth, async (req, res) => {
  const { plan_id } = req.body;
  const plan = PLANS.find((p) => p.id === plan_id);
  if (!plan) return res.status(400).json({ error: "Invalid plan" });

  try {
    const Stripe = require("stripe");
    const stripe = new Stripe(STRIPE_SECRET_KEY);

    const origin = `${req.protocol}://${req.get("host")}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Alleyesonme-AI — ${plan.label} Membership`,
              description: `${plan.label} of unlimited AI assistant access`,
            },
            unit_amount: plan.cents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        plan_id: plan.id,
        user_id: String(req.session.user.id),
      },
      success_url: `${origin}/api/membership/stripe-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#membership`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout session error:", err.message);
    res.status(500).json({ error: "Failed to create checkout session. Please try again." });
  }
});

// GET /api/membership/stripe-success — handle return from Stripe Checkout
router.get("/stripe-success", requireAuth, async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.redirect("/#membership");

  try {
    const Stripe = require("stripe");
    const stripe = new Stripe(STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== "paid") {
      console.warn("Stripe success redirect but payment_status is:", session.payment_status);
      return res.redirect("/#membership");
    }

    const planId = session.metadata && session.metadata.plan_id;
    const userId = session.metadata && session.metadata.user_id;

    if (!planId || !userId) {
      console.error("Stripe success: missing metadata in session", session_id);
      return res.redirect("/#membership");
    }

    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) {
      console.error("Stripe success: unknown plan_id:", planId);
      return res.redirect("/#membership");
    }

    const db = getDb();

    // Idempotency: check if membership already created (e.g., by webhook)
    const existing = await db.execute({
      sql: "SELECT id FROM memberships WHERE payment_ref = ? AND payment_method = 'stripe'",
      args: [session.id],
    });

    if (existing.rows.length === 0) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + plan.days * 24 * 60 * 60 * 1000);

      await db.execute({
        sql: `INSERT INTO memberships (user_id, plan, amount_cents, payment_method, payment_ref, status, starts_at, expires_at)
              VALUES (?, ?, ?, 'stripe', ?, 'active', ?, ?)`,
        args: [
          userId,
          plan.id,
          session.amount_total || plan.cents,
          session.id,
          now.toISOString(),
          expiresAt.toISOString(),
        ],
      });

      console.log(`Stripe success: activated ${plan.id} membership for user ${userId}`);
    } else {
      console.log("Stripe success: membership already exists for session", session.id);
    }

    res.redirect("/#app");
  } catch (err) {
    console.error("Stripe success handler error:", err.message);
    res.redirect("/#membership");
  }
});

module.exports = router;
