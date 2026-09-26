// Auth model mirrors the desktop app: no cookie jar of its own, so the
// extension signs in directly against the hosted API and holds the
// Supabase access/refresh token pair itself, sent as `Authorization: Bearer`
// on every call. Stored in chrome.storage.local (extension-private, not
// reachable by the pages it's injected into).
importScripts("config.js");
const API_BASE = "https://promptshield-beta.vercel.app";
const SESSION_KEY = "redaxa_session";

function repositoryEntitlement(account) {
  // Personal is the existing billing ID for Pro. Business includes Pro.
  // New API derives Business member access from the owner's verified entitlement.
  if (typeof account?.repositoryAccess === "boolean") return account.active === true && account.repositoryAccess;
  return account?.active === true && ["active", "trialing"].includes(account.status)
    && ["personal", "pro", "business"].includes(account.plan);
}

function repositoryURL(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error("Enter a public GitHub repository URL."); }
  const parts = url.pathname.replace(/\/$/, "").split("/").filter(Boolean);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash
    || parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_.-]+$/.test(part)) || parts.some(part => part === "." || part === "..")) {
    throw new Error("Use a repository URL like https://github.com/owner/repository, without a file or branch path.");
  }
  const repo = parts[1].replace(/\.git$/, "");
  if (!repo || repo === "." || repo === "..") throw new Error("Enter a valid repository name.");
  return `https://github.com/${parts[0]}/${repo}`;
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

async function accessToken() {
  const session = await readSession();
  if (!session) return null;
  if (session.expires_at > Date.now() + 30_000) return session.access_token;
  const response = await fetch(`${API_BASE}/api/auth/session`, {
    headers: { Authorization: `Bearer ${session.access_token}`, "X-Refresh-Token": session.refresh_token },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok && response.status !== 401 && response.status !== 403) throw new Error("Account service is temporarily unavailable. Please retry.");
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403 || payload.email === null) {
    await clearSession();
    return null;
  }
  if (!payload.email) throw new Error("Account service returned an incomplete response. Please retry.");
  if (!payload.access_token && !payload.refresh_token) return session.access_token;
  if (!payload.access_token || !payload.refresh_token) throw new Error("Account service returned an incomplete session. Please retry.");
  await saveSession({
    email: payload.email,
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: Date.now() + (payload.expires_in ?? 3600) * 1000
  });
  return payload.access_token;
}

async function apiRequest(path, body, method = "POST", { timeoutMs = 15_000, retries = 1 } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = await accessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
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
      if (!response.ok) throw Object.assign(new Error(payload.error ?? "Request failed."), { httpStatus: response.status });
      return payload;
    } catch (error) {
      if (error.httpStatus || attempt >= retries) {
        throw error.name === "AbortError" ? new Error("The check timed out. Please try again.") : error;
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

async function handleMessage(message, sender) {
  if (["SIGN_IN", "SIGN_OUT", "OPEN_REPOSITORY"].includes(message.type)
    && sender?.url !== chrome.runtime.getURL("popup.html")) {
    throw new Error("Use the Redaxa popup for this account action.");
  }
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
      const session = await readSession();
      if (!session) return { signedIn: false };
      try {
        const token = await accessToken();
        if (!token) return { signedIn: false };
        const account = await apiRequest("/api/account", undefined, "GET");
        return { signedIn: true, email: session.email, active: account.active === true, plan: account.plan,
          repositoryAccess: repositoryEntitlement(account) };
      } catch {
        return { signedIn: true, email: session.email, active: false, repositoryAccess: false, unavailable: true };
      }
    }
    case "OPEN_REPOSITORY": {
      // Navigation and credentials remain popup-only. Content scripts only need STATUS/SCAN.
      if (sender?.url !== chrome.runtime.getURL("popup.html")) throw new Error("Open Repository check from the Redaxa popup.");
      const repository = repositoryURL(message.repository);
      const account = await apiRequest("/api/account", undefined, "GET");
      if (!repositoryEntitlement(account)) throw new Error("Repository checks require an active Pro or Business plan.");
      const url = new URL("/github.html", REDAXA_WORKSPACE_URL);
      url.searchParams.set("repo", repository);
      url.searchParams.set("source", "extension");
      // Do not put access tokens in URLs or bridge them into page storage.
      await chrome.tabs.create({ url: url.href });
      return { opened: true };
    }
    case "SCAN": {
      if (typeof message.text !== "string" || !message.text.trim() || message.text.length > 20_000) {
        throw new Error("Enter between 1 and 20,000 characters to check.");
      }
      // Audit metadata only: which AI app the prompt was headed to. Derived
      // from the sender tab's host here (trusted context), never from the
      // page itself.
      const host = sender?.tab?.url ? new URL(sender.tab.url).hostname : "";
      const application =
        host.includes("chatgpt") || host.includes("chat.openai") ? "chatgpt" :
        host.includes("claude") ? "claude" :
        host.includes("gemini") ? "gemini" :
        host.includes("copilot") ? "copilot" :
        host.includes("perplexity") ? "perplexity" : "extension";
      const result = await apiRequest("/api/scan", { text: message.text, application, options: message.options ?? {} });
      if (!Array.isArray(result.findings) || typeof result.redactedText !== "string") {
        throw new Error("The check returned an incomplete result. Please try again.");
      }
      // The decision (which policy rule fired, why, and whether the send is
      // blocked) must survive this hop — the content script's modal depends
      // on it. Dropping it here silently degraded block to warn.
      return { findings: result.findings ?? [], redactedText: result.redactedText ?? "", decision: result.decision ?? null };
    }
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // No externally_connectable is declared, so only this extension's own
  // content scripts/popup can reach onMessage -- but check the sender id
  // explicitly anyway, so this stays safe if externally_connectable is
  // ever added later for an unrelated reason.
  if (sender.id !== chrome.runtime.id) return false;
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unexpected error.", httpStatus: error.httpStatus }));
  return true; // keep the message channel open for the async response
});
