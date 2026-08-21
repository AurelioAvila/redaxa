import { isTauri, openInSystemBrowser } from "./desktop.js";
import type { Finding } from "./scanner.js";

type AuthConfig = { configured: boolean };
type DesktopSession = { email: string; access_token: string; refresh_token: string; expires_at: number };

// The desktop build has no domain/cookie jar of its own, so it authenticates the
// same way PC Tweaker and Social Dashboard do: sign in/register happens in this
// same embedded form (not a browser handoff), and the resulting Supabase access
// token is held by the app itself and sent as `Authorization: Bearer` on every
// API call. This is a different trust model from the web dashboard's httpOnly
// cookie (a stolen Bearer token requires the caller to already have it, so it
// doesn't reopen the XSS-session-theft risk the cookie migration closed), and it
// only applies to the desktop build.
const webAppUrl = "https://promptshield-beta.vercel.app";
const apiBase = isTauri() ? webAppUrl : "";

let config: AuthConfig | null = null;
let mode: "signup" | "signin" | "recovery" = "signup";
let currentEmail: string | null = null;
let accountActive = false;

type ScanRequestOptions = { includePersonalData?: boolean; includeCredentials?: boolean; includeFinancialData?: boolean; customTerms?: string[] };
// The policy layer's verdict, passed through untouched from /api/scan so every
// surface can show WHICH rule fired and WHY (indexes only — never values).
type ScanDecision = { action: "allow" | "warn" | "redact" | "block"; decidedBy: { ruleId: string; ruleName: string; reason: string; findingIndexes: number[] } | null };

declare global {
  interface Window {
    promptShieldAuth?: {
      hasAccess(): boolean;
      requestAccess(message?: string): void;
      scanPrompt(text: string, options?: ScanRequestOptions): Promise<{ findings: Finding[]; redactedText: string; decision?: ScanDecision }>;
      request(path: string, body?: Record<string, unknown>, method?: "GET" | "POST"): Promise<Record<string, unknown>>;
    };
  }
}

// Persisted via the OS credential store (Windows Credential Manager, through a
// Rust `keyring` command), not the webview's localStorage: localStorage is a
// plain, unencrypted file on disk, readable by any other local process or user
// account, which would let a stolen refresh token be lifted without ever
// touching the running app. `secureStore*` below are the only functions that
// touch this value; everything else in the file goes through them.
let sessionCache: DesktopSession | null | undefined;

async function secureStoreGet(): Promise<string | null> {
  const invoke = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__?.invoke;
  if (!invoke) return null;
  const value = await invoke("secure_store_get").catch(() => null);
  return typeof value === "string" ? value : null;
}
async function secureStoreSet(value: string): Promise<void> {
  const invoke = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__?.invoke;
  await invoke?.("secure_store_set", { value }).catch(() => undefined);
}
async function secureStoreDelete(): Promise<void> {
  const invoke = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__?.invoke;
  await invoke?.("secure_store_delete").catch(() => undefined);
}

async function readDesktopSession(): Promise<DesktopSession | null> {
  if (sessionCache !== undefined) return sessionCache;
  try {
    const raw = await secureStoreGet();
    const value: unknown = JSON.parse(raw ?? "null");
    sessionCache = value && typeof value === "object" ? value as DesktopSession : null;
  } catch { sessionCache = null; }
  return sessionCache;
}
async function saveDesktopSession(session: DesktopSession): Promise<void> {
  sessionCache = session;
  await secureStoreSet(JSON.stringify(session));
}
async function clearDesktopSession(): Promise<void> {
  sessionCache = null;
  await secureStoreDelete();
}
// One synchronous read of the in-memory cache, for call sites (like the
// sign-out button handler) that need the current session's fields without
// awaiting -- readDesktopSession()/loadSession() populate the cache during
// boot(), so by the time a user can click anything it is already warm.
function cachedDesktopSession(): DesktopSession | null { return sessionCache ?? null; }

