import { isTauri, openInSystemBrowser, usesDesktopPreviewTransport } from "./desktop.js";
import { restoreTheme } from "./themes.js";
import { installDesktopTitlebar } from "./desktop.js";
import { track } from "./growth.js";
import type { Finding } from "./scanner.js";
import { RETURN_COPY, loadPrices, parseBilling, readStripeReturn, returnView, withoutStripeReturn, type BillingView } from "./trial.js";

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
const localDesktopPreview = usesDesktopPreviewTransport(isTauri(), location.origin);
const apiBase = localDesktopPreview ? '/api/desktop-preview' : isTauri() ? webAppUrl : "";
function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if(localDesktopPreview) headers.set('X-Redaxa-Desktop','1');
  return fetch(input,{...init,headers});
}

let config: AuthConfig | null = null;
let mode: "signup" | "signin" | "recovery" = "signup";
let currentEmail: string | null = null;
let accountActive = false;
let latestAccount: AccountState | null = null;
// Days of free trial the server offers right now, or null while it is off or unknown.
let trialDaysOffered: number | null = null;
if (typeof document !== "undefined") void loadPrices().then((prices) => { trialDaysOffered = prices?.trialEnabled ? prices.trialDays : null; });

type ScanRequestOptions = { includePersonalData?: boolean; includeCredentials?: boolean; includeFinancialData?: boolean; customTerms?: string[] };
// The policy layer's verdict, passed through untouched from /api/scan so every
// surface can show WHICH rule fired and WHY (indexes only — never values).
type ScanDecision = { action: "allow" | "warn" | "redact" | "block"; decidedBy: { ruleId: string; ruleName: string; reason: string; findingIndexes: number[] } | null };

declare global {
  interface Window {
    promptShieldAuth?: {
      hasAccess(): boolean;
      hasAccount(): boolean;
      requestAccess(message?: string): void;
      scanPrompt(text: string, options?: ScanRequestOptions): Promise<{ findings: Finding[]; redactedText: string; decision?: ScanDecision }>;
      request(path: string, body?: Record<string, unknown>, method?: "GET" | "POST"): Promise<Record<string, unknown>>;
      download(path: string): Promise<Blob>;
      /** The signed-in address, or null. */
      email(): string | null;
      /** What the Sign out button does: ends the session here and forgets it. */
      signOut(): Promise<void>;
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

// Recheck tokens near expiry; the server may confirm the existing token before
// it expires, or return a refreshed pair after expiry. `force` skips the local
// expiry check: the API refused a token this computer's clock still considers
// valid (a clock set back after sign-in, or a session revoked elsewhere), so
// the server decides instead of the clock.
async function desktopAccessToken(force = false): Promise<string | null> {
  const session = await readDesktopSession();
  if (!session) return null;
  if (!force && session.expires_at > Date.now() + 30_000) return session.access_token;
  const response = await authFetch(`${apiBase}/api/auth/session`, {
    headers: { Authorization: `Bearer ${session.access_token}`, "X-Refresh-Token": session.refresh_token },
    signal: AbortSignal.timeout(15_000)
  });
  // Temporary failures must not delete a customer's saved session.
  if (!response.ok && response.status !== 401 && response.status !== 403) throw new Error("Account service is temporarily unavailable. Please retry.");
  const payload = await response.json().catch(() => ({})) as { email?: string | null; access_token?: string; refresh_token?: string; expires_in?: number };
  if (response.status === 401 || response.status === 403 || payload.email === null) { await clearDesktopSession(); return null; }
  if (!payload.email) throw new Error("Account service returned an incomplete response. Please retry.");
  if (!payload.access_token && !payload.refresh_token) return session.access_token;
  if (!payload.access_token || !payload.refresh_token) throw new Error("Account service returned an incomplete session. Please retry.");
  await saveDesktopSession({ email: payload.email, access_token: payload.access_token, refresh_token: payload.refresh_token, expires_at: Date.now() + (payload.expires_in ?? 3600) * 1000 });
  return payload.access_token;
}

// Repository requests use the native session without exposing tokens to callers.
// The local engine independently verifies the subscription with the official API.
export async function repositoryRequest(body: Record<string, unknown>, signal: AbortSignal, scanId: string): Promise<Response> {
  if(nativeRepositoryEngine()) {
    const invoke=(window as any).__TAURI_INTERNALS__.invoke as (command:string,args?:Record<string,unknown>)=>Promise<unknown>;
    const abort=()=>{void invoke('repository_cancel').catch(()=>{});};
    signal.addEventListener('abort',abort,{once:true});
    try {
      const accessToken=body.demo===true?'':await desktopAccessToken();
      signal.throwIfAborted();
      const report=await invoke('repository_scan',{url:String(body.url??''),accessToken:accessToken??'',demo:body.demo===true,includeHistory:body.includeHistory===true});
      return Response.json(report);
    } catch(error) {
      const message=String(error);return Response.json({error:message.replace(/^PRO_REQUIRED:\s*/,''),...(message.includes('PRO_REQUIRED')?{code:'PRO_REQUIRED'}:{})},{status:message.includes('PRO_REQUIRED')?403:400});
    } finally {signal.removeEventListener('abort',abort);}
  }
  const headers: Record<string,string> = {'Content-Type':'application/json','X-Redaxa-Preview':'1','X-Redaxa-Scan':scanId};
  if(isTauri()) {const token=await desktopAccessToken();if(token)headers.Authorization=`Bearer ${token}`;}
  return fetch('/api/repository-scan',{method:'POST',headers,body:JSON.stringify(body),signal});
}

export function nativeRepositoryEngine():boolean {return isTauri()&&location.origin!=='http://127.0.0.1:4186';}
export async function repositoryProgress(scanId:string,signal:AbortSignal):Promise<Record<string,any>> {
  if(nativeRepositoryEngine())return (window as any).__TAURI_INTERNALS__.invoke('repository_progress');
  return fetch('/api/repository-progress',{headers:{'X-Redaxa-Preview':'1','X-Redaxa-Scan':scanId},signal}).then(r=>r.json());
}

/**
 * One authenticated request. In the desktop app a 401 gets one more try with a
 * token the server has just confirmed or refreshed: the saved expiry is measured
 * on this computer's clock, and a clock moved back after sign-in made a dead
 * token look alive, so the app signed people out although their session could
 * still be refreshed. A 401 means nothing was processed, so the retry is safe.
 */
async function authorizedFetch(path: string, init: RequestInit & { headers: Record<string, string> }): Promise<Response> {
  const token = isTauri() ? await desktopAccessToken() : null;
  if (token) init.headers.Authorization = `Bearer ${token}`;
  const response = await authFetch(`${apiBase}${path}`, init);
  if (response.status !== 401 || !token) return response;
  const fresh = await desktopAccessToken(true).catch(() => null);
  if (!fresh || fresh === token) return response;
  init.headers.Authorization = `Bearer ${fresh}`;
  return authFetch(`${apiBase}${path}`, init);
}

async function apiRequest(path: string, body?: Record<string, unknown>, method: "GET" | "POST" = "POST"): Promise<Record<string, unknown>> {
  const response = await authorizedFetch(path, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && "error" in payload ? String((payload as { error?: unknown }).error) : "We could not complete that request.";
    // The machine-readable reason, when the API gives one (e.g. trial_unavailable).
    const code = typeof payload === "object" && payload !== null && "code" in payload ? String((payload as { code?: unknown }).code) : undefined;
    const url = typeof payload === "object" && payload !== null && "url" in payload && typeof (payload as { url?: unknown }).url === "string" ? (payload as { url: string }).url : undefined;
    throw Object.assign(new Error(message), { code, ...(url?.startsWith("https://billing.stripe.com/") ? { url } : {}) });
  }
  return payload as Record<string, unknown>;
}

/**
 * Fetches a file rather than JSON, through the same authentication.
 *
 * A plain `<a download>` would work on the web, where the session is a cookie
 * the browser attaches by itself — and would silently produce a sign-in page
 * instead of a file in the desktop app, where the session is a bearer token
 * this code has to add. One path, so the export cannot work in one build and
 * quietly fail in the other.
 */
async function apiDownload(path: string): Promise<Blob> {
  const response = await authorizedFetch(path, { method: "GET", headers: {} });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => ({}));
    const message = typeof payload === "object" && payload !== null && "error" in payload ? String((payload as { error?: unknown }).error) : "We could not prepare that download.";
    throw new Error(message);
  }
  return response.blob();
}

function accountControls(): { trigger: HTMLAnchorElement; login: HTMLAnchorElement; account: HTMLDivElement; email: HTMLSpanElement; signout: HTMLButtonElement; avatars: HTMLElement[]; closeMenu: () => void } {
  const trigger = document.querySelector<HTMLAnchorElement>(".small-btn")!;
  const outerParent = trigger.parentElement!;
  trigger.href = "#account";
  trigger.textContent = L("Create account");
  // Previously "Create account" was the only visible entry point -- an
  // already-registered user had no obvious way in and had to click through
  // to the signup dialog just to find the small "Already have an account?"
  // link. Add a real, equally visible "Log in" control next to it, in its
  // own horizontal row so it doesn't stack under Create account on pages
  // whose layout is a vertical flex column (the dashboard's top-right).
  const login = document.createElement("a");
  login.className = "small-btn ghost";
  login.href = "#account";
  login.textContent = L("Log in");
  const buttonRow = document.createElement("div");
  buttonRow.className = "ps-auth-buttons";
  trigger.insertAdjacentElement("beforebegin", buttonRow);
  buttonRow.append(login, trigger);
  // The marketing page had no visible way into the product itself: the only
  // entry points were "Create account"/"Log in" and the avatar menu. Give
  // everyone a first-class Dashboard link in the same slot — signed-out
  // visitors are asked to sign in by the dashboard itself. Omitted inside the
  // workspace (dashboard and repository check), which has its own sidebar.
  const dashboard = document.createElement("a");
  dashboard.className = "small-btn";
  dashboard.href = "/dashboard.html";
  dashboard.textContent = L("Dashboard");
  // The desktop app serves the workspace as index.html, so test the page
  // itself rather than its path.
  if (!document.body.matches(".redaxa-workspace,.repository-page")) buttonRow.append(dashboard);
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
        <div class="ps-account-identity"><span class="ps-account-email"></span><span class="ps-account-plan">Checking your plan…</span></div>
      </div>
      <div class="ps-menu-group">
        <button class="ps-menu-link" type="button" role="menuitem" data-account-action="overview">Your account <span>Photo, plan & access</span></button>
        <button class="ps-menu-link" type="button" role="menuitem" data-account-action="photo">Profile photo</button>
        <button class="ps-menu-link" type="button" role="menuitem" data-account-action="subscription"><b data-sub-copy="menu">Manage subscription</b> <span data-sub-copy="menuNote">Plan, renewal and cancellation</span></button>
        <a class="ps-menu-link" role="menuitem" href="/dashboard.html#plans"><b data-sub-copy="menuPlans">Plans & pricing</b> <span data-sub-copy="menuPlansNote">Compare plans</span></a>
      </div>
      <div class="ps-menu-group">
        <a class="ps-menu-link" role="menuitem" href="/dashboard.html#preferences">Preferences <span>Language, appearance, privacy</span></a>
        <a class="ps-menu-link" role="menuitem" href="/dashboard.html#api-keys">Developer API keys <span>Manage Redaxa access keys</span></a>
        <a class="ps-menu-link" role="menuitem" href="/dashboard.html#workspace">Workspace &amp; team <span>Members, policies &amp; protected terms</span></a>
        <a class="ps-menu-link" role="menuitem" href="/dashboard.html#history">Recent checks <span>Local summaries</span></a>
        <button class="ps-menu-link" type="button" role="menuitem" data-account-action="password">Password & security <span>Request a reset link</span></button>
      </div>
      <div class="ps-menu-group">
        <button class="ps-menu-link" type="button" role="menuitem" data-account-action="support">Help & support</button>
        <button class="ps-menu-link" type="button" role="menuitem" data-account-action="privacy">Privacy policy</button>
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
  menu.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest('[role="menuitem"]')) setMenuOpen(false);
  });
  avatarButton.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setMenuOpen(true);
      const items = menu.querySelectorAll<HTMLElement>('[role="menuitem"]');
      (event.key === "ArrowUp" ? items[items.length - 1] : items[0])?.focus();
    }
  });
  menu.addEventListener("keydown", event => {
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  });
  account.addEventListener("focusout", event => {
    // Use the destination: activeElement can briefly be body between blur/focus.
    if (event.relatedTarget instanceof Node && !account.contains(event.relatedTarget)) setMenuOpen(false);
  });
  document.addEventListener("redaxa:account", event => {
    const state = (event as CustomEvent<AccountState | null>).detail;
    account.querySelector<HTMLElement>(".ps-account-plan")!.textContent = accountPlanLabel(state);
  });

  return {
    trigger, login, account,
    email: account.querySelector<HTMLSpanElement>(".ps-account-email")!,
    signout: account.querySelector<HTMLButtonElement>(".ps-signout")!,
    avatars: Array.from(account.querySelectorAll<HTMLElement>(".ps-avatar")),
    closeMenu: () => setMenuOpen(false)
  };
}

