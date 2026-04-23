/**
 * Chat routes — conversation CRUD and LLM proxy.
 */
const express = require("express");
const { getDb } = require("../db/setup");
const { requireActiveMembership } = require("../middleware/auth");
const { chatWithLLM } = require("../lib/llm");
const { getUserMemory, updateUserMemory } = require("../lib/memory");

const router = express.Router();

// --- Conversation list ---
router.get("/conversations", requireActiveMembership, async (req, res) => {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT id, title, updated_at FROM conversations
          WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50`,
    args: [req.session.user.id],
  });
  res.json(result.rows);
});

// --- Create conversation ---
router.post("/conversations", requireActiveMembership, async (req, res) => {
  const db = getDb();
  const result = await db.execute({
    sql: "INSERT INTO conversations (user_id, title) VALUES (?, ?)",
    args: [req.session.user.id, req.body.title || "New Chat"],
  });
  res.json({ id: Number(result.lastInsertRowid) });
});

// --- Delete conversation ---
router.delete("/conversations/:id", requireActiveMembership, async (req, res) => {
  const db = getDb();
  await db.execute({
    sql: "DELETE FROM conversations WHERE id = ? AND user_id = ?",
    args: [req.params.id, req.session.user.id],
  });
  res.json({ ok: true });
});

// --- Get messages for a conversation ---
router.get("/conversations/:id/messages", requireActiveMembership, async (req, res) => {
  const db = getDb();

  const convoResult = await db.execute({
    sql: "SELECT * FROM conversations WHERE id = ? AND user_id = ?",
    args: [req.params.id, req.session.user.id],
  });
  const convo = convoResult.rows[0] || null;
  if (!convo) return res.status(404).json({ error: "Not found" });

  const msgsResult = await db.execute({
    sql: "SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id",
    args: [req.params.id],
  });
  res.json({ conversation: convo, messages: msgsResult.rows });
});

// --- Send message (SSE streaming with thinking steps) ---
router.post("/conversations/:id/messages", requireActiveMembership, async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: "Message content required" });

  const db = getDb();

  const convoResult = await db.execute({
    sql: "SELECT * FROM conversations WHERE id = ? AND user_id = ?",
    args: [req.params.id, req.session.user.id],
  });
  const convo = convoResult.rows[0] || null;
  if (!convo) return res.status(404).json({ error: "Not found" });

  // Set up SSE stream
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  /** Send a thinking step event to the client. */
  function sendStep(label, detail) {
    res.write(`data: ${JSON.stringify({ type: "step", label, detail: detail || "" })}\n\n`);
  }

  try {
    sendStep("Saving your message...");

    // Save user message
    await db.execute({
      sql: "INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)",
      args: [req.params.id, content],
    });

    sendStep("Loading conversation history...");

    // Build context
    const historyResult = await db.execute({
      sql: "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id",
      args: [req.params.id],
    });
    const history = historyResult.rows;

    // --- Conversation length management ---
    let effectiveHistory;
    if (history.length > 30) {
      const olderMessages = history.slice(0, history.length - 10);
      const recentMessages = history.slice(history.length - 10);

      let summary = convo.summary || null;
      if (!summary) {
        sendStep("Summarizing earlier messages...", `${olderMessages.length} older messages being condensed`);
        const summaryPrompt = [
          { role: "system", content: "You are a conversation summarizer. Summarize the following conversation history concisely, preserving key facts, decisions, context, and any important details. Output a clear, dense summary in 2-4 paragraphs. Do not include greetings or fluff." },
          { role: "user", content: olderMessages.map((m) => `${m.role}: ${m.content}`).join("\n") },
        ];
        summary = await chatWithLLM(summaryPrompt);

        await db.execute({
          sql: "UPDATE conversations SET summary = ? WHERE id = ?",
          args: [summary, req.params.id],
        });
      } else {
        sendStep("Using cached conversation summary...");
      }

      effectiveHistory = [
        { role: "user", content: `[Summary of earlier conversation]\n${summary}` },
        { role: "assistant", content: "Understood, I have the context from our earlier conversation. Let's continue." },
        ...recentMessages.map((m) => ({ role: m.role, content: m.content })),
      ];
    } else {
      effectiveHistory = history.map((m) => ({ role: m.role, content: m.content }));
    }

    // --- Per-user memory ---
    sendStep("Recalling what I know about you...");
    let existingMemory = "";
    try {
      existingMemory = await getUserMemory(db, req.session.user.id);
    } catch (err) {
      console.error("Memory fetch error:", err);
    }

    let systemContent = "You are Alleyesonme-AI, a helpful and knowledgeable AI assistant. Be concise, accurate, and helpful. Use markdown formatting when appropriate.";
    if (existingMemory) {
      systemContent += `\n\nHere are things you remember about this user from previous conversations:\n${existingMemory}`;
      sendStep("Personalizing with your preferences...", "Loaded your saved context");
    }

    const llmMessages = [
      { role: "system", content: systemContent },
      ...effectiveHistory,
    ];

    sendStep("Generating response...", `${llmMessages.length} messages in context`);

    // Call LLM
    const reply = await chatWithLLM(llmMessages);

    sendStep("Saving response...");

    // Save assistant message
    await db.execute({
      sql: "INSERT INTO messages (conversation_id, role, content) VALUES (?, 'assistant', ?)",
      args: [req.params.id, reply],
    });

    // Update conversation title from first message
    if (history.length <= 1) {
      const title = content.slice(0, 60) + (content.length > 60 ? "..." : "");
      await db.execute({
        sql: "UPDATE conversations SET title = ? WHERE id = ?",
        args: [title, req.params.id],
      });
    }

    await db.execute({
      sql: "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?",
      args: [req.params.id],
    });

    // Invalidate cached summary when new messages are added
    if (convo.summary && history.length > 30) {
      await db.execute({
        sql: "UPDATE conversations SET summary = NULL WHERE id = ?",
        args: [req.params.id],
      });
    }

    // Mark free trial prompt as used if this was a trial
    if (req.isTrialPrompt) {
      await db.execute({
        sql: "UPDATE users SET free_prompt_used = 1 WHERE id = ?",
        args: [req.session.user.id],
      });
    }

    // Background memory update (non-blocking)
    if (history.length % 6 === 0) {
      sendStep("Updating memory...");
      updateUserMemory(
        db,
        req.session.user.id,
        history.concat([{ role: "assistant", content: reply }]),
        existingMemory
      ).catch((err) => console.error("Memory update error:", err));
    }

    // Send final response
    res.write(`data: ${JSON.stringify({ type: "response", role: "assistant", content: reply, trialUsed: !!req.isTrialPrompt })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (err) {
    console.error("Chat error:", err);
    res.write(`data: ${JSON.stringify({ type: "error", error: "Failed to get response from AI" })}\n\n`);
    res.end();
  }
});

module.exports = router;
