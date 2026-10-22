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
    // Editing an earlier message on ChatGPT and Gemini opens a second editor
    // of the same kind above the composer: the composer is the lowest one.
    const shown = [...(document.querySelectorAll?.(selector) ?? [])].filter(visible);
    const el = shown.length > 1
      ? shown.reduce((a, b) => (b.getBoundingClientRect().top >= a.getBoundingClientRect().top ? b : a))
      : document.querySelector(selector);
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
  selectAllNow();
  const inserted = document.execCommand("insertText", false, text);
  if (!inserted) {
    el.innerText = text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }
  // An editor may still refuse a scripted edit (Lexical did before its
  // selection was announced). Verify after the editor has had time to apply
  // the change; if it refused, fall back to the one path
  // that can never be blocked: safe text on the clipboard, everything left
  // selected, and a toast telling the user the single keystroke that
  // finishes the job.
  setTimeout(() => {
    if (composerText(el).trim() === text.trim()) return;
    navigator.clipboard.writeText(text).then(() => {
      el.focus();
      selectAllNow();
      psToast(t("pasteToast"));
    }).catch(() => {
      psToast(t("editorBlocked"));
    });
  }, 400);
}

// Lexical (Perplexity) learns about a new selection from the browser's
// selectionchange event, which arrives after this code has run: without it,
// insertText lands at the old caret and the redacted text is appended to the
// original instead of replacing it (seen live on 14 October 2026). Announcing
// the change at once keeps every editor's selection in step.
function selectAllNow() {
  document.execCommand("selectAll");
  document.dispatchEvent(new Event("selectionchange"));
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
    <div class="ps-actions"><button type="button" class="ps-use-redacted" id="redaxa-use-redacted">${escapeHtml(t("replaceRedacted"))}</button></div>
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
// It arrives with STATUS: this script has no storage access of its own.
let autoCheck = true;
// The switch or a sign-in/out changed in the popup: apply it before the next send.
chrome.runtime.onMessage?.addListener((message, sender) => {
  if (sender?.id !== chrome.runtime.id || message?.type !== "SETTINGS_CHANGED") return;
  statusCheckedAt = 0;
  // A status request already on its way was answered before the change: ask again after it.
  void (statusRefresh ?? Promise.resolve()).then(() => refreshStatus());
});
let statusCheckedAt = 0;
let bypassArm = false;
let statusRefresh = null;
let gatePending = false;

function refreshStatus() {
  if (statusRefresh) return statusRefresh;
  statusRefresh = send({ type: "STATUS" }).then(status => {
    if (typeof status?.autoCheck === "boolean") autoCheck = status.autoCheck;
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
// matching event instead of gating it again. Modifiers are kept: a site set
// to send with Ctrl+Enter would read a bare Enter as a new line.
function resendVia(kind, target, keys = {}) {
  bypassArm = true;
  if (kind === "key") {
    target.focus();
    const { ctrlKey = false, metaKey = false, altKey = false } = keys;
    for (const type of ["keydown", "keypress", "keyup"]) {
      target.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, ctrlKey, metaKey, altKey, bubbles: true, cancelable: true, composed: true }));
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
  const sendChecked = () => { if (sameCheckedPrompt(composer, text)) { clearAttachments(); closeModal(); resend(); } };
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
    // Switched off in the popup while this send waited for the status.
    if (!autoCheck) { resend(); return; }
    // The account service is unreachable. A Business workspace member may
    // have team rules that block sending, so only they wait; everyone else
    // is checked on this device, as free use is.
    if (status.unavailable && status.orgManaged) throw new Error(t("couldNotVerify"));
    const account = status.signedIn === true && status.active === true && !status.unavailable;
    let outage = status.signedIn === true && status.unavailable === true;
    if (!text) {
      // Only a flagged attachment holds this send.
      result = { findings: [], redactedText: "", decision: null, engine: "local" };
    } else if (text.length > 20_000) {
      // Longer than a check accepts: say so instead of holding the send forever.
      result = { tooLong: true, account: account || status.orgManaged === true };
    } else {
      try {
        result = await runScan(text, account);
      } catch (error) {
        // The account check failed without an answer (network, timeout): the
        // same fallback as an outage. A refusal (402, 401) or team rules stand.
        if (!account || status.orgManaged || error.httpStatus) throw error;
        result = await runScan(text, false);
        outage = true;
      }
    }
    if (outage) result.outage = true;
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

  if (Date.now() - attachmentsSince > ATTACHMENT_HOLD_MS) clearAttachments();
  if (!result.findings.length && result.decision?.action !== "block" && !flaggedFiles.length) {
    sendChecked();
    if (result.outage) psToast(t("checkedLocallyOutage"));
    return;
  }

  // Enforcement follows the policy decision: when the winning rule says
  // "block" there is no "Send anyway" -- the prompt stays unsent until fixed.
  // (The default personal policy never blocks; this path exists for
  // organization rules.)
  const blocked = result.decision?.action === "block";
  const found = result.findings.length;
  const title = blocked ? t("blockedTitle") : found === 1 ? t("foundOne") : found ? t("foundMany", [String(found)]) : t("attachTitle");
  showModal(`
    <div class="ps-int-head"><span id="ps-int-title">${escapeHtml(title)}</span>${closeButton}</div>
    <div class="ps-int-body">
      ${found ? `${apiWarning(result.findings)}
      ${decisionReason(result)}
      ${findingList(result.findings)}
      ${redactedPreview(result)}
      <p class="ps-explain">${escapeHtml(t("fixExplain"))}</p>` : ""}
      ${attachmentSection(found > 0)}
      ${result.outage ? `<p class="ps-where">${escapeHtml(t("checkedLocallyOutage"))}</p>` : ""}
      <div class="ps-actions">
        ${found ? `<button type="button" class="ps-use-redacted" id="ps-int-fix">${escapeHtml(t("replaceRedacted"))}</button>` : ""}
        ${blocked ? "" : `<button type="button" class="ps-int-secondary" id="ps-int-send-anyway">${escapeHtml(t("sendAnyway"))}</button>`}
      </div>
    </div>
  `, composer);
  modalEl.querySelector("#ps-int-fix")?.addEventListener("click", () => {
    if (!sameCheckedPrompt(composer, text)) return;
    setComposerText(composer, result.redactedText);
    closeModal();
    psToast(t("replacedToast"));
  });
  modalEl.querySelector("#ps-int-send-anyway")?.addEventListener("click", sendChecked);
  (modalEl.querySelector("#ps-int-fix") ?? modalEl.querySelector("#ps-int-close"))?.focus?.();
}

// ---------------------------------------------------------------------------
// Attachments. Uploads are never blocked or re-sent (a site may ignore a
// replayed drop or file choice). Text files are read here and checked with
// the same engine on this device; their contents go nowhere. A finding is
// announced at once and holds the next send until the user confirms it.
// ---------------------------------------------------------------------------
const ATTACHMENT_MAX_BYTES = 1_000_000;
const ATTACHMENT_HOLD_MS = 30 * 60_000;
const textFileName = /(?:^|\.)(?:env(?:\.(?:local|development|production|staging|test|example|sample))?|txt|text|csv|tsv|json|jsonl|ya?ml|toml|ini|conf|cfg|config|properties|log|md|markdown|xml|html?|js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|cs|php|swift|sh|bash|zsh|ps1|bat|cmd|sql|pem|key|crt|cer|p8|tf|tfvars|tfstate|npmrc|pypirc|netrc|gitconfig|htpasswd)$/i;
const textFileBase = /^(?:id_rsa|id_ecdsa|id_ed25519|credentials|dockerfile|makefile)$/i;
const textMime = /^(?:text\/|application\/(?:json|xml|x-yaml|yaml|toml|sql|javascript|x-sh|x-pem-file|x-x509-ca-cert)\b)/i;
let flaggedFiles = [];
let skippedFiles = [];
let attachmentsSince = 0;

function clearAttachments() {
  flaggedFiles = [];
  skippedFiles = [];
}

function inspectableFile(file) {
  const name = String(file?.name ?? "");
  return Number(file?.size) <= ATTACHMENT_MAX_BYTES
    && (textMime.test(file?.type ?? "") || textFileName.test(name) || textFileBase.test(name));
}

// The engine takes 20,000 characters at a time; chunks overlap so a value
// on a boundary is still seen whole.
async function attachmentKinds(text) {
  const kinds = new Set();
  for (let start = 0; start < text.length; start += 19_600) {
    const part = text.slice(start, start + 20_000);
    if (!part.trim()) continue;
    const result = await send({ type: "SCAN", text: part, requireAccount: false, options: { includePersonalData: true, includeCredentials: true, includeFinancialData: true } });
    for (const finding of findingPriority(result.findings ?? [])) kinds.add(findingLabel(finding));
  }
  return [...kinds];
}

async function inspectAttachments(files) {
  if (!files.length || !autoCheck || !globalThis.chrome?.runtime?.id) return;
  const flagged = [];
  for (const file of files) {
    if (!inspectableFile(file)) { skippedFiles.push(file.name); continue; }
    try {
      const kinds = await attachmentKinds(await file.text());
      if (kinds.length) flagged.push({ name: file.name, kinds });
    } catch {
      skippedFiles.push(file.name);
    }
  }
  if (!flagged.length) return;
  flaggedFiles.push(...flagged);
  attachmentsSince = Date.now();
  psToast(t("attachFoundToast", [flagged[0].name, flagged[0].kinds.join(", ")]));
}

function attachmentSection(afterText) {
  if (!flaggedFiles.length) return "";
  const rows = flaggedFiles.map(({ name, kinds }) => `<div class="ps-finding"><b>${escapeHtml(name)}</b> <span class="ps-times">${escapeHtml(kinds.join(", "))}</span></div>`).join("");
  const skipped = skippedFiles.length ? `<p class="ps-where">${escapeHtml(t("attachSkipped", [skippedFiles.join(", ")]))}</p>` : "";
  return `${afterText ? `<p class="ps-count">${escapeHtml(t("attachTitle"))}</p>` : ""}${rows}<p class="ps-explain">${escapeHtml(t("attachExplain"))}</p>${skipped}`;
}

const filesOf = (list) => [...(list ?? [])].filter((file) => file && typeof file.name === "string");
document.addEventListener("drop", (event) => { void inspectAttachments(filesOf(event.dataTransfer?.files)); }, true);
document.addEventListener("paste", (event) => { void inspectAttachments(filesOf(event.clipboardData?.files)); }, true);
document.addEventListener("change", (event) => {
  if (event.target?.type === "file") void inspectAttachments(filesOf(event.target.files));
}, true);

// After the extension updates, scripts already running in open tabs lose
// their link to it for good. They can no longer check anything, so they step
// aside rather than hold every send until the tab is reloaded, and say so
// once. The notice is read now: translations are gone once orphaned.
const reloadNotice = t("reloadAfterUpdate");
let reloadNoticeShown = false;
function orphaned() {
  if (globalThis.chrome?.runtime?.id) return false;
  if (!reloadNoticeShown && reloadNotice) { reloadNoticeShown = true; psToast(reloadNotice); }
  return true;
}

function withinComposer(node, composer) {
  return Boolean(composer) && (node === composer || composer.contains(node));
}

// Editing an earlier message happens in a second text box on conversation
// pages. Settings, project and dialog text areas keep Enter as a new line.
const editableSelector = "textarea, [contenteditable='true'], [contenteditable='plaintext-only']";
const conversationPath = /^\/(?:c|g\/[^/]+\/c|chat|app|u\/\d+\/app|search)\//;
function inConversation(el) {
  return conversationPath.test(globalThis.location?.pathname ?? "")
    && !el.closest?.("[role='dialog'], [aria-modal='true'], nav, aside, header, footer, #redaxa-panel, #redaxa-intercept");
}

// Enter is only intercepted in the main composer. In an edit box (and in
// editors such as ChatGPT's canvas) Enter may be a new line, and a re-sent
// synthetic Enter inserts nothing, so intercepting it would eat the line
// break. Edited messages are checked when their Save/Send button is clicked.
function composerForKey(target) {
  const main = findComposer();
  return withinComposer(target, main) ? main : null;
}

// The text box a send button belongs to, found from the button itself. The
// main composer wins when it is in reach: ChatGPT keeps a hidden fallback
// textarea in the same form, and an empty hidden box must never stand in.
const visible = (el) => Boolean(el?.offsetHeight || el?.getClientRects?.().length);
function firstVisibleEditable(node) {
  return [...(node.querySelectorAll?.(editableSelector) ?? [])].find(visible) ?? null;
}
function composerNear(button) {
  const main = findComposer();
  let node = button?.parentElement;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    if (main && node.contains?.(main)) return main;
    const editable = firstVisibleEditable(node);
    if (editable) return editable;
  }
  return main;
}

// An edit box's own submit is the last button beside it (Save, Send or
// Update after Cancel), whatever its translated label. "Beside it" is the
// nearest container around the box that holds buttons: further out, other
// controls (ChatGPT's feedback close, Perplexity's panel toggle) come last.
// A disabled Save (text unchanged) still counts, so Cancel never stands in.
function editSubmit(editable) {
  let node = editable.parentElement;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    const buttons = [...node.querySelectorAll("button")].filter((b) => !editable.contains(b));
    if (buttons.length) return buttons.at(-1);
  }
  return null;
}
function editBoxForButton(button) {
  const main = findComposer();
  let node = button?.parentElement;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    const editable = firstVisibleEditable(node);
    if (!editable) continue;
    if (withinComposer(editable, main) || !inConversation(editable)) return null;
    return !button.disabled && editSubmit(editable) === button ? editable : null;
  }
  return null;
}

