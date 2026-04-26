/* ===== Alleyesonme-AI — Frontend App ===== */

// --- State ---
let currentUser = null;
let currentConversationId = null;
let isAuthRegister = false;
let selectedPlan = null;
let previousScreen = 'landing-screen';

// --- Helpers ---
async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    credentials: 'same-origin',
    ...opts,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw { status: res.status, ...data };
  }
  return res;
}

async function apiJSON(url, opts = {}) {
  const res = await api(url, opts);
  return res.json();
}

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

// --- Screen Management ---
function showScreen(id) {
  const screens = ['landing-screen', 'auth-screen', 'app-screen', 'membership-screen',
    'support-screen', 'admin-screen', 'store-screen', 'arcade-screen',
    'agent-screen', 'game-player-screen'];
  const prevVisible = screens.find(s => document.getElementById(s)?.style.display !== 'none');
  if (prevVisible) previousScreen = prevVisible;
  screens.forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = s === id ? '' : 'none';
  });
  // Load data for specific screens
  if (id === 'arcade-screen') loadArcadeGames();
  if (id === 'store-screen') { loadStoreProducts(); loadMyPurchases(); }
  if (id === 'agent-screen') { loadAgentCapabilities(); loadAgentTasks(); }
  if (id === 'membership-screen') { loadPlans(); loadMembershipStatus(); }
  if (id === 'support-screen') loadTickets();
  if (id === 'admin-screen') { loadAdminStats(); loadAdminUsers(); }
  // Close sidebar on mobile
  $('#sidebar')?.classList.remove('open');
}

function goBackFromArcade() {
  showScreen(currentUser ? 'app-screen' : 'landing-screen');
}

// --- Init ---
async function init() {
  try {
    const data = await apiJSON('/api/auth/me');
    if (data.user) {
      currentUser = data.user;
      onLogin();
    } else {
      showScreen('landing-screen');
    }
  } catch {
    showScreen('landing-screen');
  }
  setupEventListeners();
}

function onLogin() {
  showScreen('app-screen');
  $('#user-info').textContent = currentUser.username + (currentUser.role === 'admin' ? ' (Admin)' : '');
  // Show admin nav items
  if (currentUser.role === 'admin') {
    $$('.admin-only').forEach(el => el.style.display = '');
  } else {
    $$('.admin-only').forEach(el => el.style.display = 'none');
  }
  loadConversations();
  loadQuickPrompts();
}

function setupEventListeners() {
  // Auth
  $('#landing-signin')?.addEventListener('click', e => { e.preventDefault(); isAuthRegister = false; showAuthScreen(); });
  $('#landing-register')?.addEventListener('click', e => { e.preventDefault(); isAuthRegister = true; showAuthScreen(); });
  $('#auth-toggle-link')?.addEventListener('click', e => { e.preventDefault(); isAuthRegister = !isAuthRegister; showAuthScreen(); });
  $('#auth-form')?.addEventListener('submit', handleAuth);
  $('#btn-landing-purchase')?.addEventListener('click', () => {
    if (currentUser) showScreen('membership-screen');
    else { isAuthRegister = true; showAuthScreen(); }
  });

  // Chat
  $('#btn-new-chat')?.addEventListener('click', createNewChat);
  $('#chat-form')?.addEventListener('submit', handleChatSubmit);
  $('#chat-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chat-form').dispatchEvent(new Event('submit')); }
  });
  $('#chat-input')?.addEventListener('input', autoResize);

  // Sidebar
  $('#sidebar-toggle')?.addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#btn-logout')?.addEventListener('click', handleLogout);

  // Agent
  $('#btn-submit-task')?.addEventListener('click', handleSubmitTask);

  // Arcade
  $('#btn-upload-game')?.addEventListener('click', handleUploadGame);

  // Support
  $('#support-form')?.addEventListener('submit', handleSubmitTicket);

  // Admin tabs
  $$('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.admin-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.admin-panel').forEach(p => p.style.display = 'none');
      document.getElementById(tab.dataset.tab).style.display = '';
      // Load data for tab
      const t = tab.dataset.tab;
      if (t === 'admin-users') loadAdminUsers();
      if (t === 'admin-memberships') loadAdminMemberships();
      if (t === 'admin-tickets') loadAdminTickets();
      if (t === 'admin-arcade-pending') loadAdminArcadePending();
      if (t === 'admin-memories') loadAdminMemories();
    });
  });

  // Admin password
  $('#password-form')?.addEventListener('submit', handleChangePassword);
}

