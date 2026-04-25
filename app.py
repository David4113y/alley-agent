import os
from flask import Flask, request, jsonify, render_template
import google.generativeai as genai
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)

# --- ADMIN & VIP CONFIGURATION ---
# These credentials grant you admin status on the site
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

# --- MAIN NAVIGATION ROUTES ---

@app.route('/')
def index():
    """Main Dashboard"""
    return render_template('index.html')

@app.route('/login', methods=['GET'])
def login_page():
    """Renders the professional Login screen"""
    return render_template('login.html')

# --- FUNCTIONAL API ROUTES ---

@app.route('/chat', methods=['POST'])
def chat():
    """Handles AI interaction from the dashboard"""
    user_message = request.json.get('message')
    if not user_message:
        return jsonify({"agent_response": "I didn't catch that."})
    
    try:
        response = model.generate_content(user_message)
        return jsonify({"agent_response": response.text})
    except Exception as e:
        return jsonify({"agent_response": f"Beast Error: {str(e)}"})

@app.route('/login', methods=['POST'])
def login_logic():
    """Validates Admin and VIP credentials"""
    data = request.json
    u = data.get('username')
    p = data.get('password')
    
    if u == ADMIN_DATA['username'] and p == ADMIN_DATA['password']:
        return jsonify({"status": "success", "role": "admin", "message": "Admin recognized. Welcome, David."})
    elif u == VIP_GUEST['username'] and p == VIP_GUEST['password']:
        return jsonify({"status": "success", "role": "vip", "message": "VIP Access Granted."})
    
    return jsonify({"status": "error", "message": "Connection error. Please try again."}), 401

# --- GAME CENTER ROUTES ---

@app.route('/alley-agents')
def alley_agents():
    """Retro city platformer route"""
    return render_template('alley-agents.html')

@app.route('/echoes')
def echoes():
    """Echoes of Eternity quest route"""
    return render_template('echoes.html')

# --- SERVER EXECUTION ---

if __name__ == "__main__":
    # Standard Render port configuration
    app.run(host='0.0.0.0', port=10000)
