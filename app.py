import os
from flask import Flask, request, jsonify, render_template
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__)

# --- ADMIN & VIP CREDENTIALS ---
ADMIN_DATA = {
    "username": "DAVIDALLEY",
    "password": "Passwerd1",
    "email": "davidalleyway@gmail.com"
}

VIP_GUEST = {
    "username": "VIPaddress",
    "password": "onlyfree4me"
}

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel('gemini-pro')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/login', methods=['GET'])
def login_page():
    return render_template('login.html')

@app.route('/login', methods=['POST'])
def login_logic():
    data = request.json
    u = data.get('username')
    p = data.get('password')
    
    if u == ADMIN_DATA['username'] and p == ADMIN_DATA['password']:
        return jsonify({"status": "success", "message": "Admin recognized. Welcome, David."})
    elif u == VIP_GUEST['username'] and p == VIP_GUEST['password']:
        return jsonify({"status": "success", "message": "VIP Access Granted."})
    
    return jsonify({"status": "error", "message": "Connection error. Please try again."}), 401

@app.route('/chat', methods=['POST'])
def chat():
    user_message = request.json.get('message')
    try:
        response = model.generate_content(user_message)
        return jsonify({"agent_response": response.text})
    except Exception as e:
        return jsonify({"agent_response": "Beast Error: " + str(e)})

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=10000)
