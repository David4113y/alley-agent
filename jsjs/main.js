const sendBtn = document.getElementById('sendBtn');
const userInput = document.getElementById('userInput');

sendBtn.addEventListener('click', async () => {
    const message = userInput.value;
    if (!message) return;

    // Visual feedback
    userInput.value = 'Thinking...';

    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message })
        });
        const data = await response.json();

        // For now, let's alert the response to prove it works!
        alert("Alley Agent: " + data.agent_response);
        userInput.value = ''; 
    } catch (error) {
        console.error("Error:", error);
        alert("Connection failed.");
    }
});