function autoResize() {
  const el = $('#chat-input');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 150) + 'px';
}

// --- Auth ---
function showAuthScreen() {
  showScreen('auth-screen');
  $('#auth-subtitle').textContent = isAuthRegister ? 'Create an account' : 'Sign in to continue';
  $('#auth-submit-btn').textContent = isAuthRegister ? 'Create Account' : 'Sign In';
  $('#auth-toggle-text').innerHTML = isAuthRegister
    ? 'Already have an account? <a href="#" id="auth-toggle-link">Sign in</a>'
    : 'Don\'t have an account? <a href="#" id="auth-toggle-link">Create one</a>';
  $('#email-group').style.display = isAuthRegister ? '' : 'none';
  $('#auth-error').textContent = '';
  $('#auth-toggle-link')?.addEventListener('click', e => { e.preventDefault(); isAuthRegister = !isAuthRegister; showAuthScreen(); });
}

async function handleAuth(e) {
  e.preventDefault();
  const username = $('#auth-username').value.trim();
  const password = $('#auth-password').value;
  const email = $('#auth-email').value.trim();

  try {
    const endpoint = isAuthRegister ? '/api/auth/register' : '/api/auth/login';
    const body = { username, password };
    if (isAuthRegister && email) body.email = email;

    const data = await apiJSON(endpoint, { method: 'POST', body: JSON.stringify(body) });
    currentUser = data.user;
    onLogin();
  } catch (err) {
    $('#auth-error').textContent = err.error || 'Authentication failed';
  }
}

async function handleLogout() {
  await apiJSON('/api/auth/logout', { method: 'POST' }).catch(() => {});
  currentUser = null;
  currentConversationId = null;
  showScreen('landing-screen');
}

// --- Conversations ---
async function loadConversations() {
  try {
    const convos = await apiJSON('/api/conversations');
    const list = $('#conversation-list');
    list.innerHTML = convos.map(c => `
      <div class="convo-item${c.id === currentConversationId ? ' active' : ''}" data-id="${c.id}">
        <span class="convo-title">${escapeHtml(c.title)}</span>
        <button class="delete-btn" onclick="event.stopPropagation();deleteConversation(${c.id})">&times;</button>
      </div>
    `).join('');
    list.querySelectorAll('.convo-item').forEach(el => {
      el.addEventListener('click', () => loadConversation(parseInt(el.dataset.id)));
    });
  } catch {}
}

async function createNewChat() {
  try {
    const data = await apiJSON('/api/conversations', { method: 'POST', body: JSON.stringify({ title: 'New Chat' }) });
    currentConversationId = data.id;
    loadConversations();
    clearChat();
    $('#sidebar')?.classList.remove('open');
  } catch {}
}

async function deleteConversation(id) {
  try {
    await apiJSON(`/api/conversations/${id}`, { method: 'DELETE' });
    if (currentConversationId === id) { currentConversationId = null; clearChat(); }
    loadConversations();
  } catch {}
}

async function loadConversation(id) {
  currentConversationId = id;
  loadConversations();
  try {
    const data = await apiJSON(`/api/conversations/${id}/messages`);
    renderMessages(data.messages);
    $('#sidebar')?.classList.remove('open');
  } catch {}
}

function clearChat() {
  const msgs = $('#chat-messages');
  msgs.innerHTML = `<div class="welcome-msg" id="welcome-msg">
    <h2>Welcome to Alleyesonme-AI</h2>
    <p>Start a new conversation or select one from the sidebar.</p>
    <div class="quick-prompts" id="quick-prompts"></div>
  </div>`;
  loadQuickPrompts();
}

function renderMessages(messages) {
  const container = $('#chat-messages');
  container.innerHTML = messages.map(m => `
    <div class="message ${m.role}">
      <div class="message-bubble">${formatMessage(m.content)}</div>
    </div>
  `).join('');
  container.scrollTop = container.scrollHeight;
}

