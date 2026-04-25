import os
from flask import Flask, request, jsonify, render_template
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# --- ADMIN & VIP CONFIGURATION ---
# This ensures your accounts exist on every fresh deploy
ADMIN_DATA = {
    "username": "DAVIDALLEY",
    "password": "Passwerd1",
    "email": "davidalleyway@gmail.com"
}

VIP_GUEST = {
    "username": "VIPaddress",
    "password": "onlyfree4me"
}

# Configure your Gemini AI
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel('gemini-pro')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/chat', methods=['POST'])
def chat():
    user_message = request.json.get('message')
    if not user_message:
        return jsonify({"agent_response": "I didn't catch that. Try again?"})
    
    try:
        response = model.generate_content(user_message)
        return jsonify({"agent_response": response.text})
    except Exception as e:
        return jsonify({"agent_response": f"Error: {str(e)}"})

# New Login Route for your Admin/VIP accounts
@app.route('/login', methods=['POST'])
def login():
    data = request.json
    u = data.get('username')
    p = data.get('password')
    
    if u == ADMIN_DATA['username'] and p == ADMIN_DATA['password']:
        return jsonify({"status": "success", "role": "admin", "message": "Welcome back, David."})
    elif u == VIP_GUEST['username'] and p == VIP_GUEST['password']:
        return jsonify({"status": "success", "role": "vip", "message": "VIP Access Granted."})
    
    return jsonify({"status": "error", "message": "Invalid credentials"}), 401

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=10000)
