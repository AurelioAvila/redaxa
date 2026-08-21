// Auth model mirrors the desktop app: no cookie jar of its own, so the
// extension signs in directly against the hosted API and holds the
// Supabase access/refresh token pair itself, sent as `Authorization: Bearer`
// on every call. Stored in chrome.storage.local (extension-private, not
// reachable by the pages it's injected into).
const API_BASE = "https://promptshield-beta.vercel.app";
const SESSION_KEY = "promptshield_session";

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
    headers: { Authorization: `Bearer ${session.access_token}`, "X-Refresh-Token": session.refresh_token }
  });
  const payload = await response.json().catch(() => ({}));
  if (!payload.email || !payload.access_token || !payload.refresh_token) {
    await clearSession();
    return null;
  }
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
  // single transient network blip shouldn't read as "PromptShield is broken":
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
      const token = await accessToken();
      if (!token) return { signedIn: false };
      try {
        const account = await apiRequest("/api/account", undefined, "GET");
        return { signedIn: true, email: session.email, active: Boolean(account.active) };
      } catch {
        return { signedIn: true, email: session.email, active: false };
      }
    }
    case "SCAN": {
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
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unexpected error." }));
  return true; // keep the message channel open for the async response
});
