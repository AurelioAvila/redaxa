// Auth model mirrors the desktop app: no cookie jar of its own, so the
// extension signs in directly against the hosted API and holds the
// Supabase access/refresh token pair itself, sent as `Authorization: Bearer`
// on every call. Stored in chrome.storage.local, closed to content scripts
// (see below): the AI sites' tabs get only what STATUS tells them.
import "./config.js";
import { inspectPrompt } from "./engine/scanner.js";
import { defaultPersonalPolicy, evaluatePolicy } from "./engine/policy.js";
// Account and plan services live on the workspace origin. No host permission:
// the API answers extension origins over CORS, and free checks never call it.
const REDAXA_WORKSPACE_URL = globalThis.REDAXA_WORKSPACE_URL;
const API_BASE = REDAXA_WORKSPACE_URL;
const t = (key) => chrome.i18n.getMessage(key);
const SESSION_KEY = "redaxa_session";
const HELPFUL_KEY = "redaxa_helpful_checks";
const AUTO_CHECK_KEY = "redaxa_auto_check";

// Content scripts share a process with the AI site they run on, so they do not
// get storage access: a compromised page renderer could otherwise read the
// session tokens. Browsers without this control keep the default.
try { chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })?.catch?.(() => undefined); } catch { /* unsupported */ }

function repositoryEntitlement(account) {
  // Personal is the existing billing ID for Pro. Business includes Pro.
  // New API derives Business member access from the owner's verified entitlement.
  if (typeof account?.repositoryAccess === "boolean") return account.active === true && account.repositoryAccess;
  return account?.active === true && ["active", "trialing"].includes(account.status)
    && ["personal", "pro", "business"].includes(account.plan);
}

async function readSession() {
  const stored = await chrome.storage.local.get(SESSION_KEY);
  return stored[SESSION_KEY] ?? null;
}

async function saveSession(session) {
  await chrome.storage.local.set({ [SESSION_KEY]: session });
}

async function clearSession() {
  await chrome.storage.local.remove(SESSION_KEY);
}

// `force` skips the local expiry check: the API refused a token this computer's
// clock still considers valid (clock set back after sign-in, or a session
// revoked elsewhere), so the server decides instead of the clock.
async function accessToken(force = false) {
  const session = await readSession();
  if (!session) return null;
  if (!force && session.expires_at > Date.now() + 30_000) return session.access_token;
  const response = await fetch(`${API_BASE}/api/auth/session`, {
    headers: { Authorization: `Bearer ${session.access_token}`, "X-Refresh-Token": session.refresh_token },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok && response.status !== 401 && response.status !== 403) throw new Error(t("errAccountUnavailable"));
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403 || payload.email === null) {
    await clearSession();
    return null;
  }
  if (!payload.email) throw new Error(t("errAccountIncomplete"));
  if (!payload.access_token && !payload.refresh_token) return session.access_token;
  if (!payload.access_token || !payload.refresh_token) throw new Error(t("errAccountIncomplete"));
  await saveSession({
    email: payload.email,
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: Date.now() + (payload.expires_in ?? 3600) * 1000
  });
  return payload.access_token;
}

