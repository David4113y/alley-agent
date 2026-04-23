console.log("Login Script Active");
document.addEventListener('click', async (e) => {
    // If they clicked a button that looks like a Sign In button
    if (e.target.tagName === 'BUTTON' || e.target.innerText.includes('Sign')) {
        e.preventDefault();
        
        const user = document.querySelector('input[type="text"]').value;
        const pass = document.querySelector('input[type="password"]').value;

        console.log("Attempting login for:", user);

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: user, password: pass })
            });
            const data = await res.json();
            if (data.success) {
                alert('WELCOME, DAVID.');
                window.location.href = '/dashboard';
            } else {
                alert('ERROR: ' + data.message);
            }
        } catch (err) {
            alert('CRITICAL: Phone cannot see the Laptop. Check Wi-Fi.');
        }
    }
});
