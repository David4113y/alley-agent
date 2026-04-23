/**
 * Alleyesonme-AI — Frontend Application
 */

// ===== State =====
let currentUser = null;
let conversations = [];
let activeConvoId = null;
let selectedPlan = null;
let selectedPayment = null;
let plansData = null;

// ===== Prompt Pool (cycling randomly, 6 shown at a time) =====
const PROMPT_POOL = [
  { icon: "&#9997;", text: "Write me a poem", prompt: "Write me a poem about the ocean at sunset" },
  { icon: "&#128300;", text: "Explain quantum physics simply", prompt: "Explain quantum physics in simple terms that anyone can understand" },
  { icon: "&#127918;", text: "Design me a game", prompt: "Design me a fun browser game I can play right now" },
  { icon: "&#127760;", text: "Build me a website", prompt: "Build me a modern landing page website with HTML and CSS" },
  { icon: "&#9992;", text: "Help me plan a trip", prompt: "Help me plan a 7-day trip to Japan including must-see spots and budget tips" },
  { icon: "&#128187;", text: "Debug my code", prompt: "Help me debug my code. I'll paste it below." },
  { icon: "&#128218;", text: "Summarize a book", prompt: "Summarize the key ideas of Atomic Habits by James Clear" },
  { icon: "&#128176;", text: "Write a business plan", prompt: "Write me a business plan for a mobile app startup" },
  { icon: "&#127912;", text: "Create a logo concept", prompt: "Describe a creative logo concept for a tech company called NovaByte" },
  { icon: "&#128202;", text: "Analyze data for me", prompt: "Help me analyze sales data and identify trends" },
  { icon: "&#127911;", text: "Recommend music", prompt: "Recommend 10 songs similar to Bohemian Rhapsody by Queen" },
  { icon: "&#128221;", text: "Write a cover letter", prompt: "Write a professional cover letter for a software engineering position" },
  { icon: "&#128170;", text: "Create a workout plan", prompt: "Create a 4-week workout plan for building muscle at home" },
  { icon: "&#127858;", text: "Plan a meal", prompt: "Plan a healthy meal prep for the week with grocery list" },
  { icon: "&#128161;", text: "Brainstorm ideas", prompt: "Brainstorm 10 creative side hustle ideas I can start this week" },
  { icon: "&#128640;", text: "Teach me something new", prompt: "Teach me the basics of machine learning in simple terms" },
  { icon: "&#127908;", text: "Write a speech", prompt: "Write a 3-minute motivational speech for a graduation ceremony" },
  { icon: "&#128736;", text: "Fix my resume", prompt: "Review and improve my resume for a marketing manager role" },
  { icon: "&#128205;", text: "Plan a date night", prompt: "Plan a creative and affordable date night in a big city" },
  { icon: "&#128640;", text: "Explain blockchain", prompt: "Explain blockchain technology and how cryptocurrency works in simple terms" },
];

