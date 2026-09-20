const statusBox = document.getElementById("status");
const formBox = document.getElementById("form");
const statusEmail = document.getElementById("status-email");
const msg = document.getElementById("msg");
const installed = typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
const DASHBOARD_URL = `${REDAXA_WORKSPACE_URL}/dashboard.html`;
let currentStatus = { signedIn: false, repositoryAccess: false };

function send(message) {
  if (!installed) return Promise.reject(new Error("This is a design preview. Use the installed extension to sign in."));
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError || !response) { reject(new Error("Redaxa could not connect. Reopen the extension and try again.")); return; }
      if (!response.ok) { reject(new Error(response.error || "The request could not be completed.")); return; }
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
  if (!currentStatus.signedIn) { setPanel(false); document.getElementById("email").focus(); return; }
  if (!currentStatus.repositoryAccess) { openWorkspace(`${DASHBOARD_URL}#plans`); return; }
  const button = document.getElementById("open-repository"); button.disabled = true;
  try {
    // Fresh entitlement verification in the background on every open; UI state is not authorization.
    await send({ type: "OPEN_REPOSITORY", repository: document.getElementById("repository-url").value.trim() });
  } catch (error) { msg.textContent = error.message || "Could not open the repository check."; }
  finally { button.disabled = false; }
});
document.getElementById("prompt-tab").addEventListener("click", () => setPanel(false));
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
  try { await send({ type: "SIGN_OUT" }); await render(); } catch (error) { msg.textContent = error.message; }
});
document.getElementById("preview-note").hidden = installed;
void render();

