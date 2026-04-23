/**
 * Stripe Webhook handler — receives checkout.session.completed events
 * as a backup to ensure memberships activate even if the success redirect fails.
 *
 * Mounted in server.js BEFORE express.json() with express.raw() body parser.
 */
const { getDb } = require("../db/setup");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

const PLANS = [
  { id: "weekly",      days: 7   },
  { id: "monthly",     days: 30  },
  { id: "quarterly",   days: 90  },
  { id: "semiannual",  days: 180 },
  { id: "annual",      days: 365 },
];

async function activateMembership(session) {
  const planId = session.metadata && session.metadata.plan_id;
  const userId = session.metadata && session.metadata.user_id;

  if (!planId || !userId) {
    console.error("Stripe webhook: missing plan_id or user_id in session metadata");
    return;
  }

  const plan = PLANS.find((p) => p.id === planId);
  if (!plan) {
    console.error("Stripe webhook: unknown plan_id:", planId);
    return;
  }

  const db = getDb();

  // Check if this session already created a membership (idempotency)
  const existing = await db.execute({
    sql: "SELECT id FROM memberships WHERE payment_ref = ? AND payment_method = 'stripe'",
    args: [session.id],
  });
  if (existing.rows.length > 0) {
    console.log("Stripe webhook: membership already exists for session", session.id);
    return;
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + plan.days * 24 * 60 * 60 * 1000);

  await db.execute({
    sql: `INSERT INTO memberships (user_id, plan, amount_cents, payment_method, payment_ref, status, starts_at, expires_at)
          VALUES (?, ?, ?, 'stripe', ?, 'active', ?, ?)`,
    args: [
      userId,
      planId,
      session.amount_total || 0,
      session.id,
      now.toISOString(),
      expiresAt.toISOString(),
    ],
  });

  console.log(`Stripe webhook: activated ${planId} membership for user ${userId} (session ${session.id})`);
}

module.exports = async function stripeWebhookHandler(req, res) {
  const Stripe = require("stripe");
  const stripe = new Stripe(STRIPE_SECRET_KEY);

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  if (webhookSecret) {
    const sig = req.headers["stripe-signature"];
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error("Stripe webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    // No webhook secret configured yet — parse event from body but log warning
    console.warn("WARNING: STRIPE_WEBHOOK_SECRET not set — skipping signature verification. Set it in production!");
    try {
      event = JSON.parse(req.body.toString());
    } catch (err) {
      console.error("Stripe webhook: failed to parse body:", err.message);
      return res.status(400).send("Invalid payload");
    }
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (session.payment_status === "paid") {
      try {
        await activateMembership(session);
      } catch (err) {
        console.error("Stripe webhook: error activating membership:", err);
        return res.status(500).send("Internal error");
      }
    }
  }

  res.json({ received: true });
};