function getRandomPrompts(count) {
  const shuffled = [...PROMPT_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function renderLandingPrompts() {
  const grid = document.getElementById("landing-prompts-grid");
  if (!grid) return;
  const prompts = getRandomPrompts(6);
  grid.innerHTML = prompts.map(p =>
    `<div class="landing-prompt-card">
      <div class="example-icon">${p.icon}</div>
      <div class="example-text">${p.text}</div>
    </div>`
  ).join("");
}

function renderWelcomePrompts() {
  const grid = document.getElementById("welcome-prompts-grid");
  if (!grid) return;
  const prompts = getRandomPrompts(6);
  grid.innerHTML = prompts.map(p =>
    `<div class="example-card" data-prompt="${p.prompt.replace(/"/g, '&quot;')}">
      <div class="example-icon">${p.icon}</div>
      <div class="example-text">${p.text}</div>
    </div>`
  ).join("");
  // Attach click handlers to new cards
  grid.querySelectorAll(".example-card").forEach((card) => {
    card.addEventListener("click", () => {
      const promptText = card.getAttribute("data-prompt");
      if (promptText) {
        $("#chat-input").value = promptText;
        sendMessage();
      }
    });
  });
}

// ===== DOM refs =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ===== Welcome Screen / Chat Messages Toggle =====
function showWelcomeScreen() {
  const ws = $("#welcome-screen");
  const cm = $("#chat-messages");
  if (ws) ws.classList.remove("hidden");
  if (cm) cm.classList.remove("active");
}
function showChatMessages() {
  const ws = $("#welcome-screen");
  const cm = $("#chat-messages");
  if (ws) ws.classList.add("hidden");
  if (cm) cm.classList.add("active");
}
function resetToWelcomeScreen() {
  activeConvoId = null;
  $("#chat-messages").innerHTML = "";
  $("#chat-title").textContent = "New Chat";
  renderWelcomePrompts();
  showWelcomeScreen();
}

// ===== Screen management =====
function showScreen(name) {
  ["landing-screen", "auth-screen", "app-screen", "membership-screen", "admin-screen", "support-screen"].forEach((id) => {
    document.getElementById(id).style.display = "none";
  });
  const el = document.getElementById(name + "-screen");
  if (name === "app") el.style.display = "flex";
  else if (name === "landing") el.style.display = "block";
  else if (name === "auth") el.style.display = "flex";
  else el.style.display = "block";
}

// ===== Init =====
let postAuthRedirect = null; // tracks where to go after login/register

async function init() {
  try {
    const resp = await fetch("/api/auth/me");
    if (resp.ok) {
      const data = await resp.json();
      currentUser = data.user;
      enterApp();
    } else {
      renderLandingPrompts();
      showScreen("landing");
    }
  } catch {
    renderLandingPrompts();
    showScreen("landing");
  }
}

function enterApp() {
  showScreen("app");
  // Always close sidebar on mobile when entering the app
  closeSidebar();
  renderWelcomePrompts();
  $("#user-name").textContent = currentUser.username;
  $("#user-role").textContent = currentUser.role;
  $("#user-avatar").textContent = currentUser.username.charAt(0).toUpperCase();
  if (currentUser.role === "admin") {
    $("#link-admin").style.display = "inline";
    // Admin sees store preview button, not upgrade banner
    $("#admin-store-btn").style.display = "flex";
    $("#upgrade-banner").style.display = "none";
    $("#welcome-upgrade-cta").style.display = "none";
    $("#link-membership").style.display = "none";
  } else {
    // Non-admin: show upgrade banner and CTA, check membership status
    $("#admin-store-btn").style.display = "none";
    showUpgradeElements();
  }
  loadConversations();
}

async function showUpgradeElements() {
  try {
    const resp = await fetch("/api/membership/status");
    const status = await resp.json();
    if (status.active) {
      // Active member — hide upgrade prompts
      $("#upgrade-banner").style.display = "none";
      $("#welcome-upgrade-cta").style.display = "none";
      $("#link-membership").style.display = "flex";
    } else {
      // No active membership — show all upgrade CTAs prominently
      $("#upgrade-banner").style.display = "flex";
      $("#welcome-upgrade-cta").style.display = "flex";
      $("#link-membership").style.display = "flex";
    }
  } catch {
    // On error, show upgrade elements by default
    $("#upgrade-banner").style.display = "flex";
    $("#welcome-upgrade-cta").style.display = "flex";
    $("#link-membership").style.display = "flex";
  }
}

// ===== Auth =====
let isLoginMode = true;

function toggleAuthMode() {
  isLoginMode = !isLoginMode;
  if (isLoginMode) {
    $("#auth-subtitle").textContent = "Sign in to continue";
    $("#auth-submit").textContent = "Sign In";
    $("#auth-toggle-text").textContent = "Don't have an account?";
    $("#auth-toggle-link").textContent = "Register";
    $("#email-group").style.display = "none";
  } else {
    $("#auth-subtitle").textContent = "Create your account";
    $("#auth-submit").textContent = "Register";
    $("#auth-toggle-text").textContent = "Already have an account?";
    $("#auth-toggle-link").textContent = "Sign In";
    $("#email-group").style.display = "block";
  }
  $("#auth-error").style.display = "none";
}

// ===== Landing Page Handlers =====

// "Purchase Membership Now!" — go to register, then redirect to store
$("#btn-landing-purchase").addEventListener("click", () => {
  postAuthRedirect = "membership";
  showScreen("auth");
  if (isLoginMode) toggleAuthMode(); // switch to register mode
});

// "Sign In" link
$("#landing-signin").addEventListener("click", (e) => {
  e.preventDefault();
  postAuthRedirect = null;
  showScreen("auth");
  if (!isLoginMode) toggleAuthMode(); // switch to login mode
});

// "Create Account" link
$("#landing-register").addEventListener("click", (e) => {
  e.preventDefault();
  postAuthRedirect = "membership";
  showScreen("auth");
  if (isLoginMode) toggleAuthMode(); // switch to register mode
});

// Back to landing from auth screen
$("#auth-back-to-landing").addEventListener("click", (e) => {
  e.preventDefault();
  postAuthRedirect = null;
  renderLandingPrompts();
  showScreen("landing");
});

$("#auth-toggle-link").addEventListener("click", (e) => { e.preventDefault(); toggleAuthMode(); });

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("#auth-username").value.trim();
  const password = $("#auth-password").value;
  const email = $("#auth-email").value.trim();

  const endpoint = isLoginMode ? "/api/auth/login" : "/api/auth/register";
  const body = { username, password };
  if (!isLoginMode && email) body.email = email;

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) {
      $("#auth-error").textContent = data.error;
      $("#auth-error").style.display = "block";
      return;
    }
    currentUser = data.user;
    if (postAuthRedirect === "membership") {
      postAuthRedirect = null;
      enterApp();
      // Immediately show membership store
      showScreen("membership");
      loadMembership();
    } else {
      enterApp();
    }
  } catch (err) {
    $("#auth-error").textContent = "Connection error. Please try again.";
    $("#auth-error").style.display = "block";
  }
});

// ===== Sidebar Toggle (Mobile) =====

// Upgrade banner click -> go to membership page
$("#upgrade-banner").addEventListener("click", () => {
  showScreen("membership");
  loadMembership();
  closeSidebar();
});

// Admin store preview click -> go to membership page
$("#admin-store-btn").addEventListener("click", () => {
  showScreen("membership");
  loadMembership();
  closeSidebar();
});

// Welcome CTA click -> go to membership page
const welcomeUpgradeBtn = $("#btn-welcome-upgrade");
if (welcomeUpgradeBtn) {
  welcomeUpgradeBtn.addEventListener("click", () => {
    showScreen("membership");
    loadMembership();
  });
}

function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#sidebar-overlay").classList.remove("active");
}

function openSidebar() {
  $("#sidebar").classList.add("open");
  $("#sidebar-overlay").classList.add("active");
}

$("#btn-sidebar-toggle").addEventListener("click", () => {
  const sidebar = $("#sidebar");
  if (sidebar.classList.contains("open")) {
    closeSidebar();
  } else {
    openSidebar();
  }
});

// Close button inside sidebar (mobile)
$("#btn-sidebar-close").addEventListener("click", () => {
  closeSidebar();
});

$("#sidebar-overlay").addEventListener("click", () => {
  closeSidebar();
});

// ===== Example Prompt Cards =====
// (Handled dynamically via renderWelcomePrompts)

// ===== Welcome Prompt Box (wide input on welcome screen) =====
const welcomePromptInput = $("#welcome-prompt-input");
const welcomePromptSend = $("#welcome-prompt-send");

if (welcomePromptInput && welcomePromptSend) {
  welcomePromptSend.addEventListener("click", () => {
    const text = welcomePromptInput.value.trim();
    if (!text) return;
    // Dismiss keyboard and reset viewport before DOM changes
    welcomePromptInput.blur();
    // Transfer to main chat input and send
    $("#chat-input").value = text;
    welcomePromptInput.value = "";
    sendMessage();
  });

  welcomePromptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = welcomePromptInput.value.trim();
      if (!text) return;
      welcomePromptInput.blur();
      $("#chat-input").value = text;
      welcomePromptInput.value = "";
      sendMessage();
    }
  });

  // Auto-resize
  welcomePromptInput.addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = Math.min(this.scrollHeight, 200) + "px";
  });
}

