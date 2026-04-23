/**
 * Auth routes — login, register, logout.
 */
const express = require("express");
const bcrypt = require("bcryptjs");
const { getDb } = require("../db/setup");

const router = express.Router();

// POST /api/auth/register
router.post("/register", async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  const db = getDb();

  const existing = await db.execute({
    sql: "SELECT id FROM users WHERE username = ?",
    args: [username],
  });
  if (existing.rows.length) {
    return res.status(409).json({ error: "Username already taken" });
  }

  if (email) {
    const emailExists = await db.execute({
      sql: "SELECT id FROM users WHERE email = ?",
      args: [email],
    });
    if (emailExists.rows.length) {
      return res.status(409).json({ error: "Email already registered" });
    }
  }

  const hash = bcrypt.hashSync(password, 12);
  const result = await db.execute({
    sql: "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
    args: [username, email || null, hash],
  });

  const user = { id: Number(result.lastInsertRowid), username, role: "user" };
  req.session.user = user;

  res.json({ ok: true, user });
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  const db = getDb();

  const result = await db.execute({
    sql: "SELECT * FROM users WHERE username = ?",
    args: [username],
  });
  const row = result.rows[0] || null;

  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  if (!row.is_active) {
    return res.status(403).json({ error: "Account is deactivated" });
  }

  const user = { id: row.id, username: row.username, role: row.role };
  req.session.user = user;

  res.json({ ok: true, user });
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get("/me", async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const db = getDb();

  const result = await db.execute({
    sql: `SELECT plan, status, expires_at FROM memberships
          WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now')
          ORDER BY expires_at DESC LIMIT 1`,
    args: [req.session.user.id],
  });
  const membership = result.rows[0] || null;

  res.json({
    user: req.session.user,
    membership,
  });
});

module.exports = router;