function appendMessage(role, content) {
  const welcome = $('#welcome-msg');
  if (welcome) welcome.remove();
  const container = $('#chat-messages');
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.innerHTML = `<div class="message-bubble">${formatMessage(content)}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function formatMessage(text) {
  // Basic markdown: code blocks, bold, italic, lists
  let html = escapeHtml(text);
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold, italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  // Lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// --- Chat Submit ---
async function handleChatSubmit(e) {
  e.preventDefault();
  const input = $('#chat-input');
  const content = input.value.trim();
  if (!content || !currentConversationId) {
    if (!currentConversationId) await createNewChat();
    if (!content) return;
  }

  appendMessage('user', content);
  input.value = '';
  input.style.height = 'auto';
  $('#btn-send').disabled = true;
  const steps = $('#thinking-steps');
  steps.style.display = '';
  steps.innerHTML = '';

  try {
    const res = await fetch(`/api/conversations/${currentConversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ content }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'step') {
            steps.innerHTML += `<div class="thinking-step"><div class="spinner"></div> ${escapeHtml(data.label)} ${data.detail ? '<span style="color:var(--text-muted)">(' + escapeHtml(data.detail) + ')</span>' : ''}</div>`;
          } else if (data.type === 'response') {
            appendMessage('assistant', data.content);
            loadConversations();
          } else if (data.type === 'error') {
            appendMessage('assistant', 'Error: ' + data.error);
          }
        } catch {}
      }
    }
  } catch (err) {
    if (err.code === 'MEMBERSHIP_REQUIRED' || err.status === 403) {
      appendMessage('assistant', 'You need an active membership to continue chatting. Visit the Membership page to subscribe!');
    } else {
      appendMessage('assistant', 'Sorry, something went wrong. Please try again.');
    }
  }

  steps.style.display = 'none';
  steps.innerHTML = '';
  $('#btn-send').disabled = false;
}

// --- Quick Prompts ---
function loadQuickPrompts() {
  const el = $('#quick-prompts');
  if (!el) return;
  const prompts = [
    'Help me write a professional email',
    'Explain quantum computing simply',
    'Create a workout plan for beginners',
    'Write Python code to sort a list',
    'Plan a weekend trip to NYC',
    'Summarize the latest tech trends',
  ];
  el.innerHTML = prompts.map(p => `<button class="quick-prompt">${p}</button>`).join('');
  el.querySelectorAll('.quick-prompt').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!currentConversationId) await createNewChat();
      $('#chat-input').value = btn.textContent;
      $('#chat-form').dispatchEvent(new Event('submit'));
    });
  });
}

// --- Agent ---
async function loadAgentCapabilities() {
  try {
    const caps = await apiJSON('/api/agent/capabilities');
    const select = $('#agent-task-type');
    select.innerHTML = caps.map(c => `<option value="${c.id}">${c.name} — ${c.description}</option>`).join('');
    $('#agent-capabilities').innerHTML = caps.map(c => `
      <div class="capability-card">
        <h4>${escapeHtml(c.name)}</h4>
        <p>${escapeHtml(c.description)}</p>
      </div>
    `).join('');
  } catch {}
}

async function loadAgentTasks() {
  try {
    const tasks = await apiJSON('/api/agent/tasks');
    const el = $('#agent-tasks');
    if (!tasks.length) { el.innerHTML = '<p style="color:var(--text-muted)">No tasks yet. Submit one above!</p>'; return; }
    el.innerHTML = tasks.map(t => `
      <div class="task-item">
        <div class="task-header">
          <strong>${escapeHtml(t.task_type)} — ${escapeHtml(t.description.substring(0, 80))}${t.description.length > 80 ? '...' : ''}</strong>
          <span class="task-status ${t.status}">${t.status}</span>
        </div>
        <div style="font-size:12px;color:var(--text-muted)">${t.created_at}</div>
        ${t.result ? `<div class="task-result">${formatMessage(t.result)}</div>` : ''}
        ${t.status === 'processing' ? '<button class="btn-sm" onclick="refreshTask(' + t.id + ')">Refresh</button>' : ''}
      </div>
    `).join('');
  } catch {}
}