// ===== Conversations =====
async function loadConversations() {
  try {
    const resp = await fetch("/api/chat/conversations");
    if (resp.status === 403) {
      const data = await resp.json();
      if (data.code === "NO_MEMBERSHIP" && currentUser.role !== "admin") {
        // Don't redirect — let the user see the chat and use trial prompt
        // They can still type; sendMessage handles the membership gate
        return;
      }
    }
    if (!resp.ok) return;
    conversations = await resp.json();
    renderConversations();
  } catch {}
}

function renderConversations() {
  const list = $("#conversation-list");
  list.innerHTML = "";
  conversations.forEach((c) => {
    const div = document.createElement("div");
    div.className = "convo-item" + (c.id === activeConvoId ? " active" : "");
    div.innerHTML = `
      <span class="convo-title">${escapeHtml(c.title)}</span>
      <span class="convo-delete" title="Delete">&times;</span>
    `;
    div.querySelector(".convo-title").addEventListener("click", () => {
      openConversation(c.id);
      closeSidebar();
    });
    div.querySelector(".convo-delete").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteConversation(c.id);
    });
    list.appendChild(div);
  });
}

async function openConversation(id) {
  activeConvoId = id;
  renderConversations();

  // Immediately switch to chat view and show loading
  showChatMessages();
  const container = $("#chat-messages");
  container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Loading...</div>';

  try {
    const resp = await fetch(`/api/chat/conversations/${id}/messages`);
    if (!resp.ok) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Failed to load conversation.</div>';
      return;
    }
    const data = await resp.json();

    // Verify this is still the active conversation (prevents race conditions)
    if (activeConvoId !== id) return;

    $("#chat-title").textContent = data.conversation.title;
    container.innerHTML = "";

    if (data.messages.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);"><h2 style="color:var(--text-primary);margin-bottom:8px;">Alleyesonme-AI</h2><p>Start typing to begin this conversation.</p></div>';
    } else {
      data.messages.forEach((m) => appendMessage(m.role, m.content));
    }

    container.scrollTop = container.scrollHeight;
  } catch (err) {
    if (activeConvoId === id) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Failed to load conversation.</div>';
    }
  }
}

async function deleteConversation(id) {
  await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" });
  if (activeConvoId === id) {
    resetToWelcomeScreen();
  }
  loadConversations();
}

$("#btn-new-chat").addEventListener("click", () => {
  resetToWelcomeScreen();
  loadConversations();
  closeSidebar();
});

