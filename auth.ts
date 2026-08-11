type AuthConfig = { configured: boolean; url: string | null; publishableKey: string | null };
type Session = { access_token: string; refresh_token: string; expires_at?: number; user?: { email?: string } };

const sessionKey = "promptshield.auth.session.v1";
let config: AuthConfig | null = null;
let mode: "signup" | "signin" | "recovery" = "signup";

function apiUrl(path: string): string {
  if (!config?.url) throw new Error("Account setup is not available yet.");
  return `${config.url.replace(/\/$/, "")}/auth/v1${path}`;
}

function readSession(): Session | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(sessionKey) ?? "null");
    return value && typeof value === "object" ? value as Session : null;
  } catch { return null; }
}

function saveSession(session: Session): void { localStorage.setItem(sessionKey, JSON.stringify(session)); }
function clearSession(): void { localStorage.removeItem(sessionKey); }

async function authRequest(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!config?.publishableKey) throw new Error("Account setup is not available yet.");
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.publishableKey, Authorization: `Bearer ${config.publishableKey}` },
    body: JSON.stringify(body)
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && "msg" in payload ? String(payload.msg) : "We could not complete that request.";
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
  stylesheet.href = "/auth.css";
  document.head.append(stylesheet);
}

async function loadConfig(): Promise<AuthConfig> {
  const response = await fetch("/api/auth-config", { cache: "no-store" });
  if (!response.ok) return { configured: false, url: null, publishableKey: null };
  return response.json() as Promise<AuthConfig>;
}

function authRedirect(): string { return `${location.origin}/`; }

async function boot(): Promise<void> {
  installStylesheet();
  config = await loadConfig().catch(() => ({ configured: false, url: null, publishableKey: null }));
  const controls = accountControls();
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
  const renderAccount = (session: Session | null): void => {
    const email = session?.user?.email;
    controls.account.classList.toggle("open", Boolean(email)); controls.trigger.hidden = Boolean(email);
    controls.email.textContent = email ?? "";
  };
  renderAccount(readSession());
  controls.trigger.addEventListener("click", (event) => { event.preventDefault(); if (!config?.configured) { setMessage("Account setup is being completed. Please try again shortly.", true); } show(); });
  document.querySelectorAll<HTMLElement>("[data-plan]").forEach((button) => button.addEventListener("click", show));
  dialog.backdrop.querySelector(".ps-auth-close")?.addEventListener("click", close);
  dialog.backdrop.addEventListener("click", (event) => { if (event.target === dialog.backdrop) close(); });
  controls.signout.addEventListener("click", () => { clearSession(); renderAccount(null); });
  dialog.switcher.addEventListener("click", () => setMode(mode === "signup" ? "signin" : mode === "signin" ? "recovery" : "signin"));
  dialog.form.addEventListener("submit", async (event) => {
    event.preventDefault(); if (!config?.configured) { setMessage("Account setup is not configured yet.", true); return; }
    dialog.submit.disabled = true; setMessage("");
    try {
      if (mode === "signup") {
        await authRequest("/signup", { email: dialog.email.value.trim(), password: dialog.password.value, options: { emailRedirectTo: authRedirect() } });
        setMessage("Check your email to confirm your account, then sign in."); setMode("signin");
      } else if (mode === "signin") {
        const payload = await authRequest("/token?grant_type=password", { email: dialog.email.value.trim(), password: dialog.password.value });
        const session = payload as unknown as Session; saveSession(session); renderAccount(session); setMessage("Signed in successfully."); window.setTimeout(close, 700);
      } else {
        await authRequest("/recover", { email: dialog.email.value.trim(), redirect_to: authRedirect() });
        setMessage("If that account exists, a password-reset link is on its way.");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "We could not complete that request.", true); }
    finally { dialog.submit.disabled = false; }
  });
}

if (typeof document !== "undefined") void boot();
