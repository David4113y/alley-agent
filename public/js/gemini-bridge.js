document.addEventListener('DOMContentLoaded', () => {
    const chatBtn = document.querySelector('button[class*="purple"]'); // Targets your purple arrow buttons
    const chatInput = document.querySelector('input[placeholder*="Ask me"]');
    const executeBtn = document.querySelector('button:contains("Execute")') || document.querySelector('.developer-mode button');

    // Wire up the Main Chat
    if (chatInput) {
        chatInput.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                const prompt = chatInput.value;
                const res = await fetch('/api/chat', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ prompt: prompt })
                });
                const data = await res.json();
                alert("ALLEY AGENT: " + data.reply);
                chatInput.value = '';
            }
        });
    }
});