// ===== Chat =====
function appendMessage(role, content) {
  // Ensure we're showing chat messages, not welcome screen
  showChatMessages();

  const container = $("#chat-messages");
  const div = document.createElement("div");
  div.className = `message ${role}`;
  div.innerHTML = `
    <div class="msg-role">${role === "user" ? "You" : "Alleyesonme-AI"}</div>
    <div class="msg-content">${formatMarkdown(content)}</div>
  `;
  container.appendChild(div);

  // Scroll to bottom
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

// ===== Inline Thinking Block (persists in chat history) =====

/** Create a live thinking block in the chat messages area. Returns a controller object. */
function createThinkingBlock() {
  showChatMessages();
  const container = $("#chat-messages");

  const block = document.createElement("div");
  block.className = "thinking-block live";

  // Live header with animated dots
  block.innerHTML = `
    <div class="thinking-live-header">
      <div class="thinking-dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
      <span class="thinking-live-label">Thinking...</span>
    </div>
    <div class="thinking-steps-container">
      <div class="thinking-steps-inner"></div>
    </div>
  `;
  container.appendChild(block);

  const stepsInner = block.querySelector(".thinking-steps-inner");
  const liveLabel = block.querySelector(".thinking-live-label");
  const startTime = Date.now();

  function scrollToBottom() {
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  }
  scrollToBottom();

  return {
    /** Add a new step to the timeline. */
    addStep(label, detail) {
      // Mark previous active as done
      const prev = stepsInner.querySelector(".thinking-step.active");
      if (prev) {
        prev.classList.remove("active");
        prev.classList.add("done");
        const icon = prev.querySelector(".step-icon");
        if (icon) icon.textContent = "\u2713";
      }
      // Create new step
      const el = document.createElement("div");
      el.className = "thinking-step active";
      el.innerHTML = `<span class="step-label">${escapeHtml(label)}${detail ? `<span class="step-detail"> \u2014 ${escapeHtml(detail)}</span>` : ""}</span><span class="step-icon">...</span>`;
      stepsInner.appendChild(el);
      // Update live label
      liveLabel.textContent = label;
      scrollToBottom();
    },

    /** Finalize all steps and collapse into a toggle. */
    finalize() {
      // Mark remaining active steps as done
      stepsInner.querySelectorAll(".thinking-step.active").forEach(el => {
        el.classList.remove("active");
        el.classList.add("done");
        const icon = el.querySelector(".step-icon");
        if (icon) icon.textContent = "\u2713";
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const stepCount = stepsInner.querySelectorAll(".thinking-step").length;

      // Switch from live to collapsed toggle
      block.classList.remove("live");

      // Replace live header with toggle button
      const liveHeader = block.querySelector(".thinking-live-header");
      const toggle = document.createElement("button");
      toggle.className = "thinking-toggle";
      toggle.innerHTML = `
        <span class="thinking-toggle-icon"><svg viewBox="0 0 12 12"><path d="M4 2L8 6L4 10"/></svg></span>
        <span class="thinking-toggle-text">Thought for ${elapsed}s</span>
        <span class="thinking-toggle-duration">${stepCount} step${stepCount !== 1 ? "s" : ""}</span>
      `;
      toggle.addEventListener("click", () => {
        block.classList.toggle("expanded");
      });

      liveHeader.replaceWith(toggle);
      scrollToBottom();
    },

    /** Remove the block entirely (for error recovery). */
    remove() {
      block.remove();
    },

    /** Get the DOM element. */
    get element() { return block; }
  };
}

/** Parse SSE lines from a text chunk. Returns array of parsed data objects. */
function parseSSEChunk(text) {
  const events = [];
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try { events.push(JSON.parse(line.slice(6))); } catch {}
    }
  }
  return events;
}

async function sendMessage() {
  const input = $("#chat-input");
  const content = input.value.trim();
  if (!content) return;

  if (!activeConvoId) {
    const resp = await fetch("/api/chat/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Chat" }),
    });
    if (!resp.ok) {
      const data = await resp.json();
      if (data.code === "NO_MEMBERSHIP") { showScreen("membership"); loadMembership(); }
      return;
    }
    const data = await resp.json();
    activeConvoId = data.id;
  }

  input.value = "";
  input.style.height = "auto";
  input.blur();
  appendMessage("user", content);

  // Create inline thinking block
  const thinking = createThinkingBlock();
  $("#btn-send").disabled = true;

  try {
    const resp = await fetch(`/api/chat/conversations/${activeConvoId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (!resp.ok) {
      thinking.remove();
      $("#btn-send").disabled = false;
      try {
        const data = await resp.json();
        if (data.code === "NO_MEMBERSHIP") {
          appendMessage("assistant", "Thanks for trying Alleyesonme-AI! To continue chatting, please subscribe to a membership plan.");
          setTimeout(() => { showScreen("membership"); loadMembership(); }, 2000);
          return;
        }
        appendMessage("assistant", `Error: ${data.error || "Something went wrong."}`);
      } catch {
        appendMessage("assistant", "Error: Something went wrong.");
      }
      return;
    }

    // Read SSE stream
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalData = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop();

      for (const part of parts) {
        const events = parseSSEChunk(part + "\n");
        for (const evt of events) {
          if (evt.type === "step") {
            thinking.addStep(evt.label, evt.detail);
          } else if (evt.type === "response") {
            finalData = evt;
          } else if (evt.type === "error") {
            thinking.remove();
            appendMessage("assistant", `Error: ${evt.error}`);
          }
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const events = parseSSEChunk(buffer);
      for (const evt of events) {
        if (evt.type === "response") finalData = evt;
      }
    }

    // Finalize thinking block into collapsed toggle
    thinking.finalize();
    $("#btn-send").disabled = false;

    if (finalData) {
      appendMessage("assistant", finalData.content);

      if (finalData.trialUsed) {
        setTimeout(() => {
          appendMessage("assistant", "That was your free trial prompt! Subscribe to a membership plan to continue using Alleyesonme-AI with unlimited access.");
          setTimeout(() => { showScreen("membership"); loadMembership(); }, 3000);
        }, 1500);
      }
    }

    loadConversations();
  } catch (err) {
    thinking.remove();
    $("#btn-send").disabled = false;
    appendMessage("assistant", "Error: Failed to connect to server.");
  }
}

$("#btn-send").addEventListener("click", sendMessage);
$("#chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// Auto-resize textarea
$("#chat-input").addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 200) + "px";
});

// ===== Membership =====
async function loadMembership() {
  // Mark store as seen (for free trial eligibility)
  if (currentUser && currentUser.role !== "admin") {
    fetch("/api/membership/seen-store", { method: "POST" }).catch(() => {});
  }

  // Load plans
  const plansResp = await fetch("/api/membership/plans");
  plansData = await plansResp.json();

  const grid = $("#plans-grid");
  grid.innerHTML = "";
  plansData.plans.forEach((p) => {
    const div = document.createElement("div");
    div.className = "plan-card";
    div.dataset.id = p.id;
    // Add badges for popular/best value plans
    let badge = "";
    if (p.id === "monthly") badge = '<span class="plan-badge popular">Most Popular</span>';
    else if (p.id === "annual") badge = '<span class="plan-badge best-value">Best Value</span>';
    else if (p.id === "semiannual") badge = '<span class="plan-badge best-value">Save 33%</span>';
    div.innerHTML = `
      ${badge}
      <div class="plan-duration">${p.label}</div>
      <div class="plan-price">$${p.price}</div>
    `;
    div.addEventListener("click", () => selectPlan(p.id));
    grid.appendChild(div);
  });

  // Payment info
  $("#paypal-link").href = plansData.paypal;
  $("#paypal-link").textContent = plansData.paypal;
  $("#ltc-address").textContent = plansData.crypto.ltc.address;
  $("#btc-address").textContent = plansData.crypto.btc.address;

  // Check status
  const statusResp = await fetch("/api/membership/status");
  const status = await statusResp.json();
  const statusDiv = $("#membership-status");
  statusDiv.innerHTML = "";

  if (status.active) {
    statusDiv.innerHTML = `<p style="margin-bottom:24px"><span class="active-badge">Active — ${status.active.plan}</span> Expires: ${new Date(status.active.expires_at).toLocaleDateString()}</p>`;
  } else if (status.pending) {
    statusDiv.innerHTML = `<p style="margin-bottom:24px;color:#58a6ff;background:rgba(88,166,255,0.1);padding:12px 16px;border-radius:8px;border:1px solid rgba(88,166,255,0.3);">Your <strong>${status.pending.plan}</strong> membership is <strong>pending approval</strong>. We're verifying your payment — you'll be activated shortly.</p>`;
  }
}

function selectPlan(id) {
  selectedPlan = id;
  $$(".plan-card").forEach((el) => el.classList.toggle("selected", el.dataset.id === id));
  updateSubscribeButton();
}

function selectPayment(method) {
  selectedPayment = method;
  $$(".payment-method").forEach((el) => el.classList.toggle("selected", el.dataset.method === method));
  $("#payment-paypal-details").style.display = method === "paypal" ? "block" : "none";
  $("#payment-ltc-details").style.display = method === "crypto_ltc" ? "block" : "none";
  $("#payment-btc-details").style.display = method === "crypto_btc" ? "block" : "none";
  $("#payment-stripe-details").style.display = method === "stripe" ? "block" : "none";
  updateSubscribeButton();
}
// expose to onclick
window.selectPayment = selectPayment;

function updateSubscribeButton() {
  $("#btn-subscribe").disabled = !(selectedPlan && selectedPayment);
}

$("#btn-subscribe").addEventListener("click", async () => {
  // --- Stripe: redirect to Stripe Checkout ---
  if (selectedPayment === "stripe") {
    if (!selectedPlan) {
      alert("Please select a plan first.");
      return;
    }
    $("#btn-subscribe").disabled = true;
    $("#btn-subscribe").textContent = "Redirecting to checkout...";
    try {
      const resp = await fetch("/api/membership/stripe-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: selectedPlan }),
      });
      const data = await resp.json();
      if (resp.ok && data.url) {
        window.location.href = data.url;
        return;
      } else {
        alert(data.error || "Failed to start checkout. Please try again.");
      }
    } catch (err) {
      alert("Connection error. Please try again.");
    }
    $("#btn-subscribe").disabled = false;
    $("#btn-subscribe").textContent = "Subscribe";
    return;
  }

  // --- Manual payment methods (PayPal, Crypto) ---
  let ref = "";
  if (selectedPayment === "paypal") ref = $("#paypal-ref").value;
  else if (selectedPayment === "crypto_ltc") ref = $("#ltc-ref").value;
  else if (selectedPayment === "crypto_btc") ref = $("#btc-ref").value;

  if (!ref || !ref.trim()) {
    alert("Please enter your payment transaction ID or reference so we can verify your payment.");
    return;
  }

  const resp = await fetch("/api/membership/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan_id: selectedPlan,
      payment_method: selectedPayment,
      payment_ref: ref,
    }),
  });

  const data = await resp.json();
  if (resp.ok) {
    alert(data.message);
    showScreen("app");
    showUpgradeElements();
    loadConversations();
  } else {
    alert(data.error || "Subscription failed.");
  }
});

$("#membership-back").addEventListener("click", (e) => { e.preventDefault(); showScreen("app"); loadConversations(); });

// ===== Admin =====
async function loadAdmin() {
  showScreen("admin");

  // Stats
  const statsResp = await fetch("/api/admin/stats");
  const stats = await statsResp.json();
  $("#admin-stats").innerHTML = `
    <div class="stat-card"><div class="stat-value">${stats.totalUsers}</div><div class="stat-label">Total Users</div></div>
    <div class="stat-card"><div class="stat-value">${stats.activeMembers}</div><div class="stat-label">Active Members</div></div>
    <div class="stat-card"><div class="stat-value" style="color:${stats.pendingMembers > 0 ? '#58a6ff' : 'inherit'}">${stats.pendingMembers}</div><div class="stat-label">Pending Approval</div></div>
    <div class="stat-card"><div class="stat-value">${stats.suspendedMembers}</div><div class="stat-label">Suspended</div></div>
    <div class="stat-card"><div class="stat-value">$${stats.totalRevenue.toFixed(2)}</div><div class="stat-label">Total Revenue</div></div>
    <div class="stat-card"><div class="stat-value" style="color:${stats.openTickets > 0 ? '#f0b429' : 'inherit'}">${stats.openTickets}</div><div class="stat-label">Open Tickets</div></div>
  `;

  // Memberships
  const membResp = await fetch("/api/admin/memberships");
  const memberships = await membResp.json();
  const mtbody = $("#memberships-tbody");
  mtbody.innerHTML = memberships.length === 0
    ? `<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">No memberships yet</td></tr>`
    : memberships.map((m) => {
      let actions = "";
      if (m.status === "pending") {
        actions = `<button class="btn-sm btn-approve" onclick="approveMembership(${m.id})">Approve</button> <button class="btn-sm btn-reject" onclick="rejectMembership(${m.id})">Reject</button>`;
      } else if (m.status === "active") {
        actions = `<button class="btn-sm btn-reject" onclick="suspendMembership(${m.id})">Suspend</button> <button class="btn-sm btn-reject" onclick="cancelMembership(${m.id})">Cancel</button>`;
      } else if (m.status === "suspended") {
        actions = `<button class="btn-sm btn-approve" onclick="reactivateMembership(${m.id})">Reactivate</button> <button class="btn-sm btn-reject" onclick="cancelMembership(${m.id})">Cancel</button>`;
      } else {
        actions = `<span style="color:var(--text-muted)">${m.status}</span>`;
      }
      const statusColor = m.status === "active" ? "var(--success)" : m.status === "pending" ? "#58a6ff" : m.status === "suspended" ? "#f0b429" : "var(--text-muted)";
      return `
      <tr>
        <td>${escapeHtml(m.username)}</td>
        <td>${m.plan}</td>
        <td>$${(m.amount_cents / 100).toFixed(2)}</td>
        <td>${m.payment_method}</td>
        <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(m.payment_ref || '')}">${escapeHtml(m.payment_ref || "—")}</td>
        <td><span style="color:${statusColor}">${m.status}</span></td>
        <td>${m.expires_at ? new Date(m.expires_at).toLocaleDateString() : "—"}</td>
        <td>${actions}</td>
      </tr>
    `}).join("");

  // Users
  const usersResp = await fetch("/api/admin/users");
  const users = await usersResp.json();
  const utbody = $("#users-tbody");
  utbody.innerHTML = users.map((u) => `
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td>${u.role}</td>
      <td>${u.active_plan || "—"}</td>
      <td>${u.membership_expires ? new Date(u.membership_expires).toLocaleDateString() : "—"}</td>
      <td>${u.is_active ? '<span style="color:var(--success)">Active</span>' : '<span style="color:var(--danger)">Disabled</span>'}</td>
      <td>${u.role !== "admin" ? `<button class="btn-sm btn-toggle" onclick="toggleUser(${u.id})">${u.is_active ? "Disable" : "Enable"}</button>` : ""}</td>
    </tr>
  `).join("");

  // Clear password fields
  $("#admin-current-pass").value = "";
  $("#admin-new-pass").value = "";
  $("#admin-confirm-pass").value = "";
  const passMsg = $("#password-change-msg");
  passMsg.className = "password-msg";
  passMsg.style.display = "none";

  // Support tickets
  loadAdminTickets();

  // User memories
  loadAdminMemories();
}

async function approveMembership(id) {
  if (!confirm("Approve this membership? This confirms you've verified the payment.")) return;
  await fetch(`/api/admin/approve/${id}`, { method: "POST" });
  loadAdmin();
}
window.approveMembership = approveMembership;

async function rejectMembership(id) {
  if (!confirm("Reject this membership? The user will need to resubmit.")) return;
  await fetch(`/api/admin/reject/${id}`, { method: "POST" });
  loadAdmin();
}
window.rejectMembership = rejectMembership;

async function suspendMembership(id) {
  await fetch(`/api/admin/suspend/${id}`, { method: "POST" });
  loadAdmin();
}
window.suspendMembership = suspendMembership;

async function cancelMembership(id) {
  if (!confirm("Cancel this membership?")) return;
  await fetch(`/api/admin/cancel/${id}`, { method: "POST" });
  loadAdmin();
}
window.cancelMembership = cancelMembership;

async function reactivateMembership(id) {
  await fetch(`/api/admin/reactivate/${id}`, { method: "POST" });
  loadAdmin();
}
window.reactivateMembership = reactivateMembership;

async function toggleUser(id) {
  await fetch(`/api/admin/toggle-user/${id}`, { method: "POST" });
  loadAdmin();
}
window.toggleUser = toggleUser;

// ===== Admin Password Change =====
$("#btn-change-password").addEventListener("click", async () => {
  const currentPass = $("#admin-current-pass").value;
  const newPass = $("#admin-new-pass").value;
  const confirmPass = $("#admin-confirm-pass").value;
  const passMsg = $("#password-change-msg");

  if (!currentPass || !newPass || !confirmPass) {
    passMsg.className = "password-msg error";
    passMsg.textContent = "All fields are required.";
    return;
  }
  if (newPass !== confirmPass) {
    passMsg.className = "password-msg error";
    passMsg.textContent = "New passwords do not match.";
    return;
  }
  if (newPass.length < 6) {
    passMsg.className = "password-msg error";
    passMsg.textContent = "New password must be at least 6 characters.";
    return;
  }

  try {
    const resp = await fetch("/api/admin/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: currentPass, new_password: newPass }),
    });
    const data = await resp.json();
    if (resp.ok) {
      passMsg.className = "password-msg success";
      passMsg.textContent = data.message || "Password changed successfully.";
      $("#admin-current-pass").value = "";
      $("#admin-new-pass").value = "";
      $("#admin-confirm-pass").value = "";
    } else {
      passMsg.className = "password-msg error";
      passMsg.textContent = data.error || "Failed to change password.";
    }
  } catch {
    passMsg.className = "password-msg error";
    passMsg.textContent = "Connection error. Please try again.";
  }
});