// Returns a Bearer token good for at least 30 more seconds, transparently
// refreshing (and re-persisting) it first if the stored one is stale or absent.
async function desktopAccessToken(): Promise<string | null> {
  const session = await readDesktopSession();
  if (!session) return null;
  if (session.expires_at > Date.now() + 30_000) return session.access_token;
  const response = await fetch(`${apiBase}/api/auth/session`, {
    headers: { Authorization: `Bearer ${session.access_token}`, "X-Refresh-Token": session.refresh_token }
  });
  const payload = await response.json().catch(() => ({})) as { email?: string | null; access_token?: string; refresh_token?: string; expires_in?: number };
  if (!payload.email || !payload.access_token || !payload.refresh_token) { await clearDesktopSession(); return null; }
  await saveDesktopSession({ email: payload.email, access_token: payload.access_token, refresh_token: payload.refresh_token, expires_at: Date.now() + (payload.expires_in ?? 3600) * 1000 });
  return payload.access_token;
}

async function apiRequest(path: string, body?: Record<string, unknown>, method: "GET" | "POST" = "POST"): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (isTauri()) {
    const token = await desktopAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${apiBase}${path}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && "error" in payload ? String((payload as { error?: unknown }).error) : "We could not complete that request.";
    throw new Error(message);
  }
  return payload as Record<string, unknown>;
}

function accountControls(): { trigger: HTMLAnchorElement; login: HTMLAnchorElement; account: HTMLDivElement; email: HTMLSpanElement; signout: HTMLButtonElement; avatars: HTMLElement[]; closeMenu: () => void } {
  const trigger = document.querySelector<HTMLAnchorElement>(".small-btn")!;
  const outerParent = trigger.parentElement!;
  trigger.href = "#account";
  trigger.textContent = "Create account";
  // Previously "Create account" was the only visible entry point -- an
  // already-registered user had no obvious way in and had to click through
  // to the signup dialog just to find the small "Already have an account?"
  // link. Add a real, equally visible "Log in" control next to it, in its
  // own horizontal row so it doesn't stack under Create account on pages
  // whose layout is a vertical flex column (the dashboard's top-right).
  const login = document.createElement("a");
  login.className = "small-btn ghost";
  login.href = "#account";
  login.textContent = "Log in";
  const buttonRow = document.createElement("div");
  buttonRow.className = "ps-auth-buttons";
  trigger.insertAdjacentElement("beforebegin", buttonRow);
  buttonRow.append(login, trigger);
  // The marketing page had no visible way into the product itself: the only
  // entry points were "Create account"/"Log in" and the avatar menu. Give
  // everyone a first-class Dashboard link in the same slot — signed-out
  // visitors are asked to sign in by the dashboard itself. Omitted only on
  // the dashboard, where it would link to the current page.
  const dashboard = document.createElement("a");
  dashboard.className = "small-btn";
  dashboard.href = "/dashboard.html";
  dashboard.textContent = "Dashboard";
  if (!location.pathname.includes("dashboard")) buttonRow.append(dashboard);
  // A full email address plus a permanent "Sign out" button spent the most
  // prominent slot in the header on the two things a signed-in user needs
  // least often. Collapsed into an initials avatar that opens a menu; the
  // address and sign-out live inside it.
  const account = document.createElement("div");
  account.className = "ps-account";
  account.innerHTML = `
    <button class="ps-avatar-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu">
      <span class="ps-avatar" aria-hidden="true"></span>
    </button>
    <div class="ps-account-menu" role="menu" hidden>
      <div class="ps-account-menu-head">
        <span class="ps-avatar ps-avatar-lg" aria-hidden="true"></span>
        <span class="ps-account-email"></span>
      </div>
      <button class="ps-signout" type="button" role="menuitem">Sign out</button>
    </div>`;
  outerParent.append(account);

  const avatarButton = account.querySelector<HTMLButtonElement>(".ps-avatar-btn")!;
  const menu = account.querySelector<HTMLElement>(".ps-account-menu")!;
  const setMenuOpen = (open: boolean): void => {
    menu.hidden = !open;
    avatarButton.setAttribute("aria-expanded", String(open));
  };
  avatarButton.addEventListener("click", (event) => { event.stopPropagation(); setMenuOpen(menu.hidden); });
  document.addEventListener("click", (event) => { if (!account.contains(event.target as Node)) setMenuOpen(false); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !menu.hidden) { setMenuOpen(false); avatarButton.focus(); } });
  account.querySelector(".ps-signout")?.addEventListener("click", () => setMenuOpen(false));

  return {
    trigger, login, account,
    email: account.querySelector<HTMLSpanElement>(".ps-account-email")!,
    signout: account.querySelector<HTMLButtonElement>(".ps-signout")!,
    avatars: Array.from(account.querySelectorAll<HTMLElement>(".ps-avatar")),
    closeMenu: () => setMenuOpen(false)
  };
}

