// Best-effort composer detection: ChatGPT and Claude both change their DOM
// structure periodically, so this looks for the standard selectors first and
// falls back to "the largest visible contenteditable/textarea on the page"
// rather than hard-failing when a selector goes stale.
function findComposer() {
  const known = [
    "#prompt-textarea",
    "textarea#mobile-composer-prompt",
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

// Send buttons are recognized by structure first. The visible labels are
// translated ("Invia messaggio"), so label-only selectors let a click on Send
// skip the check in every non-English interface. Each selector is tried on its
// own so one the browser cannot parse never disables the others.
const sendButtonSelectors = [
  "button[data-testid='send-button']",
  "button[data-testid='composer-send-button']",
  "button[data-composer-submit]", // ChatGPT
  "button[data-testid='chat-input-send']", // Claude
  ".send-button button", "button.send-button", // Gemini
  "button:has(use[*|href='#pplx-icon-arrow-right'])", // Perplexity
  "button[aria-label='Send message']",
  "button[aria-label='Send prompt']",
  "button[aria-label='Send']",
  "button[aria-label='Submit']"
];

function isSendButton(button) {
  // ChatGPT's submit button turns into "Stop generating" while it answers.
  const stopping = Boolean(button.dataset?.stopLabel) && button.getAttribute?.("aria-label") === button.dataset.stopLabel;
  return !button.disabled && !stopping && sendButtonSelectors.some((selector) => {
    try { return button.matches(selector); } catch { return false; }
  });
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
      psToast(t("pasteToast"));
    }).catch(() => {
      psToast(t("editorBlocked"));
    });
  }, 400);
}

function psToast(message) {
  document.getElementById("redaxa-toast")?.remove();
  const toast = document.createElement("div");
  toast.id = "redaxa-toast";
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 7000);
}

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (!response) { reject(new Error(t("extensionUnavailable"))); return; }
      if (!response.ok) { reject(Object.assign(new Error(response.error), { httpStatus: response.httpStatus })); return; }
      resolve(response.result);
    });
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[c] ?? c));
}

// ---------------------------------------------------------------------------
// Checks run on this device for free use (see background.js); an active plan
// uses the account service for workspace terms and team policies.
// ---------------------------------------------------------------------------
function buildUI() {
  const button = document.createElement("button");
  button.id = "redaxa-check-btn";
  button.type = "button";
  button.textContent = t("pageCheck");
  document.body.append(button);

  const panel = document.createElement("div");
  panel.id = "redaxa-panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Redaxa");
  panel.innerHTML = `
    <div class="ps-panel-head">Redaxa<button type="button" id="redaxa-close" aria-label="${escapeHtml(t("close"))}">×</button></div>
    <div class="ps-panel-body" id="redaxa-body" aria-live="polite"></div>
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
      body.innerHTML = `<p class="ps-empty">${escapeHtml(t("typeFirst"))}</p>`;
      return;
    }
    body.innerHTML = `<p class="ps-loading">${escapeHtml(t("checking"))}</p>`;
    try {
      const status = await send({ type: "STATUS" }).catch(() => ({ signedIn: false }));
      const result = await runScan(text, status.signedIn === true && status.active === true);
      renderFindings(body, result, composer, () => panel.classList.remove("open"));
    } catch (error) {
      body.innerHTML = `<p class="ps-empty">${escapeHtml(errorText(error))}</p>`;
    }
  });
}

// The policy decision explains WHY the scan flagged something: the winning
// rule's reason, translated for the built-in rules.
function decisionReason(result) {
  const reason = policyReason(result.decision);
  return reason ? `<p class="ps-reason">${escapeHtml(reason)}</p>` : "";
}

function apiWarning(findings) {
  const matches = findings.filter(f => f.kind === 'secret');
  if (!matches.length) return '';
  // No raw values, excerpts or file paths in notifications or their markup.
  const count = new Set(matches.map((f, i) => f.value || `match-${i}`)).size;
  const title = count === 1 ? t("apiWarnOne") : t("apiWarnMany", [String(count)]);
  return `<div class="ps-api-warning" role="alert"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(t("apiWarnBody"))}</p></div>`;
}

function whereChecked(result) {
  return result.engine === "local" ? `<p class="ps-where">${escapeHtml(t("whereLocal"))}</p>` : "";
}

// Grouped findings: "Email address × 2", credentials first, with advice.
function findingList(findings) {
  return groupFindings(findings).map(({ title, count, credential }) => {
    const advice = credential ? credentialAdvice(credential) : null;
    return `<div class="ps-finding"><b>${escapeHtml(title)}</b>${count > 1 ? ` <span class="ps-times">× ${count}</span>` : ""}${advice ? `<details><summary>${escapeHtml(advice.summary)}</summary><p>${escapeHtml(advice.body)}</p></details>` : ""}</div>`;
  }).join("");
}

// What "Replace" will put in the composer, placeholders highlighted. The
// redacted text holds no detected values, so showing it exposes nothing new.
function redactedPreview(result) {
  if (typeof result.redactedText !== "string" || !result.redactedText) return "";
  const marked = escapeHtml(result.redactedText).replace(/\[[A-Z][A-Z ]{1,20}\]/g, "<mark>$&</mark>");
  return `<p class="ps-preview-label">${escapeHtml(t("redactedLabel"))}</p><div class="ps-preview">${marked}</div>`;
}

function renderFindings(body, result, composer, onHandled) {
  if (!result.findings.length) {
    body.innerHTML = `<p class="ps-empty">${escapeHtml(t("nothingFound"))}</p>${whereChecked(result)}`;
    return;
  }
  const found = result.findings.length;
  body.innerHTML = `
    ${apiWarning(result.findings)}
    <p class="ps-count">${escapeHtml(found === 1 ? t("resultOne") : t("resultMany", [String(found)]))}</p>
    ${decisionReason(result)}
    ${findingList(result.findings)}
    ${redactedPreview(result)}
    <button type="button" class="ps-use-redacted" id="redaxa-use-redacted">${escapeHtml(t("replaceRedacted"))}</button>
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
  psToast(t("promptChanged"));
  return false;
}