async function handleSubmitTask() {
  const type = $('#agent-task-type').value;
  const desc = $('#agent-task-desc').value.trim();
  if (!desc) return alert('Please describe your task');

  try {
    await apiJSON('/api/agent/tasks', { method: 'POST', body: JSON.stringify({ task_type: type, description: desc }) });
    $('#agent-task-desc').value = '';
    loadAgentTasks();
  } catch (err) {
    if (err.code === 'MEMBERSHIP_REQUIRED') alert('Active membership required for agent tasks.');
    else alert(err.error || 'Failed to submit task');
  }
}

async function refreshTask(id) {
  try {
    const task = await apiJSON(`/api/agent/tasks/${id}`);
    loadAgentTasks();
  } catch {}
}

// --- Store ---
async function loadStoreProducts() {
  try {
    const products = await apiJSON('/api/store/products');
    $('#store-products').innerHTML = products.map(p => `
      <div class="product-card">
        <h3>${escapeHtml(p.name)}</h3>
        <p>${escapeHtml(p.description || '')}</p>
        <div class="product-price">$${(p.price_cents / 100).toFixed(2)}</div>
        <button class="btn-primary" onclick="purchaseProduct(${p.id}, '${escapeHtml(p.name)}', ${p.price_cents})">Purchase</button>
      </div>
    `).join('');
    // Mark store as seen
    api('/api/membership/seen-store', { method: 'POST' }).catch(() => {});
  } catch {}
}

async function loadMyPurchases() {
  try {
    const purchases = await apiJSON('/api/store/my-purchases');
    const el = $('#my-purchases');
    if (!purchases.length) { el.innerHTML = '<p style="color:var(--text-muted)">No purchases yet.</p>'; return; }
    el.innerHTML = purchases.map(p => `
      <div class="task-item">
        <div class="task-header">
          <strong>${escapeHtml(p.product_name)}</strong>
          <span class="task-status ${p.status}">${p.status}</span>
        </div>
        <div style="font-size:12px;color:var(--text-muted)">$${(p.amount_cents/100).toFixed(2)} via ${p.payment_method} &middot; ${p.created_at}</div>
      </div>
    `).join('');
  } catch {}
}

async function purchaseProduct(id, name, cents) {
  const method = prompt(`Purchase "${name}" for $${(cents/100).toFixed(2)}\n\nPayment method:\n1. PayPal\n2. BTC\n3. LTC\n\nEnter 1, 2, or 3:`);
  const methods = { '1': 'paypal', '2': 'crypto_btc', '3': 'crypto_ltc' };
  const pm = methods[method];
  if (!pm) return;

  const ref = prompt('Enter your payment reference / transaction ID:');
  if (!ref) return;

  try {
    const data = await apiJSON('/api/store/purchase', { method: 'POST', body: JSON.stringify({ product_id: id, payment_method: pm, payment_ref: ref }) });
    alert(data.message);
    loadMyPurchases();
  } catch (err) {
    alert(err.error || 'Purchase failed');
  }
}

// --- Arcade ---
async function loadArcadeGames() {
  try {
    const games = await apiJSON('/api/arcade/games');
    $('#arcade-games').innerHTML = games.map(g => `
      <div class="game-card" onclick="playGame(${g.id})">
        <h3>${escapeHtml(g.title)}</h3>
        <p>${escapeHtml(g.description || '')}</p>
        <div class="game-meta">By ${escapeHtml(g.author)} &middot; ${g.play_count} plays</div>
      </div>
    `).join('');
    // Show upload section for authenticated users
    const uploadSection = $('#arcade-upload-section');
    if (uploadSection) uploadSection.style.display = currentUser ? '' : 'none';
  } catch {}
}

async function playGame(id) {
  try {
    const game = await apiJSON(`/api/arcade/games/${id}`);
    $('#game-player-title').textContent = game.title;
    $('#game-container').innerHTML = game.html_content;
    showScreen('game-player-screen');
    // Execute scripts in the game content
    const scripts = $('#game-container').querySelectorAll('script');
    scripts.forEach(s => {
      const ns = document.createElement('script');
      ns.textContent = s.textContent;
      s.parentNode.replaceChild(ns, s);
    });
  } catch (err) {
    alert(err.error || 'Failed to load game');
  }
}

