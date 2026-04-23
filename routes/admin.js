/**
 * Admin routes — manage users, memberships, payments, account security.
 */
const express = require("express");
const bcrypt = require("bcryptjs");
const { getDb } = require("../db/setup");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

// GET /api/admin/users
router.get("/users", requireAdmin, async (_req, res) => {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT u.id, u.username, u.email, u.role, u.is_active, u.created_at,
      (SELECT m.plan FROM memberships m
       WHERE m.user_id = u.id AND m.status = 'active' AND m.expires_at > datetime('now')
       ORDER BY m.expires_at DESC LIMIT 1) as active_plan,
      (SELECT m.expires_at FROM memberships m
       WHERE m.user_id = u.id AND m.status = 'active' AND m.expires_at > datetime('now')
       ORDER BY m.expires_at DESC LIMIT 1) as membership_expires
    FROM users u ORDER BY u.created_at DESC`,
    args: [],
  });
  res.json(result.rows);
});

// GET /api/admin/memberships — all memberships
router.get("/memberships", requireAdmin, async (_req, res) => {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT m.*, u.username FROM memberships m
          JOIN users u ON u.id = m.user_id
          ORDER BY m.created_at DESC`,
    args: [],
  });
  res.json(result.rows);
});

// POST /api/admin/approve/:id — approve pending membership
router.post("/approve/:id", requireAdmin, async (req, res) => {
  const db = getDb();

  // Get the membership to find the plan duration
  const result = await db.execute({
    sql: "SELECT * FROM memberships WHERE id = ? AND status = 'pending'",
    args: [req.params.id],
  });
  const membership = result.rows[0];
  if (!membership) return res.status(404).json({ error: "Pending membership not found" });

  const PLAN_DAYS = { weekly: 7, monthly: 30, quarterly: 90, semiannual: 180, annual: 365 };
  const days = PLAN_DAYS[membership.plan] || 30;
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + days * 86400000).toISOString();

  await db.execute({
    sql: "UPDATE memberships SET status = 'active', starts_at = ?, expires_at = ? WHERE id = ?",
    args: [now, expires, req.params.id],
  });
  res.json({ ok: true });
});

// POST /api/admin/reject/:id — reject pending membership
router.post("/reject/:id", requireAdmin, async (req, res) => {
  const db = getDb();
  await db.execute({
    sql: "UPDATE memberships SET status = 'rejected' WHERE id = ? AND status = 'pending'",
    args: [req.params.id],
  });
  res.json({ ok: true });
});

// POST /api/admin/suspend/:membershipId — temporarily suspend
router.post("/suspend/:id", requireAdmin, async (req, res) => {
  const db = getDb();
  await db.execute({
    sql: "UPDATE memberships SET status = 'suspended' WHERE id = ?",
    args: [req.params.id],
  });
  res.json({ ok: true });
});

// POST /api/admin/cancel/:id — cancel membership
router.post("/cancel/:id", requireAdmin, async (req, res) => {
  const db = getDb();
  await db.execute({
    sql: "UPDATE memberships SET status = 'cancelled' WHERE id = ?",
    args: [req.params.id],
  });
  res.json({ ok: true });
});

// POST /api/admin/reactivate/:id — reactivate suspended membership
router.post("/reactivate/:id", requireAdmin, async (req, res) => {
  const db = getDb();
  await db.execute({
    sql: "UPDATE memberships SET status = 'active' WHERE id = ?",
    args: [req.params.id],
  });
  res.json({ ok: true });
});

// POST /api/admin/toggle-user/:userId
router.post("/toggle-user/:id", requireAdmin, async (req, res) => {
  const db = getDb();

  const result = await db.execute({
    sql: "SELECT * FROM users WHERE id = ?",
    args: [req.params.id],
  });
  const user = result.rows[0] || null;
  if (!user) return res.status(404).json({ error: "Not found" });

  await db.execute({
    sql: "UPDATE users SET is_active = ? WHERE id = ?",
    args: [user.is_active ? 0 : 1, req.params.id],
  });
  res.json({ ok: true, is_active: !user.is_active });
});

