/**
 * Code-agent routes — admin-only endpoints for self-modifying code,
 * git operations, and deployment triggers.
 */
const express = require("express");
const { requireAdmin } = require("../middleware/auth");
const { runCodeAgent } = require("../lib/code-agent");
const gitOps = require("../lib/git-ops");

const router = express.Router();

// All routes require admin
router.use(requireAdmin);

// ---------------------------------------------------------------------------
// POST /execute — run the code agent with a prompt (SSE streaming)
// ---------------------------------------------------------------------------
router.post("/execute", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "prompt is required" });
  }

  // Set up SSE stream
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    req.setTimeout(5 * 60 * 1000); // 5 minutes

    const onStep = (stepObj) => {
      res.write(`data: ${JSON.stringify({ type: "step", ...stepObj })}\n\n`);
    };

    const result = await runCodeAgent(prompt, onStep);

    res.write(`data: ${JSON.stringify({ type: "result", ...result })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (err) {
    console.error("Code agent error:", err);
    res.write(`data: ${JSON.stringify({ type: "error", error: "Code agent failed: " + err.message })}\n\n`);
    res.end();
  }
});

// ---------------------------------------------------------------------------
// GET /status — current git status (changed files)
// ---------------------------------------------------------------------------
router.get("/status", (_req, res) => {
  try {
    const status = gitOps.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /diff — current git diff
// ---------------------------------------------------------------------------
router.get("/diff", (_req, res) => {
  try {
    const diff = gitOps.getDiff();
    res.json(diff);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /commit — commit, push, and trigger Render deploy
// ---------------------------------------------------------------------------
router.post("/commit", async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "commit message is required" });
  }

  try {
    // Step 1 — commit and push
    const commitResult = gitOps.commitAndPush(message);
    if (!commitResult.success) {
      return res.status(400).json({ error: commitResult.error });
    }

    // Step 2 — trigger Render deploy
    const deployResult = await gitOps.triggerDeploy();

    res.json({
      commit: commitResult,
      deploy: deployResult,
    });
  } catch (err) {
    console.error("Commit/deploy error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /revert — revert all uncommitted changes
// ---------------------------------------------------------------------------
router.post("/revert", (_req, res) => {
  try {
    const result = gitOps.revertChanges();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
