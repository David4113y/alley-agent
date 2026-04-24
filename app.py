import os
from flask import Flask, request, jsonify
from dotenv import load_dotenv
import google.generativeai as genai
from openai import OpenAI

load_dotenv()

app = Flask(__name__)

# Basic landing page to verify the server is live
@app.route('/')
def home():
    return "Alley Agent is Live and Online."

# The core Chat Route
@app.route('/chat', methods=['POST'])
def chat():
    try:
        data = request.json
        user_message = data.get('message')
        
        # Configure Gemini using your Render Environment Variable
        genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
        model = genai.GenerativeModel('gemini-1.5-flash')
        
        # Generate the response
        response = model.generate_content(user_message)
        
        return jsonify({
            "status": "success",
            "agent_response": response.text
        })
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

if __name__ == "__main__":
    # Render automatically sets the PORT variable
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
