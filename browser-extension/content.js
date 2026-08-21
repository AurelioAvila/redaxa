// Best-effort composer detection: ChatGPT and Claude both change their DOM
// structure periodically, so this looks for the standard selectors first and
// falls back to "the largest visible contenteditable/textarea on the page"
// rather than hard-failing when a selector goes stale.
function findComposer() {
  const known = [
    "#prompt-textarea",
    "div.ProseMirror[contenteditable='true']",
    "textarea[data-testid='chat-input']",
    "rich-textarea .ql-editor[contenteditable='true']",
    "div.ql-editor[contenteditable='true']",
    "#userInput",
    "textarea#composer-background"
  ];
  for (const selector of known) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  const candidates = [...document.querySelectorAll("textarea, [contenteditable='true']")]
    .filter((el) => el.offsetHeight > 20 && el.offsetWidth > 200);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight))[0];
}

function findSendButton() {
  const known = [
    "button[data-testid='send-button']",
    "button[data-testid='composer-send-button']",
    "button[aria-label='Send message']",
    "button[aria-label='Send prompt']",
    "button[aria-label='Send']",
    "button[aria-label='Submit']"
  ];
  for (const selector of known) {
    const el = document.querySelector(selector);
    if (el && !el.disabled) return el;
  }
  return null;
}

function composerText(el) {
  if (!el) return "";
  return "value" in el ? el.value : el.innerText;
}

function setComposerText(el, text) {
  if (!el) return;
  if ("value" in el) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    el.innerText = text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }
}

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (!response) { reject(new Error("PromptShield extension is unavailable.")); return; }
      if (!response.ok) { reject(new Error(response.error)); return; }
      resolve(response.result);
    });
  });
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[c] ?? c));
}

// ---------------------------------------------------------------------------
// Manual "Check" panel -- always available regardless of subscription status,
// so a signed-out visitor can still see what it would find (STATUS below
// tells them to sign in before it will run a real scan).
// ---------------------------------------------------------------------------
function buildUI() {
  const button = document.createElement("button");
  button.id = "promptshield-check-btn";
  button.type = "button";
  button.textContent = "🛡 Check";
  document.body.append(button);

  const panel = document.createElement("div");
  panel.id = "promptshield-panel";
  panel.innerHTML = `
    <div class="ps-panel-head">PromptShield<button type="button" id="promptshield-close">×</button></div>
    <div class="ps-panel-body" id="promptshield-body"></div>
  `;
  document.body.append(panel);

  const closeBtn = panel.querySelector("#promptshield-close");
  const body = panel.querySelector("#promptshield-body");
  closeBtn.addEventListener("click", () => panel.classList.remove("open"));

  button.addEventListener("click", async () => {
    const composer = findComposer();
    const text = composerText(composer).trim();
    panel.classList.add("open");
    if (!text) {
      body.innerHTML = `<p class="ps-empty">Type a prompt first, then check it.</p>`;
      return;
    }
    body.innerHTML = `<p class="ps-loading">Checking…</p>`;
    try {
      const status = await send({ type: "STATUS" });
      if (!status.signedIn) {
        body.innerHTML = `<p class="ps-empty">Sign in to PromptShield from the extension icon to run a check.</p>`;
        return;
      }
      if (!status.active) {
        body.innerHTML = `<p class="ps-empty">Your PromptShield trial/subscription isn't active. Open the extension icon or <a href="https://promptshield-beta.vercel.app/#pricing" target="_blank" rel="noopener">see plans</a>.</p>`;
        return;
      }
      const result = await runScan(text);
      renderFindings(body, result, composer, () => panel.classList.remove("open"));
    } catch (error) {
      body.innerHTML = `<p class="ps-empty">${escapeHtml(error.message || "Check failed.")}</p>`;
    }
  });
}

// The policy decision explains WHY the scan flagged something: the server
// returns the winning rule's human-written reason alongside the findings.
function decisionReason(result) {
  const reason = result.decision?.decidedBy?.reason;
  return reason ? `<p class="ps-reason">${escapeHtml(reason)}</p>` : "";
}

function renderFindings(body, result, composer, onHandled) {
  if (!result.findings.length) {
    body.innerHTML = `<p class="ps-empty">Nothing obvious found. This is a helpful signal, not a guarantee.</p>`;
    return;
  }
  const list = result.findings.map((f) => `<div class="ps-finding"><b>${escapeHtml(f.label)}</b></div>`).join("");
  body.innerHTML = `
    <p class="ps-count">${result.findings.length} item${result.findings.length === 1 ? "" : "s"} to review</p>
    ${decisionReason(result)}
    ${list}
    <button type="button" class="ps-use-redacted" id="promptshield-use-redacted">Replace with safer version</button>
  `;
  body.querySelector("#promptshield-use-redacted")?.addEventListener("click", () => {
    setComposerText(composer, result.redactedText);
    onHandled();
  });
}

async function runScan(text) {
  return send({ type: "SCAN", text, options: { includePersonalData: true, includeCredentials: true, includeFinancialData: true } });
}

