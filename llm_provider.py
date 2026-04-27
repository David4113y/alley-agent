"""
LLM provider — multi-model fallback chain.

Priority:
  1. Ollama Dolphin Llama on local beast via Cloudflare Tunnel (primary)
  2. Gemini 2.0 Flash  (secondary)
  3. Groq with mixtral-8x7b-32768  (tertiary backup)

Set OLLAMA_BASE_URL to your Cloudflare Tunnel URL, e.g.:
  https://ollama.alleyesonme.live   or
  https://random-name.trycloudflare.com
"""
import os
import json
import traceback
import requests
import google.generativeai as genai
from groq import Groq

# ---------- configuration ----------

_gemini_configured = False
_groq_client = None

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "dolphin-llama3:70b")


def _get_ollama_url():
    """Return the base URL for the Ollama instance (beast via CF Tunnel)."""
    url = os.getenv("OLLAMA_BASE_URL", "").rstrip("/")
    return url or None


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

def _chat_ollama(messages: list[dict]) -> str:
    """Call Ollama API on the beast via Cloudflare Tunnel."""
    base_url = _get_ollama_url()
    if not base_url:
        raise RuntimeError("OLLAMA_BASE_URL not set")

    model = os.getenv("OLLAMA_MODEL", "dolphin-llama3:70b")

    # Ollama /api/chat expects {model, messages, stream}
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {
            "temperature": 0.4,
            "num_predict": 4096,
        },
    }

    resp = requests.post(
        f"{base_url}/api/chat",
        json=payload,
        timeout=120,
    )
    resp.raise_for_status()
    data = resp.json()

    content = data.get("message", {}).get("content", "")
    if not content:
        raise RuntimeError("Ollama returned empty response")
    return content


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

    if system_msg:
        model = genai.GenerativeModel(
            "gemini-2.0-flash",
            system_instruction=system_msg["content"],
            generation_config=gen_config,
        )
        resp = model.generate_content(contents)
    else:
        resp = model.generate_content(contents, generation_config=gen_config)

    if resp and resp.text:
        return resp.text
    return "(no response)"


def _chat_groq(messages: list[dict], model_name: str = "mixtral-8x7b-32768") -> str:
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
      1. Ollama — Dolphin Llama on beast (primary)
      2. Gemini 2.0 Flash (secondary)
      3. Groq — mixtral-8x7b-32768 (tertiary backup)
    """
    errors = []

    # 1) Ollama — Dolphin Llama on beast (primary)
    try:
        return _chat_ollama(messages)
    except Exception as e:
        errors.append(f"Ollama-dolphin: {e}")
        print(f"[LLM] Ollama Dolphin Llama (primary) failed: {e}")

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
    ollama_url = _get_ollama_url()
    ollama_ok = False
    if ollama_url:
        try:
            r = requests.get(f"{ollama_url}/api/tags", timeout=5)
            ollama_ok = r.status_code == 200
        except Exception:
            pass

    return {
        "ollama": ollama_ok,
        "ollama_url": ollama_url or "(not set)",
        "ollama_model": OLLAMA_MODEL,
        "gemini": bool(os.getenv("GEMINI_API_KEY")),
        "groq": bool(os.getenv("GROQ_API_KEY")),
    }
