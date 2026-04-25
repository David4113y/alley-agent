import os
from flask import Flask, request, jsonify, render_template, session, redirect, url_for
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__)
app.secret_key = os.urandom(24) # Allows the site to remember your login

# --- CREDENTIALS ---
ADMIN_DATA = {"username": "DAVIDALLEY", "password": "Passwerd1"}
VIP_GUEST = {"username": "VIPaddress", "password": "onlyfree4me"}

# --- FIXED AI CONFIGURATION ---
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
# Using gemini-1.5-flash to fix the 404 'Beast Error'
model = genai.GenerativeModel('gemini-1.5-flash')

@app.route('/')
def index():
    # Sends your 'role' (admin, vip, or none) to the HTML
    return render_template('index.html', role=session.get('role'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        data = request.json
        u, p = data.get('username'), data.get('password')
        
        if u == ADMIN_DATA['username'] and p == ADMIN_DATA['password']:
            session['role'] = 'admin'
            return jsonify({"status": "success", "message": "Admin recognized."})
        elif u == VIP_GUEST['username'] and p == VIP_GUEST['password']:
            session['role'] = 'vip'
            return jsonify({"status": "success", "message": "VIP Access Granted."})
        return jsonify({"status": "error", "message": "Connection error."}), 401
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

@app.route('/chat', methods=['POST'])
def chat():
    user_message = request.json.get('message')
    try:
        response = model.generate_content(user_message)
        return jsonify({"agent_response": response.text})
    except Exception as e:
        return jsonify({"agent_response": f"Beast Error: {str(e)}"})

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=10000)