// "m.rossi@acme.com" -> "MR", "canadesino91@gmail.com" -> "C". Derived from the
// address because the dashboard never receives the first/last name fields.
function initialsFor(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._\-+]/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]).join("");
  return (letters || local[0] || "?").toUpperCase();
}

function installDialog(): {
  backdrop: HTMLDivElement; form: HTMLFormElement; title: HTMLElement; description: HTMLElement; submit: HTMLButtonElement;
  firstName: HTMLInputElement; lastName: HTMLInputElement; dateOfBirth: HTMLInputElement; registerFields: HTMLElement;
  email: HTMLInputElement; password: HTMLInputElement; passwordField: HTMLLabelElement;
  confirmPassword: HTMLInputElement; confirmPasswordField: HTMLLabelElement;
  message: HTMLElement; switcher: HTMLButtonElement; legal: HTMLElement;
  resendRow: HTMLElement; resend: HTMLButtonElement; forgot: HTMLButtonElement;
  rememberRow: HTMLElement; remember: HTMLInputElement;
} {
  const backdrop = document.createElement("div");
  backdrop.className = "ps-auth-backdrop";
  backdrop.innerHTML = `<section class="ps-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="ps-auth-title">
    <button class="ps-auth-close" type="button" aria-label="Close account dialog">×</button>
    <h2 id="ps-auth-title">Create your account</h2><p id="ps-auth-description">Start your 7-day free trial. Your prompt is checked to power the scan and never stored or logged.</p>
    <form>
    <div id="ps-auth-register-fields">
      <label class="ps-auth-field">First name<input id="ps-auth-first-name" type="text" autocomplete="given-name"></label>
      <label class="ps-auth-field">Last name<input id="ps-auth-last-name" type="text" autocomplete="family-name"></label>
      <label class="ps-auth-field">Date of birth<input id="ps-auth-dob" type="date" autocomplete="bday"></label>
    </div>
    <label class="ps-auth-field">Email<input id="ps-auth-email" name="email" type="email" autocomplete="username" required></label>
    <!-- Explicit for=: a label's implicit target is its first labelable
         descendant, which here was the "Forgot password?" button, leaving the
         password input with no accessible name at all. -->
    <label class="ps-auth-field" id="ps-auth-password-field" for="ps-auth-password">
      <div class="ps-auth-field-head">Password<button type="button" class="ps-auth-forgot" id="ps-auth-forgot" hidden>Forgot password?</button></div>
      <div class="ps-auth-pw-wrap"><input id="ps-auth-password" name="password" type="password" autocomplete="new-password" minlength="12" required><button type="button" class="ps-auth-toggle-pw" data-for="ps-auth-password">Show</button></div>
    </label>
    <label class="ps-auth-field" id="ps-auth-confirm-password-field">Confirm password
      <div class="ps-auth-pw-wrap"><input id="ps-auth-confirm-password" name="confirm-password" type="password" autocomplete="new-password" minlength="12"><button type="button" class="ps-auth-toggle-pw" data-for="ps-auth-confirm-password">Show</button></div>
    </label>
    <label class="ps-auth-remember" id="ps-auth-remember-row" hidden><input type="checkbox" id="ps-auth-remember" checked> Remember me on this device</label>
    <button class="ps-auth-submit" type="submit">Create account</button></form>
    <p class="ps-auth-message" role="status"></p><p class="ps-auth-switch"><button class="ps-auth-link" type="button">Already have an account? Sign in</button></p>
    <p class="ps-auth-switch" id="ps-auth-resend-row" hidden><button class="ps-auth-link" type="button" id="ps-auth-resend">Resend confirmation email</button></p>
    <p class="ps-auth-legal" id="ps-auth-legal">By creating an account you agree to our <a href="/terms.html" target="_blank" rel="noopener">Terms</a> and <a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</p></section>`;
  document.body.append(backdrop);
  return {
    backdrop, form: backdrop.querySelector("form")!, title: backdrop.querySelector("#ps-auth-title")!, description: backdrop.querySelector("#ps-auth-description")!,
    submit: backdrop.querySelector(".ps-auth-submit")!, registerFields: backdrop.querySelector("#ps-auth-register-fields")!,
    firstName: backdrop.querySelector("#ps-auth-first-name")!, lastName: backdrop.querySelector("#ps-auth-last-name")!, dateOfBirth: backdrop.querySelector("#ps-auth-dob")!,
    email: backdrop.querySelector("#ps-auth-email")!, password: backdrop.querySelector("#ps-auth-password")!,
    passwordField: backdrop.querySelector("#ps-auth-password-field")!,
    confirmPassword: backdrop.querySelector("#ps-auth-confirm-password")!, confirmPasswordField: backdrop.querySelector("#ps-auth-confirm-password-field")!,
    message: backdrop.querySelector(".ps-auth-message")!, switcher: backdrop.querySelector(".ps-auth-link")!,
    legal: backdrop.querySelector("#ps-auth-legal")!,
    resendRow: backdrop.querySelector("#ps-auth-resend-row")!, resend: backdrop.querySelector("#ps-auth-resend")!,
    forgot: backdrop.querySelector("#ps-auth-forgot")!,
    rememberRow: backdrop.querySelector("#ps-auth-remember-row")!, remember: backdrop.querySelector("#ps-auth-remember")!
  };
}

