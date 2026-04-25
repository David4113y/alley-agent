import os
from flask import Flask, request, jsonify, render_template
import google.generativeai as genai
from dotenv import load_dotenv

# Load environment variables (like your GEMINI_API_KEY)
load_dotenv()

# Initialize Flask and tell it to look for the 'templates' folder
app = Flask(__name__)

# --- ADMIN & VIP CONFIGURATION ---
ADMIN_DATA = {
    "username": "DAVIDALLEY",
    "password": "Passwerd1",
    "email": "davidalleyway@gmail.com"
}

VIP_GUEST = {
    "username": "VIPaddress",
    "password": "onlyfree4me"
}

# --- AI CONFIGURATION ---
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel('gemini-pro')

# --- MAIN ROUTES ---

@app.route('/')
def index():
    """Main Dashboard"""
    return render_template('index.html')

@app.route('/chat', methods=['POST'])
def chat():
    """Handles AI Chat requests"""
    user_message = request.json.get('message')
    if not user_message:
        return jsonify({"agent_response": "I didn't catch that. Try again?"})
    
    try:
        response = model.generate_content(user_message)
        return jsonify({"agent_response": response.text})
    except Exception as e:
        return jsonify({"agent_response": f"Error: {str(e)}"})

@app.route('/login', methods=['POST'])
def login():
    """Handles Admin/VIP Login"""
    data = request.json
    u = data.get('username')
    p = data.get('password')
    
    if u == ADMIN_DATA['username'] and p == ADMIN_DATA['password']:
        return jsonify({"status": "success", "role": "admin", "message": "Welcome back, David."})
    elif u == VIP_GUEST['username'] and p == VIP_GUEST['password']:
        return jsonify({"status": "success", "role": "vip", "message": "VIP Access Granted."})
    
    return jsonify({"status": "error", "message": "Invalid credentials"}), 401

# --- GAME CENTER ROUTES ---

@app.route('/alley-agents')
def alley_agents():
    """Route for the retro city platformer"""
    return render_template('alley-agents.html')

@app.route('/echoes')
def echoes():
    """Route for the Echoes of Eternity quest"""
    return render_template('echoes.html')

# --- SERVER START ---

if __name__ == "__main__":
    # Render uses port 10000 by default
    app.run(host='0.0.0.0', port=10000)
