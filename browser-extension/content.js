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
    "#ask-input",
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
    return;
  }
  // Rich editors (Lexical on Perplexity, ProseMirror on ChatGPT/Claude,
  // Quill on Gemini) revert DOM writes they didn't make; the replacement has
  // to flow through execCommand so it enters the editor's own beforeinput
  // pipeline. Two constraints make the exact shape of this code load-bearing:
  //  1. It must run SYNCHRONOUSLY inside the user's button click — the
  //     user-gesture token that makes insertText acceptable to these editors
  //     does not survive a setTimeout.
  //  2. When insertText reports success, believe it. Editors apply the change
  //     asynchronously, so the DOM still shows the old text right here — a
  //     "verify and fall back to innerText" step would stomp the editor's DOM
  //     and get the whole edit reverted (observed live on Perplexity).
  el.focus();
  const selection = window.getSelection();
  const caret = document.createRange();
  caret.selectNodeContents(el);
  caret.collapse(false);
  selection.removeAllRanges();
  selection.addRange(caret);
  document.execCommand("selectAll");
  const inserted = document.execCommand("insertText", false, text);
  if (!inserted) {
    el.innerText = text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }
  // Some editors (Lexical on Perplexity) discard scripted edits entirely, no
  // matter which pipeline they arrive through. Verify after the editor has
  // had time to apply the change; if it refused, fall back to the one path
  // that can never be blocked: safe text on the clipboard, everything left
  // selected, and a toast telling the user the single keystroke that
  // finishes the job.
  setTimeout(() => {
    if (composerText(el).trim() === text.trim()) return;
    navigator.clipboard.writeText(text).then(() => {
      el.focus();
      document.execCommand("selectAll");
      psToast("Safe version copied — press Ctrl+V to replace your prompt.");
    }).catch(() => {
      psToast("This editor blocks automatic replacing. Copy the safe version from the Redaxa panel.");
    });
  }, 400);
}

function psToast(message) {
  document.getElementById("redaxa-toast")?.remove();
  const toast = document.createElement("div");
  toast.id = "redaxa-toast";
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 7000);
}

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (!response) { reject(new Error("Redaxa extension is unavailable.")); return; }
      if (!response.ok) { reject(Object.assign(new Error(response.error), { httpStatus: response.httpStatus })); return; }
      resolve(response.result);
    });
  });
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[c] ?? c));
}

// ---------------------------------------------------------------------------
// Checks run on this device for free use (see background.js); an active plan
// uses the account service for workspace terms and team policies.
// ---------------------------------------------------------------------------
function buildUI() {
  const button = document.createElement("button");
  button.id = "redaxa-check-btn";
  button.type = "button";
  button.textContent = "🛡 Check";
  document.body.append(button);

  const panel = document.createElement("div");
  panel.id = "redaxa-panel";
  panel.innerHTML = `
    <div class="ps-panel-head">Redaxa<button type="button" id="redaxa-close">×</button></div>
    <div class="ps-panel-body" id="redaxa-body"></div>
  `;
  document.body.append(panel);

  const closeBtn = panel.querySelector("#redaxa-close");
  const body = panel.querySelector("#redaxa-body");
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
      const status = await send({ type: "STATUS" }).catch(() => ({ signedIn: false }));
      const result = await runScan(text, status.signedIn === true && status.active === true);
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

function findingPriority(findings) {
  const severity = { critical: 4, high: 3, medium: 2, low: 1 };
  const credential = f => f.category === 'credentials' || ['secret', 'privateKey', 'credential'].includes(f.kind);
  return [...findings].sort((a, b) => Number(b.kind === 'secret') - Number(a.kind === 'secret') || Number(credential(b)) - Number(credential(a)) || (severity[b.severity] || 0) - (severity[a.severity] || 0));
}
function apiWarning(findings) {
  const matches = findings.filter(f => f.kind === 'secret');
  if (!matches.length) return '';
  // No raw values, excerpts or file paths in notifications or their markup.
  const count = new Set(matches.map((f, i) => f.value || `match-${i}`)).size;
  return `<div class="ps-api-warning" role="alert"><strong>API key or token found · ${count} potential ${count === 1 ? 'match' : 'matches'}</strong><p>Review these first. Validity has not been tested. Replace with the safer version before sharing.</p></div>`;
}

function whereChecked(result) {
  return result.engine === "local" ? `<p class="ps-where">Checked on this device. Nothing was sent.</p>` : "";
}

function renderFindings(body, result, composer, onHandled) {
  if (!result.findings.length) {
    body.innerHTML = `<p class="ps-empty">Nothing obvious found. This is a helpful signal, not a guarantee.</p>${whereChecked(result)}`;
    return;
  }
  const list = findingPriority(result.findings).map((f) => `<div class="ps-finding"><b>${escapeHtml(f.credential ? f.credential.service+' · '+f.credential.type : f.label)}</b>${f.credential?`<details><summary>${escapeHtml(f.credential.response)}</summary><p>${escapeHtml(f.credential.evidence+' '+f.credential.guidance)}</p></details>`:''}</div>`).join("");
  body.innerHTML = `
    ${apiWarning(result.findings)}
    <p class="ps-count">${result.findings.length} item${result.findings.length === 1 ? "" : "s"} to review</p>
    ${decisionReason(result)}
    ${list}
    <button type="button" class="ps-use-redacted" id="redaxa-use-redacted">Replace with safer version</button>
    ${whereChecked(result)}
  `;
  body.querySelector("#redaxa-use-redacted")?.addEventListener("click", () => {
    if (!sameCheckedPrompt(composer, result.checkedText)) return;
    setComposerText(composer, result.redactedText);
    onHandled();
  });
}

async function runScan(text, requireAccount = false) {
  const result = await send({ type: "SCAN", text, requireAccount, options: { includePersonalData: true, includeCredentials: true, includeFinancialData: true } });
  return { ...result, checkedText: text };
}

function sameCheckedPrompt(composer, checkedText) {
  if (composer?.isConnected !== false && composerText(composer).trim() === checkedText) return true;
  closeModal();
  psToast("Your prompt changed. Check it again before sending or replacing it.");
  return false;
}

// ---------------------------------------------------------------------------
// Send interception. A manual "Check" button alone is easy to forget, so for
// everyone (unless switched off in the popup) this also intercepts the actual send action
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
let statusCache = { unavailable: true };
// "Check automatically before sending", on unless switched off in the popup.
let autoCheck = true;
const AUTO_CHECK_KEY = "redaxa_auto_check";
chrome.storage?.local?.get(AUTO_CHECK_KEY).then(stored => { autoCheck = stored?.[AUTO_CHECK_KEY] !== false; }).catch(() => undefined);
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area === "local" && AUTO_CHECK_KEY in changes) autoCheck = changes[AUTO_CHECK_KEY].newValue !== false;
});
let statusCheckedAt = 0;
let bypassArm = false;
let statusRefresh = null;
let gatePending = false;