/* ---------- Manage subscription (account menu) ----------
 * The in-app panel behind "Manage subscription": what is active, when it
 * renews or ends, and stopping or resuming the renewal. GET/POST
 * /api/billing/subscription[/cancel|/resume] (api/_subscription.ts).
 * Cancelling never ends access early: the plan runs to the end of the period
 * already paid for. Card and invoices stay in Stripe's billing portal. */
type SubscriptionInfo = {
  plan: string | null; interval: "month" | "year" | null; amount: number | null; currency: string | null; seats: number | null;
  status: string; trial_end: string | null; current_period_end: string | null; cancel_at_period_end: boolean; cancel_at: string | null;
  payment_method: { brand: string; last4: string } | null; can_cancel: boolean; can_resume: boolean; member_of: string | null;
};
type SubLanguage = "en" | "it" | "es" | "fr" | "de";
// French copy keeps a narrow no-break space before ? ! : ; as French typography requires.
export const subscriptionCopyByLanguage: Record<SubLanguage, Record<string, string>> = {
  en: {
    menu: "Manage subscription", menuNote: "Plan, renewal and cancellation", menuPlans: "Plans & pricing", menuPlansNote: "Compare plans",
    title: "Manage subscription", intro: "Your Redaxa plan, its renewal and payment.", close: "Close",
    loading: "Loading your subscription…", offline: "You’re offline. Connect to the internet, then try again.", error: "We couldn’t load your subscription.", retry: "Try again",
    noneTitle: "No active subscription", noneText: "You’re on the free plan: 5 prompt checks a day on the web and in the Windows app.", memberText: "Your access comes from {owner}’s Business workspace. The workspace owner manages the subscription.", seePlans: "See plans",
    plan: "Plan", price: "Price", status: "Status", renews: "Renews on", trialEnds: "Free trial ends", accessUntil: "Access until", payment: "Payment method", paymentPortal: "Managed in the billing portal",
    planPro: "Redaxa Pro", planBusiness: "Redaxa Business", users: "{n} user|{n} users", perMonth: "{price} a month", perYear: "{price} a year", exVat: "excl. VAT",
    stActive: "Active", stTrial: "Free trial", stCancels: "Won’t renew", stPastDue: "Payment failed", stPaused: "Paused",
    cancel: "Cancel subscription", resume: "Resume subscription", portal: "Payment method & invoices",
    confirmTitle: "Cancel your subscription?", confirmText: "You keep {plan} until {date}. You won’t be charged again.", confirmTrial: "Your free trial continues until {date}. You won’t be charged.", keep: "Keep subscription",
    cancelled: "Cancelled. You keep {plan} until {date} and won’t be charged again.", resumed: "Your subscription is back on. It renews on {date}.",
    pastDue: "Your last payment didn’t go through. Update the payment method to keep {plan}.", portalFallback: "Continue in the billing portal", working: "Saving…", back: "Back", signIn: "Please sign in again to manage your subscription.",
    reasonsTitle: "Before you go — what’s the main reason?", reasonsIntro: "Optional. It helps us improve Redaxa.", rTooExpensive: "Too expensive", rUnused: "I don’t use it enough", rMissingFeatures: "Missing a feature I need", rSwitchedService: "Switching to another tool", rLowQuality: "Technical problems / bugs", rTooComplex: "Too complicated to use", rCustomerService: "Problems with support", rOther: "Other", comment: "Anything we could do better?", commentOther: "Tell us more (optional)", commentHint: "Optional", skip: "Skip", next: "Continue", step: "Step {n} of 2"
  },
  it: {
    menu: "Gestisci abbonamento", menuNote: "Piano, rinnovo e disdetta", menuPlans: "Piani e prezzi", menuPlansNote: "Confronta i piani",
    title: "Gestisci abbonamento", intro: "Il tuo piano Redaxa, il rinnovo e il pagamento.", close: "Chiudi",
    loading: "Caricamento dell’abbonamento…", offline: "Sei offline. Connettiti a Internet e riprova.", error: "Non è stato possibile caricare l’abbonamento.", retry: "Riprova",
    noneTitle: "Nessun abbonamento attivo", noneText: "Stai usando il piano gratuito: 5 controlli di prompt al giorno sul web e nell’app Windows.", memberText: "Il tuo accesso proviene dallo spazio di lavoro Business di {owner}. L’abbonamento è gestito dal proprietario dello spazio di lavoro.", seePlans: "Vedi i piani",
    plan: "Piano", price: "Prezzo", status: "Stato", renews: "Si rinnova il", trialEnds: "La prova gratuita termina il", accessUntil: "Accesso fino al", payment: "Metodo di pagamento", paymentPortal: "Gestito nel portale di fatturazione",
    planPro: "Redaxa Pro", planBusiness: "Redaxa Business", users: "{n} utente|{n} utenti", perMonth: "{price} al mese", perYear: "{price} all’anno", exVat: "IVA esclusa",
    stActive: "Attivo", stTrial: "Prova gratuita", stCancels: "Non si rinnova", stPastDue: "Pagamento non riuscito", stPaused: "In pausa",
    cancel: "Disdici abbonamento", resume: "Riattiva abbonamento", portal: "Metodo di pagamento e fatture",
    confirmTitle: "Disdire l’abbonamento?", confirmText: "Mantieni {plan} fino al {date}. Non ti verrà addebitato altro.", confirmTrial: "La prova gratuita continua fino al {date}. Non ti verrà addebitato nulla.", keep: "Mantieni abbonamento",
    cancelled: "Disdetto. Mantieni {plan} fino al {date} e non ti verrà addebitato altro.", resumed: "L’abbonamento è di nuovo attivo. Si rinnova il {date}.",
    pastDue: "L’ultimo pagamento non è andato a buon fine. Aggiorna il metodo di pagamento per mantenere {plan}.", portalFallback: "Continua nel portale di fatturazione", working: "Salvataggio…", back: "Indietro", signIn: "Accedi di nuovo per gestire l’abbonamento.",
    reasonsTitle: "Prima di andare: qual è il motivo principale?", reasonsIntro: "Facoltativo. Ci aiuta a migliorare Redaxa.", rTooExpensive: "Troppo caro", rUnused: "Non lo uso abbastanza", rMissingFeatures: "Manca una funzione che mi serve", rSwitchedService: "Passo a un altro strumento", rLowQuality: "Problemi tecnici / bug", rTooComplex: "Troppo complicato da usare", rCustomerService: "Problemi con l’assistenza", rOther: "Altro", comment: "C’è qualcosa che potremmo fare meglio?", commentOther: "Raccontaci di più (facoltativo)", commentHint: "Facoltativo", skip: "Salta", next: "Continua", step: "Passo {n} di 2"
  },
  es: {
    menu: "Gestionar suscripción", menuNote: "Plan, renovación y cancelación", menuPlans: "Planes y precios", menuPlansNote: "Comparar planes",
    title: "Gestionar suscripción", intro: "Tu plan de Redaxa, su renovación y el pago.", close: "Cerrar",
    loading: "Cargando tu suscripción…", offline: "No tienes conexión. Conéctate a Internet y vuelve a intentarlo.", error: "No hemos podido cargar tu suscripción.", retry: "Reintentar",
    noneTitle: "Ninguna suscripción activa", noneText: "Usas el plan gratuito: 5 revisiones de prompts al día en la web y en la app de Windows.", memberText: "Tu acceso procede del espacio de trabajo Business de {owner}. La suscripción la gestiona el propietario del espacio de trabajo.", seePlans: "Ver planes",
    plan: "Plan", price: "Precio", status: "Estado", renews: "Se renueva el", trialEnds: "La prueba gratuita termina el", accessUntil: "Acceso hasta el", payment: "Método de pago", paymentPortal: "Se gestiona en el portal de facturación",
    planPro: "Redaxa Pro", planBusiness: "Redaxa Business", users: "{n} usuario|{n} usuarios", perMonth: "{price} al mes", perYear: "{price} al año", exVat: "IVA no incluido",
    stActive: "Activa", stTrial: "Prueba gratuita", stCancels: "No se renovará", stPastDue: "Pago fallido", stPaused: "En pausa",
    cancel: "Cancelar suscripción", resume: "Reanudar suscripción", portal: "Método de pago y facturas",
    confirmTitle: "¿Cancelar tu suscripción?", confirmText: "Conservas {plan} hasta el {date}. No se te volverá a cobrar.", confirmTrial: "Tu prueba gratuita continúa hasta el {date}. No se te cobrará nada.", keep: "Mantener suscripción",
    cancelled: "Cancelada. Conservas {plan} hasta el {date} y no se te volverá a cobrar.", resumed: "Tu suscripción vuelve a estar activa. Se renueva el {date}.",
    pastDue: "Tu último pago no se ha completado. Actualiza el método de pago para conservar {plan}.", portalFallback: "Continuar en el portal de facturación", working: "Guardando…", back: "Atrás", signIn: "Vuelve a iniciar sesión para gestionar tu suscripción.",
    reasonsTitle: "Antes de irte: ¿cuál es el motivo principal?", reasonsIntro: "Opcional. Nos ayuda a mejorar Redaxa.", rTooExpensive: "Demasiado caro", rUnused: "No lo uso lo suficiente", rMissingFeatures: "Falta una función que necesito", rSwitchedService: "Me cambio a otra herramienta", rLowQuality: "Problemas técnicos / errores", rTooComplex: "Demasiado complicado de usar", rCustomerService: "Problemas con el soporte", rOther: "Otro", comment: "¿Hay algo que podríamos hacer mejor?", commentOther: "Cuéntanos más (opcional)", commentHint: "Opcional", skip: "Omitir", next: "Continuar", step: "Paso {n} de 2"
  },
  fr: {
    menu: "Gérer l’abonnement", menuNote: "Offre, renouvellement et résiliation", menuPlans: "Offres et tarifs", menuPlansNote: "Comparer les offres",
    title: "Gérer l’abonnement", intro: "Votre offre Redaxa, son renouvellement et le paiement.", close: "Fermer",
    loading: "Chargement de votre abonnement…", offline: "Vous êtes hors ligne. Connectez-vous à Internet, puis réessayez.", error: "Nous n’avons pas pu charger votre abonnement.", retry: "Réessayer",
    noneTitle: "Aucun abonnement actif", noneText: "Vous utilisez l’offre gratuite : 5 vérifications de prompt par jour sur le web et dans l’application Windows.", memberText: "Votre accès provient de l’espace de travail Business de {owner}. C’est le propriétaire de l’espace de travail qui gère l’abonnement.", seePlans: "Voir les offres",
    plan: "Offre", price: "Prix", status: "État", renews: "Renouvellement le", trialEnds: "Fin de l’essai gratuit le", accessUntil: "Accès jusqu’au", payment: "Moyen de paiement", paymentPortal: "Géré dans le portail de facturation",
    planPro: "Redaxa Pro", planBusiness: "Redaxa Business", users: "{n} utilisateur|{n} utilisateurs", perMonth: "{price} par mois", perYear: "{price} par an", exVat: "HT",
    stActive: "Actif", stTrial: "Essai gratuit", stCancels: "Sans renouvellement", stPastDue: "Échec du paiement", stPaused: "En pause",
    cancel: "Résilier l’abonnement", resume: "Réactiver l’abonnement", portal: "Moyen de paiement et factures",
    confirmTitle: "Résilier votre abonnement ?", confirmText: "Vous conservez {plan} jusqu’au {date}. Vous ne serez plus prélevé.", confirmTrial: "Votre essai gratuit continue jusqu’au {date}. Vous ne serez pas prélevé.", keep: "Garder l’abonnement",
    cancelled: "Résilié. Vous conservez {plan} jusqu’au {date} et ne serez plus prélevé.", resumed: "Votre abonnement est réactivé. Il se renouvelle le {date}.",
    pastDue: "Votre dernier paiement n’a pas abouti. Mettez à jour le moyen de paiement pour conserver {plan}.", portalFallback: "Continuer dans le portail de facturation", working: "Enregistrement…", back: "Retour", signIn: "Reconnectez-vous pour gérer votre abonnement.",
    reasonsTitle: "Avant de partir : quelle est la raison principale ?", reasonsIntro: "Facultatif. Cela nous aide à améliorer Redaxa.", rTooExpensive: "Trop cher", rUnused: "Je ne l’utilise pas assez", rMissingFeatures: "Une fonction me manque", rSwitchedService: "Je passe à un autre outil", rLowQuality: "Problèmes techniques / bugs", rTooComplex: "Trop compliqué à utiliser", rCustomerService: "Problèmes avec le support", rOther: "Autre", comment: "Que pourrions-nous améliorer ?", commentOther: "Dites-nous-en plus (facultatif)", commentHint: "Facultatif", skip: "Passer", next: "Continuer", step: "Étape {n} sur 2"
  },
  de: {
    menu: "Abonnement verwalten", menuNote: "Tarif, Verlängerung und Kündigung", menuPlans: "Tarife & Preise", menuPlansNote: "Tarife vergleichen",
    title: "Abonnement verwalten", intro: "Dein Redaxa-Tarif, seine Verlängerung und die Zahlung.", close: "Schließen",
    loading: "Dein Abonnement wird geladen…", offline: "Du bist offline. Stelle eine Internetverbindung her und versuche es erneut.", error: "Wir konnten dein Abonnement nicht laden.", retry: "Erneut versuchen",
    noneTitle: "Kein aktives Abonnement", noneText: "Du nutzt den kostenlosen Tarif: 5 Prompt-Prüfungen pro Tag im Web und in der Windows-App.", memberText: "Dein Zugang stammt aus dem Business-Arbeitsbereich von {owner}. Das Abonnement verwaltet die Person, der der Arbeitsbereich gehört.", seePlans: "Tarife ansehen",
    plan: "Tarif", price: "Preis", status: "Status", renews: "Verlängert sich am", trialEnds: "Testphase endet am", accessUntil: "Zugang bis", payment: "Zahlungsmethode", paymentPortal: "Wird im Abrechnungsportal verwaltet",
    planPro: "Redaxa Pro", planBusiness: "Redaxa Business", users: "{n} Nutzer|{n} Nutzer", perMonth: "{price} pro Monat", perYear: "{price} pro Jahr", exVat: "zzgl. MwSt.",
    stActive: "Aktiv", stTrial: "Kostenlose Testphase", stCancels: "Wird nicht verlängert", stPastDue: "Zahlung fehlgeschlagen", stPaused: "Pausiert",
    cancel: "Abonnement kündigen", resume: "Abonnement fortsetzen", portal: "Zahlungsmethode & Rechnungen",
    confirmTitle: "Abonnement kündigen?", confirmText: "Du behältst {plan} bis zum {date}. Es wird nichts mehr abgebucht.", confirmTrial: "Deine kostenlose Testphase läuft bis zum {date}. Es wird nichts abgebucht.", keep: "Abonnement behalten",
    cancelled: "Gekündigt. Du behältst {plan} bis zum {date}; es wird nichts mehr abgebucht.", resumed: "Dein Abonnement läuft wieder. Es verlängert sich am {date}.",
    pastDue: "Deine letzte Zahlung ist fehlgeschlagen. Aktualisiere die Zahlungsmethode, um {plan} zu behalten.", portalFallback: "Im Abrechnungsportal fortfahren", working: "Wird gespeichert…", back: "Zurück", signIn: "Bitte melde dich erneut an, um dein Abonnement zu verwalten.",
    reasonsTitle: "Bevor du gehst: Was ist der Hauptgrund?", reasonsIntro: "Optional. Es hilft uns, Redaxa zu verbessern.", rTooExpensive: "Zu teuer", rUnused: "Ich nutze es zu selten", rMissingFeatures: "Mir fehlt eine Funktion", rSwitchedService: "Ich nutze ein anderes Tool", rLowQuality: "Technische Probleme / Fehler", rTooComplex: "Zu kompliziert in der Nutzung", rCustomerService: "Probleme mit dem Support", rOther: "Sonstiges", comment: "Was könnten wir besser machen?", commentOther: "Erzähle uns mehr (optional)", commentHint: "Optional", skip: "Überspringen", next: "Weiter", step: "Schritt {n} von 2"
  }
};
const subLanguage = (): SubLanguage => { const l = (typeof document !== "undefined" ? document.documentElement.lang : "en").slice(0, 2); return (["en", "it", "es", "fr", "de"] as const).includes(l as SubLanguage) ? l as SubLanguage : "en"; };
const subWords = (): Record<string, string> => subscriptionCopyByLanguage[subLanguage()];
const subFill = (text: string, values: Record<string, string | number>): string => text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
/** Sign-in dialog copy for the languages the rest of the app speaks, keyed by the English text; anything not listed stays English. */
const authCopy: Record<string, readonly [string, string, string, string]> = {
  "Create your account": ["Crea il tuo account", "Crea tu cuenta", "Créez votre compte", "Erstelle dein Konto"],
  "Eligible new subscribers can try Redaxa free for 3 days. Prompt text is processed by Redaxa's scanner without being stored or logged.": ["I nuovi abbonati idonei possono provare Redaxa gratis per 3 giorni. Il testo dei prompt viene elaborato dallo scanner di Redaxa senza essere salvato né registrato.", "Los nuevos suscriptores que cumplan los requisitos pueden probar Redaxa gratis durante 3 días. El texto de los prompts lo procesa el analizador de Redaxa sin almacenarse ni registrarse.", "Les nouveaux abonnés éligibles peuvent essayer Redaxa gratuitement pendant 3 jours. Le texte des prompts est traité par l’analyseur de Redaxa sans être stocké ni journalisé.", "Berechtigte neue Abonnenten können Redaxa 3 Tage kostenlos testen. Der Prompt-Text wird vom Redaxa-Scanner verarbeitet, ohne gespeichert oder protokolliert zu werden."],
  "First name (optional)": ["Nome (facoltativo)", "Nombre (opcional)", "Prénom (facultatif)", "Vorname (optional)"],
  "Email": ["E-mail", "Correo electrónico", "E-mail", "E-Mail"],
  "Password": ["Password", "Contraseña", "Mot de passe", "Passwort"],
  "Forgot password?": ["Password dimenticata?", "¿Olvidaste tu contraseña?", "Mot de passe oublié\u00a0?", "Passwort vergessen?"],
  "Show": ["Mostra", "Mostrar", "Afficher", "Anzeigen"],
  "Hide": ["Nascondi", "Ocultar", "Masquer", "Verbergen"],
  "Confirm password": ["Conferma la password", "Confirma la contraseña", "Confirmez le mot de passe", "Passwort bestätigen"],
  "Remember me on this device": ["Ricordami su questo dispositivo", "Recordarme en este dispositivo", "Se souvenir de moi sur cet appareil", "Auf diesem Gerät angemeldet bleiben"],
  "Create account": ["Crea account", "Crear cuenta", "Créer un compte", "Konto erstellen"],
  "Log in": ["Accedi", "Iniciar sesión", "Se connecter", "Anmelden"],
  "Dashboard": ["Dashboard", "Panel", "Tableau de bord", "Dashboard"],
  "Already have an account? Sign in": ["Hai già un account? Accedi", "¿Ya tienes una cuenta? Inicia sesión", "Vous avez déjà un compte\u00a0? Connectez-vous", "Du hast schon ein Konto? Melde dich an"],
  "Already use Frame Witness? Sign in with the same email and password.": ["Usi già Frame Witness? Accedi con la stessa email e la stessa password.", "¿Ya usas Frame Witness? Inicia sesión con el mismo correo y la misma contraseña.", "Vous utilisez déjà Frame Witness\u00a0? Connectez-vous avec la même adresse e-mail et le même mot de passe.", "Du nutzt schon Frame Witness? Melde dich mit derselben E-Mail-Adresse und demselben Passwort an."],
  "Resend confirmation email": ["Invia di nuovo l’email di conferma", "Reenviar el correo de confirmación", "Renvoyer l’e-mail de confirmation", "Bestätigungs-E-Mail erneut senden"],
  "Terms": ["Termini di servizio", "Términos del servicio", "Conditions d’utilisation", "Nutzungsbedingungen"],
  "Privacy Policy": ["Informativa sulla privacy", "Política de privacidad", "Politique de confidentialité", "Datenschutzerklärung"],
  "By creating an account you agree to our {terms} and {privacy}.": ["Creando un account accetti i nostri {terms} e l’{privacy}.", "Al crear una cuenta aceptas nuestros {terms} y nuestra {privacy}.", "En créant un compte, vous acceptez nos {terms} et notre {privacy}.", "Mit der Erstellung eines Kontos stimmst du unseren {terms} und der {privacy} zu."],
  "Close account dialog": ["Chiudi la finestra dell’account", "Cerrar el cuadro de la cuenta", "Fermer la fenêtre du compte", "Kontofenster schließen"],
  "Reset your password": ["Reimposta la password", "Restablece tu contraseña", "Réinitialisez votre mot de passe", "Setze dein Passwort zurück"],
  "Welcome back": ["Bentornato", "Te damos la bienvenida de nuevo", "Content de vous revoir", "Willkommen zurück"],
  "Use a password with at least 12 characters. We will send a verification email.": ["Usa una password di almeno 12 caratteri. Ti invieremo un’email di verifica.", "Usa una contraseña de al menos 12 caracteres. Te enviaremos un correo de verificación.", "Utilisez un mot de passe d’au moins 12 caractères. Nous vous enverrons un e-mail de vérification.", "Verwende ein Passwort mit mindestens 12 Zeichen. Wir senden dir eine Bestätigungs-E-Mail."],
  "We will email you a secure link to choose a new password.": ["Ti invieremo via email un link sicuro per scegliere una nuova password.", "Te enviaremos por correo un enlace seguro para elegir una nueva contraseña.", "Nous vous enverrons par e-mail un lien sécurisé pour choisir un nouveau mot de passe.", "Wir senden dir einen sicheren Link per E-Mail, mit dem du ein neues Passwort wählen kannst."],
  "Sign in to continue with your private workspace.": ["Accedi per continuare nel tuo spazio di lavoro privato.", "Inicia sesión para continuar en tu espacio de trabajo privado.", "Connectez-vous pour continuer dans votre espace de travail privé.", "Melde dich an, um mit deinem privaten Arbeitsbereich fortzufahren."],
  "Send reset link": ["Invia il link di reimpostazione", "Enviar enlace de restablecimiento", "Envoyer le lien de réinitialisation", "Link zum Zurücksetzen senden"],
  "Sign in": ["Accedi", "Iniciar sesión", "Se connecter", "Anmelden"],
  "Back to sign in": ["Torna all’accesso", "Volver a iniciar sesión", "Retour à la connexion", "Zurück zur Anmeldung"],
  "New here? Create an account": ["Prima volta qui? Crea un account", "¿Eres nuevo? Crea una cuenta", "Première visite\u00a0? Créez un compte", "Neu hier? Erstelle ein Konto"],
  "Choose a new password": ["Scegli una nuova password", "Elige una nueva contraseña", "Choisissez un nouveau mot de passe", "Wähle ein neues Passwort"],
  "Use at least 12 characters. Every device signed in to your account will be signed out.": ["Usa almeno 12 caratteri. Tutti i dispositivi collegati al tuo account verranno disconnessi.", "Usa al menos 12 caracteres. Se cerrará la sesión en todos los dispositivos conectados a tu cuenta.", "Utilisez au moins 12 caractères. Tous les appareils connectés à votre compte seront déconnectés.", "Verwende mindestens 12 Zeichen. Alle Geräte, auf denen du angemeldet bist, werden abgemeldet."],
  "Use a password with at least 12 characters.": ["Usa una password di almeno 12 caratteri.", "Usa una contraseña de al menos 12 caracteres.", "Utilisez un mot de passe d’au moins 12 caractères.", "Verwende ein Passwort mit mindestens 12 Zeichen."],
  "Set the new password": ["Imposta la nuova password", "Establecer la nueva contraseña", "Enregistrer le nouveau mot de passe", "Neues Passwort festlegen"],
  "Confirm your email": ["Conferma la tua email", "Confirma tu correo electrónico", "Confirmez votre e-mail", "Bestätige deine E-Mail-Adresse"],
  "Select Confirm email to finish creating your Redaxa account. Then sign in with your password.": ["Seleziona «Conferma email» per completare la creazione del tuo account Redaxa. Poi accedi con la tua password.", "Selecciona «Confirmar correo» para terminar de crear tu cuenta de Redaxa. Después inicia sesión con tu contraseña.", "Sélectionnez «\u00a0Confirmer l’e-mail\u00a0» pour terminer la création de votre compte Redaxa. Connectez-vous ensuite avec votre mot de passe.", "Wähle „E-Mail bestätigen“, um dein Redaxa-Konto fertig einzurichten. Melde dich danach mit deinem Passwort an."],
  "Confirm email": ["Conferma email", "Confirmar correo", "Confirmer l’e-mail", "E-Mail bestätigen"],
  "That reset link is incomplete. Request a new one below.": ["Questo link di reimpostazione è incompleto. Richiedine uno nuovo qui sotto.", "Ese enlace de restablecimiento está incompleto. Solicita uno nuevo más abajo.", "Ce lien de réinitialisation est incomplet. Demandez-en un nouveau ci-dessous.", "Dieser Link zum Zurücksetzen ist unvollständig. Fordere unten einen neuen an."],
  "That confirmation link is incomplete. Enter your email and resend the confirmation.": ["Questo link di conferma è incompleto. Inserisci la tua email e invia di nuovo la conferma.", "Ese enlace de confirmación está incompleto. Introduce tu correo y reenvía la confirmación.", "Ce lien de confirmation est incomplet. Saisissez votre adresse e-mail et renvoyez la confirmation.", "Dieser Bestätigungslink ist unvollständig. Gib deine E-Mail-Adresse ein und sende die Bestätigung erneut."],
  "Account created. Check your email for a confirmation link, then sign in here.": ["Account creato. Controlla la tua email per il link di conferma, poi accedi qui.", "Cuenta creada. Revisa tu correo para encontrar el enlace de confirmación y luego inicia sesión aquí.", "Compte créé. Consultez votre e-mail pour le lien de confirmation, puis connectez-vous ici.", "Konto erstellt. Sieh in deinem Postfach nach dem Bestätigungslink und melde dich dann hier an."],
  "Please sign in again to continue.": ["Accedi di nuovo per continuare.", "Inicia sesión de nuevo para continuar.", "Reconnectez-vous pour continuer.", "Melde dich erneut an, um fortzufahren."],
  "Sign in to manage your subscription.": ["Accedi per gestire il tuo abbonamento.", "Inicia sesión para gestionar tu suscripción.", "Connectez-vous pour gérer votre abonnement.", "Melde dich an, um dein Abonnement zu verwalten."],
  "Email confirmed. Sign in with your password to continue.": ["Email confermata. Accedi con la tua password per continuare.", "Correo confirmado. Inicia sesión con tu contraseña para continuar.", "E-mail confirmé. Connectez-vous avec votre mot de passe pour continuer.", "E-Mail bestätigt. Melde dich mit deinem Passwort an, um fortzufahren."],
  "Password changed and other devices signed out. Sign in with the new password.": ["Password cambiata e altri dispositivi disconnessi. Accedi con la nuova password.", "Contraseña cambiada y sesión cerrada en los demás dispositivos. Inicia sesión con la nueva contraseña.", "Mot de passe modifié et autres appareils déconnectés. Connectez-vous avec le nouveau mot de passe.", "Passwort geändert, andere Geräte abgemeldet. Melde dich mit dem neuen Passwort an."],
  "Password changed. Sign in with the new one.": ["Password cambiata. Accedi con quella nuova.", "Contraseña cambiada. Inicia sesión con la nueva.", "Mot de passe modifié. Connectez-vous avec le nouveau.", "Passwort geändert. Melde dich mit dem neuen an."],
  "If that account exists, a password-reset link is on its way.": ["Se l’account esiste, un link per reimpostare la password è in arrivo.", "Si la cuenta existe, el enlace para restablecer la contraseña está en camino.", "Si le compte existe, un lien de réinitialisation du mot de passe est en route.", "Wenn das Konto existiert, ist ein Link zum Zurücksetzen des Passworts unterwegs."],
  "If that account exists and isn't confirmed yet, a new confirmation email is on its way.": ["Se l’account esiste e non è ancora confermato, una nuova email di conferma è in arrivo.", "Si la cuenta existe y aún no está confirmada, un nuevo correo de confirmación está en camino.", "Si le compte existe et n’est pas encore confirmé, un nouvel e-mail de confirmation est en route.", "Wenn das Konto existiert und noch nicht bestätigt ist, ist eine neue Bestätigungs-E-Mail unterwegs."],
  "We could not resend that email. Please try again shortly.": ["Non siamo riusciti a reinviare l’email. Riprova tra poco.", "No pudimos reenviar ese correo. Vuelve a intentarlo en unos minutos.", "Nous n’avons pas pu renvoyer cet e-mail. Réessayez dans un instant.", "Wir konnten die E-Mail nicht erneut senden. Versuche es gleich noch einmal."],
  "Enter your email address first.": ["Inserisci prima il tuo indirizzo email.", "Introduce primero tu dirección de correo electrónico.", "Saisissez d’abord votre adresse e-mail.", "Gib zuerst deine E-Mail-Adresse ein."],
  "Account setup is being completed. Please try again shortly.": ["La configurazione degli account è in fase di completamento. Riprova tra poco.", "Se está terminando de configurar las cuentas. Vuelve a intentarlo en unos minutos.", "La configuration des comptes est en cours de finalisation. Réessayez dans un instant.", "Die Kontoeinrichtung wird gerade abgeschlossen. Versuche es gleich noch einmal."],
  "Account setup is not configured yet.": ["La configurazione degli account non è ancora completa.", "Las cuentas aún no están configuradas.", "Les comptes ne sont pas encore configurés.", "Die Konten sind noch nicht eingerichtet."],
  "Passwords do not match.": ["Le password non coincidono.", "Las contraseñas no coinciden.", "Les mots de passe ne correspondent pas.", "Die Passwörter stimmen nicht überein."],
  "Signed in successfully.": ["Accesso effettuato.", "Sesión iniciada.", "Connexion réussie.", "Erfolgreich angemeldet."],
  "Create an account first to choose a plan.": ["Crea prima un account per scegliere un piano.", "Crea primero una cuenta para elegir un plan.", "Créez d’abord un compte pour choisir une offre.", "Erstelle zuerst ein Konto, um einen Tarif zu wählen."],
  "Verification link received. Sign in with your own email and password to continue.": ["Link di verifica ricevuto. Accedi con la tua email e la tua password per continuare.", "Enlace de verificación recibido. Inicia sesión con tu correo y tu contraseña para continuar.", "Lien de vérification reçu. Connectez-vous avec votre adresse e-mail et votre mot de passe pour continuer.", "Bestätigungslink empfangen. Melde dich mit deiner E-Mail-Adresse und deinem Passwort an, um fortzufahren."],
  "Create an account or sign in to review this team invitation.": ["Crea un account o accedi per vedere questo invito al team.", "Crea una cuenta o inicia sesión para revisar esta invitación al equipo.", "Créez un compte ou connectez-vous pour consulter cette invitation d’équipe.", "Erstelle ein Konto oder melde dich an, um diese Team-Einladung anzusehen."],
  "Creating account…": ["Creazione dell’account…", "Creando la cuenta…", "Création du compte…", "Konto wird erstellt…"],
  "Signing in…": ["Accesso in corso…", "Iniciando sesión…", "Connexion…", "Anmeldung läuft…"],
  "Confirming…": ["Conferma in corso…", "Confirmando…", "Confirmation…", "Wird bestätigt…"],
  "Saving…": ["Salvataggio…", "Guardando…", "Enregistrement…", "Wird gespeichert…"],
  "Sending link…": ["Invio del link…", "Enviando el enlace…", "Envoi du lien…", "Link wird gesendet…"],
  "Sending…": ["Invio…", "Enviando…", "Envoi…", "Wird gesendet…"],
  "Resend available in {time}": ["Nuovo invio disponibile tra {time}", "Reenvío disponible en {time}", "Renvoi possible dans {time}", "Erneut senden möglich in {time}"],
  "Too many attempts. Please wait a few minutes and try again.": ["Troppi tentativi. Attendi qualche minuto e riprova.", "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.", "Trop de tentatives. Patientez quelques minutes, puis réessayez.", "Zu viele Versuche. Warte ein paar Minuten und versuche es erneut."],
  "Too many sign-up emails right now. Please wait a few minutes and try again.": ["Ora ci sono troppe email di registrazione. Attendi qualche minuto e riprova.", "Hay demasiados correos de registro en este momento. Espera unos minutos y vuelve a intentarlo.", "Trop d’e-mails d’inscription en ce moment. Patientez quelques minutes, puis réessayez.", "Gerade werden zu viele Registrierungs-E-Mails gesendet. Warte ein paar Minuten und versuche es erneut."],
  "Enter a valid email address.": ["Inserisci un indirizzo email valido.", "Introduce una dirección de correo electrónico válida.", "Saisissez une adresse e-mail valide.", "Gib eine gültige E-Mail-Adresse ein."],
  "Enter a valid email and a password of at least 12 characters.": ["Inserisci un’email valida e una password di almeno 12 caratteri.", "Introduce un correo válido y una contraseña de al menos 12 caracteres.", "Saisissez une adresse e-mail valide et un mot de passe d’au moins 12 caractères.", "Gib eine gültige E-Mail-Adresse und ein Passwort mit mindestens 12 Zeichen ein."],
  "We could not create that account.": ["Non siamo riusciti a creare quell’account.", "No pudimos crear esa cuenta.", "Nous n’avons pas pu créer ce compte.", "Wir konnten dieses Konto nicht erstellen."],
  "We could not complete that request.": ["Non siamo riusciti a completare la richiesta.", "No pudimos completar la solicitud.", "Nous n’avons pas pu traiter cette demande.", "Wir konnten die Anfrage nicht abschließen."],
};
const L = (text: string, values: Record<string, string> = {}): string => {
  const index = ["it", "es", "fr", "de"].indexOf(subLanguage());
  const row = authCopy[text];
  return subFill(index >= 0 && row ? row[index] : text, values);
};