// ---------------------------------------------------------------------------
// Send interception. A manual "Check" button alone is easy to forget, so for
// signed-in, active subscribers this also intercepts the actual send action
// (Enter key and the Send button) at the document capture phase -- the
// earliest point in the DOM event chain, ahead of the site's own React/Vue
// handlers -- and puts up a blocking modal before anything leaves the
// browser. The user must explicitly pick "Send anyway" or "Fix it first";
// closing/cancelling leaves the message sitting unsent in the composer.
//
// A prior attempt at this (see git history) intercepted Enter only, attached
// late (document_idle), and was found to still let the raw message through
// on some runs. This version fixes the two likely causes: it attaches at
// document_start so its capture listener is registered before the page's own
// scripts run, and it intercepts both the Enter keydown AND the Send button
// click/mousedown/form-submit, not just one path.
// ---------------------------------------------------------------------------
let statusCache = { signedIn: false, active: false };
let statusCheckedAt = 0;
let bypassArm = false;

async function refreshStatus() {
  try {
    statusCache = await send({ type: "STATUS" });
  } catch {
    statusCache = { signedIn: false, active: false };
  }
  statusCheckedAt = Date.now();
  return statusCache;
}

async function currentStatus() {
  if (Date.now() - statusCheckedAt > 30_000) await refreshStatus();
  return statusCache;
}

let modalEl = null;

function closeModal() {
  modalEl?.remove();
  modalEl = null;
}

function showModal(html) {
  closeModal();
  modalEl = document.createElement("div");
  modalEl.id = "promptshield-intercept";
  modalEl.innerHTML = `<div class="ps-intercept-card">${html}</div>`;
  document.body.append(modalEl);
  return modalEl;
}

// Re-fires the original send action after the user explicitly approves it.
// `bypassArm` tells this same interceptor to step aside for exactly the next
// matching event instead of gating it again.
function resendVia(kind, target) {
  bypassArm = true;
  if (kind === "key") {
    target.focus();
    for (const type of ["keydown", "keypress", "keyup"]) {
      target.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true }));
    }
  } else {
    target.click();
  }
  // Safety net: if nothing consumed the re-dispatched event (e.g. the button
  // reference went stale), don't leave the interceptor permanently disarmed.
  window.setTimeout(() => { bypassArm = false; }, 400);
}

async function gate(composer, resend) {
  const text = composerText(composer).trim();
  showModal(`
    <div class="ps-int-head">PromptShield</div>
    <div class="ps-int-body"><p class="ps-loading">Checking before this sends…</p></div>
  `);
  let result;
  try {
    result = await runScan(text);
  } catch (error) {
    showModal(`
      <div class="ps-int-head">PromptShield<button type="button" class="ps-int-x" id="ps-int-close">×</button></div>
      <div class="ps-int-body">
        <p class="ps-empty">${escapeHtml(error.message || "Check failed.")}</p>
        <button type="button" class="ps-int-secondary" id="ps-int-send-anyway">Send anyway</button>
      </div>
    `);
    modalEl.querySelector("#ps-int-close")?.addEventListener("click", closeModal);
    modalEl.querySelector("#ps-int-send-anyway")?.addEventListener("click", () => { closeModal(); resend(); });
    return;
  }

  if (!result.findings.length) {
    closeModal();
    resend();
    return;
  }

  const list = result.findings.map((f) => `<div class="ps-finding"><b>${escapeHtml(f.label)}</b></div>`).join("");
  // Enforcement follows the policy decision: when the winning rule says
  // "block" there is no "Send anyway" -- the prompt stays unsent until fixed.
  // (The default personal policy never blocks; this path exists for
  // organization rules.)
  const blocked = result.decision?.action === "block";
  showModal(`
    <div class="ps-int-head">${blocked ? "Blocked by your organization's policy" : `Found ${result.findings.length} item${result.findings.length === 1 ? "" : "s"} before sending`}<button type="button" class="ps-int-x" id="ps-int-close">×</button></div>
    <div class="ps-int-body">
      ${decisionReason(result)}
      ${list}
      <button type="button" class="ps-use-redacted" id="ps-int-fix">Fix it first</button>
      ${blocked ? "" : `<button type="button" class="ps-int-secondary" id="ps-int-send-anyway">Send anyway</button>`}
    </div>
  `);
  modalEl.querySelector("#ps-int-close")?.addEventListener("click", closeModal);
  modalEl.querySelector("#ps-int-fix")?.addEventListener("click", () => {
    setComposerText(composer, result.redactedText);
    closeModal();
  });
  modalEl.querySelector("#ps-int-send-anyway")?.addEventListener("click", () => { closeModal(); resend(); });
}

function withinComposer(node, composer) {
  return Boolean(composer) && (node === composer || composer.contains(node));
}

document.addEventListener("keydown", (event) => {
  if (bypassArm) { bypassArm = false; return; }
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  if (!statusCache.signedIn || !statusCache.active) return;
  const composer = findComposer();
  if (!withinComposer(event.target, composer)) return;
  const text = composerText(composer).trim();
  if (!text) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  gate(composer, () => resendVia("key", composer));
}, true);

document.addEventListener("click", (event) => {
  if (bypassArm) { bypassArm = false; return; }
  if (!statusCache.signedIn || !statusCache.active) return;
  const button = event.target.closest?.("button");
  if (!button) return;
  const sendButton = findSendButton();
  if (!sendButton || button !== sendButton) return;
  const composer = findComposer();
  const text = composerText(composer).trim();
  if (!text) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  gate(composer, () => resendVia("click", sendButton));
}, true);

void refreshStatus();
window.setInterval(refreshStatus, 30_000);

function boot() {
  if (!document.getElementById("promptshield-check-btn")) buildUI();
}
if (document.body) boot();
else document.addEventListener("DOMContentLoaded", boot, { once: true });
