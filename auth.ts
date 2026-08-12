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
const desktopSessionKey = "promptshield.desktop.session.v1";
const apiBase = isTauri() ? webAppUrl : "";

let config: AuthConfig | null = null;
let mode: "signup" | "signin" | "recovery" = "signup";
let currentEmail: string | null = null;
let accountActive = false;

type ScanRequestOptions = { includePersonalData?: boolean; includeCredentials?: boolean; includeFinancialData?: boolean; customTerms?: string[] };

declare global {
  interface Window {
    promptShieldAuth?: {
      hasAccess(): boolean;
      requestAccess(message?: string): void;
      scanPrompt(text: string, options?: ScanRequestOptions): Promise<{ findings: Finding[]; redactedText: string }>;
    };
  }
}

function readDesktopSession(): DesktopSession | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(desktopSessionKey) ?? "null");
    return value && typeof value === "object" ? value as DesktopSession : null;
  } catch { return null; }
}
function saveDesktopSession(session: DesktopSession): void { localStorage.setItem(desktopSessionKey, JSON.stringify(session)); }
function clearDesktopSession(): void { localStorage.removeItem(desktopSessionKey); }

// Returns a Bearer token good for at least 30 more seconds, transparently
// refreshing (and re-persisting) it first if the stored one is stale or absent.
async function desktopAccessToken(): Promise<string | null> {
  const session = readDesktopSession();
  if (!session) return null;
  if (session.expires_at > Date.now() + 30_000) return session.access_token;
  const response = await fetch(`${apiBase}/api/auth/session`, {
    headers: { Authorization: `Bearer ${session.access_token}`, "X-Refresh-Token": session.refresh_token }
  });
  const payload = await response.json().catch(() => ({})) as { email?: string | null; access_token?: string; refresh_token?: string; expires_in?: number };
  if (!payload.email || !payload.access_token || !payload.refresh_token) { clearDesktopSession(); return null; }
  saveDesktopSession({ email: payload.email, access_token: payload.access_token, refresh_token: payload.refresh_token, expires_at: Date.now() + (payload.expires_in ?? 3600) * 1000 });
  return payload.access_token;
}

async function apiRequest(path: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (isTauri()) {
    const token = await desktopAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${apiBase}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && "error" in payload ? String((payload as { error?: unknown }).error) : "We could not complete that request.";
    throw new Error(message);
  }
  return payload as Record<string, unknown>;
}

function accountControls(): { trigger: HTMLAnchorElement; account: HTMLDivElement; email: HTMLSpanElement; signout: HTMLButtonElement } {
  const trigger = document.querySelector<HTMLAnchorElement>(".small-btn")!;
  trigger.href = "#account";
  trigger.textContent = "Create account";
  const account = document.createElement("div");
  account.className = "ps-account";
  account.innerHTML = '<span class="ps-account-email"></span><button class="ps-signout" type="button">Sign out</button>';
  trigger.parentElement?.append(account);
  return { trigger, account, email: account.querySelector<HTMLSpanElement>(".ps-account-email")!, signout: account.querySelector<HTMLButtonElement>(".ps-signout")! };
}

