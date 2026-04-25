import os
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
import google.generativeai as genai

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "alley_empire_secret_123")

# Configure Gemini
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel('gemini-1.5-flash')

# Initial Default Credentials (Change these in the Admin Dashboard)
admin_creds = {"user": "admin", "pass": "password123"}
vip_creds = {"user": "guest", "pass": "alleyvip"}

# --- ROUTES ---

@app.route('/')
def index():
    # Check if user is logged in to hide/show the yellow box
    logged_in = 'user_id' in session
    is_admin = session.get('is_admin', False)
    return render_template('index.html', logged_in=logged_in, is_admin=is_admin)

@app.route('/chat', method=['POST'])
def chat():
    user_input = request.json.get("prompt")
    if not user_input:
        return jsonify({"response": "I didn't catch that."})

    # Optional: Logic to limit visitors to one question
    if 'user_id' not in session:
        # You can add logic here to track IP or cookie for the 1-question limit
        pass

    try:
        response = model.generate_content(user_input)
        return jsonify({"response": response.text})
    except Exception as e:
        return jsonify({"response": f"The Beast encountered an error: {str(e)}"}), 500

# --- AUTHENTICATION ---

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')

        # Check Admin
        if username == admin_creds['user'] and password == admin_creds['pass']:
            session['user_id'] = 'admin'
            session['is_admin'] = True
            return redirect(url_for('index'))
        
        # Check VIP
        if username == vip_creds['user'] and password == vip_creds['pass']:
            session['user_id'] = 'vip'
            session['is_admin'] = False
            return redirect(url_for('index'))

        return "Invalid Credentials", 401
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

# --- ADMIN COMMANDS ---

@app.route('/admin')
def admin_panel():
    if not session.get('is_admin'):
        return redirect(url_for('login'))
    return render_template('admin.html')

@app.route('/update_admin', methods=['POST'])
def update_admin():
    if session.get('is_admin'):
        admin_creds['user'] = request.form.get('username')
        admin_creds['pass'] = request.form.get('password')
    return redirect(url_for('admin_panel'))

@app.route('/update_vip', methods=['POST'])
def update_vip():
    if session.get('is_admin'):
        vip_creds['user'] = request.form.get('vip_user')
        vip_creds['pass'] = request.form.get('vip_pass')
    return redirect(url_for('admin_panel'))

# --- ARCADE & GAMES ---

@app.route('/games')
def games_hub():
    # Accessible to everyone
    return render_template('games.html')

@app.route('/play/alley-agents')
def play_aa():
    return render_template('alley_agents.html')

@app.route('/play/eoe')
def play_eoe():
    return render_template('eoe.html')

if __name__ == '__main__':
    # Running on 0.0.0.0 so it's accessible via local IP (The Beast)
    app.run(host='0.0.0.0', port=10000, debug=True)
