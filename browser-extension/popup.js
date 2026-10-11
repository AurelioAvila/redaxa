const $ = (id) => document.getElementById(id);
const statusBox = $("status");
const formBox = $("form");
const statusEmail = $("status-email");
const msg = $("msg");
const installed = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
const DASHBOARD_URL = `${REDAXA_WORKSPACE_URL}/dashboard.html`;
const STORE_URL = "https://chromewebstore.google.com/detail/redaxa/clkobbjoaegkgnmkibjghlboeoplpmok";
const HELPFUL_KEY = "redaxa_helpful_checks";
const REVIEW_KEY = "redaxa_review_prompt";
const welcome = new URLSearchParams(globalThis.location?.search ?? "").has("welcome");
let currentStatus = { signedIn: false, repositoryAccess: false };

// Markup carries the English text; the extension swaps in the user's language.
document.documentElement.lang = t("locale") || "en";
for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n) || el.textContent;
for (const el of document.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder) || el.placeholder;
for (const el of document.querySelectorAll("[data-i18n-label]")) el.setAttribute("aria-label", t(el.dataset.i18nLabel));
$("link-privacy").href = `${REDAXA_WORKSPACE_URL}/privacy.html`;
$("link-website").href = `${REDAXA_WORKSPACE_URL}/?source=extension`;
$("link-windows").href = "https://github.com/AurelioAvila/redaxa/releases/latest";
$("review-rate").href = `${STORE_URL}/reviews`;

function send(message) {
  if (!installed) return Promise.reject(new Error(t("previewOnly")));
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError || !response) { reject(new Error(t("connectError"))); return; }
      if (!response.ok) { reject(Object.assign(new Error(response.error || t("requestFailed")), { httpStatus: response.httpStatus })); return; }
      resolve(response.result);
    });
  });
}
function openWorkspace(url) {
  if (installed) chrome.tabs.create({ url });
  else window.open(url, "_blank", "noopener,noreferrer");
}
async function render() {
  currentStatus = installed ? await send({ type: "STATUS" }).catch(() => ({ signedIn: false, unavailable: true })) : { signedIn: false };
  statusBox.hidden = !currentStatus.signedIn;
  formBox.hidden = currentStatus.signedIn;
  $("account-summary").textContent = t(currentStatus.signedIn ? "accountSummary" : "signInSummary");
  $("pro-benefits").hidden = Boolean(currentStatus.active);
  const accountChecks = currentStatus.signedIn === true && currentStatus.active === true && !currentStatus.unavailable;
  $("check-access").textContent = t(accountChecks ? "accessAccount" : "accessFree");
  $("check-privacy").textContent = t(accountChecks ? "privacyAccount" : "privacyLocal");
  if (currentStatus.signedIn) {
    statusEmail.textContent = currentStatus.email;
    $("status-pill-text").textContent = t(currentStatus.unavailable ? "statusUnavailable" : currentStatus.active ? "statusActive" : "statusFree");
    $("status-pill").classList.toggle("off", !currentStatus.active);
    $("status-plan").textContent = t(currentStatus.repositoryAccess ? (currentStatus.plan === "business" ? "planBusiness" : "planPro") : "planManage");
  }
  if (currentStatus.unavailable) msg.textContent = t("accountUnavailable");
}
formBox.addEventListener("submit", async (event) => {
  event.preventDefault(); msg.textContent = "";
  const button = $("sign-in"); button.disabled = true;
  try {
    await send({ type: "SIGN_IN", email: $("email").value.trim(), password: $("password").value });
    $("password").value = "";
    await render();
  } catch (error) { msg.textContent = error.message || t("signInFailed"); }
  finally { button.disabled = false; }
});
$("open-account").addEventListener("click", () => {
  $("account-details").open = true;
  $(currentStatus.signedIn ? "open-dashboard" : "email").focus();
});
$("open-dashboard").addEventListener("click", () => openWorkspace(DASHBOARD_URL));
$("create-account").addEventListener("click", () => openWorkspace(`${DASHBOARD_URL}?auth=signup`));
$("forgot-password").addEventListener("click", () => openWorkspace(`${DASHBOARD_URL}?auth=recovery`));
$("show-password").addEventListener("click", (event) => {
  const input = $("password"); const show = input.type === "password";
  input.type = show ? "text" : "password";
  event.target.textContent = t(show ? "hidePassword" : "showPassword");
  event.target.setAttribute("aria-label", t(show ? "hidePasswordLabel" : "showPasswordLabel"));
});
$("sign-out").addEventListener("click", async () => {
  try { await send({ type: "SIGN_OUT" }); clearCheck(); await render(); } catch (error) { msg.textContent = error.message; }
});