function installDialog(): {
  backdrop: HTMLDivElement; form: HTMLFormElement; title: HTMLElement; description: HTMLElement; submit: HTMLButtonElement;
  firstName: HTMLInputElement; lastName: HTMLInputElement; dateOfBirth: HTMLInputElement; registerFields: HTMLElement;
  email: HTMLInputElement; password: HTMLInputElement; passwordField: HTMLLabelElement;
  confirmPassword: HTMLInputElement; confirmPasswordField: HTMLLabelElement;
  message: HTMLElement; switcher: HTMLButtonElement;
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
    <label class="ps-auth-field">Email<input id="ps-auth-email" type="email" autocomplete="email" required></label>
    <label class="ps-auth-field" id="ps-auth-password-field">Password<input id="ps-auth-password" type="password" autocomplete="new-password" minlength="12" required></label>
    <label class="ps-auth-field" id="ps-auth-confirm-password-field">Confirm password<input id="ps-auth-confirm-password" type="password" autocomplete="new-password" minlength="12"></label>
    <button class="ps-auth-submit" type="submit">Create account</button></form>
    <p class="ps-auth-message" role="status"></p><p class="ps-auth-switch"><button class="ps-auth-link" type="button">Already have an account? Sign in</button></p></section>`;
  document.body.append(backdrop);
  return {
    backdrop, form: backdrop.querySelector("form")!, title: backdrop.querySelector("#ps-auth-title")!, description: backdrop.querySelector("#ps-auth-description")!,
    submit: backdrop.querySelector(".ps-auth-submit")!, registerFields: backdrop.querySelector("#ps-auth-register-fields")!,
    firstName: backdrop.querySelector("#ps-auth-first-name")!, lastName: backdrop.querySelector("#ps-auth-last-name")!, dateOfBirth: backdrop.querySelector("#ps-auth-dob")!,
    email: backdrop.querySelector("#ps-auth-email")!, password: backdrop.querySelector("#ps-auth-password")!,
    passwordField: backdrop.querySelector("#ps-auth-password-field")!,
    confirmPassword: backdrop.querySelector("#ps-auth-confirm-password")!, confirmPasswordField: backdrop.querySelector("#ps-auth-confirm-password-field")!,
    message: backdrop.querySelector(".ps-auth-message")!, switcher: backdrop.querySelector(".ps-auth-link")!
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
    const token = await desktopAccessToken();
    return token ? readDesktopSession()?.email ?? null : null;
  }
  try {
    const response = await fetch(`${apiBase}/api/auth/session`, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json() as { email?: string | null };
    return payload.email ?? null;
  } catch { return null; }
}

function authRedirect(): string { return `${location.origin}/`; }

// Scanning is gated on an active trial or subscription, not just being signed
// in -- checked server-side too (the real enforcement point is whatever calls
// the paid API), but the UI needs to know this to avoid teasing a scan the
// account isn't entitled to run.
async function refreshEntitlement(): Promise<void> {
  if (!currentEmail) { accountActive = false; return; }
  try {
    const headers: Record<string, string> = {};
    if (isTauri()) {
      const token = await desktopAccessToken();
      if (!token) { accountActive = false; return; }
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${apiBase}/api/account`, { headers, cache: "no-store" });
    if (!response.ok) { accountActive = false; return; }
    const payload = await response.json() as { active?: boolean };
    accountActive = Boolean(payload.active);
  } catch { accountActive = false; }
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
    dialog.submit.textContent = signup ? "Create account" : recovery ? "Send reset link" : "Sign in";
    dialog.switcher.textContent = signup ? "Already have an account? Sign in" : recovery ? "Back to sign in" : "Need a password reset?";
  };
  const renderAccount = (email: string | null): void => {
    currentEmail = email;
    controls.account.classList.toggle("open", Boolean(email)); controls.trigger.hidden = Boolean(email);
    controls.email.textContent = email ?? "";
  };
  renderAccount(currentEmail);
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
      const payload = await apiRequest("/api/scan", { text, options: options ?? {} }) as { findings?: Finding[]; redactedText?: string };
      return { findings: payload.findings ?? [], redactedText: payload.redactedText ?? "" };
    }
  };
  controls.trigger.addEventListener("click", (event) => { event.preventDefault(); if (!config?.configured) { setMessage("Account setup is being completed. Please try again shortly.", true); } setMode("signup"); show(); });

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
      const payload = await apiRequest("/api/checkout", { plan, interval, seats }) as { url?: string };
      if (!payload.url) throw new Error("Checkout could not be opened.");
      if (desktop) void openInSystemBrowser(payload.url); else location.assign(payload.url);
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") { renderAccount(null); clearDesktopSession(); setMode("signin"); setMessage("Please sign in again to continue."); show(); }
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
      const payload = await apiRequest("/api/portal") as { url?: string };
      if (!payload.url) throw new Error("Billing management is unavailable.");
      if (desktop) void openInSystemBrowser(payload.url); else location.assign(payload.url);
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") { renderAccount(null); clearDesktopSession(); setMode("signin"); setMessage("Please sign in again to continue."); show(); }
      else { setMessage(error instanceof Error ? error.message : "Billing management is unavailable.", true); show(); }
    }
  });
  dialog.backdrop.querySelector(".ps-auth-close")?.addEventListener("click", close);
  dialog.backdrop.addEventListener("click", (event) => { if (event.target === dialog.backdrop) close(); });
  controls.signout.addEventListener("click", () => {
    accountActive = false;
    if (desktop) {
      const session = readDesktopSession();
      clearDesktopSession();
      renderAccount(null);
      if (session) void fetch(`${apiBase}/api/auth/signout`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } }).catch(() => undefined);
    } else {
      void apiRequest("/api/auth/signout").catch(() => undefined).finally(() => renderAccount(null));
    }
  });
  dialog.switcher.addEventListener("click", () => setMode(mode === "signup" ? "signin" : mode === "signin" ? "recovery" : "signin"));
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
        // setMode() resets the status message, so it must run before the
        // "check your email" message is set -- not after, or the message is
        // wiped the instant it appears and the user never sees it.
        setMode("signin");
        setMessage("Account created. Check your email for a confirmation link, then sign in here.");
      } else if (mode === "signin") {
        dialog.submit.textContent = "Signing in…";
        const payload = await apiRequest("/api/auth/signin", { email: dialog.email.value.trim(), password: dialog.password.value }) as
          { email?: string; access_token?: string; refresh_token?: string; expires_in?: number };
        const email = payload.email ?? dialog.email.value.trim();
        if (desktop && payload.access_token && payload.refresh_token) {
          saveDesktopSession({ email, access_token: payload.access_token, refresh_token: payload.refresh_token, expires_at: Date.now() + (payload.expires_in ?? 3600) * 1000 });
        }
        renderAccount(email); await refreshEntitlement(); setMessage("Signed in successfully."); window.setTimeout(close, 700);
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