function installStylesheet(): void {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "auth.css";
  document.head.append(stylesheet);
}

async function loadConfig(): Promise<AuthConfig> {
  const response = await fetch(`${apiBase}/api/auth-config`, { cache: "no-store" });
  if (!response.ok) return { configured: false };
  return response.json() as Promise<AuthConfig>;
}

async function loadSession(): Promise<string | null> {
  if (isTauri()) {
    // A transient network failure here (e.g. a CORS/connectivity hiccup
    // during token refresh) must not throw past this point -- an uncaught
    // rejection here would stop the rest of boot() from running, including
    // wiring up the login dialog's own event listeners.
    try {
      const token = await desktopAccessToken();
      return token ? (await readDesktopSession())?.email ?? null : null;
    } catch { return (await readDesktopSession())?.email ?? null; }
  }
  try {
    const response = await fetch(`${apiBase}/api/auth/session`, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json() as { email?: string | null };
    return payload.email ?? null;
  } catch { return null; }
}

// Always point confirmation/reset emails at the web app, never at
// location.origin -- on desktop that's the Tauri window's own internal
// origin (tauri://localhost or similar), which an email client can't open
// and Supabase's redirect allowlist can't match against an http(s) URL.
function authRedirect(): string { return `${webAppUrl}/`; }

// Scanning is gated on an active trial or subscription, not just being signed
// in -- checked server-side too (the real enforcement point is whatever calls
// the paid API), but the UI needs to know this to avoid teasing a scan the
// account isn't entitled to run.
// The dashboard renders the plan/trial state in its sidebar. Rather than have
// it issue its own /api/account request (and race this one), the single
// response already fetched here is published as an event.
export type SyncedSettings = { detectPersonal?: boolean; detectCredentials?: boolean; detectFinancial?: boolean; scanMode?: "standard" | "strict"; customTerms?: string[] };
export type AccountState = { active: boolean; status: string | null; currentPeriodEnd: string | null; plan: string | null; settings?: SyncedSettings | null };
function publishAccountState(state: AccountState | null): void {
  document.dispatchEvent(new CustomEvent("promptshield:account", { detail: state }));
}

async function refreshEntitlement(): Promise<void> {
  if (!currentEmail) { accountActive = false; publishAccountState(null); return; }
  try {
    const headers: Record<string, string> = {};
    if (isTauri()) {
      const token = await desktopAccessToken();
      if (!token) { accountActive = false; publishAccountState(null); return; }
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${apiBase}/api/account`, { headers, cache: "no-store" });
    if (!response.ok) { accountActive = false; publishAccountState(null); return; }
    const payload = await response.json() as { active?: boolean; status?: string | null; currentPeriodEnd?: string | null; plan?: string | null; settings?: SyncedSettings | null };
    accountActive = Boolean(payload.active);
    publishAccountState({
      active: accountActive,
      status: payload.status ?? null,
      currentPeriodEnd: payload.currentPeriodEnd ?? null,
      plan: payload.plan ?? null,
      settings: payload.settings ?? null
    });
  } catch { accountActive = false; publishAccountState(null); }
}

async function boot(): Promise<void> {
  installStylesheet();
  const desktop = isTauri();
  const controls = accountControls();
  const dialog = installDialog();

  config = await loadConfig().catch(() => ({ configured: false }));
  currentEmail = await loadSession();
  await refreshEntitlement();
  window.addEventListener("focus", () => { void refreshEntitlement(); });
  const show = (): void => { dialog.backdrop.classList.add("open"); dialog.email.focus(); };
  const close = (): void => dialog.backdrop.classList.remove("open");
  const setMessage = (message: string, error = false): void => { dialog.message.textContent = message; dialog.message.classList.toggle("error", error); };
  const setMode = (nextMode: typeof mode): void => {
    mode = nextMode; setMessage("");
    const signup = mode === "signup"; const recovery = mode === "recovery";
    dialog.title.textContent = signup ? "Create your account" : recovery ? "Reset your password" : "Welcome back";
    dialog.description.textContent = signup ? "Use a password with at least 12 characters. We will send a verification email." : recovery ? "We will email you a secure link to choose a new password." : "Sign in to continue with your private workspace.";
    dialog.registerFields.hidden = !signup;
    dialog.firstName.required = signup; dialog.lastName.required = signup; dialog.dateOfBirth.required = signup;
    dialog.passwordField.hidden = recovery; dialog.password.required = !recovery; dialog.password.autocomplete = signup ? "new-password" : "current-password";
    dialog.confirmPasswordField.hidden = !signup; dialog.confirmPassword.required = signup; dialog.confirmPassword.value = "";
    dialog.legal.hidden = !signup;
    dialog.rememberRow.hidden = mode !== "signin";
    dialog.resendRow.hidden = !signup;
    if (signup) resendCooldownTicker();
    dialog.forgot.hidden = mode !== "signin";
    dialog.submit.textContent = signup ? "Create account" : recovery ? "Send reset link" : "Sign in";
    dialog.switcher.textContent = signup ? "Already have an account? Sign in" : recovery ? "Back to sign in" : "New here? Create an account";
  };
  const renderAccount = (email: string | null): void => {
    currentEmail = email;
    controls.account.classList.toggle("open", Boolean(email)); controls.trigger.hidden = Boolean(email); controls.login.hidden = Boolean(email);
    controls.email.textContent = email ?? "";
    controls.avatars.forEach((avatar) => { avatar.textContent = email ? initialsFor(email) : ""; });
    if (!email) { controls.closeMenu(); publishAccountState(null); }
  };
  renderAccount(currentEmail);

  // Team invite links (?invite=TOKEN) point at a teammate who may not have an
  // account yet -- the token is parked in localStorage so it survives the
  // signup -> email confirmation -> redirect round trip, then consumed the
  // moment we know who's signed in. Defined before the confirmation-hash
  // handling below so that flow can also trigger it on first sign-in.
  const pendingInviteKey = "promptshield.pending-invite.v1";
  const acceptPendingInvite = async (): Promise<void> => {
    if (desktop) return;
    const token = localStorage.getItem(pendingInviteKey);
    if (!token || !currentEmail) return;
    localStorage.removeItem(pendingInviteKey);
    try {
      await apiRequest("/api/team?action=accept", { token });
      await refreshEntitlement();
      setMode("signin");
      setMessage("You've joined the team.");
      show();
      window.setTimeout(close, 2500);
    } catch (error) {
      setMode("signin");
      setMessage(error instanceof Error ? error.message : "We could not accept that invite.", true);
      show();
    }
  };

  // Supabase's email-confirmation and password-reset links redirect back here
  // with the session tokens (or an error) in the URL fragment -- nothing was
  // reading it, so users landed on the homepage with no feedback and had to
  // sign in manually even though confirmation had already succeeded.
  if (!desktop && location.hash.includes("access_token")) {
    const hashParams = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, "", location.pathname + location.search);
    const hashAccessToken = hashParams.get("access_token");
    const hashRefreshToken = hashParams.get("refresh_token");
    if (hashAccessToken && hashRefreshToken) {
      try {
        const payload = await apiRequest("/api/auth/callback", {
          access_token: hashAccessToken, refresh_token: hashRefreshToken, expires_in: Number(hashParams.get("expires_in")) || 3600
        }) as { email?: string };
        if (payload.email) {
          currentEmail = payload.email;
          renderAccount(payload.email);
          await refreshEntitlement();
          if (localStorage.getItem(pendingInviteKey)) {
            await acceptPendingInvite();
          } else {
            setMode("signin");
            setMessage("Email confirmed — you're signed in.");
            show();
            window.setTimeout(close, 2500);
          }
        }
      } catch { /* falls through with no session; user can sign in normally */ }
    }
  } else if (!desktop && location.hash.includes("error")) {
    const hashParams = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, "", location.pathname + location.search);
    // Signup mode, not signin: this is almost always an expired confirmation
    // link, and resend now lives on the signup screen, not the login one.
    setMode("signup");
    setMessage(hashParams.get("error_description")?.replace(/\+/g, " ") || "That link is invalid or has expired. Enter your email below and resend a confirmation, or sign in if you're already confirmed.", true);
    show();
  }

  if (!desktop) {
    const inviteToken = new URLSearchParams(location.search).get("invite");
    if (inviteToken) {
      localStorage.setItem(pendingInviteKey, inviteToken);
      history.replaceState(null, "", location.pathname + location.hash);
      if (currentEmail) await acceptPendingInvite();
      else { setMode("signup"); setMessage("Create your account to join the team."); show(); }
    }

    // Lets external entry points (the browser extension popup, which has no
    // room for its own signup/recovery forms) deep-link straight into the
    // right mode instead of dumping the user on a plain sign-in screen.
    const authParam = new URLSearchParams(location.search).get("auth");
    if (authParam === "signup" || authParam === "recovery") {
      const url = new URL(location.href);
      url.searchParams.delete("auth");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
      if (!currentEmail) { setMode(authParam); show(); }
    }
  }

  window.promptShieldAuth = {
    hasAccess: () => Boolean(currentEmail) && accountActive,
    requestAccess: (message) => {
      if (!currentEmail) {
        setMode("signup");
        setMessage(message ?? "Create your account to start your 7-day free trial.");
        show();
        return;
      }
      // Already signed in but no active trial/subscription: point at pricing
      // instead of re-showing a login form the user doesn't need.
      document.dispatchEvent(new CustomEvent("promptshield:need-upgrade", { detail: { message } }));
    },
    scanPrompt: async (text, options) => {
      // Audit metadata only: which surface asked. Grants nothing server-side.
      const application = "__TAURI_INTERNALS__" in window ? "desktop" : "web";
      const payload = await apiRequest("/api/scan", { text, application, options: options ?? {} }) as { findings?: Finding[]; redactedText?: string; decision?: ScanDecision };
      return { findings: payload.findings ?? [], redactedText: payload.redactedText ?? "", decision: payload.decision };
    },
    request: (path, body, method) => apiRequest(path, body, method)
  };
  controls.trigger.addEventListener("click", (event) => { event.preventDefault(); if (!config?.configured) { setMessage("Account setup is being completed. Please try again shortly.", true); } setMode("signup"); show(); });
  controls.login.addEventListener("click", (event) => { event.preventDefault(); if (!config?.configured) { setMessage("Account setup is being completed. Please try again shortly.", true); } setMode("signin"); show(); });

  const beginCheckout = async (button: HTMLElement): Promise<void> => {
    if (!currentEmail) {
      setMode("signup");
      setMessage("Create your account first to start a secure trial.");
      show();
      return;
    }
    const plan = button.dataset.plan;
    const interval = button.dataset.interval;
    const seats = plan === "business" ? Number(document.querySelector<HTMLSelectElement>("#business-seats")?.value ?? 1) : 1;
    button.setAttribute("aria-busy", "true");
    (button as HTMLButtonElement).disabled = true;
    try {
      const payload = await apiRequest("/api/billing", { plan, interval, seats }) as { url?: string };
      if (!payload.url) throw new Error("Checkout could not be opened.");
      if (desktop) void openInSystemBrowser(payload.url); else location.assign(payload.url);
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") { renderAccount(null); void clearDesktopSession(); setMode("signin"); setMessage("Please sign in again to continue."); show(); }
      else { setMessage(error instanceof Error ? error.message : "Checkout could not be opened.", true); show(); }
    } finally {
      button.removeAttribute("aria-busy");
      (button as HTMLButtonElement).disabled = false;
    }
  };
  document.querySelectorAll<HTMLElement>("[data-plan]").forEach((button) => button.addEventListener("click", () => void beginCheckout(button)));
  document.querySelector<HTMLButtonElement>("#manage-billing")?.addEventListener("click", async () => {
    if (!currentEmail) { setMode("signin"); setMessage("Sign in to manage your subscription."); show(); return; }
    try {
      const payload = await apiRequest("/api/billing?action=portal") as { url?: string };
      if (!payload.url) throw new Error("Billing management is unavailable.");
      if (desktop) void openInSystemBrowser(payload.url); else location.assign(payload.url);
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") { renderAccount(null); void clearDesktopSession(); setMode("signin"); setMessage("Please sign in again to continue."); show(); }
      else { setMessage(error instanceof Error ? error.message : "Billing management is unavailable.", true); show(); }
    }
  });
  dialog.backdrop.querySelector(".ps-auth-close")?.addEventListener("click", close);
  dialog.backdrop.addEventListener("click", (event) => { if (event.target === dialog.backdrop) close(); });
  controls.signout.addEventListener("click", () => {
    accountActive = false;
    if (desktop) {
      const session = cachedDesktopSession();
      void clearDesktopSession();
      renderAccount(null);
      if (session) void fetch(`${apiBase}/api/auth/signout`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } }).catch(() => undefined);
    } else {
      void apiRequest("/api/auth/signout").catch(() => undefined).finally(() => renderAccount(null));
    }
  });
  dialog.switcher.addEventListener("click", () => setMode(mode === "recovery" ? "signin" : mode === "signup" ? "signin" : "signup"));
  dialog.forgot.addEventListener("click", () => setMode("recovery"));
  dialog.backdrop.addEventListener("click", (event) => {
    const toggle = (event.target as HTMLElement).closest<HTMLButtonElement>(".ps-auth-toggle-pw");
    if (!toggle?.dataset.for) return;
    const input = dialog.backdrop.querySelector<HTMLInputElement>(`#${toggle.dataset.for}`);
    if (!input) return;
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    toggle.textContent = showing ? "Show" : "Hide";
  });
  // One free manual resend right after the automatic signup email, then a
  // 600s cooldown per email before another is allowed -- tracked client-side
  // (the server also rate-limits independently as a backstop).
  const resendCooldownKey = "promptshield.resend-cooldown.v1";
  const resendCooldownSeconds = 600;
  const readResendCooldown = (): Record<string, number> => {
    try { return JSON.parse(localStorage.getItem(resendCooldownKey) ?? "{}") as Record<string, number>; } catch { return {}; }
  };
  const resendCooldownTicker = (): void => {
    const email = dialog.email.value.trim().toLowerCase();
    const availableAt = email ? readResendCooldown()[email] ?? 0 : 0;
    const remaining = Math.ceil((availableAt - Date.now()) / 1000);
    if (remaining > 0) {
      dialog.resend.disabled = true;
      dialog.resend.textContent = `Resend available in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
      window.setTimeout(resendCooldownTicker, 1000);
    } else {
      dialog.resend.disabled = false;
      dialog.resend.textContent = "Resend confirmation email";
    }
  };
  dialog.resend.addEventListener("click", async () => {
    const email = dialog.email.value.trim();
    if (!email) { setMessage("Enter your email address first.", true); dialog.email.focus(); return; }
    const cooldowns = readResendCooldown();
    const key = email.toLowerCase();
    if ((cooldowns[key] ?? 0) > Date.now()) { resendCooldownTicker(); return; }
    dialog.resend.disabled = true;
    dialog.resend.textContent = "Sending…";
    try {
      await apiRequest("/api/auth/signup", { email, resend: true, emailRedirectTo: authRedirect() });
      setMessage("If that account exists and isn't confirmed yet, a new confirmation email is on its way.");
    } catch {
      setMessage("We could not resend that email. Please try again shortly.", true);
    } finally {
      cooldowns[key] = Date.now() + resendCooldownSeconds * 1000;
      localStorage.setItem(resendCooldownKey, JSON.stringify(cooldowns));
      resendCooldownTicker();
    }
  });
  dialog.form.addEventListener("submit", async (event) => {
    event.preventDefault(); if (!config?.configured) { setMessage("Account setup is not configured yet.", true); return; }
    const restingLabel = dialog.submit.textContent;
    dialog.submit.disabled = true; setMessage("");
    try {
      if (mode === "signup") {
        if (dialog.password.value !== dialog.confirmPassword.value) { setMessage("Passwords do not match.", true); dialog.submit.disabled = false; return; }
        dialog.submit.textContent = "Creating account…";
        await apiRequest("/api/auth/signup", {
          email: dialog.email.value.trim(), password: dialog.password.value, emailRedirectTo: authRedirect(),
          firstName: dialog.firstName.value.trim(), lastName: dialog.lastName.value.trim(), dateOfBirth: dialog.dateOfBirth.value
        });
        // Stays in signup mode (not switched to signin) so the resend
        // option -- which only makes sense right after registering -- is
        // right there instead of requiring a trip to the login screen.
        setMessage("Account created. Check your email for a confirmation link, then sign in here.");
        resendCooldownTicker();
      } else if (mode === "signin") {
        dialog.submit.textContent = "Signing in…";
        const payload = await apiRequest("/api/auth/signin", { email: dialog.email.value.trim(), password: dialog.password.value, remember: dialog.remember.checked }) as
          { email?: string; access_token?: string; refresh_token?: string; expires_in?: number };
        const email = payload.email ?? dialog.email.value.trim();
        if (desktop && payload.access_token && payload.refresh_token) {
          await saveDesktopSession({ email, access_token: payload.access_token, refresh_token: payload.refresh_token, expires_at: Date.now() + (payload.expires_in ?? 3600) * 1000 });
        }
        renderAccount(email); await refreshEntitlement();
        if (localStorage.getItem(pendingInviteKey)) { await acceptPendingInvite(); }
        else { setMessage("Signed in successfully."); window.setTimeout(close, 700); }
      } else {
        dialog.submit.textContent = "Sending link…";
        await apiRequest("/api/auth/recover", { email: dialog.email.value.trim(), redirect_to: authRedirect() });
        dialog.submit.textContent = restingLabel;
        setMessage("If that account exists, a password-reset link is on its way.");
      }
    } catch (error) {
      dialog.submit.textContent = restingLabel;
      setMessage(error instanceof Error ? error.message : "We could not complete that request.", true);
    }
    finally { dialog.submit.disabled = false; }
  });
}

if (typeof document !== "undefined") void boot();
