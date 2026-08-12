import { isTauri, openInSystemBrowser } from "./desktop.js";

type AuthConfig = { configured: boolean };

// The desktop build has no server of its own; account creation and billing always
// happen on the hosted web app, opened in the user's system browser.
const webAppUrl = "https://promptshield-beta.vercel.app";

// Session tokens live only in httpOnly cookies set by the server (/api/auth/*). The
// browser never holds them, so an XSS bug in this page cannot steal a signed-in session.
let config: AuthConfig | null = null;
let mode: "signup" | "signin" | "recovery" = "signup";
let currentEmail: string | null = null;

async function apiRequest(path: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
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

function installDialog(): { backdrop: HTMLDivElement; form: HTMLFormElement; title: HTMLElement; description: HTMLElement; submit: HTMLButtonElement; email: HTMLInputElement; password: HTMLInputElement; passwordField: HTMLLabelElement; message: HTMLElement; switcher: HTMLButtonElement } {
  const backdrop = document.createElement("div");
  backdrop.className = "ps-auth-backdrop";
  backdrop.innerHTML = `<section class="ps-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="ps-auth-title">
    <button class="ps-auth-close" type="button" aria-label="Close account dialog">×</button>
    <h2 id="ps-auth-title">Create your account</h2><p id="ps-auth-description">Start your 14-day free trial when PromptShield billing launches. Your prompt text stays local.</p>
    <form><label class="ps-auth-field">Email<input id="ps-auth-email" type="email" autocomplete="email" required></label>
    <label class="ps-auth-field" id="ps-auth-password-field">Password<input id="ps-auth-password" type="password" autocomplete="new-password" minlength="12" required></label>
    <button class="ps-auth-submit" type="submit">Create account</button></form>
    <p class="ps-auth-message" role="status"></p><p class="ps-auth-switch"><button class="ps-auth-link" type="button">Already have an account? Sign in</button></p></section>`;
  document.body.append(backdrop);
  return {
    backdrop, form: backdrop.querySelector("form")!, title: backdrop.querySelector("#ps-auth-title")!, description: backdrop.querySelector("#ps-auth-description")!,
    submit: backdrop.querySelector(".ps-auth-submit")!, email: backdrop.querySelector("#ps-auth-email")!, password: backdrop.querySelector("#ps-auth-password")!,
    passwordField: backdrop.querySelector("#ps-auth-password-field")!, message: backdrop.querySelector(".ps-auth-message")!, switcher: backdrop.querySelector(".ps-auth-link")!
  };
}

function installStylesheet(): void {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "auth.css";
  document.head.append(stylesheet);
}

async function loadConfig(): Promise<AuthConfig> {
  const response = await fetch("/api/auth-config", { cache: "no-store" });
  if (!response.ok) return { configured: false };
  return response.json() as Promise<AuthConfig>;
}

async function loadSession(): Promise<string | null> {
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json() as { email?: string | null };
    return payload.email ?? null;
  } catch { return null; }
}

function authRedirect(): string { return `${location.origin}/`; }

async function boot(): Promise<void> {
  installStylesheet();
  const controls = accountControls();

  if (isTauri()) {
    // No embedded login/checkout here: the desktop shell has no domain of its own to
    // hold a session cookie, so every account/billing action hands off to the hosted
    // web app in the user's regular browser instead.
    controls.trigger.textContent = "Manage account";
    const openWebApp = (event: Event): void => { event.preventDefault(); void openInSystemBrowser(webAppUrl); };
    controls.trigger.addEventListener("click", openWebApp);
    document.querySelectorAll<HTMLElement>("[data-plan]").forEach((button) => button.addEventListener("click", openWebApp));
    document.querySelector<HTMLButtonElement>("#manage-billing")?.addEventListener("click", openWebApp);
    return;
  }

  config = await loadConfig().catch(() => ({ configured: false }));
  currentEmail = await loadSession();
  const dialog = installDialog();
  const show = (): void => { dialog.backdrop.classList.add("open"); dialog.email.focus(); };
  const close = (): void => dialog.backdrop.classList.remove("open");
  const setMessage = (message: string, error = false): void => { dialog.message.textContent = message; dialog.message.classList.toggle("error", error); };
  const setMode = (nextMode: typeof mode): void => {
    mode = nextMode; setMessage("");
    const signup = mode === "signup"; const recovery = mode === "recovery";
    dialog.title.textContent = signup ? "Create your account" : recovery ? "Reset your password" : "Welcome back";
    dialog.description.textContent = signup ? "Use a password with at least 12 characters. We will send a verification email." : recovery ? "We will email you a secure link to choose a new password." : "Sign in to continue with your private workspace.";
    dialog.passwordField.hidden = recovery; dialog.password.required = !recovery; dialog.password.autocomplete = signup ? "new-password" : "current-password";
    dialog.submit.textContent = signup ? "Create account" : recovery ? "Send reset link" : "Sign in";
    dialog.switcher.textContent = signup ? "Already have an account? Sign in" : recovery ? "Back to sign in" : "Need a password reset?";
  };
  const renderAccount = (email: string | null): void => {
    currentEmail = email;
    controls.account.classList.toggle("open", Boolean(email)); controls.trigger.hidden = Boolean(email);
    controls.email.textContent = email ?? "";
  };
  renderAccount(currentEmail);
  controls.trigger.addEventListener("click", (event) => { event.preventDefault(); if (!config?.configured) { setMessage("Account setup is being completed. Please try again shortly.", true); } show(); });
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
      location.assign(payload.url);
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") { renderAccount(null); setMode("signin"); setMessage("Please sign in again to continue."); show(); }
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
      location.assign(payload.url);
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") { renderAccount(null); setMode("signin"); setMessage("Please sign in again to continue."); show(); }
      else { setMessage(error instanceof Error ? error.message : "Billing management is unavailable.", true); show(); }
    }
  });
  dialog.backdrop.querySelector(".ps-auth-close")?.addEventListener("click", close);
  dialog.backdrop.addEventListener("click", (event) => { if (event.target === dialog.backdrop) close(); });
  controls.signout.addEventListener("click", () => {
    void apiRequest("/api/auth/signout").catch(() => undefined).finally(() => renderAccount(null));
  });
  dialog.switcher.addEventListener("click", () => setMode(mode === "signup" ? "signin" : mode === "signin" ? "recovery" : "signin"));
  dialog.form.addEventListener("submit", async (event) => {
    event.preventDefault(); if (!config?.configured) { setMessage("Account setup is not configured yet.", true); return; }
    dialog.submit.disabled = true; setMessage("");
    try {
      if (mode === "signup") {
        await apiRequest("/api/auth/signup", { email: dialog.email.value.trim(), password: dialog.password.value, emailRedirectTo: authRedirect() });
        setMessage("Check your email to confirm your account, then sign in."); setMode("signin");
      } else if (mode === "signin") {
        const payload = await apiRequest("/api/auth/signin", { email: dialog.email.value.trim(), password: dialog.password.value }) as { email?: string };
        renderAccount(payload.email ?? dialog.email.value.trim()); setMessage("Signed in successfully."); window.setTimeout(close, 700);
      } else {
        await apiRequest("/api/auth/recover", { email: dialog.email.value.trim(), redirect_to: authRedirect() });
        setMessage("If that account exists, a password-reset link is on its way.");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "We could not complete that request.", true); }
    finally { dialog.submit.disabled = false; }
  });
}

if (typeof document !== "undefined") void boot();