// GET /api/admin/stats
router.get("/stats", requireAdmin, async (_req, res) => {
  const db = getDb();

  const totalUsersResult = await db.execute({
    sql: "SELECT COUNT(*) as c FROM users WHERE role = 'user'",
    args: [],
  });
  const activeMembersResult = await db.execute({
    sql: `SELECT COUNT(DISTINCT user_id) as c FROM memberships
          WHERE status = 'active' AND expires_at > datetime('now')`,
    args: [],
  });
  const suspendedResult = await db.execute({
    sql: "SELECT COUNT(*) as c FROM memberships WHERE status = 'suspended'",
    args: [],
  });
  const pendingResult = await db.execute({
    sql: "SELECT COUNT(*) as c FROM memberships WHERE status = 'pending'",
    args: [],
  });
  const revenueResult = await db.execute({
    sql: "SELECT COALESCE(SUM(amount_cents), 0) as c FROM memberships WHERE status = 'active'",
    args: [],
  });
  const openTicketsResult = await db.execute({
    sql: "SELECT COUNT(*) as c FROM support_tickets WHERE status = 'open'",
    args: [],
  });

  const totalUsers = Number(totalUsersResult.rows[0].c);
  const activeMembers = Number(activeMembersResult.rows[0].c);
  const suspendedMembers = Number(suspendedResult.rows[0].c);
  const pendingMembers = Number(pendingResult.rows[0].c);
  const totalRevenue = Number(revenueResult.rows[0].c) / 100;
  const openTickets = Number(openTicketsResult.rows[0].c);

  res.json({ totalUsers, activeMembers, suspendedMembers, pendingMembers, totalRevenue, openTickets });
});

// --- Email alert helper (Resend API — 1 env var, no SMTP hassle) ---
async function sendPasswordChangeAlert(username, ip) {
  const adminEmail = process.env.ADMIN_EMAIL || "davidalleyway@gmail.com";
  const resendKey = process.env.RESEND_API_KEY;

  if (!resendKey) {
    console.warn("RESEND_API_KEY not set — skipping password change email alert.");
    return;
  }

  try {
    const timestamp = new Date().toISOString();

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Alleyesonme-AI Security <onboarding@resend.dev>",
        to: [adminEmail],
        subject: "ALERT: Admin Password Changed — Alleyesonme-AI",
        html: `
          <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#0d1117;color:#e6edf3;border-radius:12px;">
            <h2 style="color:#f85149;margin-bottom:16px;">Admin Password Changed</h2>
            <p>The admin password for <strong>${username}</strong> was changed.</p>
            <p><strong>Time:</strong> ${timestamp}</p>
            <p><strong>IP:</strong> ${ip || "unknown"}</p>
            <hr style="border-color:#30363d;margin:20px 0;">
            <p style="color:#8b949e;font-size:13px;">If you did not make this change, your account may be compromised. Take immediate action.</p>
          </div>
        `,
      }),
    });

    if (resp.ok) {
      console.log("Password change alert email sent to", adminEmail);
    } else {
      const err = await resp.text();
      console.error("Resend API error:", resp.status, err);
    }
  } catch (err) {
    console.error("Failed to send password change alert email:", err.message);
  }
}

// POST /api/admin/change-password
router.post("/change-password", requireAdmin, async (req, res) => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: "Current and new password are required" });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters" });
  }

  const db = getDb();

  // Verify current password
  const result = await db.execute({
    sql: "SELECT * FROM users WHERE id = ?",
    args: [req.session.user.id],
  });
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: "User not found" });

  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }

  // Update password
  const newHash = bcrypt.hashSync(new_password, 12);
  await db.execute({
    sql: "UPDATE users SET password_hash = ? WHERE id = ?",
    args: [newHash, req.session.user.id],
  });

  // Send email alert (non-blocking)
  const clientIp = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
  sendPasswordChangeAlert(user.username, clientIp).catch(() => {});

  res.json({ ok: true, message: "Password changed successfully. An alert email has been sent." });
});

// GET /api/admin/memories — all user memories
router.get("/memories", requireAdmin, async (_req, res) => {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT um.user_id, um.memory_text, um.updated_at, u.username
          FROM user_memories um
          JOIN users u ON u.id = um.user_id
          ORDER BY um.updated_at DESC`,
    args: [],
  });
  res.json(result.rows);
});

// DELETE /api/admin/memories/:userId — clear a user's memory
router.delete("/memories/:userId", requireAdmin, async (req, res) => {
  const db = getDb();
  await db.execute({
    sql: "DELETE FROM user_memories WHERE user_id = ?",
    args: [req.params.userId],
  });
  res.json({ ok: true });
});

module.exports = router;
