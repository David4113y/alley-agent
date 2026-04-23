/**
 * Support routes — users submit tickets, admins view/reply/close them.
 */
const express = require("express");
const { getDb } = require("../db/setup");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

// POST /api/support/tickets — user submits a support ticket
router.post("/tickets", requireAuth, async (req, res) => {
  const { subject, message } = req.body;

  if (!subject || !subject.trim()) {
    return res.status(400).json({ error: "Subject is required." });
  }
  if (!message || !message.trim()) {
    return res.status(400).json({ error: "Message is required." });
  }
  if (subject.trim().length > 200) {
    return res.status(400).json({ error: "Subject must be under 200 characters." });
  }
  if (message.trim().length > 5000) {
    return res.status(400).json({ error: "Message must be under 5000 characters." });
  }

  const db = getDb();
  await db.execute({
    sql: `INSERT INTO support_tickets (user_id, subject, message) VALUES (?, ?, ?)`,
    args: [req.session.user.id, subject.trim(), message.trim()],
  });

  res.json({ ok: true, message: "Your support ticket has been submitted. We'll get back to you soon." });
});

// GET /api/support/tickets — user views their own tickets
router.get("/tickets", requireAuth, async (req, res) => {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT id, subject, message, status, admin_reply, created_at, updated_at
          FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC`,
    args: [req.session.user.id],
  });
  res.json(result.rows);
});

// --- Admin routes ---

// GET /api/support/admin/tickets — admin views all tickets
router.get("/admin/tickets", requireAdmin, async (_req, res) => {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT t.*, u.username FROM support_tickets t
          JOIN users u ON u.id = t.user_id
          ORDER BY CASE t.status WHEN 'open' THEN 0 ELSE 1 END, t.created_at DESC`,
    args: [],
  });
  res.json(result.rows);
});

// POST /api/support/admin/reply/:id — admin replies to a ticket
router.post("/admin/reply/:id", requireAdmin, async (req, res) => {
  const { reply } = req.body;
  if (!reply || !reply.trim()) {
    return res.status(400).json({ error: "Reply is required." });
  }

  const db = getDb();
  await db.execute({
    sql: `UPDATE support_tickets SET admin_reply = ?, status = 'replied', updated_at = datetime('now') WHERE id = ?`,
    args: [reply.trim(), req.params.id],
  });
  res.json({ ok: true });
});

// POST /api/support/admin/close/:id — admin closes a ticket
router.post("/admin/close/:id", requireAdmin, async (req, res) => {
  const db = getDb();
  await db.execute({
    sql: `UPDATE support_tickets SET status = 'closed', updated_at = datetime('now') WHERE id = ?`,
    args: [req.params.id],
  });
  res.json({ ok: true });
});

module.exports = router;