async function handleUploadGame() {
  const title = $('#game-title').value.trim();
  const desc = $('#game-description').value.trim();
  const html = $('#game-html').value.trim();

  if (!title || !html) return alert('Title and HTML content required');

  try {
    const data = await apiJSON('/api/arcade/upload', { method: 'POST', body: JSON.stringify({ title, description: desc, html_content: html }) });
    alert(data.message);
    $('#game-title').value = '';
    $('#game-description').value = '';
    $('#game-html').value = '';
    loadArcadeGames();
  } catch (err) {
    alert(err.error || 'Upload failed');
  }
}

// --- Membership ---
let plansData = [];

async function loadPlans() {
  try {
    const data = await apiJSON('/api/membership/plans');
    plansData = data;
    $('#plans-grid').innerHTML = data.plans.map(p => `
      <div class="plan-card" data-plan="${p.id}" onclick="selectPlan('${p.id}')">
        <h3>${p.label}</h3>
        <div class="plan-price">$${p.price}</div>
        <div class="plan-period">${p.label} access</div>
      </div>
    `).join('');
  } catch {}
}

async function loadMembershipStatus() {
  try {
    const data = await apiJSON('/api/membership/status');
    const el = $('#membership-status');
    if (data.active) {
      el.innerHTML = `<p style="color:var(--success);font-weight:600">Active: ${data.active.plan} plan (expires ${data.active.expires_at})</p>`;
    } else if (data.pending) {
      el.innerHTML = `<p style="color:var(--warning);font-weight:600">Pending: ${data.pending.plan} plan — awaiting approval</p>`;
    } else {
      el.innerHTML = `<p style="color:var(--text-muted)">No active membership</p>`;
    }
  } catch {}
}

function selectPlan(planId) {
  selectedPlan = plansData.plans?.find(p => p.id === planId);
  $$('.plan-card').forEach(c => c.classList.toggle('selected', c.dataset.plan === planId));

  const section = $('#payment-section');
  section.style.display = '';
  $('#payment-details').innerHTML = `<p>Selected: <strong>${selectedPlan.label}</strong> — $${selectedPlan.price}</p>`;
  $('#payment-methods').innerHTML = `
    <button class="payment-method-btn" onclick="payStripe()">Pay with Card (Stripe)</button>
    <button class="payment-method-btn" onclick="payManual('paypal')">Pay with PayPal</button>
    <button class="payment-method-btn" onclick="payManual('crypto_btc')">Pay with Bitcoin</button>
    <button class="payment-method-btn" onclick="payManual('crypto_ltc')">Pay with Litecoin</button>
  `;
}

async function payStripe() {
  if (!selectedPlan) return;
  try {
    const data = await apiJSON('/api/membership/stripe-checkout', { method: 'POST', body: JSON.stringify({ plan_id: selectedPlan.id }) });
    if (data.url) window.location.href = data.url;
  } catch (err) {
    alert(err.error || 'Stripe checkout failed');
  }
}

async function payManual(method) {
  if (!selectedPlan) return;
  let instructions = '';
  if (method === 'paypal') {
    instructions = `Send $${selectedPlan.price} to: ${plansData.paypal}\n\nEnter your PayPal transaction ID:`;
  } else if (method === 'crypto_btc') {
    instructions = `Send $${selectedPlan.price} in BTC to:\n${plansData.crypto.btc.address}\n\nEnter your transaction hash:`;
  } else {
    instructions = `Send $${selectedPlan.price} in LTC to:\n${plansData.crypto.ltc.address}\n\nEnter your transaction hash:`;
  }
  const ref = prompt(instructions);
  if (!ref) return;

  try {
    const data = await apiJSON('/api/membership/subscribe', { method: 'POST', body: JSON.stringify({ plan_id: selectedPlan.id, payment_method: method, payment_ref: ref }) });
    alert(data.message);
    loadMembershipStatus();
  } catch (err) {
    alert(err.error || 'Subscription failed');
  }
}