// ---------------------------------------------------------------------------
// Send interception. A manual "Check" button alone is easy to forget, so for
// everyone (unless switched off in the popup) this also intercepts the actual send action
// (Enter key and the Send button) at the document capture phase -- the
// earliest point in the DOM event chain, ahead of the site's own React/Vue
// handlers -- and puts up a blocking modal before anything leaves the
// browser. The user must explicitly pick "Send anyway" or the redacted version;
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
  // Signing in or out in the popup takes effect on the next send, not 30 s later.
  if (area === "local" && "redaxa_session" in changes) statusCheckedAt = 0;
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
let modalComposer = null;
// Bumped when the user dismisses a dialog, so a check still running for it
// neither sends nor reopens anything.
let gateRun = 0;

function closeModal() {
  modalEl?.remove();
  modalEl = null;
}

function dismissModal() {
  gateRun++;
  const composer = modalComposer;
  closeModal();
  composer?.focus?.();
}

// A labelled dialog; the card takes focus until a button is focused.
function showModal(html, composer) {
  closeModal();
  modalComposer = composer;
  modalEl = document.createElement("div");
  modalEl.id = "redaxa-intercept";
  modalEl.innerHTML = `<div class="ps-intercept-card" role="dialog" aria-modal="true" aria-labelledby="ps-int-title" tabindex="-1">${html}</div>`;
  document.body.append(modalEl);
  modalEl.querySelector("#ps-int-close")?.addEventListener("click", dismissModal);
  modalEl.querySelector(".ps-intercept-card")?.focus?.();
  return modalEl;
}

