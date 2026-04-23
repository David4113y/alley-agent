/**
 * Auth middleware — session and role checks.
 */
const { getDb } = require("../db/setup");

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    if (req.xhr || req.path.startsWith("/api/")) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    return res.redirect("/login");
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user || req.session.user.role !== "admin") {
    if (req.xhr || req.path.startsWith("/api/")) {
      return res.status(403).json({ error: "Admin access required" });
    }
    return res.redirect("/login");
  }
  next();
}

async function requireActiveMembership(req, res, next) {
  if (!req.session || !req.session.user) {
    if (req.xhr || req.path.startsWith("/api/")) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    return res.redirect("/login");
  }

  // Admin always has access
  if (req.session.user.role === "admin") {
    return next();
  }

  const db = getDb();

  // Check active membership first
  const result = await db.execute({
    sql: `SELECT * FROM memberships
          WHERE user_id = ? AND status = 'active' AND expires_at > datetime('now')
          ORDER BY expires_at DESC LIMIT 1`,
    args: [req.session.user.id],
  });
  const membership = result.rows[0] || null;

  if (membership) {
    req.membership = membership;
    return next();
  }

  // Check if user qualifies for free trial prompt
  const userResult = await db.execute({
    sql: "SELECT free_prompt_used, has_seen_store FROM users WHERE id = ?",
    args: [req.session.user.id],
  });
  const user = userResult.rows[0];

  if (user && user.has_seen_store && !user.free_prompt_used) {
    // User has seen the store but hasn't used their free prompt yet — allow through
    req.isTrialPrompt = true;
    return next();
  }

  // No membership and no trial available
  if (req.xhr || req.path.startsWith("/api/")) {
    return res.status(403).json({ error: "Active membership required", code: "NO_MEMBERSHIP" });
  }
  return res.redirect("/membership");
}

module.exports = { requireAuth, requireAdmin, requireActiveMembership };