// --- Support ---
async function loadTickets() {
  try {
    const tickets = await apiJSON('/api/support/tickets');
    const el = $('#tickets-list');
    if (!tickets.length) { el.innerHTML = '<p style="color:var(--text-muted)">No tickets yet.</p>'; return; }
    el.innerHTML = tickets.map(t => `
      <div class="ticket-item">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h4>${escapeHtml(t.subject)}</h4>
          <span class="ticket-status ${t.status}">${t.status}</span>
        </div>
        <p>${escapeHtml(t.message)}</p>
        <div style="font-size:12px;color:var(--text-muted)">${t.created_at}</div>
        ${t.admin_reply ? `<div class="admin-reply"><strong>Admin:</strong> ${escapeHtml(t.admin_reply)}</div>` : ''}
      </div>
    `).join('');
  } catch {}
}

async function handleSubmitTicket(e) {
  e.preventDefault();
  const subject = $('#ticket-subject').value.trim();
  const message = $('#ticket-message').value.trim();
  if (!subject || !message) return;

  try {
    const data = await apiJSON('/api/support/tickets', { method: 'POST', body: JSON.stringify({ subject, message }) });
    alert(data.message);
    $('#ticket-subject').value = '';
    $('#ticket-message').value = '';
    loadTickets();
  } catch (err) {
    alert(err.error || 'Failed to submit ticket');
  }
}

// --- Admin ---
async function loadAdminStats() {
  try {
    const stats = await apiJSON('/api/admin/stats');
    $('#admin-stats').innerHTML = Object.entries({
      'Users': stats.users, 'Active Memberships': stats.active_memberships,
      'Pending': stats.pending_memberships, 'Conversations': stats.conversations,
      'Messages': stats.messages, 'Open Tickets': stats.open_tickets,
      'Pending Tasks': stats.pending_tasks,
    }).map(([k, v]) => `<div class="stat-card"><div class="stat-value">${v}</div><div class="stat-label">${k}</div></div>`).join('');
  } catch {}
}

async function loadAdminUsers() {
  try {
    const users = await apiJSON('/api/admin/users');
    $('#admin-users').innerHTML = `<table><thead><tr><th>ID</th><th>Username</th><th>Role</th><th>Active</th><th>Actions</th></tr></thead><tbody>
      ${users.map(u => `<tr>
        <td>${u.id}</td><td>${escapeHtml(u.username)}</td><td>${u.role}</td><td>${u.is_active ? 'Yes' : 'No'}</td>
        <td>
          <button class="btn-sm" onclick="toggleUser(${u.id})">${u.is_active ? 'Disable' : 'Enable'}</button>
          <button class="btn-sm" onclick="changeRole(${u.id})">Role</button>
        </td>
      </tr>`).join('')}
    </tbody></table>`;
  } catch {}
}

async function toggleUser(id) {
  await apiJSON(`/api/admin/users/${id}/toggle`, { method: 'POST' }).catch(() => {});
  loadAdminUsers();
}

async function changeRole(id) {
  const role = prompt('Enter new role (user, admin, vip):');
  if (!role) return;
  await apiJSON(`/api/admin/users/${id}/role`, { method: 'POST', body: JSON.stringify({ role }) }).catch(() => {});
  loadAdminUsers();
}

async function loadAdminMemberships() {
  try {
    const memberships = await apiJSON('/api/admin/memberships');
    $('#admin-memberships').innerHTML = `<table><thead><tr><th>User</th><th>Plan</th><th>Amount</th><th>Method</th><th>Ref</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      ${memberships.map(m => `<tr>
        <td>${escapeHtml(m.username)}</td><td>${m.plan}</td><td>$${(m.amount_cents/100).toFixed(2)}</td>
        <td>${m.payment_method}</td><td>${escapeHtml(m.payment_ref || '')}</td><td>${m.status}</td>
        <td>${m.status === 'pending' ? `<button class="btn-sm" onclick="approveMembership(${m.id})">Approve</button><button class="btn-sm danger" onclick="rejectMembership(${m.id})">Reject</button>` : ''}</td>
      </tr>`).join('')}
    </tbody></table>`;
  } catch {}
}

async function approveMembership(id) {
  await apiJSON(`/api/admin/memberships/${id}/approve`, { method: 'POST' }).catch(() => {});
  loadAdminMemberships();
  loadAdminStats();
}
async function rejectMembership(id) {
  await apiJSON(`/api/admin/memberships/${id}/reject`, { method: 'POST' }).catch(() => {});
  loadAdminMemberships();
}