// ===== Developer Mode (Self-Modifying Code Agent) =====

let devmodeWorking = false;

$("#btn-devmode-execute").addEventListener("click", async () => {
  const prompt = $("#devmode-prompt").value.trim();
  if (!prompt || devmodeWorking) return;

  devmodeWorking = true;

  // Show status with live steps, hide previous results
  $("#devmode-status").style.display = "flex";
  $("#devmode-status-text").textContent = "Agent is working...";
  $("#devmode-response").style.display = "none";
  $("#devmode-toolcalls").style.display = "none";
  $("#devmode-files").style.display = "none";
  $("#devmode-git").style.display = "none";
  $("#devmode-deploy").style.display = "none";
  $("#devmode-git-output").style.display = "none";
  $("#btn-devmode-execute").disabled = true;

  // Create or reset live steps panel
  let liveSteps = document.getElementById("devmode-live-steps");
  if (!liveSteps) {
    liveSteps = document.createElement("div");
    liveSteps.id = "devmode-live-steps";
    liveSteps.className = "devmode-live-steps";
    $("#devmode-status").parentElement.insertBefore(liveSteps, $("#devmode-status").nextSibling);
  }
  liveSteps.innerHTML = "";
  liveSteps.style.display = "block";

  function addDevmodeStep(text, cssClass) {
    const el = document.createElement("div");
    el.className = "devmode-live-step " + (cssClass || "");
    el.textContent = text;
    liveSteps.appendChild(el);
    liveSteps.scrollTop = liveSteps.scrollHeight;
  }

  try {
    const resp = await fetch("/api/admin/code/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      let errMsg = "Unknown error";
      try { errMsg = JSON.parse(errText).error || errMsg; } catch {}
      $("#devmode-status").style.display = "none";
      liveSteps.style.display = "none";
      $("#devmode-response").style.display = "block";
      $("#devmode-response-text").textContent = "Error: " + errMsg;
      return;
    }

    // Read SSE stream
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop();

      for (const part of parts) {
        const events = parseSSEChunk(part + "\n");
        for (const evt of events) {
          if (evt.type === "step") {
              let cssClass = "thinking";
              if (evt.name) cssClass = "tool-call";
              if (evt.success === true) cssClass = "tool-result success";
              if (evt.success === false) cssClass = "tool-result failure";
              addDevmodeStep(evt.label || "Working...", cssClass);
              $("#devmode-status-text").textContent = evt.label || "Working...";
          } else if (evt.type === "result") {
            finalResult = evt;
          } else if (evt.type === "error") {
            addDevmodeStep("Error: " + evt.error, "tool-result failure");
          }
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const events = parseSSEChunk(buffer);
      for (const evt of events) {
        if (evt.type === "result") finalResult = evt;
      }
    }

    // Hide status spinner
    $("#devmode-status").style.display = "none";

    if (finalResult) {
      // Show agent response
      if (finalResult.response) {
        $("#devmode-response").style.display = "block";
        $("#devmode-response-text").innerHTML = formatMarkdown(finalResult.response);
      }

      // Show tool calls log
      if (finalResult.toolCalls && finalResult.toolCalls.length > 0) {
        $("#devmode-toolcalls").style.display = "block";
        $("#devmode-toolcalls-count").textContent = finalResult.toolCalls.length;
        const list = $("#devmode-toolcalls-list");
        list.innerHTML = finalResult.toolCalls.map(tc => {
          const resultStr = typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result);
          const shortResult = resultStr.length > 500 ? resultStr.slice(0, 500) + "..." : resultStr;
          return `<div class="devmode-toolcall-item">
            <span class="devmode-toolcall-name">${tc.name}</span>(${Object.keys(tc.args).map(k => k + '=' + JSON.stringify(tc.args[k]).slice(0, 60)).join(', ')})
            <div style="color:var(--text-muted);margin-top:2px;max-height:80px;overflow:hidden;">${escapeHtml(shortResult)}</div>
          </div>`;
        }).join("");
      }

      // Show modified files
      if (finalResult.filesModified && finalResult.filesModified.length > 0) {
        $("#devmode-files").style.display = "block";
        const filesList = $("#devmode-files-list");
        filesList.innerHTML = finalResult.filesModified.map(f => `<li>${escapeHtml(f)}</li>`).join("");

        $("#devmode-git").style.display = "block";
        $("#devmode-deploy").style.display = "block";

        const suggested = "Agent: " + prompt.slice(0, 60) + (prompt.length > 60 ? "..." : "");
        $("#devmode-commit-msg").value = suggested;
      }
    }

  } catch (err) {
    $("#devmode-status").style.display = "none";
    $("#devmode-response").style.display = "block";
    $("#devmode-response-text").textContent = "Connection error: " + err.message;
  } finally {
    devmodeWorking = false;
    $("#btn-devmode-execute").disabled = false;
  }
});

