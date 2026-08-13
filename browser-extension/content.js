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

if (!document.getElementById("promptshield-check-btn")) buildUI();