async function apiRequest(path, body, method = "POST", { timeoutMs = 15_000, retries = 1, requireAccount = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  let token = await accessToken();
  if (requireAccount && !token) throw new Error(t("errSignInAgain"));
  if (token) headers.Authorization = `Bearer ${token}`;
  let renewed = false;
  // A hung request would leave the user staring at "Checking…" forever, and a
  // single transient network blip shouldn't read as "Redaxa is broken":
  // hard timeout + one retry on pure network failures (never on HTTP errors,
  // which are real answers).
  for (let attempt = 0; ; attempt++) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
        signal: abort.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(payload.error ?? t("errRequestFailed")), { httpStatus: response.status });
      return payload;
    } catch (error) {
      // One retry with a token the server just confirmed or refreshed; a 401
      // means nothing was processed, so sending again is safe.
      if (error.httpStatus === 401 && token && !renewed) {
        renewed = true;
        const fresh = await accessToken(true).catch(() => null);
        if (fresh && fresh !== token) { token = fresh; headers.Authorization = `Bearer ${fresh}`; attempt--; continue; }
      }
      if (error.httpStatus || attempt >= retries) {
        throw error.name === "AbortError" ? new Error(t("errTimeout")) : error;
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

// Only the category switches are accepted from callers; anything else falls
// back to the engine defaults.
function scanOptions(options) {
  const flag = (value) => value !== false;
  return {
    includePersonalData: flag(options?.includePersonalData),
    includeCredentials: flag(options?.includeCredentials),
    includeFinancialData: flag(options?.includeFinancialData)
  };
}

async function handleMessage(message, sender) {
  // Account actions only from the popup (also opened as the welcome tab).
  const fromPopup = sender?.url?.split(/[?#]/)[0] === chrome.runtime.getURL("popup.html");
  if (["SIGN_IN", "SIGN_OUT"].includes(message.type) && !fromPopup) throw new Error(t("errPopupOnly"));
  switch (message.type) {
    case "SIGN_IN": {
      const payload = await apiRequest("/api/auth/signin", { email: message.email, password: message.password });
      await saveSession({
        email: payload.email,
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
        expires_at: Date.now() + (payload.expires_in ?? 3600) * 1000
      });
      return { email: payload.email };
    }
    case "SIGN_OUT": {
      const session = await readSession();
      if (session) apiRequest("/api/auth/signout", {}).catch(() => undefined);
      await clearSession();
      return { ok: true };
    }
    case "STATUS": {
      // The automatic-check switch travels with the status; pages get no email.
      const autoCheck = (await chrome.storage.local.get(AUTO_CHECK_KEY))?.[AUTO_CHECK_KEY] !== false;
      const session = await readSession();
      const email = () => fromPopup ? { email: session.email } : {};
      if (!session) return { signedIn: false, autoCheck };
      try {
        const token = await accessToken();
        if (!token) return { signedIn: false, autoCheck };
        const account = await apiRequest("/api/account", undefined, "GET");
        return { signedIn: true, ...email(), active: account.active === true, plan: account.plan,
          repositoryAccess: repositoryEntitlement(account), autoCheck };
      } catch {
        return { signedIn: true, ...email(), active: false, repositoryAccess: false, unavailable: true, autoCheck };
      }
    }
    case "SCAN": {
      if (typeof message.text !== "string" || !message.text.trim() || message.text.length > 20_000) {
        throw new Error(t("errTextLength"));
      }
      // Audit metadata only: which AI app the prompt was headed to. Derived
      // from the sender tab's host here (trusted context), never from the
      // page itself.
      const host = sender?.tab?.url ? new URL(sender.tab.url).hostname : "";
      const application =
        host === "chatgpt.com" ? "chatgpt" :
        host === "claude.ai" ? "claude" :
        host === "gemini.google.com" ? "gemini" :
        host === "www.perplexity.ai" ? "perplexity" : "extension";
      // Free use is checked on this device: the text never leaves the browser.
      // An active plan uses the account service, where workspace protected
      // terms, team policies and the activity record live.
      if (message.requireAccount !== true) {
        const local = inspectPrompt(message.text, scanOptions(message.options));
        if (local.findings.length && application !== "extension") void countHelpfulCheck();
        return { findings: local.findings, redactedText: local.redactedText, decision: evaluatePolicy(local.findings, defaultPersonalPolicy), engine: "local" };
      }
      const result = await apiRequest("/api/scan", { text: message.text, application, options: message.options ?? {} }, "POST", { requireAccount: true });
      if (!Array.isArray(result.findings) || typeof result.redactedText !== "string") {
        throw new Error(t("errIncompleteResult"));
      }
      // The decision (which policy rule fired, why, and whether the send is
      // blocked) must survive this hop — the content script's modal depends
      // on it. Dropping it here silently degraded block to warn.
      return { findings: result.findings ?? [], redactedText: result.redactedText ?? "", decision: result.decision ?? null, engine: "account" };
    }
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// A number only, kept on this device: after a few checks on an AI site that
// found something, the popup offers a link to the store reviews once.
async function countHelpfulCheck() {
  const stored = await chrome.storage.local.get(HELPFUL_KEY).catch(() => ({}));
  await chrome.storage.local.set({ [HELPFUL_KEY]: (Number(stored?.[HELPFUL_KEY]) || 0) + 1 }).catch(() => undefined);
}

// First install: open the popup as a welcome tab (try an example, see the result).
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") void chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?welcome") });
});

// Open AI-site tabs cannot watch storage, so the switch and sign-in/out are
// pushed to them. Without the tabs permission, tabs come without URLs: tabs
// without the content script simply do not answer.
chrome.storage.onChanged?.addListener((changes, area) => {
  const signedInOrOut = SESSION_KEY in changes && !changes[SESSION_KEY].oldValue !== !changes[SESSION_KEY].newValue;
  if (area !== "local" || !(AUTO_CHECK_KEY in changes || signedInOrOut)) return;
  chrome.tabs.query({}).then(tabs => {
    for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: "SETTINGS_CHANGED" }).catch(() => undefined);
  }).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // No externally_connectable is declared, so only this extension's own
  // content scripts/popup can reach onMessage -- but check the sender id
  // explicitly anyway, so this stays safe if externally_connectable is
  // ever added later for an unrelated reason.
  if (sender.id !== chrome.runtime.id) return false;
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : t("errRequestFailed"), httpStatus: error.httpStatus }));
  return true; // keep the message channel open for the async response
});
