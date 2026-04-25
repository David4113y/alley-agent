import os
from flask import Flask, request, jsonify, render_template, session, redirect, url_for
import google.generativeai as genai
from groq import Groq
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__)
app.secret_key = os.urandom(24)

# --- AI CONFIGURATION ---
# Tier 1: Google Gemini
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
gemini_model = genai.GenerativeModel('gemini-1.5-flash')

# Tier 2 & 3: Groq (Llama/Dolphin)
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# Tier 4: OpenAI (Emergency Backup)
oa_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def get_ai_response(prompt):
    """The 4-Tier Failover Logic"""
    # TIER 1: Gemini
    try:
        response = gemini_model.generate_content(prompt)
        return response.text
    except Exception:
        print("Gemini failed, trying Groq Llama...")

    # TIER 2: Groq Llama 3.1
    try:
        res = groq_client.chat.completions.create(
            model="llama-3.1-70b-versatile",
            messages=[{"role": "user", "content": prompt}]
        )
        return res.choices[0].message.content
    except Exception:
        print("Llama failed, trying Dolphin/Mixtral...")

    # TIER 3: Groq Mixtral/Dolphin
    try:
        res = groq_client.chat.completions.create(
            model="mixtral-8x7b-32768",
            messages=[{"role": "user", "content": prompt}]
        )
        return res.choices[0].message.content
    except Exception:
        print("Groq fully failed, trying OpenAI backup...")

    # TIER 4: OpenAI GPT-4o-mini
    try:
        res = oa_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}]
        )
        return res.choices[0].message.content
    except Exception:
        return "The Beast is silent. All AI tiers have failed. Check your API keys."

# --- ROUTES ---
@app.route('/')
def index():
    return render_template('index.html', role=session.get('role'))

@app.route('/chat', methods=['POST'])
def chat():
    msg = request.json.get('message')
    if not msg:
        return jsonify({"agent_response": "I didn't hear anything."})
    return jsonify({"agent_response": get_ai_response(msg)})

@app.route('/admin')
def admin():
    if session.get('role') != 'admin':
        return redirect(url_for('index'))
    # Temporary user list - will move to 'The Beast' database later
    users_list = [
        {"username": "DavidAlley", "role": "admin", "status": "Active"},
        {"username": "Guest_VIP", "role": "vip", "status": "Active"}
    ]
    return render_template('admin.html', users=users_list)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        u, p = request.json.get('username'), request.json.get('password')
        if u == "DAVIDALLEY" and p == "Passwerd1": # Update with your secure pass
            session['role'] = 'admin'
            return jsonify({"status": "success"})
        return jsonify({"status": "error"}), 401
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=10000)