const subPlural = (text: string, n: number): string => subFill(text.split("|")[n === 1 ? 0 : 1] ?? text, { n });
const subDate = (iso: string | null): string => {
  const time = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(time)) return "";
  const lang = subLanguage();
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : lang, { day: "numeric", month: "long", year: "numeric" }).format(new Date(time));
};
const subMoney = (cents: number, currency: string): string => {
  const lang = subLanguage();
  return new Intl.NumberFormat(lang === "en" ? "en-IE" : lang, { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
};
const cardBrand = (brand: string): string => ({ visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", jcb: "JCB", diners: "Diners Club", unionpay: "UnionPay", cartes_bancaires: "Cartes Bancaires", link: "Link" } as Record<string, string>)[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1);

/** The cancel dialog's reasons: Stripe's cancellation_details.feedback codes
 *  (api/_subscription.ts CANCEL_REASONS) and their copy keys, in display order. */
const SUB_REASONS: ReadonlyArray<[string, string]> = [
  ["too_expensive", "rTooExpensive"], ["unused", "rUnused"], ["missing_features", "rMissingFeatures"], ["switched_service", "rSwitchedService"],
  ["low_quality", "rLowQuality"], ["too_complex", "rTooComplex"], ["customer_service", "rCustomerService"], ["other", "rOther"],
];
const SUB_COMMENT_MAX = 500;

/** The "Manage subscription" panel, opened from the account menu, the
 *  account page and the current plan's card. Returns the function that opens it. */
function mountSubscriptionPanel(deps: { menu: HTMLElement; desktop: boolean; manageBilling: () => Promise<void>; signIn: (message: string) => void }): () => void {
  // Manage subscription: one dialog, four states (loading, error, nothing to
  // manage, the subscription) plus the cancel confirmation. Every change is
  // the server's answer redrawn, never a guess made here.
  const subSheet = document.createElement("dialog");
  subSheet.className = "ps-account-sheet ps-sub-sheet";
  subSheet.setAttribute("aria-labelledby", "ps-sub-title");
  document.body.append(subSheet);
  let subState: SubscriptionInfo | null = null;
  let subBusy = false;
  let cancelReason: string | null = null;
  let cancelComment = "";
  const subEscape = (value: string): string => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const subPlanName = (s: SubscriptionInfo): string => { const w = subWords(); return s.plan === "business" ? w.planBusiness : w.planPro; };
  const subEnds = (s: SubscriptionInfo): string | null => s.status === "trialing" ? (s.cancel_at ?? s.trial_end ?? s.current_period_end) : (s.cancel_at ?? s.current_period_end);
  const subFrame = (body: string, message = ""): void => {
    const w = subWords();
    subSheet.innerHTML = `<header><div><h2 id="ps-sub-title">${subEscape(w.title)}</h2><p>${subEscape(w.intro)}</p></div><button type="button" data-sheet-close aria-label="${subEscape(w.close)}">×</button></header>${body}<p class="ps-account-message ps-sub-message" role="status">${subEscape(message)}</p>`;
    subSheet.querySelector("[data-sheet-close]")!.addEventListener("click", () => subSheet.close());
  };
  const subPaint = (message = ""): void => {
    const w = subWords();
    const s = subState;
    if (!s || s.status === "none") {
      const text = s?.member_of ? subFill(w.memberText, { owner: s.member_of }) : w.noneText;
      subFrame(`<section class="ps-sub-card ps-sub-empty"><h3>${subEscape(w.noneTitle)}</h3><p>${subEscape(text)}</p></section>
        <div class="ps-account-actions">${s?.member_of ? "" : `<button type="button" data-sub="plans">${subEscape(w.seePlans)}</button>`}</div>`, message);
    } else {
      const ending = s.cancel_at_period_end;
      const trial = s.status === "trialing";
      const failed = ["past_due", "unpaid", "incomplete"].includes(s.status);
      const pill = failed ? w.stPastDue : s.status === "paused" ? w.stPaused : ending ? w.stCancels : trial ? w.stTrial : w.stActive;
      const tone = failed ? "is-alert" : ending ? "is-ending" : "is-ok";
      const price = s.amount != null && s.currency ? `${subFill(s.interval === "year" ? w.perYear : w.perMonth, { price: subMoney(s.amount, s.currency) })} <small>${subEscape(w.exVat)}</small>` : "";
      const seats = s.plan === "business" && s.seats ? ` · ${subEscape(subPlural(w.users, s.seats))}` : "";
      const dateLabel = ending ? w.accessUntil : trial ? w.trialEnds : w.renews;
      const date = subDate(ending ? subEnds(s) : trial ? s.trial_end : s.current_period_end);
      const card = s.payment_method?.last4 ? `${cardBrand(s.payment_method.brand)} •••• ${s.payment_method.last4}` : s.payment_method ? cardBrand(s.payment_method.brand) : w.paymentPortal;
      const actions = [
        s.can_resume ? `<button type="button" data-sub="resume">${subEscape(w.resume)}</button>` : "",
        failed ? `<button type="button" data-sub="portal">${subEscape(w.portal)}</button>` : "",
        s.can_cancel ? `<button type="button" class="ps-sub-cancel" data-sub="cancel">${subEscape(w.cancel)}</button>` : "",
        failed ? "" : `<button type="button" class="ps-sub-link" data-sub="portal">${subEscape(w.portal)}</button>`,
      ].join("");
      subFrame(`<section class="ps-sub-card"><div class="ps-sub-head"><div><h3>${subEscape(subPlanName(s))}${seats}</h3>${price ? `<p class="ps-sub-price">${price}</p>` : ""}</div><span class="ps-sub-pill ${tone}">${subEscape(pill)}</span></div>
        ${failed ? `<p class="ps-sub-warn">${subEscape(subFill(w.pastDue, { plan: subPlanName(s) }))}</p>` : ""}
        <dl class="ps-account-facts">${date ? `<div><dt>${subEscape(dateLabel)}</dt><dd>${subEscape(date)}</dd></div>` : ""}<div><dt>${subEscape(w.payment)}</dt><dd>${subEscape(card)}</dd></div></dl></section>
        <div class="ps-account-actions ps-sub-actions">${actions}</div>`, message);
    }
    subSheet.querySelector<HTMLButtonElement>("[data-sub]")?.focus();
  };
  const subFailure = (error: unknown, retry: () => void): void => {
    const w = subWords();
    const err = error as Error & { code?: string };
    if (err?.message === "UNAUTHORIZED") { subSheet.close(); deps.signIn(w.signIn); return; }
    const offline = typeof navigator !== "undefined" && navigator.onLine === false || error instanceof TypeError;
    const portal = (err as { url?: string })?.url;
    subFrame(`<section class="ps-sub-card ps-sub-empty"><p>${subEscape(offline ? w.offline : w.error)}</p></section><div class="ps-account-actions"><button type="button" data-sub="retry">${subEscape(w.retry)}</button>${portal ? `<button type="button" data-sub="open-portal">${subEscape(w.portalFallback)}</button>` : ""}</div>`);
    subSheet.querySelector<HTMLButtonElement>('[data-sub="retry"]')!.addEventListener("click", retry);
    subSheet.querySelector<HTMLButtonElement>('[data-sub="open-portal"]')?.addEventListener("click", () => { if (deps.desktop) void openInSystemBrowser(portal!); else location.assign(portal!); });
    subSheet.querySelector<HTMLButtonElement>('[data-sub="retry"]')!.focus();
  };
  const loadSubscription = async (): Promise<void> => {
    subFrame(`<p class="ps-sub-loading" aria-busy="true">${subEscape(subWords().loading)}</p>`);
    try { subState = await apiRequest("/api/billing/subscription", undefined, "GET") as unknown as SubscriptionInfo; subPaint(); }
    catch (error) { subFailure(error, () => void loadSubscription()); }
  };
  const changeSubscription = async (cancel: boolean): Promise<void> => {
    if (subBusy || !subState) return;
    subBusy = true;
    const w = subWords();
    subSheet.querySelectorAll<HTMLButtonElement>("button[data-sub]").forEach((b) => { b.disabled = true; });
    const message = subSheet.querySelector<HTMLElement>(".ps-sub-message");
    if (message) message.textContent = w.working;
    try {
      const comment = cancelComment.trim();
      const feedback = cancel ? { ...(cancelReason ? { reason: cancelReason } : {}), ...(comment ? { comment } : {}) } : {};
      const payload = await apiRequest(`/api/billing/subscription/${cancel ? "cancel" : "resume"}`, feedback) as Record<string, unknown>;
      subState = payload as unknown as SubscriptionInfo;
      subPaint(cancel ? subFill(w.cancelled, { plan: subPlanName(subState), date: subDate(subEnds(subState)) }) : subFill(w.resumed, { date: subDate(subState.current_period_end) }));
      void refreshEntitlement();
    } catch (error) {
      // A 502 from Stripe carries the portal's own cancel flow as the way out.
      subFailure(error, () => void loadSubscription());
    } finally { subBusy = false; }
  };
  // Step 1 of cancelling: the main reason, optional and one tap (Stripe's own
  // cancellation_details codes). Skip and Continue with nothing chosen both
  // go straight to step 2; nothing here makes cancelling harder.
  const askReason = (): void => {
    const w = subWords();
    cancelReason = null; cancelComment = "";
    const options = SUB_REASONS.map(([code, key]) => `<label class="ps-sub-reason"><input type="radio" name="ps-sub-reason" value="${code}"><span>${subEscape(w[key])}</span></label>`).join("");
    subFrame(`<section class="ps-sub-card ps-sub-reasons"><p class="ps-sub-step">${subEscape(subFill(w.step, { n: 1 }))}</p>
      <fieldset aria-describedby="ps-sub-reasons-intro"><legend><h3>${subEscape(w.reasonsTitle)}</h3></legend><p id="ps-sub-reasons-intro">${subEscape(w.reasonsIntro)}</p>
      <div class="ps-sub-reason-grid">${options}</div></fieldset>
      <div class="ps-sub-comment" hidden><label for="ps-sub-comment">${subEscape(w.comment)}</label><textarea id="ps-sub-comment" rows="2" maxlength="${SUB_COMMENT_MAX}" aria-describedby="ps-sub-count"></textarea><span class="ps-sub-count" id="ps-sub-count">0/${SUB_COMMENT_MAX}</span></div></section>
      <div class="ps-account-actions ps-sub-actions"><button type="button" data-sub="next">${subEscape(w.next)}</button><button type="button" data-sub="keep">${subEscape(w.keep)}</button><button type="button" class="ps-sub-link" data-sub="skip">${subEscape(w.skip)}</button></div>`);
    subSheet.querySelector<HTMLInputElement>('input[name="ps-sub-reason"]')!.focus();
  };
  const confirmCancel = (): void => {
    const w = subWords();
    const s = subState!;
    const date = subDate(subEnds(s));
    const text = s.status === "trialing" ? subFill(w.confirmTrial, { date }) : subFill(w.confirmText, { plan: subPlanName(s), date });
    subFrame(`<section class="ps-sub-card ps-sub-confirm" role="alertdialog" aria-labelledby="ps-sub-confirm-title" aria-describedby="ps-sub-confirm-text"><p class="ps-sub-step">${subEscape(subFill(w.step, { n: 2 }))}</p><h3 id="ps-sub-confirm-title">${subEscape(w.confirmTitle)}</h3><p id="ps-sub-confirm-text">${subEscape(text)}</p></section>
      <div class="ps-account-actions ps-sub-actions"><button type="button" class="ps-sub-back" data-sub="back">${subEscape(w.back)}</button><button type="button" class="ps-sub-keep" data-sub="keep">${subEscape(w.keep)}</button><button type="button" class="ps-sub-cancel ps-sub-confirm" data-sub="confirm">${subEscape(w.cancel)}</button></div>`);
    subSheet.querySelector<HTMLButtonElement>('[data-sub="keep"]')!.focus();
  };
  subSheet.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name !== "ps-sub-reason") return;
    cancelReason = input.value;
    const box = subSheet.querySelector<HTMLElement>(".ps-sub-comment")!;
    box.hidden = false;
    box.querySelector("textarea")!.placeholder = subWords()[input.value === "other" ? "commentOther" : "commentHint"];
  });
  subSheet.addEventListener("input", (event) => {
    const area = event.target as HTMLTextAreaElement;
    if (area.id !== "ps-sub-comment") return;
    cancelComment = area.value;
    subSheet.querySelector<HTMLElement>("#ps-sub-count")!.textContent = `${area.value.length}/${SUB_COMMENT_MAX}`;
  });
  subSheet.addEventListener("click", (event) => {
    if (event.target === subSheet) { const r = subSheet.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) subSheet.close(); return; }
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-sub]")?.dataset.sub;
    if (action === "plans") { subSheet.close(); if (document.body.matches(".redaxa-workspace")) location.hash = "#plans"; else location.assign("/dashboard.html#plans"); }
    else if (action === "cancel") askReason();
    else if (action === "next") confirmCancel();
    else if (action === "back") {
      // Step 1 again, with the reason and comment as they were.
      const [reason, comment] = [cancelReason, cancelComment];
      askReason();
      const radio = reason ? subSheet.querySelector<HTMLInputElement>(`input[name="ps-sub-reason"][value="${reason}"]`) : null;
      if (radio) { radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true })); radio.focus(); }
      const area = subSheet.querySelector<HTMLTextAreaElement>("#ps-sub-comment");
      if (area && comment) { area.value = comment; area.dispatchEvent(new Event("input", { bubbles: true })); }
    }
    else if (action === "skip") { cancelReason = null; cancelComment = ""; confirmCancel(); }
    else if (action === "keep") subPaint();
    else if (action === "confirm") void changeSubscription(true);
    else if (action === "resume") void changeSubscription(false);
    else if (action === "portal") { subSheet.close(); void deps.manageBilling(); }
  });
  subSheet.addEventListener("close", () => deps.menu.querySelector<HTMLButtonElement>(".ps-avatar-btn")?.focus());
  const openSubscription = (): void => {
    if (!currentEmail) { deps.signIn(subWords().signIn); return; }
    if (!subSheet.open) subSheet.showModal();
    void loadSubscription();
  };
  // The menu speaks the page's language; re-read when the workspace switches it.
  const relabelMenu = (): void => { const w = subWords(); deps.menu.querySelectorAll<HTMLElement>("[data-sub-copy]").forEach((el) => { el.textContent = w[el.dataset.subCopy!] ?? el.textContent; }); };
  relabelMenu();
  new MutationObserver(relabelMenu).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  // Every "Manage subscription" button on the page opens this panel; a failed
  // payment goes straight to the portal, where the card is fixed.
  const manageButton = document.querySelector<HTMLButtonElement>("#manage-billing");
  manageButton?.addEventListener("click", () => {
    const paused = latestAccount?.billing?.state === "blocked" && latestAccount.billing.blockedReason === "payment_failed";
    if (paused) void deps.manageBilling(); else openSubscription();
  });
  return openSubscription;
}

