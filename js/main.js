const sendBtn = document.getElementById('sendBtn');
const userInput = document.getElementById('userInput');

sendBtn.addEventListener('click', async () => {
    const message = userInput.value;
    if (!message) return;

    userInput.value = 'Thinking...';

    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message })
        });
        const data = await response.json();
        
        alert("Alleyesonme-Ai: " + data.agent_response);
        userInput.value = ''; 
    } catch (error) {
        console.error("Error:", error);
        alert("Connection failed.");
    }
});

