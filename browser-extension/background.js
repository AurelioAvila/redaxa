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

async function apiRequest(path, body, method = "POST") {
  const headers = { "Content-Type": "application/json" };
  const token = await accessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body ?? {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Request failed.");
  return payload;
}

async function handleMessage(message) {
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
      const result = await apiRequest("/api/scan", { text: message.text, options: message.options ?? {} });
      return { findings: result.findings ?? [], redactedText: result.redactedText ?? "" };
    }
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unexpected error." }));
  return true; // keep the message channel open for the async response
});