const checkText = $("check-text");
const checkMessage = $("check-message");
const checkResult = $("check-result");
const checkButton = $("check-button");
let revision = 0;
let checking = false;
let reviewed = null;
const count = (n) => n.toLocaleString(t("locale") || "en");
function step(id) { if (welcome) $(id).classList.add("done"); }
function invalidateCheck() {
  revision++;
  reviewed = null;
  checkResult.hidden = true;
  $("redacted-text").value = "";
  $("finding-list").replaceChildren();
  checkMessage.textContent = checking ? t("textChangedPending") : "";
  $("text-count").textContent = `${count(checkText.value.length)} / ${count(20000)}`;
}
function clearCheck() { checkText.value = ""; invalidateCheck(); checkText.focus(); }
checkText.addEventListener("input", invalidateCheck);
$("clear-check").addEventListener("click", clearCheck);
$("try-example").addEventListener("click", () => {
  checkText.value = t("exampleText");
  invalidateCheck();
  checkMessage.textContent = t("exampleLoaded");
  step("step-example");
  checkButton.focus();
});
$("quick-check").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (checking) return;
  const text = checkText.value;
  invalidateCheck();
  if (!text.trim() || text.length > 20000) { checkMessage.textContent = t("enterText"); return; }
  const checkedRevision = revision;
  checking = true;
  checkButton.disabled = true;
  checkButton.textContent = t("checking");
  checkMessage.textContent = t("checking");
  try {
    const result = await send({ type: "SCAN", text, requireAccount: currentStatus.signedIn === true && currentStatus.active === true && !currentStatus.unavailable, options: { includePersonalData: true, includeCredentials: true, includeFinancialData: true } });
    if (revision !== checkedRevision || checkText.value !== text) return;
    if (!Array.isArray(result.findings) || typeof result.redactedText !== "string") throw new Error(t("incomplete"));
    const credentials = result.findings.some(isCredential);
    const found = result.findings.length;
    $("result-heading").textContent = credentials ? t("resultCredentials") : found === 1 ? t("resultOne") : found ? t("resultMany", [count(found)]) : t("resultNone");
    $("result-note").textContent = t(credentials ? "noteCredentials" : found ? "noteFindings" : "noteNone");
    checkResult.dataset.credentials = String(credentials);
    $("finding-list").replaceChildren(...groupFindings(result.findings).map(({ title, count: n, credential }) => {
      const item = document.createElement("li");
      item.textContent = n > 1 ? `${title} × ${n}` : title;
      if (credential) {
        const advice = credentialAdvice(credential);
        const details = document.createElement("details"), summary = document.createElement("summary"), body = document.createElement("p");
        summary.textContent = advice.summary; body.textContent = advice.body;
        details.append(summary, body); item.append(details);
      }
      return item;
    }));
    $("redacted-text").value = result.redactedText;
    reviewed = { text, redactedText: result.redactedText };
    checkResult.hidden = false;
    checkMessage.textContent = t(credentials ? "doneCredentials" : found ? "doneFindings" : "doneNone");
    step("step-result");
    $("result-heading").focus();
  } catch (error) {
    if (revision !== checkedRevision) return;
    const needsPlan = error.httpStatus === 402 || error.message === "TRIAL_REQUIRED";
    checkMessage.textContent = errorText(error);
    if (needsPlan) $("pro-benefits").hidden = false;
  } finally {
    checking = false;
    checkButton.disabled = false;
    checkButton.textContent = t("checkButton");
  }
});
$("copy-result").addEventListener("click", async () => {
  if (!reviewed || reviewed.text !== checkText.value) { invalidateCheck(); checkMessage.textContent = t("textChanged"); return; }
  try { await navigator.clipboard.writeText(reviewed.redactedText); checkMessage.textContent = t("copied"); }
  catch { checkMessage.textContent = t("copyFailed"); }
});
$("compare-plans").addEventListener("click", () => openWorkspace(`${DASHBOARD_URL}?source=extension#plans`));
$("text-count").textContent = `${count(0)} / ${count(20000)}`;
$("preview-note").hidden = installed;

// "Check automatically before sending": read by the content script on AI sites.
const autoCheck = $("auto-check");
const autoStep = () => { if (welcome) $("step-enable").classList.toggle("done", autoCheck.checked); };
if (installed && chrome.storage?.local) {
  chrome.storage.local.get(["redaxa_auto_check", HELPFUL_KEY, REVIEW_KEY]).then(stored => {
    autoCheck.checked = stored?.redaxa_auto_check !== false;
    autoStep();
    // Shown once, after three checks on AI sites that found something. No reward, no pressure.
    const ask = Number(stored?.[HELPFUL_KEY]) >= 3 && stored?.[REVIEW_KEY] !== "done";
    $("review-ask").hidden = !ask;
    if (ask) void chrome.storage.local.set({ [REVIEW_KEY]: "done" });
  }).catch(() => undefined);
  autoCheck.addEventListener("change", () => { autoStep(); void chrome.storage.local.set({ redaxa_auto_check: autoCheck.checked }); });
}
const reviewDone = () => { $("review-ask").hidden = true; if (installed) void chrome.storage.local.set({ [REVIEW_KEY]: "done" }); };
$("review-rate").addEventListener("click", reviewDone);
$("review-later").addEventListener("click", reviewDone);
$("review-share").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(STORE_URL); $("review-share").textContent = t("linkCopied"); } catch { msg.textContent = STORE_URL; }
});

if (welcome) {
  document.body.classList.add("welcome-page");
  $("welcome").hidden = false;
  $("prompt-intro").hidden = true;
  autoStep();
}
void render();