// Enter key in devmode prompt
$("#devmode-prompt").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#btn-devmode-execute").click();
  }
});

// Git Status button
$("#btn-devmode-status").addEventListener("click", async () => {
  const output = $("#devmode-git-output");
  output.style.display = "block";
  output.textContent = "Loading git status...";
  try {
    const resp = await fetch("/api/admin/code/status");
    const data = await resp.json();
    output.textContent = data.files && data.files.length > 0
      ? data.files.join("\n")
      : "(no changes)";
  } catch (err) {
    output.textContent = "Error: " + err.message;
  }
});

// Git Diff button
$("#btn-devmode-diff").addEventListener("click", async () => {
  const output = $("#devmode-git-output");
  output.style.display = "block";
  output.textContent = "Loading diff...";
  try {
    const resp = await fetch("/api/admin/code/diff");
    const data = await resp.json();
    output.textContent = data.diff || "(no changes)";
  } catch (err) {
    output.textContent = "Error: " + err.message;
  }
});

// Revert button
$("#btn-devmode-revert").addEventListener("click", async () => {
  if (!confirm("Revert ALL uncommitted changes? This cannot be undone.")) return;
  const output = $("#devmode-git-output");
  output.style.display = "block";
  output.textContent = "Reverting...";
  try {
    const resp = await fetch("/api/admin/code/revert", { method: "POST" });
    const data = await resp.json();
    output.textContent = data.success ? "All changes reverted." : "Error: " + data.error;
    // Hide the files/deploy sections since changes are gone
    if (data.success) {
      $("#devmode-files").style.display = "none";
      $("#devmode-deploy").style.display = "none";
    }
  } catch (err) {
    output.textContent = "Error: " + err.message;
  }
});

