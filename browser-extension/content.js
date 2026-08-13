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
      const result = await send({ type: "SCAN", text, options: { includePersonalData: true, includeCredentials: true, includeFinancialData: true } });
      if (!result.findings.length) {
        body.innerHTML = `<p class="ps-empty">Nothing obvious found. This is a helpful signal, not a guarantee.</p>`;
        return;
      }
      const list = result.findings.map((f) => `<div class="ps-finding"><b>${escapeHtml(f.label)}</b></div>`).join("");
      body.innerHTML = `
        <p class="ps-count">${result.findings.length} item${result.findings.length === 1 ? "" : "s"} to review</p>
        ${list}
        <button type="button" class="ps-use-redacted" id="promptshield-use-redacted">Replace with safer version</button>
      `;
      body.querySelector("#promptshield-use-redacted")?.addEventListener("click", () => {
        setComposerText(composer, result.redactedText);
        panel.classList.remove("open");
      });
    } catch (error) {
      body.innerHTML = `<p class="ps-empty">${escapeHtml(error.message || "Check failed.")}</p>`;
    }
  });
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[c] ?? c));
}

// The manual "Check" button only helps if the user remembers to press it --
// the actual differentiator is catching the moment they hit send. Every one
// of the supported sites sends on a plain Enter keypress (no Shift), so a
// capture-phase keydown listener on the composer is the one interception
// point that works identically across ChatGPT/Claude/Gemini/Copilot/
// Perplexity, without needing a per-site "Send button" selector that breaks
// on redesigns. Button-click sends aren't intercepted (lower-value, higher
// breakage risk); Enter covers the overwhelming majority of real sends.
let bypassNextEnter = false;

function resendEnter(composer) {
  bypassNextEnter = true;
  composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
}

function showInterceptDialog(composer, result, onProceed) {
  document.getElementById("promptshield-intercept")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "promptshield-intercept";
  const list = result.findings.map((f) => `<div class="ps-finding"><b>${escapeHtml(f.label)}</b></div>`).join("");
  overlay.innerHTML = `
    <div class="ps-intercept-card">
      <div class="ps-panel-head">Before you send this…</div>
      <div class="ps-panel-body">
        <p class="ps-count">${result.findings.length} item${result.findings.length === 1 ? "" : "s"} look sensitive</p>
        ${list}
        <button type="button" class="ps-use-redacted" id="ps-int-redact">Auto-redact and send</button>
        <button type="button" class="ps-int-secondary" id="ps-int-edit">Let me edit it</button>
        <button type="button" class="ps-int-secondary" id="ps-int-send">Send as-is anyway</button>
      </div>
    </div>`;
  document.body.append(overlay);
  overlay.querySelector("#ps-int-redact")?.addEventListener("click", () => {
    setComposerText(composer, result.redactedText);
    overlay.remove();
    window.setTimeout(() => resendEnter(composer), 30);
  });
  overlay.querySelector("#ps-int-send")?.addEventListener("click", () => { overlay.remove(); resendEnter(composer); });
  overlay.querySelector("#ps-int-edit")?.addEventListener("click", () => { overlay.remove(); composer.focus(); });
}

function attachSendInterception(composer) {
  if (!composer || composer.dataset.promptshieldIntercepted) return;
  composer.dataset.promptshieldIntercepted = "1";
  composer.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    if (bypassNextEnter) { bypassNextEnter = false; return; }
    const text = composerText(composer).trim();
    if (!text) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    (async () => {
      // Fails open on purpose: if sign-in/subscription/network checks don't
      // come back cleanly, the user's message still sends. A scanning outage
      // must never be able to silently block someone from using ChatGPT/
      // Claude/etc. -- that would turn a privacy helper into an outage.
      try {
        const status = await send({ type: "STATUS" });
        if (!status.signedIn || !status.active) { resendEnter(composer); return; }
        const result = await send({
          type: "SCAN", text,
          options: { includePersonalData: true, includeCredentials: true, includeFinancialData: true }
        });
        if (!result.findings.length) { resendEnter(composer); return; }
        showInterceptDialog(composer, result, () => resendEnter(composer));
      } catch { resendEnter(composer); }
    })();
  }, true);
}

if (!document.getElementById("promptshield-check-btn")) buildUI();
attachSendInterception(findComposer());
// Composers on SPA chat sites are frequently replaced (route change, new
// chat), so keep re-attaching to whatever element is current.
new MutationObserver(() => attachSendInterception(findComposer())).observe(document.body, { childList: true, subtree: true });