// While a dialog is open: Escape dismisses it and Tab stays inside it.
document.addEventListener("keydown", (event) => {
  if (!modalEl) return;
  if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); dismissModal(); return; }
  if (event.key !== "Tab") return;
  const focusable = [...modalEl.querySelectorAll("button, summary")];
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1], active = document.activeElement;
  if (!modalEl.contains(active) || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}, true);

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
  const run = ++gateRun;
  const text = composerText(composer).trim();
  const sendChecked = () => { if (sameCheckedPrompt(composer, text)) { closeModal(); resend(); } };
  const closeButton = `<button type="button" class="ps-int-x" id="ps-int-close" aria-label="${escapeHtml(t("close"))}">×</button>`;
  // A clean local check takes milliseconds: the "Checking" notice only
  // appears when a check is slow, so ordinary sends do not flash a dialog.
  const loading = window.setTimeout(() => showModal(`
    <div class="ps-int-head"><span id="ps-int-title">Redaxa</span>${closeButton}</div>
    <div class="ps-int-body"><p class="ps-loading">${escapeHtml(t("checkingBeforeSend"))}</p></div>
  `, composer), 300);
  let result;
  try {
    const status = await currentStatus();
    // A signed-in account whose plan cannot be confirmed may carry team
    // policies that block sending, so it waits rather than guessing.
    if (status.unavailable) throw new Error(t("couldNotVerify"));
    const account = status.signedIn === true && status.active === true;
    // Longer than a check accepts: say so instead of holding the send forever.
    result = text.length > 20_000 ? { tooLong: true, account } : await runScan(text, account);
  } catch (error) {
    window.clearTimeout(loading);
    if (run !== gateRun) return;
    showModal(`
      <div class="ps-int-head"><span id="ps-int-title">Redaxa</span>${closeButton}</div>
      <div class="ps-int-body">
        <p class="ps-empty">${escapeHtml(errorText(error))}</p>
        <p class="ps-empty">${escapeHtml(t("notSent"))}</p>
      </div>
    `, composer);
    modalEl.querySelector("#ps-int-close")?.focus?.();
    return;
  } finally {
    window.clearTimeout(loading);
    gatePending = false;
  }
  if (run !== gateRun) return;

  if (result.tooLong) {
    // A plan may carry team rules that block sending, so only free use can skip the check.
    showModal(`
      <div class="ps-int-head"><span id="ps-int-title">${escapeHtml(t("tooLongTitle"))}</span>${closeButton}</div>
      <div class="ps-int-body">
        <p class="ps-empty">${escapeHtml(t(result.account ? "tooLongAccount" : "tooLongBody"))}</p>
        ${result.account ? "" : `<button type="button" class="ps-int-secondary" id="ps-int-send-unchecked">${escapeHtml(t("sendUnchecked"))}</button>`}
      </div>
    `, composer);
    modalEl.querySelector("#ps-int-send-unchecked")?.addEventListener("click", sendChecked);
    modalEl.querySelector("#ps-int-close")?.focus?.();
    return;
  }

  if (!result.findings.length && result.decision?.action !== "block") {
    sendChecked();
    return;
  }

  // Enforcement follows the policy decision: when the winning rule says
  // "block" there is no "Send anyway" -- the prompt stays unsent until fixed.
  // (The default personal policy never blocks; this path exists for
  // organization rules.)
  const blocked = result.decision?.action === "block";
  const found = result.findings.length;
  const title = blocked ? t("blockedTitle") : found === 1 ? t("foundOne") : t("foundMany", [String(found)]);
  showModal(`
    <div class="ps-int-head"><span id="ps-int-title">${escapeHtml(title)}</span>${closeButton}</div>
    <div class="ps-int-body">
      ${apiWarning(result.findings)}
      ${decisionReason(result)}
      ${findingList(result.findings)}
      ${redactedPreview(result)}
      <p class="ps-explain">${escapeHtml(t("fixExplain"))}</p>
      <button type="button" class="ps-use-redacted" id="ps-int-fix">${escapeHtml(t("replaceRedacted"))}</button>
      ${blocked ? "" : `<button type="button" class="ps-int-secondary" id="ps-int-send-anyway">${escapeHtml(t("sendAnyway"))}</button>`}
    </div>
  `, composer);
  modalEl.querySelector("#ps-int-fix")?.addEventListener("click", () => {
    if (!sameCheckedPrompt(composer, text)) return;
    setComposerText(composer, result.redactedText);
    closeModal();
    psToast(t("replacedToast"));
  });
  modalEl.querySelector("#ps-int-send-anyway")?.addEventListener("click", sendChecked);
  modalEl.querySelector("#ps-int-fix")?.focus?.();
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
  if (!button || !isSendButton(button)) return;
  const composer = findComposer();
  const text = composerText(composer).trim();
  if (!text) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  gate(composer, () => resendVia("click", button));
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