// Commit, Push & Deploy button
$("#btn-devmode-commit").addEventListener("click", async () => {
  const message = $("#devmode-commit-msg").value.trim();
  if (!message) { alert("Please enter a commit message."); return; }
  if (!confirm("Commit all changes, push to GitHub, and deploy to Render?")) return;

  const deployMsg = $("#devmode-deploy-msg");
  deployMsg.style.display = "block";
  deployMsg.style.background = "var(--bg-tertiary)";
  deployMsg.style.color = "var(--text-secondary)";
  deployMsg.textContent = "Committing and pushing...";
  $("#btn-devmode-commit").disabled = true;

  try {
    const resp = await fetch("/api/admin/code/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await resp.json();

    if (!resp.ok) {
      deployMsg.style.background = "rgba(248,81,73,0.15)";
      deployMsg.style.color = "#f85149";
      deployMsg.textContent = "Error: " + (data.error || "Commit failed");
      return;
    }

    let statusText = "Committed and pushed to GitHub.";
    if (data.deploy?.success) {
      statusText += " Deploy triggered on Render.";
      deployMsg.style.background = "rgba(63,185,80,0.15)";
      deployMsg.style.color = "#3fb950";
    } else {
      statusText += " Deploy: " + (data.deploy?.error || "Not triggered.");
      deployMsg.style.background = "rgba(210,168,255,0.15)";
      deployMsg.style.color = "#d2a8ff";
    }
    deployMsg.textContent = statusText;

    // Hide git controls since changes are committed
    $("#devmode-git-output").style.display = "none";
  } catch (err) {
    deployMsg.style.background = "rgba(248,81,73,0.15)";
    deployMsg.style.color = "#f85149";
    deployMsg.textContent = "Error: " + err.message;
  } finally {
    $("#btn-devmode-commit").disabled = false;
  }
});

$("#link-admin").addEventListener("click", (e) => { e.preventDefault(); loadAdmin(); });
$("#admin-back").addEventListener("click", (e) => { e.preventDefault(); showScreen("app"); loadConversations(); });

// ===== Navigation =====
$("#link-membership").addEventListener("click", (e) => { e.preventDefault(); showScreen("membership"); loadMembership(); });
$("#link-logout").addEventListener("click", async (e) => {
  e.preventDefault();
  await fetch("/api/auth/logout", { method: "POST" });
  currentUser = null;
  renderLandingPrompts();
  showScreen("landing");
});

// ===== Utilities =====
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatMarkdown(text) {
  if (!text) return "";
  // Basic markdown: code blocks, inline code, bold, italic, links, line breaks
  return text
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/\n/g, '<br>');
}

// ===== Support =====
$("#link-support").addEventListener("click", (e) => {
  e.preventDefault();
  showScreen("support");
  loadSupportTickets();
  closeSidebar();
});

$("#support-back").addEventListener("click", (e) => {
  e.preventDefault();
  showScreen("app");
  loadConversations();
});