document.addEventListener("keydown", (event) => {
  if (bypassArm) { bypassArm = false; return; }
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  if (!autoCheck) return;
  const composer = composerForKey(event.target);
  if (!composer) return;
  const text = composerText(composer).trim();
  if ((!text && !flaggedFiles.length) || orphaned()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const keys = { ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey };
  gate(composer, () => resendVia("key", composer, keys));
}, true);

document.addEventListener("click", (event) => {
  if (bypassArm) { bypassArm = false; return; }
  if (!autoCheck) return;
  const button = event.target.closest?.("button");
  if (!button) return;
  const composer = isSendButton(button) ? composerNear(button) : editBoxForButton(button);
  if (!composer) return;
  const text = composerText(composer).trim();
  if ((!text && !flaggedFiles.length) || orphaned()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  gate(composer, () => resendVia("click", button));
}, true);

// Refreshed when the tab comes back into view and before a send that finds
// the status older than 30 seconds, rather than polled from every open tab.
void refreshStatus();
document.addEventListener("visibilitychange", () => { if (!document.hidden) void refreshStatus(); });

// Bottom-right is where Send sits on narrow layouts (Gemini below about
// 1000 px wide), so the button moves up above the composer whenever it would
// cover it, and back down when the window widens again.
const CHECK_BOTTOM = 88;
function placeCheckButton() {
  const button = document.getElementById("redaxa-check-btn");
  if (!button) return;
  const composer = findComposer();
  const sends = sendButtonSelectors.flatMap((selector) => {
    try { return [...document.querySelectorAll(selector)]; } catch { return []; }
  }).filter(visible);
  // The composer's card: the smallest box holding the editor and its Send button.
  let card = composer;
  while (card && sends.length && !sends.some((send) => card.contains(send))) card = card.parentElement;
  const cardRect = card?.getBoundingClientRect();
  const obstacles = cardRect && cardRect.height < window.innerHeight / 2
    ? [cardRect]
    : [composer, ...sends].filter((el) => el && visible(el)).map((el) => el.getBoundingClientRect());
  const height = button.offsetHeight, right = window.innerWidth - 22, left = right - button.offsetWidth;
  let bottom = CHECK_BOTTOM;
  for (const rect of obstacles.sort((a, b) => b.bottom - a.bottom)) {
    const top = window.innerHeight - bottom - height;
    if (rect.left < right && rect.right > left && rect.top < top + height && rect.bottom > top) bottom = window.innerHeight - rect.top + 12;
  }
  if (bottom + height > window.innerHeight - 8) bottom = CHECK_BOTTOM; // no room above: keep the usual place
  button.style.bottom = `${bottom}px`;
  const panel = document.getElementById("redaxa-panel");
  if (panel) Object.assign(panel.style, { bottom: `${bottom + 48}px`, maxHeight: `min(64vh, ${window.innerHeight - bottom - 64}px)` });
}

function boot() {
  if (!document.getElementById("redaxa-check-btn")) buildUI();
  // Typing grows the composer and brings up Send; the composer itself can
  // render after the button does.
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; placeCheckButton(); });
  };
  window.addEventListener("resize", schedule);
  document.addEventListener("input", schedule, true);
  document.addEventListener("focusin", schedule, true);
  for (const delay of [0, 600, 2000]) setTimeout(schedule, delay);
}
if (document.body) boot();
else document.addEventListener("DOMContentLoaded", boot, { once: true });
