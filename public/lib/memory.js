/**
 * Per-user memory system — extracts and stores facts about each user
 * across conversations for personalized responses.
 */
const { chatWithLLM } = require("./llm");

/**
 * Get the stored memory text for a user.
 * Returns empty string if no memory exists yet.
 */
async function getUserMemory(db, userId) {
  const result = await db.execute({
    sql: "SELECT memory_text FROM user_memories WHERE user_id = ?",
    args: [userId],
  });
  return result.rows.length > 0 ? (result.rows[0].memory_text || "") : "";
}

/**
 * Internal — ask the LLM to extract/merge facts from conversation into memory.
 */
async function extractMemory(messages, currentMemory) {
  const systemPrompt = `You are a memory extraction assistant. Your job is to extract key facts about the user from the conversation and merge them with any existing memory.

EXISTING MEMORY:
${currentMemory || "(none yet)"}

INSTRUCTIONS:
- Extract key facts about the user: their name, preferences, skills, goals, interests, past requests, important context, and any personal details they share.
- Merge new facts with existing memory. Remove duplicates. Update facts if new information contradicts old information.
- Output ONLY a concise bullet-point list of facts. No headings, no preamble, no explanation.
- Keep it compact — maximum 500 words. Prioritize the most important and recent facts.
- If there are no meaningful new facts to extract, return the existing memory unchanged.
- Use short, clear bullet points starting with "- ".`;

  // Only send the last few messages to keep the extraction focused
  const recentMessages = messages.slice(-10);
  const conversationText = recentMessages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const llmMessages = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Here is the recent conversation:\n\n${conversationText}\n\nExtract and merge user facts into a concise bullet-point memory.`,
    },
  ];

  return await chatWithLLM(llmMessages);
}

/**
 * Update a user's memory by extracting new facts from the conversation.
 * Called in the background after chat responses.
 */
async function updateUserMemory(db, userId, conversationMessages, currentMemory) {
  const newMemory = await extractMemory(conversationMessages, currentMemory);

  if (!newMemory || newMemory.trim().length === 0) return;

  // Upsert the memory
  await db.execute({
    sql: `INSERT INTO user_memories (user_id, memory_text, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(user_id) DO UPDATE SET memory_text = ?, updated_at = datetime('now')`,
    args: [userId, newMemory.trim(), newMemory.trim()],
  });
}

module.exports = { getUserMemory, updateUserMemory };