/** Display verified account state; an unavailable lookup is not a free plan. */
function accountPlanLabel(state: AccountState | null): string {
  if (!state) return "Plan status unavailable";
  const named = (plan: string | null | undefined) => plan === "business" ? "Business" : "Pro";
  if (state.billing?.state === "blocked" && state.billing.blockedReason === "payment_failed") return `${named(state.billing.plan)} · Payment failed`;
  if (!state.active) return "No active subscription";
  const plan = state.plan === "personal" || state.plan === "pro" ? "Pro" : state.plan === "business" ? "Business" : "Active subscription";
  return plan + (state.status === "trialing" ? " · Trial" : " · Active");
}

// "m.rossi@acme.com" -> "MR", "jsmith42@example.com" -> "J". Derived from the
// address because the dashboard never receives the first/last name fields.
function initialsFor(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._\-+]/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]).join("");
  return (letters || local[0] || "?").toUpperCase();
}

async function photoStorageKey(email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()));
  return "redaxa.profile-photo.v1." + [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

function paintAvatars(email: string | null, photo: string | null = null): void {
  document.querySelectorAll<HTMLElement>(".ps-account .ps-avatar, .ps-account-sheet .ps-avatar").forEach(avatar => {
    avatar.replaceChildren();
    if (email && photo) {
      const img = document.createElement("img"); img.src = photo; img.alt = "";
      avatar.append(img);
    } else avatar.textContent = email ? initialsFor(email) : "";
  });
}

async function loadProfilePhoto(email: string | null): Promise<void> {
  paintAvatars(email);
  if (!email) return;
  try {
    const value = localStorage.getItem(await photoStorageKey(email));
    if (currentEmail === email && value && value.length < 200_000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value)) paintAvatars(email, value);
  } catch { /* Initials remain available when local storage is disabled. */ }
}

