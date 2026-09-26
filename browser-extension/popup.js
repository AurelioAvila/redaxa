const statusBox = document.getElementById("status");
const formBox = document.getElementById("form");
const statusEmail = document.getElementById("status-email");
const msg = document.getElementById("msg");
const installed = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
const DASHBOARD_URL = `${REDAXA_WORKSPACE_URL}/dashboard.html`;
let currentStatus = { signedIn: false, repositoryAccess: false };

function send(message) {
  if (!installed) return Promise.reject(new Error("Preview only. Use the installed Redaxa extension to check your text."));
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError || !response) { reject(new Error("Redaxa could not connect. Reopen the extension and try again.")); return; }
      if (!response.ok) { reject(Object.assign(new Error(response.error || "The request could not be completed."), { httpStatus: response.httpStatus })); return; }
      resolve(response.result);
    });
  });
}
function openWorkspace(url) {
  if (installed) chrome.tabs.create({ url });
  else window.open(url, "_blank", "noopener,noreferrer");
}
function setPanel(repository) {
  document.getElementById("prompt-panel").hidden = repository;
  document.getElementById("repository-panel").hidden = !repository;
  for (const [id, selected] of [["prompt-tab", !repository], ["repository-tab", repository]]) {
    const tab = document.getElementById(id);
    tab.classList.toggle("selected", selected);
    tab.setAttribute("aria-pressed", String(selected));
  }
  msg.textContent = "";
}
async function render() {
  currentStatus = installed ? await send({ type: "STATUS" }).catch(() => ({ signedIn: false, unavailable: true })) : { signedIn: false };
  statusBox.hidden = !currentStatus.signedIn;
  formBox.hidden = currentStatus.signedIn;
  document.getElementById("account-summary").textContent = currentStatus.signedIn ? "Your account & workspace" : "Already have an account? Sign in";
  document.getElementById("pro-benefits").hidden = Boolean(currentStatus.active);
  document.getElementById("check-access").textContent = currentStatus.unavailable ? "Account verification unavailable. Retry in a moment." : currentStatus.signedIn ? (currentStatus.active ? "Included in your plan. Service rate limits apply." : "Your account needs an active plan. Compare the options below.") : "5 free checks per 24 hours, shared by network. No account needed.";
  if (currentStatus.signedIn) {
    statusEmail.textContent = currentStatus.email;
    document.getElementById("status-pill-text").textContent = currentStatus.unavailable ? "Could not verify your plan" : currentStatus.active ? "Prompt protection active" : "Plan required";
    document.querySelector("#status-pill i").style.background = currentStatus.active ? "#a8d9bd" : "#ffb8ac";
    document.getElementById("status-plan").textContent = currentStatus.repositoryAccess ? (currentStatus.plan === "business" ? "Business · Pro features included" : "Pro workspace") : "Manage your plan in the workspace";
  }
  document.getElementById("repository-access").textContent = currentStatus.repositoryAccess ? "Included in your plan. Requires the latest Redaxa Windows app; access is verified again before scanning." : "Local Windows repository checks are included with Pro and Business.";
  const action = document.getElementById("open-repository");
  action.firstChild.textContent = currentStatus.repositoryAccess ? "Open repository check " : currentStatus.signedIn ? "Explore Pro " : "Sign in to continue ";
  document.getElementById("repository-url").required = Boolean(currentStatus.repositoryAccess);
  if (currentStatus.unavailable) msg.textContent = "Account verification is unavailable. Please try again; no access has been unlocked.";
}
formBox.addEventListener("submit", async (event) => {
  event.preventDefault(); msg.textContent = "";
  const button = document.getElementById("sign-in"); button.disabled = true;
  try {
    await send({ type: "SIGN_IN", email: document.getElementById("email").value.trim(), password: document.getElementById("password").value });
    document.getElementById("password").value = "";
    await render();
  } catch (error) { msg.textContent = error.message || "Sign-in failed."; }
  finally { button.disabled = false; }
});
document.getElementById("repository-form").addEventListener("submit", async (event) => {
  event.preventDefault(); msg.textContent = "";
  if (!currentStatus.signedIn) { setPanel(false); document.getElementById("account-details").open = true; document.getElementById("email").focus(); return; }
  if (!currentStatus.repositoryAccess) { openWorkspace(`${DASHBOARD_URL}#plans`); return; }
  const button = document.getElementById("open-repository"); button.disabled = true;
  try {
    // Fresh entitlement verification in the background on every open; UI state is not authorization.
    await send({ type: "OPEN_REPOSITORY", repository: document.getElementById("repository-url").value.trim() });
  } catch (error) { msg.textContent = error.message || "Could not open the repository check."; }
  finally { button.disabled = false; }
});
document.getElementById("prompt-tab").addEventListener("click", () => setPanel(false));
document.getElementById("open-account").addEventListener("click", () => {
  setPanel(false);
  document.getElementById("account-details").open = true;
  document.getElementById(currentStatus.signedIn ? "open-dashboard" : "email").focus();
});
document.getElementById("repository-tab").addEventListener("click", () => setPanel(true));
document.getElementById("open-dashboard").addEventListener("click", () => openWorkspace(DASHBOARD_URL));
document.getElementById("repository-plans").addEventListener("click", () => openWorkspace(`${DASHBOARD_URL}#plans`));
document.getElementById("create-account").addEventListener("click", () => openWorkspace(`${DASHBOARD_URL}?auth=signup`));
document.getElementById("forgot-password").addEventListener("click", () => openWorkspace(`${DASHBOARD_URL}?auth=recovery`));
document.getElementById("show-password").addEventListener("click", (event) => {
  const input = document.getElementById("password"); const show = input.type === "password";
  input.type = show ? "text" : "password";
  event.target.textContent = show ? "Hide" : "Show";
  event.target.setAttribute("aria-label", show ? "Hide password" : "Show password");
});
document.getElementById("sign-out").addEventListener("click", async () => {
  try { await send({ type: "SIGN_OUT" }); clearCheck(); await render(); } catch (error) { msg.textContent = error.message; }
});
const checkText = document.getElementById("check-text");
const checkMessage = document.getElementById("check-message");
const checkResult = document.getElementById("check-result");
const checkButton = document.getElementById("check-button");
let revision = 0;
let checking = false;
let reviewed = null;
function invalidateCheck() {
  revision++;
  reviewed = null;
  checkResult.hidden = true;
  document.getElementById("redacted-text").value = "";
  document.getElementById("finding-list").replaceChildren();
  checkMessage.textContent = checking ? "Text changed. Check again when the current request finishes." : "";
  document.getElementById("text-count").textContent = `${checkText.value.length.toLocaleString("en-US")} / 20,000`;
}
function clearCheck() { checkText.value = ""; invalidateCheck(); checkText.focus(); }
checkText.addEventListener("input", invalidateCheck);
document.getElementById("clear-check").addEventListener("click", clearCheck);
document.getElementById("try-example").addEventListener("click", () => {
  checkText.value = "Please send the invoice to taylor@example.com. My card number is 4111 1111 1111 1111.";
  invalidateCheck();
  checkMessage.textContent = "Fictional example loaded. Choose Check text to see what Redaxa finds.";
  checkText.focus();
});
document.getElementById("quick-check").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (checking) return;
  const text = checkText.value;
  invalidateCheck();
  if (!text.trim() || text.length > 20000) { checkMessage.textContent = "Enter between 1 and 20,000 characters."; return; }
  const checkedRevision = revision;
  checking = true;
  checkButton.disabled = true;
  checkButton.textContent = "Checking…";
  checkMessage.textContent = "Checking with Redaxa…";
  try {
    const result = await send({ type: "SCAN", text, options: { includePersonalData: true, includeCredentials: true, includeFinancialData: true } });
    if (revision !== checkedRevision || checkText.value !== text) return;
    if (!Array.isArray(result.findings) || typeof result.redactedText !== "string") throw new Error("Incomplete result. Please check again.");
    const credentials = result.findings.filter(f => f.category === "credentials" || f.kind === "secret" || f.kind === "privateKey");
    const severity = { critical: 4, high: 3, medium: 2, low: 1 };
    const sorted = [...result.findings].sort((a, b) => Number(b.kind === "secret") - Number(a.kind === "secret") || Number(credentials.includes(b)) - Number(credentials.includes(a)) || (severity[b.severity] || 0) - (severity[a.severity] || 0));
    document.getElementById("result-heading").textContent = credentials.length ? "Potential credentials found" : result.findings.length ? `${result.findings.length} items to review` : "No obvious sensitive data found";
    document.getElementById("result-note").textContent = credentials.length ? "Review these first. Service names are inferred, not verified ownership. Follow each finding’s advice; validity has not been tested." : "Review the output before sharing. Detection can miss details or flag examples.";
    checkResult.dataset.credentials = String(credentials.length > 0);
    const labels = new Map();
    for (const finding of sorted) {
      const label=finding.credential?`${finding.credential.service} · ${finding.credential.type}`:finding.label;
      const entry=labels.get(label)??{count:0,context:finding.credential};entry.count++;labels.set(label,entry);
    }
    document.getElementById("finding-list").replaceChildren(...[...labels].map(([label, {count,context}]) => {
      const item = document.createElement("li"); item.textContent = `${label}${count > 1 ? ` × ${count}` : ""}`;
      if(context){const details=document.createElement("details"),summary=document.createElement("summary"),body=document.createElement("p");summary.textContent=context.response;body.textContent=`${context.evidence} ${context.guidance}`;details.append(summary,body);item.append(details);}
      return item;
    }));
    document.getElementById("redacted-text").value = result.redactedText;
    reviewed = { text, redactedText: result.redactedText };
    checkResult.hidden = false;
    checkMessage.textContent = credentials.length ? "Check complete. Potential credentials need your attention." : "Check complete. Your reviewed version is below.";
  } catch (error) {
    if (revision !== checkedRevision) return;
    const needsPlan = error.httpStatus === 402 || error.message === "TRIAL_REQUIRED";
    checkMessage.textContent = needsPlan ? (currentStatus.signedIn ? "An active plan is required for this account. Compare Pro plans below." : "The free check limit for this network has been reached. Sign in with an active plan, compare Pro, or try again after the daily window resets.") : error.message || "Could not check this text. Please retry.";
    if (needsPlan) document.getElementById("pro-benefits").hidden = false;
  } finally {
    checking = false;
    checkButton.disabled = false;
    checkButton.textContent = "Check text →";
  }
});
document.getElementById("copy-result").addEventListener("click", async () => {
  if (!reviewed || reviewed.text !== checkText.value) { invalidateCheck(); checkMessage.textContent = "Text changed. Run a fresh check before copying."; return; }
  try { await navigator.clipboard.writeText(reviewed.redactedText); checkMessage.textContent = "Reviewed text copied. Check it before sharing."; }
  catch { checkMessage.textContent = "Copy unavailable. Select and copy the reviewed text above."; }
});
document.getElementById("compare-plans").addEventListener("click", () => openWorkspace(`${DASHBOARD_URL}?source=extension#plans`));
document.getElementById("preview-note").hidden = installed;
void render();