$("#btn-submit-ticket").addEventListener("click", async () => {
  const subject = $("#support-subject").value.trim();
  const message = $("#support-message").value.trim();
  const msgEl = $("#support-msg");

  if (!subject) {
    msgEl.style.display = "block";
    msgEl.style.background = "rgba(248,81,73,0.15)";
    msgEl.style.color = "#f85149";
    msgEl.textContent = "Please enter a subject.";
    return;
  }
  if (!message) {
    msgEl.style.display = "block";
    msgEl.style.background = "rgba(248,81,73,0.15)";
    msgEl.style.color = "#f85149";
    msgEl.textContent = "Please enter a message.";
    return;
  }

  try {
    const resp = await fetch("/api/support/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, message }),
    });
    const data = await resp.json();
    if (resp.ok) {
      msgEl.style.display = "block";
      msgEl.style.background = "rgba(63,185,80,0.15)";
      msgEl.style.color = "#3fb950";
      msgEl.textContent = data.message;
      $("#support-subject").value = "";
      $("#support-message").value = "";
      loadSupportTickets();
    } else {
      msgEl.style.display = "block";
      msgEl.style.background = "rgba(248,81,73,0.15)";
      msgEl.style.color = "#f85149";
      msgEl.textContent = data.error || "Failed to submit ticket.";
    }
  } catch {
    msgEl.style.display = "block";
    msgEl.style.background = "rgba(248,81,73,0.15)";
    msgEl.style.color = "#f85149";
    msgEl.textContent = "Connection error. Please try again.";
  }
});

async function loadSupportTickets() {
  try {
    const resp = await fetch("/api/support/tickets");
    if (!resp.ok) return;
    const tickets = await resp.json();
    const container = $("#support-tickets-list");

    if (tickets.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:14px;">No tickets yet.</p>';
      return;
    }

    container.innerHTML = tickets.map((t) => {
      const statusColor = t.status === "open" ? "#58a6ff" : t.status === "replied" ? "#3fb950" : "var(--text-muted)";
      return `
        <div class="support-ticket-card">
          <div class="ticket-header">
            <strong>${escapeHtml(t.subject)}</strong>
            <span class="ticket-status" style="color:${statusColor}">${t.status}</span>
          </div>
          <p class="ticket-message">${escapeHtml(t.message)}</p>
          ${t.admin_reply ? `<div class="ticket-reply"><strong>Admin reply:</strong> ${escapeHtml(t.admin_reply)}</div>` : ""}
          <div class="ticket-date">${new Date(t.created_at).toLocaleString()}</div>
        </div>
      `;
    }).join("");
  } catch {}
}

// ===== Admin Support Tickets =====
let replyTicketId = null;

async function loadAdminTickets() {
  try {
    const resp = await fetch("/api/support/admin/tickets");
    if (!resp.ok) return;
    const tickets = await resp.json();
    const tbody = $("#tickets-tbody");

    if (tickets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No support tickets</td></tr>';
      return;
    }

    tbody.innerHTML = tickets.map((t) => {
      const statusColor = t.status === "open" ? "#58a6ff" : t.status === "replied" ? "#3fb950" : "var(--text-muted)";
      let actions = "";
      if (t.status === "open" || t.status === "replied") {
        actions = `<button class="btn-sm btn-approve" onclick="openReplyModal(${t.id}, '${escapeHtml(t.subject).replace(/'/g, "\\'")}', '${escapeHtml(t.message).replace(/'/g, "\\'")}')">Reply</button> <button class="btn-sm btn-reject" onclick="closeTicket(${t.id})">Close</button>`;
      } else {
        actions = '<span style="color:var(--text-muted)">Closed</span>';
      }
      return `
        <tr>
          <td>${escapeHtml(t.username)}</td>
          <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(t.subject)}">${escapeHtml(t.subject)}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(t.message)}">${escapeHtml(t.message)}</td>
          <td><span style="color:${statusColor}">${t.status}</span></td>
          <td>${new Date(t.created_at).toLocaleDateString()}</td>
          <td>${actions}</td>
        </tr>
      `;
    }).join("");
  } catch {}
}

function openReplyModal(id, subject, message) {
  replyTicketId = id;
  $("#reply-modal-subject").textContent = subject;
  $("#reply-modal-message").textContent = message;
  $("#reply-modal-text").value = "";
  $("#reply-modal-overlay").style.display = "flex";
}
window.openReplyModal = openReplyModal;

$("#reply-modal-cancel").addEventListener("click", () => {
  $("#reply-modal-overlay").style.display = "none";
  replyTicketId = null;
});

$("#reply-modal-overlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) {
    $("#reply-modal-overlay").style.display = "none";
    replyTicketId = null;
  }
});

$("#reply-modal-send").addEventListener("click", async () => {
  const reply = $("#reply-modal-text").value.trim();
  if (!reply) { alert("Please enter a reply."); return; }

  await fetch(`/api/support/admin/reply/${replyTicketId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply }),
  });

  $("#reply-modal-overlay").style.display = "none";
  replyTicketId = null;
  loadAdminTickets();
});

async function closeTicket(id) {
  if (!confirm("Close this ticket?")) return;
  await fetch(`/api/support/admin/close/${id}`, { method: "POST" });
  loadAdminTickets();
}
window.closeTicket = closeTicket;

// ===== Admin User Memories =====
async function loadAdminMemories() {
  try {
    const resp = await fetch("/api/admin/memories");
    if (!resp.ok) return;
    const memories = await resp.json();
    const tbody = $("#memories-tbody");

    if (memories.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No user memories yet</td></tr>';
      return;
    }

    tbody.innerHTML = memories.map((m) => {
      const memoryPreview = escapeHtml(m.memory_text || "").replace(/\n/g, "<br>");
      const updatedAt = m.updated_at ? new Date(m.updated_at).toLocaleDateString() : "—";
      return `
        <tr>
          <td>${escapeHtml(m.username)}</td>
          <td style="max-width:400px;font-size:12px;line-height:1.4;white-space:pre-wrap;word-break:break-word;">${memoryPreview}</td>
          <td>${updatedAt}</td>
          <td><button class="btn-sm btn-reject" onclick="clearUserMemory(${m.user_id})">Clear</button></td>
        </tr>
      `;
    }).join("");
  } catch {}
}

async function clearUserMemory(userId) {
  if (!confirm("Clear this user's memory? The agent will no longer remember facts about them.")) return;
  await fetch(`/api/admin/memories/${userId}`, { method: "DELETE" });
  loadAdminMemories();
}
window.clearUserMemory = clearUserMemory;

// ===== Boot =====
init();