async function loadAdminTickets() {
  try {
    const tickets = await apiJSON('/api/admin/tickets');
    $('#admin-tickets').innerHTML = tickets.map(t => `
      <div class="ticket-item">
        <div style="display:flex;justify-content:space-between"><h4>${escapeHtml(t.subject)}</h4><span class="ticket-status ${t.status}">${t.status}</span></div>
        <div style="font-size:12px;color:var(--text-muted)">From: ${escapeHtml(t.username)} &middot; ${t.created_at}</div>
        <p>${escapeHtml(t.message)}</p>
        ${t.admin_reply ? `<div class="admin-reply"><strong>Reply:</strong> ${escapeHtml(t.admin_reply)}</div>` : ''}
        ${t.status === 'open' ? `<div style="margin-top:8px"><textarea id="reply-${t.id}" placeholder="Type your reply..." rows="2" style="width:100%;margin-bottom:8px"></textarea><button class="btn-sm" onclick="replyTicket(${t.id})">Send Reply</button></div>` : ''}
      </div>
    `).join('');
  } catch {}
}

async function replyTicket(id) {
  const reply = document.getElementById(`reply-${id}`).value.trim();
  if (!reply) return;
  await apiJSON(`/api/admin/tickets/${id}/reply`, { method: 'POST', body: JSON.stringify({ reply }) }).catch(() => {});
  loadAdminTickets();
}

async function loadAdminArcadePending() {
  try {
    const games = await apiJSON('/api/admin/arcade/pending');
    const el = $('#admin-arcade-pending');
    if (!games.length) { el.innerHTML = '<p style="color:var(--text-muted)">No pending games.</p>'; return; }
    el.innerHTML = games.map(g => `
      <div class="task-item">
        <div class="task-header"><strong>${escapeHtml(g.title)}</strong><span style="color:var(--text-muted)">by ${escapeHtml(g.author || 'Unknown')}</span></div>
        <p>${escapeHtml(g.description || '')}</p>
        <button class="btn-sm" onclick="approveGame(${g.id})">Approve</button>
        <button class="btn-sm danger" onclick="rejectGame(${g.id})">Reject</button>
      </div>
    `).join('');
  } catch {}
}

async function approveGame(id) {
  await apiJSON(`/api/admin/arcade/${id}/approve`, { method: 'POST' }).catch(() => {});
  loadAdminArcadePending();
}
async function rejectGame(id) {
  if (!confirm('Delete this game?')) return;
  await apiJSON(`/api/admin/arcade/${id}/reject`, { method: 'POST' }).catch(() => {});
  loadAdminArcadePending();
}

async function loadAdminMemories() {
  try {
    const memories = await apiJSON('/api/admin/memories');
    const el = $('#admin-memories');
    if (!memories.length) { el.innerHTML = '<p style="color:var(--text-muted)">No memories yet.</p>'; return; }
    el.innerHTML = memories.map(m => `
      <div class="task-item">
        <div class="task-header"><strong>${escapeHtml(m.username)}</strong><button class="btn-sm danger" onclick="deleteMemory(${m.user_id})">Delete</button></div>
        <div class="task-result">${escapeHtml(m.memory_text)}</div>
        <div style="font-size:12px;color:var(--text-muted)">Updated: ${m.updated_at}</div>
      </div>
    `).join('');
  } catch {}
}

async function deleteMemory(uid) {
  await apiJSON(`/api/admin/memories/${uid}`, { method: 'DELETE' }).catch(() => {});
  loadAdminMemories();
}

async function handleChangePassword(e) {
  e.preventDefault();
  const current = $('#pw-current').value;
  const newPw = $('#pw-new').value;
  try {
    await apiJSON('/api/admin/change-password', { method: 'POST', body: JSON.stringify({ current_password: current, new_password: newPw }) });
    $('#pw-result').innerHTML = '<p style="color:var(--success)">Password changed!</p>';
    $('#pw-current').value = '';
    $('#pw-new').value = '';
  } catch (err) {
    $('#pw-result').innerHTML = `<p style="color:var(--danger)">${err.error || 'Failed'}</p>`;
  }
}

// --- Boot ---
document.addEventListener('DOMContentLoaded', init);
