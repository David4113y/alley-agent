document.addEventListener('DOMContentLoaded', () => {
    // FIXING THE TERMINAL (Beast Console)
    const termInput = document.querySelector('.terminal-input');
    const termBody = document.querySelector('.terminal-body');

    if (termInput) {
        termInput.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                const cmd = termInput.value;
                try {
                    const res = await fetch('http://192.168.0.73:3000/api/execute', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ command: cmd })
                    });
                    const data = await res.json();
                    termBody.innerHTML += `<div>> ${cmd}</div><div style="color:#0f0">${data.output}</div>`;
                } catch (err) {
                    termBody.innerHTML += `<div style="color:red">CONNECTION ERROR</div>`;
                }
                termInput.value = '';
            }
        });
    }

    // FIXING THE LOGIN
    const loginBtn = document.querySelector('.login-button'); 
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            // Force bypass for Admin
            const user = document.querySelector('#username').value;
            const pass = document.querySelector('#password').value;
            if(user === 'DAVIDALLEY' && pass === 'Passwerd1') {
                alert('Access Granted, David.');
                window.location.href = '/admin'; // or your dashboard path
            } else {
                alert('Connection Error: Membership Required');
            }
        });
    }
});