/** Decode and re-encode the selected image; metadata and original bytes never persist. */
async function prepareProfilePhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPG, PNG or WebP image.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Choose an image smaller than 5 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 20_000_000) throw new Error("Choose an image under 20 megapixels.");
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Image editing is unavailable. Please try again.");
    context.fillStyle = "#202731"; context.fillRect(0, 0, 256, 256);
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
    return canvas.toDataURL("image/jpeg", .88);
  } finally { bitmap.close(); }
}

function installDialog(): {
  backdrop: HTMLDivElement; form: HTMLFormElement; title: HTMLElement; description: HTMLElement; submit: HTMLButtonElement;
  firstName: HTMLInputElement; registerFields: HTMLElement;
  email: HTMLInputElement; password: HTMLInputElement; passwordField: HTMLLabelElement;
  confirmPassword: HTMLInputElement; confirmPasswordField: HTMLLabelElement;
  message: HTMLElement; switcher: HTMLButtonElement; legal: HTMLElement;
  resendRow: HTMLElement; resend: HTMLButtonElement; forgot: HTMLButtonElement;
  rememberRow: HTMLElement; remember: HTMLInputElement;
} {
  const backdrop = document.createElement("div");
  backdrop.className = "ps-auth-backdrop";
  backdrop.innerHTML = `<section class="ps-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="ps-auth-title">
    <button class="ps-auth-close" type="button" aria-label="${L("Close account dialog")}">×</button>
    <h2 id="ps-auth-title">${L("Create your account")}</h2><p id="ps-auth-description">${L("Eligible new subscribers can try Redaxa free for 3 days. Prompt text is processed by Redaxa's scanner without being stored or logged.")}</p>
    <form>
    <div id="ps-auth-register-fields">
      <label class="ps-auth-field">${L("First name (optional)")}<input id="ps-auth-first-name" type="text" autocomplete="given-name"></label>
    </div>
    <label class="ps-auth-field">${L("Email")}<input id="ps-auth-email" name="email" type="email" autocomplete="username" required></label>
    <!-- Explicit for=: a label's implicit target is its first labelable
         descendant, which here was the "Forgot password?" button, leaving the
         password input with no accessible name at all. -->
    <label class="ps-auth-field" id="ps-auth-password-field" for="ps-auth-password">
      <div class="ps-auth-field-head">${L("Password")}<button type="button" class="ps-auth-forgot" id="ps-auth-forgot" hidden>${L("Forgot password?")}</button></div>
      <div class="ps-auth-pw-wrap"><input id="ps-auth-password" name="password" type="password" autocomplete="new-password" minlength="12" required><button type="button" class="ps-auth-toggle-pw" data-for="ps-auth-password">${L("Show")}</button></div>
    </label>
    <label class="ps-auth-field" id="ps-auth-confirm-password-field">${L("Confirm password")}
      <div class="ps-auth-pw-wrap"><input id="ps-auth-confirm-password" name="confirm-password" type="password" autocomplete="new-password" minlength="12"><button type="button" class="ps-auth-toggle-pw" data-for="ps-auth-confirm-password">${L("Show")}</button></div>
    </label>
    <label class="ps-auth-remember" id="ps-auth-remember-row" hidden><input type="checkbox" id="ps-auth-remember" checked> ${L("Remember me on this device")}</label>
    <button class="ps-auth-submit" type="submit">${L("Create account")}</button></form>
    <p class="ps-auth-message" role="status"></p><p class="ps-auth-switch"><button class="ps-auth-link" type="button">${L("Already have an account? Sign in")}</button></p>
    <p class="ps-auth-switch" id="ps-auth-fw" hidden>${L("Already use Frame Witness? Sign in with the same email and password.")}</p>
    <p class="ps-auth-switch" id="ps-auth-resend-row" hidden><button class="ps-auth-link" type="button" id="ps-auth-resend">${L("Resend confirmation email")}</button></p>
    <p class="ps-auth-legal" id="ps-auth-legal">${L("By creating an account you agree to our {terms} and {privacy}.", { terms: `<a href="/terms.html" target="_blank" rel="noopener">${L("Terms")}</a>`, privacy: `<a href="/privacy.html" target="_blank" rel="noopener">${L("Privacy Policy")}</a>` })}</p></section>`;
  document.body.append(backdrop);
  return {
    backdrop, form: backdrop.querySelector("form")!, title: backdrop.querySelector("#ps-auth-title")!, description: backdrop.querySelector("#ps-auth-description")!,
    submit: backdrop.querySelector(".ps-auth-submit")!, registerFields: backdrop.querySelector("#ps-auth-register-fields")!,
    firstName: backdrop.querySelector("#ps-auth-first-name")!,
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
  if (document.querySelector('link[href="auth.css"],link[href="/auth.css"]')) return;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "auth.css";
  document.head.append(stylesheet);
}

async function loadConfig(): Promise<AuthConfig> {
  const response = await authFetch(`${apiBase}/api/auth-config`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
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
    const response = await authFetch(`${apiBase}/api/auth/session`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const payload = await response.json() as { email?: string | null };
    return payload.email ?? null;
  } catch { return null; }
}

// Always point confirmation/reset emails at the web app, never at
// location.origin -- on desktop that's the Tauri window's own internal
// origin (tauri://localhost or similar), which an email client can't open
// and Supabase's redirect allowlist can't match against an http(s) URL.
// The canonical site, not the legacy Vercel host the desktop API still uses.
function authRedirect(): string { return "https://redaxa.getcertsprint.com/"; }

// Scanning is gated on an active trial or subscription, not just being signed
// in -- checked server-side too (the real enforcement point is whatever calls
// the paid API), but the UI needs to know this to avoid teasing a scan the
// account isn't entitled to run.
// The dashboard renders the plan/trial state in its sidebar. Rather than have
// it issue its own /api/account request (and race this one), the single
// response already fetched here is published as an event.
export type SyncedSettings = { detectPersonal?: boolean; detectCredentials?: boolean; detectFinancial?: boolean; scanMode?: "standard" | "strict"; customTerms?: string[] };
export type AccountState = { active: boolean; status: string | null; currentPeriodEnd: string | null; plan: string | null; repositoryAccess?: boolean; settings?: SyncedSettings | null; billing?: BillingView | null };
function publishAccountState(state: AccountState | null): void {
  latestAccount = state;
  document.dispatchEvent(new CustomEvent("redaxa:account", { detail: state }));
  document.documentElement.removeAttribute("data-plan-loading");
}

async function refreshEntitlement(): Promise<void> {
  if (!currentEmail) { accountActive = false; publishAccountState(null); return; }
  try {
    if (isTauri() && !(await desktopAccessToken())) { accountActive = false; publishAccountState(null); return; }
    const response = await authorizedFetch("/api/account", { headers: {}, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) { accountActive = false; publishAccountState(null); return; }
    const payload = await response.json() as { active?: boolean; status?: string | null; currentPeriodEnd?: string | null; plan?: string | null; repositoryAccess?: boolean; settings?: SyncedSettings | null; billing?: unknown };
    accountActive = Boolean(payload.active);
    publishAccountState({
      active: accountActive,
      status: payload.status ?? null,
      currentPeriodEnd: payload.currentPeriodEnd ?? null,
      plan: payload.plan ?? null,
      repositoryAccess: payload.repositoryAccess,
      settings: payload.settings ?? null,
      billing: parseBilling(payload.billing)
    });
  } catch { accountActive = false; publishAccountState(null); }
}

/* ---------- Back from Stripe ----------
 * Checkout and the billing portal send the customer back here with
 * ?checkout=success|cancelled or ?billing=managed. Says what happened (copy
 * in trial.ts), waits for the webhook to record the plan, then the address
 * loses the parameters so a reload or a shared link does not repeat it. */
function savedLanguage(): string {
  try { return String(JSON.parse(localStorage.getItem("redaxa.personal-preferences.v1") ?? "{}")?.language ?? ""); } catch { return ""; }
}
async function showStripeReturn(): Promise<void> {
  const found = readStripeReturn(location.search, savedLanguage() || document.documentElement.lang);
  if (!found) return;
  history.replaceState(history.state, "", withoutStripeReturn(location.href));
  const { kind, lang } = found;
  const w = RETURN_COPY[lang];
  const esc = (value: string): string => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const box = document.createElement("section");
  box.className = `ps-return${kind === "success" ? "" : " is-quiet"}`;
  box.lang = lang;
  box.tabIndex = -1;
  box.setAttribute("aria-labelledby", "ps-return-title");
  const next = kind === "success"
    ? `<h3>${esc(w.stepsTitle)}</h3><ul><li><a href="/dashboard.html">${esc(w.workspace)}</a></li><li><a href="https://dl.pctweaker.app/redaxa/Redaxa-Setup.exe">${esc(w.windows)}</a></li><li><a href="https://chromewebstore.google.com/detail/redaxa/clkobbjoaegkgnmkibjghlboeoplpmok" target="_blank" rel="noopener">${esc(w.extension)}</a></li></ul><p>${esc(w.sameEmail)}</p>`
    : kind === "cancelled" ? `<p><a href="/dashboard.html#plans">${esc(w.seePlans)}</a></p>` : "";
  box.innerHTML = `<h2 id="ps-return-title"></h2><p class="ps-return-text" role="status"></p>${next}<button type="button" class="ps-return-close" aria-label="${esc(w.dismiss)}">×</button>`;
  box.querySelector(".ps-return-close")!.addEventListener("click", () => box.remove());
  const paint = (settled: boolean): boolean => {
    const view = returnView(kind, lang, { signedIn: Boolean(currentEmail), billing: latestAccount?.billing ?? null, settled });
    box.querySelector("h2")!.textContent = view.title;
    box.querySelector(".ps-return-text")!.textContent = view.text;
    return view.confirmed;
  };
  let confirmed = paint(false);
  (document.querySelector("main") ?? document.body).prepend(box);
  box.focus();
  if (!currentEmail || kind === "cancelled") return;
  // The webhook usually lands within seconds of the redirect; ask a few times, then say it is still on its way.
  for (let attempt = 0; attempt < (kind === "success" ? 8 : 2) && !confirmed; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await refreshEntitlement();
    if (!box.isConnected) return;
    confirmed = kind === "success" && paint(false);
  }
  if (kind === "success" && !confirmed) paint(true);
}

async function boot(): Promise<void> {
  restoreTheme();
  installDesktopTitlebar();
  installStylesheet();
  const desktop = isTauri();
  const controls = accountControls();
  const dialog = installDialog();

  const configReady = loadConfig().catch(() => ({ configured: false }));
  window.addEventListener("focus", () => { void refreshEntitlement(); });
  // Set only while the recovery link's own screen is open, and cleared the
  // moment it is used. Its presence is what tells the one submit handler
  // below that this is a password being set rather than a sign-in.
  let recoveryToken: string | null = null;
  // One-time hashes from the current confirmation and reset emails. Spent only
  // when the reader acts on this page, so link scanners cannot use them up.
  let recoveryHash: string | null = null;
  let confirmHash: string | null = null;
  const show = (): void => { dialog.backdrop.classList.add("open"); dialog.email.focus(); };
  const close = (): void => dialog.backdrop.classList.remove("open");
  const setMessage = (message: string, error = false): void => { dialog.message.textContent = L(message); dialog.message.classList.toggle("error", error); };
  const setMode = (nextMode: typeof mode): void => {
    mode = nextMode; setMessage("");
    recoveryToken = null; recoveryHash = null; confirmHash = null;
    dialog.switcher.hidden = false;
    dialog.email.closest("label")?.removeAttribute("hidden");
    dialog.email.required = true;
    const signup = mode === "signup"; const recovery = mode === "recovery";
    dialog.title.textContent = L(signup ? "Create your account" : recovery ? "Reset your password" : "Welcome back");
    dialog.description.textContent = L(signup ? "Use a password with at least 12 characters. We will send a verification email." : recovery ? "We will email you a secure link to choose a new password." : "Sign in to continue with your private workspace.");
    dialog.registerFields.hidden = !signup;
    dialog.firstName.required = false;
    dialog.passwordField.hidden = recovery; dialog.password.required = !recovery; dialog.password.autocomplete = signup ? "new-password" : "current-password";
    dialog.confirmPasswordField.hidden = !signup; dialog.confirmPassword.required = signup; dialog.confirmPassword.value = "";
    dialog.legal.hidden = !signup;
    dialog.rememberRow.hidden = mode !== "signin";
    dialog.resendRow.hidden = !signup;
    dialog.backdrop.querySelector<HTMLElement>("#ps-auth-fw")!.hidden = !signup;
    if (signup) resendCooldownTicker();
    dialog.forgot.hidden = mode !== "signin";
    dialog.submit.textContent = L(signup ? "Create account" : recovery ? "Send reset link" : "Sign in");
    dialog.switcher.textContent = L(signup ? "Already have an account? Sign in" : recovery ? "Back to sign in" : "New here? Create an account");
  };
  const renderAccount = (email: string | null): void => {
    currentEmail = email;
    controls.account.classList.toggle("open", Boolean(email)); controls.trigger.hidden = Boolean(email); controls.login.hidden = Boolean(email);
    controls.email.textContent = email ?? "";
    void loadProfilePhoto(email);
    if (!email) { controls.closeMenu(); publishAccountState(null); }
    document.documentElement.removeAttribute("data-account-loading");
  };
  currentEmail = await loadSession();
  renderAccount(currentEmail);
  await refreshEntitlement();
  void showStripeReturn();
  config = await configReady;

  // Persist an invitation through signup, but joining always requires reviewing
  // the server-verified inviter/workspace and clicking Accept in this dialog.
  const pendingInviteKey = "redaxa.pending-invite.v1";
  const inviteDialog = document.createElement("dialog");
  inviteDialog.className = "ps-account-sheet";
  inviteDialog.setAttribute("aria-labelledby", "ps-invite-title");
  inviteDialog.innerHTML = '<header><h2 id="ps-invite-title">Review team invitation</h2><button type="button" data-invite-cancel aria-label="Close invitation">×</button></header><p data-invite-details></p><p>Joining applies this workspace’s protected terms and policies to your checks. Its owner and admins can see your future scan activity metadata, including times, application, counts and categories. Prompt text is not stored.</p><p data-invite-message role="status"></p><div class="ps-account-actions"><button type="button" data-invite-accept disabled>Accept invitation</button><button type="button" data-invite-cancel>Decline</button></div>';
  document.body.append(inviteDialog);
  const inviteAccept = inviteDialog.querySelector<HTMLButtonElement>("[data-invite-accept]")!;
  const inviteDetails = inviteDialog.querySelector<HTMLElement>("[data-invite-details]")!;
  const inviteMessage = inviteDialog.querySelector<HTMLElement>("[data-invite-message]")!;
  let verifiedInvite: { token: string; email: string } | null = null;
  let inviteBusy = false;
  const dismissInvite = (): void => {
    if (inviteBusy) return;
    verifiedInvite = null;
    localStorage.removeItem(pendingInviteKey);
    inviteDialog.close();
  };
  inviteDialog.querySelectorAll("[data-invite-cancel]").forEach(button => button.addEventListener("click", dismissInvite));
  inviteDialog.addEventListener("cancel", event => { event.preventDefault(); dismissInvite(); });
  const reviewPendingInvite = async (): Promise<void> => {
    if (desktop) return;
    const token = localStorage.getItem(pendingInviteKey);
    if (!token || !currentEmail) return;
    verifiedInvite = null;
    inviteAccept.disabled = true;
    inviteDetails.textContent = "";
    inviteMessage.textContent = "Checking this invitation…";
    if (!inviteDialog.open) inviteDialog.showModal();
    const email = currentEmail;
    try {
      if (!/^[a-f0-9]{32}$/i.test(token)) throw new Error("That invitation link is invalid.");
      const preview = await apiRequest(`/api/team?action=preview&token=${encodeURIComponent(token)}`, undefined, "GET") as { inviter?: { email?: string }; organization?: { id?: string; name?: string } };
      if (currentEmail !== email || localStorage.getItem(pendingInviteKey) !== token || !inviteDialog.open) return;
      if (!preview.inviter?.email || !preview.organization?.id || !preview.organization.name) throw new Error("We could not verify the inviter and workspace. Try the link again.");
      inviteDetails.textContent = `${preview.inviter.email} invited you to ${preview.organization.name}. You will join as ${email}.`;
      inviteMessage.textContent = "Choose whether to join this workspace.";
      verifiedInvite = { token, email };
      inviteAccept.disabled = false;
    } catch (error) {
      inviteMessage.textContent = error instanceof Error ? error.message : "We could not verify that invitation.";
    }
  };
  inviteAccept.addEventListener("click", async () => {
    const reviewed = verifiedInvite;
    if (inviteBusy || !reviewed || currentEmail !== reviewed.email || localStorage.getItem(pendingInviteKey) !== reviewed.token) return;
    inviteBusy = true;
    inviteAccept.disabled = true;
    try {
      await apiRequest("/api/team?action=accept", { token: reviewed.token });
      localStorage.removeItem(pendingInviteKey);
      verifiedInvite = null;
      await refreshEntitlement();
      inviteMessage.textContent = "You have joined the workspace.";
    } catch (error) {
      inviteMessage.textContent = error instanceof Error ? error.message : "We could not accept that invitation.";
      inviteAccept.disabled = false;
    } finally { inviteBusy = false; }
  });

  // Install the form handlers before handling entry links, including recovery.
  const handleEntryLinks = async (): Promise<void> => {
  const entry = new URLSearchParams(location.hash.slice(1));
  const validHash = (value: string | null): string | null => value && /^[A-Za-z0-9_-]{20,128}$/.test(value) ? value : null;
  if (!desktop && (entry.has("confirm") || entry.has("recovery"))) {
    history.replaceState(null, "", location.pathname + location.search);
    const recovering = entry.has("recovery");
    const hash = validHash(entry.get(recovering ? "recovery" : "confirm"));
    if (!hash) {
      setMode(recovering ? "recovery" : "signup");
      setMessage(recovering ? "That reset link is incomplete. Request a new one below." : "That confirmation link is incomplete. Enter your email and resend the confirmation.", true);
      show();
    } else if (recovering) {
      setMode("recovery");
      recoveryHash = hash;
      dialog.title.textContent = L("Choose a new password");
      dialog.description.textContent = L("Use at least 12 characters. Every device signed in to your account will be signed out.");
      dialog.email.closest("label")?.setAttribute("hidden", "hidden");
      dialog.email.required = false;
      dialog.passwordField.hidden = false;
      dialog.password.required = true;
      dialog.password.value = "";
      dialog.password.autocomplete = "new-password";
      dialog.password.minLength = 12;
      dialog.submit.textContent = L("Set the new password");
      dialog.switcher.hidden = true;
      show();
    } else {
      setMode("signin");
      confirmHash = hash;
      dialog.title.textContent = L("Confirm your email");
      dialog.description.textContent = L("Select Confirm email to finish creating your Redaxa account. Then sign in with your password.");
      dialog.email.closest("label")?.setAttribute("hidden", "hidden");
      dialog.email.required = false;
      dialog.passwordField.hidden = true;
      dialog.password.required = false;
      dialog.rememberRow.hidden = true;
      dialog.forgot.hidden = true;
      dialog.submit.textContent = L("Confirm email");
      dialog.switcher.hidden = true;
      show();
    }
  } else
  // Token fragments cannot establish a browser identity. A recovery token is
  // used only after the user explicitly submits a new password.
  if (!desktop && location.hash.includes("access_token")) {
    const hashParams = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, "", location.pathname + location.search);
    const hashAccessToken = hashParams.get("access_token");

    // Confirmation links require a fresh credential sign-in. Recovery links
    // show the password form without adopting the token as a session.
    if (hashParams.get("type") === "recovery" && hashAccessToken) {
      // Keep the recovery bearer solely for the explicit password submission.
      setMode("recovery");
      dialog.title.textContent = L("Choose a new password");
      dialog.description.textContent = L("Use a password with at least 12 characters.");
      // The dialog exposes a wrapper for the password fields but not for the
      // email one, so this reaches for its label rather than adding a field
      // to the shape for a single screen.
      dialog.email.closest("label")?.setAttribute("hidden", "hidden");
      dialog.email.required = false;
      dialog.passwordField.hidden = false;
      dialog.password.required = true;
      dialog.password.value = "";
      dialog.password.autocomplete = "new-password";
      dialog.password.minLength = 12;
      dialog.submit.textContent = L("Set the new password");
      dialog.switcher.hidden = true;
      recoveryToken = hashAccessToken;
      show();
    } else {
      setMode("signin");
      setMessage("Verification link received. Sign in with your own email and password to continue.");
      show();
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
      const url = new URL(location.href);
      url.searchParams.delete("invite");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
      if (!currentEmail && !recoveryToken) { setMode("signup"); setMessage("Create an account or sign in to review this team invitation."); show(); }
    }
    if (currentEmail && !recoveryToken && localStorage.getItem(pendingInviteKey)) { close(); await reviewPendingInvite(); }

    // Lets external entry points (the browser extension popup, which has no
    // room for its own signup/recovery forms) deep-link straight into the
    // right mode instead of dumping the user on a plain sign-in screen.
    const authParam = new URLSearchParams(location.search).get("auth");
    if (authParam === "signup" || authParam === "recovery") {
      const url = new URL(location.href);
      url.searchParams.delete("auth");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
      if (!currentEmail && !recoveryToken) { setMode(authParam); show(); }
    }
  }
  };

  window.promptShieldAuth = {
    hasAccess: () => Boolean(currentEmail) && accountActive,
    hasAccount: () => Boolean(currentEmail),
    requestAccess: (message) => {
      if (!currentEmail) {
        setMode("signup");
        setMessage(message ?? (trialDaysOffered ? `Create an account to choose a plan. You can try Pro or Business free for ${trialDaysOffered} days.` : "Create an account to choose a plan. Eligible new subscribers start with a 3-day free trial."));
        show();
        return;
      }
      // Already signed in but no active trial/subscription: point at pricing
      // instead of re-showing a login form the user doesn't need.
      document.dispatchEvent(new CustomEvent("redaxa:need-upgrade", { detail: { message } }));
    },
    scanPrompt: async (text, options) => {
      // Audit metadata only: which surface asked. Grants nothing server-side.
      const application = "__TAURI_INTERNALS__" in window ? "desktop" : "web";
      const payload = await apiRequest("/api/scan", { text, application, options: options ?? {} }) as { findings?: Finding[]; redactedText?: string; decision?: ScanDecision };
      return { findings: payload.findings ?? [], redactedText: payload.redactedText ?? "", decision: payload.decision };
    },
    request: (path, body, method) => apiRequest(path, body, method),
    download: (path) => apiDownload(path),
    email: () => currentEmail,
    signOut: () => signOut()
  };
  document.dispatchEvent(new Event("redaxa:auth-ready"));
  controls.trigger.addEventListener("click", (event) => { event.preventDefault(); if (!config?.configured) { setMessage("Account setup is being completed. Please try again shortly.", true); } setMode("signup"); show(); });
  controls.login.addEventListener("click", (event) => { event.preventDefault(); if (!config?.configured) { setMessage("Account setup is being completed. Please try again shortly.", true); } setMode("signin"); show(); });

  const beginCheckout = async (button: HTMLElement): Promise<void> => {
    // Intent is recorded before the account step so a drop at signup shows.
    // Business is stored under the worker's top-tier event name.
    track(button.dataset.plan === "business" ? "checkout_start_studio" : "checkout_start_pro");
    if (!currentEmail) {
      setMode("signup");
      setMessage("Create an account first to choose a plan.");
      show();
      return;
    }
    const plan = button.dataset.plan;
    const interval = button.dataset.interval;
    const seats = plan === "business" ? Number(document.querySelector<HTMLSelectElement>("#business-seats")?.value ?? 1) : 1;
    // "Start free trial" or "Subscribe now"; a page without the choice sends neither,
    // and the server then applies the trial these pages have always advertised.
    const choice = button.dataset.choice;
    const startTrial = choice === "trial" ? { start_trial: true } : choice === "now" ? { start_trial: false } : {};
    // Only so the trial emails are written in the language the page is in.
    const language = document.documentElement.lang;
    button.setAttribute("aria-busy", "true");
    (button as HTMLButtonElement).disabled = true;
    try {
      const payload = await apiRequest("/api/billing", { plan, interval, seats, ...startTrial, ...(language ? { language } : {}) }) as { url?: string };
      if (!payload.url) throw new Error("Checkout could not be opened.");
      if (desktop) void openInSystemBrowser(payload.url); else location.assign(payload.url);
    } catch (error) {
      if (error instanceof Error && (error as Error & { code?: string }).code === "trial_unavailable") {
        // Used in the meantime (another account, the same card): the page redraws with Subscribe now only.
        await refreshEntitlement();
        document.dispatchEvent(new CustomEvent("redaxa:trial-unavailable", { detail: { plan } }));
      }
      else if (error instanceof Error && (error as Error & { code?: string }).code === "manage_billing") void manageBilling();
      else if (error instanceof Error && error.message === "UNAUTHORIZED") { renderAccount(null); void clearDesktopSession(); setMode("signin"); setMessage("Please sign in again to continue."); show(); }
      else { setMessage(error instanceof Error ? error.message : "Checkout could not be opened.", true); show(); }
    } finally {
      button.removeAttribute("aria-busy");
      (button as HTMLButtonElement).disabled = false;
    }
  };
  document.querySelectorAll<HTMLElement>("[data-plan]").forEach((button) => button.addEventListener("click", () => void beginCheckout(button)));
  let billingBusy = false;
  const manageBilling = async (): Promise<void> => {
    if (billingBusy) return;
    billingBusy = true;
    if (!currentEmail) { billingBusy = false; setMode("signin"); setMessage("Sign in to manage your subscription."); show(); return; }
    try {
      const payload = await apiRequest("/api/billing?action=portal") as { url?: string };
      if (!payload.url) throw new Error("Billing management is unavailable.");
      if (desktop) await openInSystemBrowser(payload.url); else location.assign(payload.url);
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") { renderAccount(null); void clearDesktopSession(); setMode("signin"); setMessage("Please sign in again to continue."); show(); }
      else { paintAccountSheet(); accountSheet.querySelector<HTMLElement>(".ps-account-message")!.textContent = error instanceof Error ? error.message : "Billing management is unavailable."; if (!accountSheet.open) accountSheet.showModal(); }
    }
    finally { billingBusy = false; }
  };

  const accountSheet = document.createElement("dialog");
  accountSheet.className = "ps-account-sheet";
  accountSheet.setAttribute("aria-labelledby", "ps-account-title");
  accountSheet.innerHTML = `<header><div><h2 id="ps-account-title">Your account</h2><p>Subscription, access and account settings.</p></div><button type="button" data-sheet-close aria-label="Close account details">×</button></header>
    <section class="ps-profile-editor" aria-label="Profile photo"><span class="ps-avatar ps-profile-preview" aria-hidden="true"></span><div><label for="ps-profile-file">Profile photo</label><p>Saved on this device only. JPG, PNG or WebP, up to 5 MB.</p><input id="ps-profile-file" type="file" accept="image/jpeg,image/png,image/webp"><button type="button" data-photo-remove>Remove photo</button><p data-photo-message role="status"></p></div></section>
    <dl class="ps-account-facts"><div><dt>Email</dt><dd data-account-email></dd></div><div><dt>Plan</dt><dd data-account-plan></dd></div><div><dt data-account-period-label>Current period ends</dt><dd data-account-period></dd></div><div><dt>Repository access</dt><dd data-account-access></dd></div></dl>
    <p class="ps-account-message" role="status"></p><div class="ps-account-actions"><button type="button" data-sheet-billing>Manage subscription</button><button type="button" data-sheet-refresh>Refresh account</button></div>`;
  document.body.append(accountSheet);
  const paintAccountSheet = (): void => {
    void loadProfilePhoto(currentEmail);
    accountSheet.querySelector<HTMLElement>("[data-account-email]")!.textContent = currentEmail ?? "Signed out";
    accountSheet.querySelector<HTMLElement>("[data-account-plan]")!.textContent = accountPlanLabel(latestAccount);
    const period = latestAccount?.currentPeriodEnd ? new Date(latestAccount.currentPeriodEnd) : null;
    const trialing = latestAccount?.status === "trialing";
    const paused = latestAccount?.billing?.state === "blocked" && latestAccount.billing.blockedReason === "payment_failed";
    accountSheet.querySelector<HTMLElement>("[data-account-period-label]")!.textContent = trialing ? "Free trial ends" : "Current period ends";
    accountSheet.querySelector<HTMLElement>("[data-account-period]")!.textContent = paused ? "Paused until a payment goes through. Update the payment method under Manage subscription."
      : period && Number.isFinite(period.getTime()) ? period.toLocaleDateString(undefined, {year:"numeric",month:"long",day:"numeric"}) + (trialing && latestAccount?.billing?.cancelAtPeriodEnd ? " · cancelled, nothing will be charged" : "") : "Not available";
    accountSheet.querySelector<HTMLElement>("[data-account-access]")!.textContent = !latestAccount ? "Could not verify access" : latestAccount.repositoryAccess === true ? "Included · Windows app required" : latestAccount.repositoryAccess === false || !latestAccount.active ? "Not included in current access" : "Check your plan details";
  };
  const sheetClose = (): void => accountSheet.close();
  const photoInput = accountSheet.querySelector<HTMLInputElement>("#ps-profile-file")!;
  const photoRemove = accountSheet.querySelector<HTMLButtonElement>("[data-photo-remove]")!;
  const photoMessage = accountSheet.querySelector<HTMLElement>("[data-photo-message]")!;
  let photoBusy = false;
  photoInput.addEventListener("change", async () => {
    const file = photoInput.files?.[0]; const owner = currentEmail;
    if (!file || !owner || photoBusy) return;
    photoBusy = true; photoInput.disabled = photoRemove.disabled = true; photoMessage.textContent = "Preparing photo…";
    try {
      const value = await prepareProfilePhoto(file); const key = await photoStorageKey(owner);
      if (currentEmail !== owner) return;
      localStorage.setItem(key, value); paintAvatars(owner, value); photoMessage.textContent = "Photo saved on this device.";
    } catch (error) { photoMessage.textContent = error instanceof Error ? error.message : "Photo could not be saved. Try another image."; }
    finally { photoBusy = false; photoInput.disabled = photoRemove.disabled = false; photoInput.value = ""; }
  });
  photoRemove.addEventListener("click", async () => {
    const owner = currentEmail; if (!owner || photoBusy) return;
    photoBusy = true; photoInput.disabled = photoRemove.disabled = true;
    try { const key = await photoStorageKey(owner); if (currentEmail !== owner) return; localStorage.removeItem(key); paintAvatars(owner); photoMessage.textContent = "Photo removed."; }
    catch { photoMessage.textContent = "Photo could not be removed. Please retry."; }
    finally { photoBusy = false; photoInput.disabled = photoRemove.disabled = false; }
  });
  accountSheet.addEventListener("close", () => controls.account.querySelector<HTMLButtonElement>(".ps-avatar-btn")?.focus());
  accountSheet.querySelector("[data-sheet-close]")!.addEventListener("click", sheetClose);
  accountSheet.addEventListener("click", event => { if(event.target===accountSheet){const rect=accountSheet.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)sheetClose();} });
  accountSheet.querySelector("[data-sheet-billing]")!.addEventListener("click", () => { sheetClose(); openSubscription(); });
  accountSheet.querySelector("[data-sheet-refresh]")!.addEventListener("click", async event => {
    const button=event.currentTarget as HTMLButtonElement;button.disabled=true;
    await refreshEntitlement();paintAccountSheet();
    accountSheet.querySelector<HTMLElement>(".ps-account-message")!.textContent = latestAccount ? "Account status refreshed." : "Account service unavailable. Try again shortly.";
    button.disabled=false;
  });
  const openSubscription = mountSubscriptionPanel({
    menu: controls.account, desktop, manageBilling,
    signIn: (message: string) => { renderAccount(null); void clearDesktopSession(); setMode("signin"); setMessage(message); show(); },
  });
  controls.account.querySelectorAll<HTMLButtonElement>("[data-account-action]").forEach(button => button.addEventListener("click", event => {
    const action=(event.currentTarget as HTMLButtonElement).dataset.accountAction;
    if(!action)return;
    if(action==="overview" || action==="photo"){paintAccountSheet();accountSheet.showModal();if(action==="photo")photoInput.focus();return;}
    if(action==="subscription"){openSubscription();return;}
    if(action==="billing"){void manageBilling();return;}
    if(action==="password"){setMode("recovery");dialog.email.value=currentEmail??"";show();return;}
    const target=action==="privacy"?webAppUrl+"/privacy.html":action==="support"?"mailto:redaxa@getcertsprint.com?subject=Redaxa%20support":null;
    if(target)void openInSystemBrowser(target).then(opened=>{if(!opened)location.assign(target);}).catch(()=>{setMode("signin");setMessage("Could not open the link. Contact redaxa@getcertsprint.com for support.",true);show();});
  }));
  dialog.backdrop.querySelector(".ps-auth-close")?.addEventListener("click", close);
  dialog.backdrop.addEventListener("click", (event) => { if (event.target === dialog.backdrop) close(); });
  const signOut = async (): Promise<void> => {
    accountActive = false;
    if (desktop) {
      const session = cachedDesktopSession();
      await clearDesktopSession();
      renderAccount(null);
      if (session) void authFetch(`${apiBase}/api/auth/signout`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } }).catch(() => undefined);
    } else {
      await apiRequest("/api/auth/signout").catch(() => undefined);
      renderAccount(null);
    }
  };
  controls.signout.addEventListener("click", () => void signOut());
  dialog.switcher.addEventListener("click", () => setMode(mode === "recovery" ? "signin" : mode === "signup" ? "signin" : "signup"));
  dialog.forgot.addEventListener("click", () => setMode("recovery"));
  dialog.backdrop.addEventListener("click", (event) => {
    const toggle = (event.target as HTMLElement).closest<HTMLButtonElement>(".ps-auth-toggle-pw");
    if (!toggle?.dataset.for) return;
    const input = dialog.backdrop.querySelector<HTMLInputElement>(`#${toggle.dataset.for}`);
    if (!input) return;
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    toggle.textContent = showing ? L("Show") : L("Hide");
  });
  // One free manual resend right after the automatic signup email, then a
  // 600s cooldown per email before another is allowed -- tracked client-side
  // (the server also rate-limits independently as a backstop).
  const resendCooldownKey = "redaxa.resend-cooldown.v1";
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
      dialog.resend.textContent = L("Resend available in {time}", { time: `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` });
      window.setTimeout(resendCooldownTicker, 1000);
    } else {
      dialog.resend.disabled = false;
      dialog.resend.textContent = L("Resend confirmation email");
    }
  };
  dialog.resend.addEventListener("click", async () => {
    const email = dialog.email.value.trim();
    if (!email) { setMessage("Enter your email address first.", true); dialog.email.focus(); return; }
    const cooldowns = readResendCooldown();
    const key = email.toLowerCase();
    if ((cooldowns[key] ?? 0) > Date.now()) { resendCooldownTicker(); return; }
    dialog.resend.disabled = true;
    dialog.resend.textContent = L("Sending…");
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
        dialog.submit.textContent = L("Creating account…");
        await apiRequest("/api/auth/signup", {
          email: dialog.email.value.trim(), password: dialog.password.value, emailRedirectTo: authRedirect(),
          firstName: dialog.firstName.value.trim()
        });
        // Stays in signup mode (not switched to signin) so the resend
        // option -- which only makes sense right after registering -- is
        // right there instead of requiring a trip to the login screen.
        setMessage(`${L("Account created. Check your email for a confirmation link, then sign in here.")} ${L("Already use Frame Witness? Sign in with the same email and password.")}`);
        resendCooldownTicker();
      } else if (mode === "signin") {
        dialog.submit.textContent = L("Signing in…");
        const payload = await apiRequest("/api/auth/signin", { email: dialog.email.value.trim(), password: dialog.password.value, remember: dialog.remember.checked }) as
          { email?: string; access_token?: string; refresh_token?: string; expires_in?: number };
        const email = payload.email ?? dialog.email.value.trim();
        if (desktop && payload.access_token && payload.refresh_token) {
          await saveDesktopSession({ email, access_token: payload.access_token, refresh_token: payload.refresh_token, expires_at: Date.now() + (payload.expires_in ?? 3600) * 1000 });
        }
        renderAccount(email); await refreshEntitlement();
        if (localStorage.getItem(pendingInviteKey)) { close(); await reviewPendingInvite(); }
        else { setMessage("Signed in successfully."); window.setTimeout(close, 700); }
      } else if (confirmHash) {
        const hash = confirmHash;
        dialog.submit.textContent = L("Confirming…");
        const payload = await apiRequest("/api/auth/signup", { confirm: hash }) as { email?: string };
        dialog.submit.textContent = restingLabel;
        setMode("signin");
        if (payload.email) dialog.email.value = payload.email;
        setMessage("Email confirmed. Sign in with your password to continue.");
        dialog.password.focus();
      } else if (recoveryHash) {
        dialog.submit.textContent = L("Saving…");
        // Kept until the server accepts it: a rejected password does not spend the link.
        await apiRequest("/api/auth/recover?action=finish", { token_hash: recoveryHash, password: dialog.password.value });
        dialog.submit.textContent = restingLabel;
        dialog.switcher.hidden = false;
        setMode("signin");
        setMessage("Password changed and other devices signed out. Sign in with the new password.");
      } else if (recoveryToken) {
        // The second half of a recovery: the link has been followed and a new
        // password typed. Cleared before the await so a double submit cannot
        // spend the same token twice.
        const token = recoveryToken;
        recoveryToken = null;
        dialog.submit.textContent = L("Saving…");
        await apiRequest("/api/auth/recover?action=finish", {
          access_token: token,
          password: dialog.password.value,
        });
        dialog.submit.textContent = restingLabel;
        dialog.switcher.hidden = false;
        setMode("signin");
        setMessage("Password changed. Sign in with the new one.");
      } else {
        dialog.submit.textContent = L("Sending link…");
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
  await handleEntryLinks();
}

if (typeof document !== "undefined") void boot();
