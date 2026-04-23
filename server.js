const express = require('express');
const { exec } = require('child_process');
const axios = require('axios');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const GEMINI_KEY = 'AIzaSyD-7I0q4V0K-V5B4U5W6X7Y8Z9A0B1C2D3';

// FIX: Make the server recognize both "/" and "/dashboard"
app.get(['/', '/dashboard'], (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'dashboard.html'));
});

app.get('/login', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'login.html')));
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username.toUpperCase() === 'DAVIDALLEY' && password === 'Passwerd1') {
        res.json({ success: true, redirect: '/dashboard' });
    } else {
        res.status(401).json({ success: false, message: 'Membership Required' });
    }
});

app.post('/api/chat', async (req, res) => {
    try {
        const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`, {
            contents: [{ parts: [{ text: req.body.prompt || req.body.message }] }]
        });
        res.json({ reply: response.data.candidates[0].content.parts[0].text });
    } catch (error) {
        res.json({ reply: "Gemini is offline." });
    }
});

app.listen(3000, '0.0.0.0', () => console.log('ALLEY AGENT: DASHBOARD FIXED'));
// Path Stability Fix: Thu Apr 23 02:44:29 PM MDT 2026
