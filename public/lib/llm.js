/**
 * LLM client — shared across chat routes and memory module.
 *
 * Supports: groq, openai, anthropic, gemini, ollama.
 */

async function chatWithLLM(messages) {
  const provider = process.env.LLM_PROVIDER || "groq";
  const model = process.env.LLM_MODEL || "llama-3.3-70b-versatile";

  if (provider === "openai") {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const resp = await client.chat.completions.create({
      model,
      messages,
      max_tokens: 4096,
      temperature: 0.4,
    });
    return resp.choices[0].message.content;
  }

  if (provider === "anthropic") {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: "https://api.anthropic.com/v1/",
    });
    const resp = await client.chat.completions.create({
      model,
      messages,
      max_tokens: 4096,
      temperature: 0.4,
    });
    return resp.choices[0].message.content;
  }

  if (provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

    const geminiModel = model || "gemini-2.0-flash";

    // Convert messages to Gemini format
    const systemMsg = messages.find((m) => m.role === "system");
    const chatMsgs = messages.filter((m) => m.role !== "system");

    const contents = chatMsgs.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body = { contents };
    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }
    body.generationConfig = { temperature: 0.4, maxOutputTokens: 4096 };

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Gemini API error: ${resp.status} — ${err}`);
    }

    const data = await resp.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "(no response)";
  }

  if (provider === "groq") {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });
    const resp = await client.chat.completions.create({
      model: model || "llama-3.3-70b-versatile",
      messages,
      max_tokens: 4096,
      temperature: 0.4,
    });
    return resp.choices[0].message.content;
  }

  if (provider === "ollama") {
    const base = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const resp = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false }),
    });
    const data = await resp.json();
    return data.message?.content || "(no response)";
  }

  throw new Error(`Unknown LLM provider: ${provider}`);
}

module.exports = { chatWithLLM };
