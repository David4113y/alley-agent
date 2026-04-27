"""
LLM provider — multi-model fallback chain.

Priority:
  1. Groq with dolphin/llama-3.3-70b-versatile  (primary — fast & capable)
  2. Gemini 2.0 Flash  (secondary — when Groq quota exhausted)
  3. Groq with mixtral-8x7b-32768  (tertiary backup)
"""
import os
import json
import traceback
import google.generativeai as genai
from groq import Groq

# ---------- configuration ----------

_gemini_configured = False
_groq_client = None


def _get_gemini():
    global _gemini_configured
    key = os.getenv("GEMINI_API_KEY", "")
    if not key:
        return None
    if not _gemini_configured:
        genai.configure(api_key=key)
        _gemini_configured = True
    return genai.GenerativeModel("gemini-2.0-flash")


def _get_groq():
    global _groq_client
    key = os.getenv("GROQ_API_KEY", "")
    if not key:
        return None
    if _groq_client is None:
        _groq_client = Groq(api_key=key)
    return _groq_client


# ---------- provider implementations ----------

def _chat_gemini(messages: list[dict]) -> str:
    """Call Gemini API. Raises on quota/error."""
    model = _get_gemini()
    if model is None:
        raise RuntimeError("GEMINI_API_KEY not set")

    system_msg = next((m for m in messages if m["role"] == "system"), None)
    chat_msgs = [m for m in messages if m["role"] != "system"]

    contents = []
    for m in chat_msgs:
        role = "model" if m["role"] == "assistant" else "user"
        contents.append({"role": role, "parts": [m["content"]]})

    gen_config = genai.GenerationConfig(temperature=0.4, max_output_tokens=4096)

    kwargs = {"generation_config": gen_config}
    if system_msg:
        # Use system_instruction for Gemini models that support it
        model = genai.GenerativeModel(
            "gemini-2.0-flash",
            system_instruction=system_msg["content"],
            generation_config=gen_config,
        )
        resp = model.generate_content(contents)
    else:
        resp = model.generate_content(contents, **kwargs)

    if resp and resp.text:
        return resp.text
    return "(no response)"


def _chat_groq(messages: list[dict], model_name: str = "llama-3.3-70b-versatile") -> str:
    """Call Groq API with specified model."""
    client = _get_groq()
    if client is None:
        raise RuntimeError("GROQ_API_KEY not set")

    resp = client.chat.completions.create(
        model=model_name,
        messages=messages,
        max_tokens=4096,
        temperature=0.4,
    )
    return resp.choices[0].message.content or "(no response)"


# ---------- public interface ----------

def chat_with_llm(messages: list[dict]) -> str:
    """
    Send messages through the fallback chain:
      1. Groq — dolphin/llama-3.3-70b-versatile (primary)
      2. Gemini 2.0 Flash (secondary)
      3. Groq — mixtral-8x7b-32768 (tertiary backup)
    """
    errors = []

    # 1) Groq — dolphin / llama primary
    try:
        return _chat_groq(messages, "llama-3.3-70b-versatile")
    except Exception as e:
        errors.append(f"Groq-llama: {e}")
        print(f"[LLM] Groq llama (primary) failed: {e}")

    # 2) Gemini — secondary
    try:
        return _chat_gemini(messages)
    except Exception as e:
        errors.append(f"Gemini: {e}")
        print(f"[LLM] Gemini (secondary) failed: {e}")

    # 3) Groq — mixtral tertiary backup
    try:
        return _chat_groq(messages, "mixtral-8x7b-32768")
    except Exception as e:
        errors.append(f"Groq-mixtral: {e}")
        print(f"[LLM] Groq mixtral (tertiary) failed: {e}")

    raise RuntimeError(f"All LLM providers failed: {'; '.join(errors)}")


def get_provider_status() -> dict:
    """Return which providers are configured."""
    return {
        "gemini": bool(os.getenv("GEMINI_API_KEY")),
        "groq": bool(os.getenv("GROQ_API_KEY")),
    }