function refreshStatus() {
  if (statusRefresh) return statusRefresh;
  statusRefresh = send({ type: "STATUS" }).then(status => {
    if (typeof status?.signedIn !== "boolean" || (status.signedIn && typeof status.active !== "boolean")) {
      throw new Error("Incomplete account status.");
    }
    return status;
  }).catch(() => ({ ...statusCache, active: false, unavailable: true })).then(status => {
    statusCache = status;
    statusCheckedAt = Date.now();
    return status;
  }).finally(() => { statusRefresh = null; });
  return statusRefresh;
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
  modalEl.id = "redaxa-intercept";
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
  if (gatePending) return;
  gatePending = true;
  const text = composerText(composer).trim();
  const sendChecked = () => { if (sameCheckedPrompt(composer, text)) { closeModal(); resend(); } };
  showModal(`
    <div class="ps-int-head">Redaxa</div>
    <div class="ps-int-body"><p class="ps-loading">Checking before this sends…</p></div>
  `);
  let result;
  try {
    const status = await currentStatus();
    // A signed-in account whose plan cannot be confirmed may carry team
    // policies that block sending, so it waits rather than guessing.
    if (status.unavailable) throw new Error("Redaxa could not verify your account. Retry when the service is available.");
    result = await runScan(text, status.signedIn === true && status.active === true);
  } catch (error) {
    showModal(`
      <div class="ps-int-head">Redaxa<button type="button" class="ps-int-x" id="ps-int-close">×</button></div>
      <div class="ps-int-body">
        <p class="ps-empty">${escapeHtml(error.message || "Check failed.")}</p>
        <p class="ps-empty">Your prompt has not been sent. Close this notice and retry the check.</p>
      </div>
    `);
    modalEl.querySelector("#ps-int-close")?.addEventListener("click", closeModal);
    return;
  } finally {
    gatePending = false;
  }

  if (!result.findings.length && result.decision?.action !== "block") {
    sendChecked();
    return;
  }

  const list = findingPriority(result.findings).map((f) => `<div class="ps-finding"><b>${escapeHtml(f.label)}</b></div>`).join("");
  // Enforcement follows the policy decision: when the winning rule says
  // "block" there is no "Send anyway" -- the prompt stays unsent until fixed.
  // (The default personal policy never blocks; this path exists for
  // organization rules.)
  const blocked = result.decision?.action === "block";
  showModal(`
    <div class="ps-int-head">${blocked ? "Blocked by your organization's policy" : `Found ${result.findings.length} item${result.findings.length === 1 ? "" : "s"} before sending`}<button type="button" class="ps-int-x" id="ps-int-close">×</button></div>
    <div class="ps-int-body">
      ${apiWarning(result.findings)}
      ${decisionReason(result)}
      ${list}
      <button type="button" class="ps-use-redacted" id="ps-int-fix">Fix it first</button>
      ${blocked ? "" : `<button type="button" class="ps-int-secondary" id="ps-int-send-anyway">Send anyway</button>`}
    </div>
  `);
  modalEl.querySelector("#ps-int-close")?.addEventListener("click", closeModal);
  modalEl.querySelector("#ps-int-fix")?.addEventListener("click", () => {
    if (!sameCheckedPrompt(composer, text)) return;
    setComposerText(composer, result.redactedText);
    closeModal();
  });
  modalEl.querySelector("#ps-int-send-anyway")?.addEventListener("click", sendChecked);
}

// After the extension updates, scripts already running in open tabs lose
// their link to it for good. They can no longer check anything, so they step
// aside rather than hold every send until the tab is reloaded.
function orphaned() {
  return !globalThis.chrome?.runtime?.id;
}

function withinComposer(node, composer) {
  return Boolean(composer) && (node === composer || composer.contains(node));
}

document.addEventListener("keydown", (event) => {
  if (bypassArm) { bypassArm = false; return; }
  if (orphaned()) return;
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  if (!autoCheck) return;
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
  if (orphaned()) return;
  if (!autoCheck) return;
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

// Refreshed when the tab comes back into view and before a send that finds
// the status older than 30 seconds, rather than polled from every open tab.
void refreshStatus();
document.addEventListener("visibilitychange", () => { if (!document.hidden) void refreshStatus(); });

function boot() {
  if (!document.getElementById("redaxa-check-btn")) buildUI();
}
if (document.body) boot();
else document.addEventListener("DOMContentLoaded", boot, { once: true });
