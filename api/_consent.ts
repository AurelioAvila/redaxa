import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { Language } from "./_trial.js";

/**
 * Consent before Stripe (owner decision, 3 November 2026). Managed Payments
 * refuses consent_collection and custom_text, so the Terms tick box lives on
 * our own page, /checkout, between the plan button and Stripe:
 *
 *   POST /api/billing (web, Windows app, any version)  ->  { url: /checkout?t=... }
 *   GET  /checkout?t=...                               ->  this page
 *   POST /checkout (box ticked)                        ->  consent row, then 303 to Stripe
 *
 * Every client already opens whatever `url` the API returns, so installed apps
 * need no release. The switch is CHECKOUT_CONSENT=required (Vercel env); while
 * it is unset the API creates the Stripe session directly, as before.
 */

/** The date terms.html shows as "Last updated". A new date makes a page that
 *  is already open ask for the tick again (409 on submit). */
export const TERMS_VERSION = "2026-11-03";
export const TERMS_URL = "https://redaxa.getcertsprint.com/terms.html";
export const consentRequired = (): boolean => process.env.CHECKOUT_CONSENT === "required";

/** What the plan button asked for, sealed into the /checkout link: the page
 *  opens in a browser that may hold no Redaxa session (the desktop app opens
 *  the system browser), so the link itself carries who asked, for an hour. */
export type CheckoutIntent = {
  user: string; email: string;
  plan: "personal" | "business"; interval: "monthly" | "yearly"; seats: number;
  startTrial?: boolean; lang: Language | null; oldApp: boolean;
  /** Where Stripe sends the customer back: the web origin they came from. */
  app: string;
  exp: number;
};

const TOKEN_TTL_MS = 60 * 60_000;

function key(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  return Buffer.from(hkdfSync("sha256", secret, "redaxa", "checkout-consent-v1", 32));
}

/** AES-256-GCM: the link can be neither read nor altered (email inside). */
export function sealIntent(intent: Omit<CheckoutIntent, "exp">, now = Date.now()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ ...intent, exp: now + TOKEN_TTL_MS }), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** The intent, or null when the link is forged, altered or older than an hour. */
export function openIntent(token: unknown, now = Date.now()): CheckoutIntent | null {
  if (typeof token !== "string" || token.length < 40 || token.length > 4096) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    // authTagLength pins the full 16-byte tag: GCM would otherwise accept a truncated one.
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12), { authTagLength: 16 });
    decipher.setAuthTag(raw.subarray(12, 28));
    const intent = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as CheckoutIntent;
    return typeof intent.exp === "number" && intent.exp > now ? intent : null;
  } catch {
    return null;
  }
}

/** "Chrome/Windows": the browser family only, never the full user agent. */
export function userAgentFamily(ua: string | undefined): string {
  const s = ua ?? "";
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\/|Opera/.test(s) ? "Opera" : /Firefox\//.test(s) ? "Firefox"
    : /Chrome\/|CriOS\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "Other";
  const os = /Windows/.test(s) ? "Windows" : /Android/.test(s) ? "Android" : /iPhone|iPad|iOS/.test(s) ? "iOS"
    : /Mac OS X|Macintosh/.test(s) ? "macOS" : /Linux/.test(s) ? "Linux" : "Other";
  return `${browser}/${os}`;
}

/** Consent rows older than this are deleted by the cron sweep (privacy.html: 13 months). */
export function consentCutoff(now = Date.now()): string {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - 13);
  return date.toISOString();
}

type Service = (path: string, init?: RequestInit) => Promise<Response>;
export type ConsentRow = {
  id: string; user_id: string; plan: string; billing_interval: string; seats: number;
  terms_version: string; ip: string; user_agent_family: string;
};

/** Written before the Stripe session exists: no row, no session. */
export async function recordConsent(service: Service, row: ConsentRow): Promise<void> {
  const response = await service("/rest/v1/checkout_consents", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ...row, product: "redaxa" }) });
  if (!response.ok) {
    console.error("checkout consent insert failed:", response.status, (await response.text()).slice(0, 300));
    throw new Error("CONSENT_STORAGE_ERROR");
  }
}

/** Never in the way of the checkout: the row already proves the consent; the
 *  session also carries consent_id in its metadata. */
export async function attachSession(service: Service, consentId: string, sessionId: string): Promise<void> {
  const response = await service(`/rest/v1/checkout_consents?id=eq.${encodeURIComponent(consentId)}`, { method: "PATCH", body: JSON.stringify({ checkout_session_id: sessionId }) }).catch(() => null);
  if (!response?.ok) console.error("checkout consent session link failed:", response?.status ?? "network");
}

export async function purgeConsents(service: Service, now = Date.now()): Promise<boolean> {
  const response = await service(`/rest/v1/checkout_consents?accepted_at=lt.${encodeURIComponent(consentCutoff(now))}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  return response.ok;
}

/* --- The page ------------------------------------------------------------ */

export type PageError = "consent" | "terms" | "payment_processing" | "manage_billing" | "active" | "busy" | "trial_unavailable" | "too_many" | "generic";

type Copy = {
  title: string; h1: string; selected: string; monthly: string; yearly: string; seats: string;
  trial: string; now: string; price: string;
  before: string; terms: string; after: string;
  cta: string; back: string; expiredTitle: string; expired: string;
  errors: Record<PageError, string>;
};

const EN: Copy = {
  title: "Confirm your plan", h1: "Confirm and continue", selected: "Your selected plan", monthly: "Monthly", yearly: "Yearly", seats: "{n} users",
  trial: "Starts with a {days}-day free trial. Nothing is charged today.", now: "The subscription starts today and is charged today.",
  price: "Stripe’s secure checkout page shows the final price before you pay.",
  before: "I agree to the ", terms: "Terms",
  after: ". I ask for immediate access to this digital content and understand that I lose my 14-day right of withdrawal once access starts. Purchases are not refundable, except where Link’s buyer terms or the law require a refund. Subscriptions renew automatically until you cancel.",
  cta: "Continue to secure checkout", back: "Back to plans",
  expiredTitle: "This checkout link has expired", expired: "Go back to Redaxa and choose your plan again. Nothing has been charged.",
  errors: {
    consent: "Tick the box to continue.",
    terms: "The Terms changed while this page was open. Read them, then tick the box again.",
    payment_processing: "Your last payment is still being confirmed. Give it a minute, then refresh your plan in Redaxa.",
    manage_billing: "Your subscription has a payment to sort out. Update it in Manage subscription in Redaxa instead of starting a new one.",
    active: "This account already has an active plan.",
    busy: "A checkout is already being prepared for this account. Wait a few minutes, then try again.",
    trial_unavailable: "The free trial is not available for this account. Go back to Redaxa and choose Subscribe now.",
    too_many: "Too many attempts. Wait a few minutes, then try again.",
    generic: "We could not start checkout. Please try again.",
  },
};

const COPY: Record<Language, Copy> = {
  en: EN,
  it: {
    title: "Conferma il piano", h1: "Conferma e continua", selected: "Il piano scelto", monthly: "Mensile", yearly: "Annuale", seats: "{n} utenti",
    trial: "Inizia con {days} giorni di prova gratuita. Oggi non paghi nulla.", now: "L’abbonamento parte oggi e viene addebitato oggi.",
    price: "La pagina di pagamento sicura di Stripe mostra il prezzo finale prima che tu paghi.",
    before: "Accetto i ", terms: "Termini",
    after: ". Chiedo di accedere subito a questo contenuto digitale e so che, una volta iniziato l’accesso, perdo il diritto di recesso di 14 giorni. Gli acquisti non sono rimborsabili, salvo quando lo prevedono i termini per gli acquirenti di Link o la legge. Gli abbonamenti si rinnovano automaticamente finché non li disdici.",
    cta: "Continua al pagamento sicuro", back: "Torna ai piani",
    expiredTitle: "Questo link di pagamento è scaduto", expired: "Torna su Redaxa e scegli di nuovo il piano. Non ti è stato addebitato nulla.",
    errors: {
      consent: "Spunta la casella per continuare.",
      terms: "I Termini sono cambiati mentre questa pagina era aperta. Leggili, poi spunta di nuovo la casella.",
      payment_processing: "Il tuo ultimo pagamento è ancora in conferma. Aspetta un minuto, poi aggiorna il piano in Redaxa.",
      manage_billing: "Il tuo abbonamento ha un pagamento da sistemare. Aggiornalo da Gestisci abbonamento in Redaxa invece di avviarne uno nuovo.",
      active: "Questo account ha già un piano attivo.",
      busy: "Per questo account è già in preparazione un pagamento. Aspetta qualche minuto, poi riprova.",
      trial_unavailable: "La prova gratuita non è disponibile per questo account. Torna su Redaxa e scegli Abbonati subito.",
      too_many: "Troppi tentativi. Aspetta qualche minuto, poi riprova.",
      generic: "Non siamo riusciti ad avviare il pagamento. Riprova.",
    },
  },
  es: {
    title: "Confirma tu plan", h1: "Confirma y continúa", selected: "Tu plan elegido", monthly: "Mensual", yearly: "Anual", seats: "{n} usuarios",
    trial: "Empieza con {days} días de prueba gratis. Hoy no se te cobra nada.", now: "La suscripción empieza hoy y se cobra hoy.",
    price: "La página de pago segura de Stripe muestra el precio final antes de que pagues.",
    before: "Acepto los ", terms: "Términos",
    after: ". Solicito el acceso inmediato a este contenido digital y entiendo que pierdo mi derecho de desistimiento de 14 días en cuanto empieza el acceso. Las compras no son reembolsables, salvo cuando las condiciones para compradores de Link o la ley exijan un reembolso. Las suscripciones se renuevan automáticamente hasta que las canceles.",
    cta: "Continuar al pago seguro", back: "Volver a los planes",
    expiredTitle: "Este enlace de pago ha caducado", expired: "Vuelve a Redaxa y elige tu plan de nuevo. No se te ha cobrado nada.",
    errors: {
      consent: "Marca la casilla para continuar.",
      terms: "Los Términos han cambiado mientras esta página estaba abierta. Léelos y vuelve a marcar la casilla.",
      payment_processing: "Tu último pago aún se está confirmando. Espera un minuto y actualiza tu plan en Redaxa.",
      manage_billing: "Tu suscripción tiene un pago pendiente. Resuélvelo en Gestionar suscripción en Redaxa en lugar de empezar una nueva.",
      active: "Esta cuenta ya tiene un plan activo.",
      busy: "Ya se está preparando un pago para esta cuenta. Espera unos minutos y vuelve a intentarlo.",
      trial_unavailable: "La prueba gratuita no está disponible para esta cuenta. Vuelve a Redaxa y elige Suscribirse ahora.",
      too_many: "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.",
      generic: "No hemos podido iniciar el pago. Inténtalo de nuevo.",
    },
  },
  fr: {
    title: "Confirmez votre offre", h1: "Confirmez et continuez", selected: "L’offre choisie", monthly: "Mensuel", yearly: "Annuel", seats: "{n} utilisateurs",
    trial: "Commence par {days} jours d’essai gratuit. Rien n’est prélevé aujourd’hui.", now: "L’abonnement commence et est prélevé aujourd’hui.",
    price: "La page de paiement sécurisée de Stripe affiche le prix final avant le paiement.",
    before: "J’accepte les ", terms: "Conditions d’utilisation",
    after: ". Je demande l’accès immédiat à ce contenu numérique et je reconnais perdre mon droit de rétractation de 14 jours dès que l’accès commence. Les achats ne sont pas remboursables, sauf lorsque les conditions acheteurs de Link ou la loi imposent un remboursement. Les abonnements se renouvellent automatiquement jusqu’à leur résiliation.",
    cta: "Continuer vers le paiement sécurisé", back: "Retour aux offres",
    expiredTitle: "Ce lien de paiement a expiré", expired: "Revenez sur Redaxa et choisissez à nouveau votre offre. Rien n’a été prélevé.",
    errors: {
      consent: "Cochez la case pour continuer.",
      terms: "Les Conditions d’utilisation ont changé pendant que cette page était ouverte. Lisez-les, puis cochez à nouveau la case.",
      payment_processing: "Votre dernier paiement est encore en cours de confirmation. Patientez une minute, puis actualisez votre offre dans Redaxa.",
      manage_billing: "Votre abonnement a un paiement à régulariser. Mettez-le à jour depuis Gérer l’abonnement dans Redaxa au lieu d’en souscrire un nouveau.",
      active: "Ce compte a déjà une offre active.",
      busy: "Un paiement est déjà en préparation pour ce compte. Patientez quelques minutes, puis réessayez.",
      trial_unavailable: "L’essai gratuit n’est pas disponible pour ce compte. Revenez sur Redaxa et choisissez S’abonner maintenant.",
      too_many: "Trop de tentatives. Patientez quelques minutes, puis réessayez.",
      generic: "Nous n’avons pas pu lancer le paiement. Réessayez.",
    },
  },
  de: {
    title: "Tarif bestätigen", h1: "Bestätigen und weiter", selected: "Dein gewählter Tarif", monthly: "Monatlich", yearly: "Jährlich", seats: "{n} Nutzer",
    trial: "Beginnt mit einem {days}-tägigen kostenlosen Test. Heute wird nichts berechnet.", now: "Das Abo beginnt heute und wird heute berechnet.",
    price: "Den Endpreis siehst du vor dem Bezahlen auf der sicheren Kassenseite von Stripe.",
    before: "Ich stimme den ", terms: "Nutzungsbedingungen",
    after: " zu. Ich verlange ausdrücklich, dass der Zugang zu diesen digitalen Inhalten sofort beginnt, und mir ist bekannt, dass ich damit mein 14-tägiges Widerrufsrecht verliere. Käufe werden nicht erstattet, außer wenn die Käuferbedingungen von Link oder das Gesetz eine Erstattung vorsehen. Abos verlängern sich automatisch bis zur Kündigung.",
    cta: "Weiter zur sicheren Kasse", back: "Zurück zu den Tarifen",
    expiredTitle: "Dieser Bezahllink ist abgelaufen", expired: "Geh zurück zu Redaxa und wähle deinen Tarif erneut. Es wurde nichts berechnet.",
    errors: {
      consent: "Setz das Häkchen, um fortzufahren.",
      terms: "Die Nutzungsbedingungen haben sich geändert, während diese Seite offen war. Lies sie und setz das Häkchen erneut.",
      payment_processing: "Deine letzte Zahlung wird noch bestätigt. Warte eine Minute und aktualisiere dann deinen Tarif in Redaxa.",
      manage_billing: "Bei deinem Abo ist eine Zahlung offen. Kläre sie unter „Abonnement verwalten“ in Redaxa, statt ein neues abzuschließen.",
      active: "Dieses Konto hat bereits einen aktiven Tarif.",
      busy: "Für dieses Konto wird bereits eine Zahlung vorbereitet. Warte ein paar Minuten und versuch es dann erneut.",
      trial_unavailable: "Der kostenlose Test ist für dieses Konto nicht verfügbar. Geh zurück zu Redaxa und wähle „Jetzt abonnieren“.",
      too_many: "Zu viele Versuche. Warte ein paar Minuten und versuch es dann erneut.",
      generic: "Wir konnten die Zahlung nicht starten. Bitte versuch es erneut.",
    },
  },
};
export const CONSENT_COPY = COPY;

const esc = (value: string): string => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `
:root{--bg:#f7f6f2;--card:#fff;--text:#1b1724;--muted:#5a5466;--line:#e3dfd5;--accent:#a3471d;--danger:#b3261e;color-scheme:light}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
::selection{background:rgba(163,71,29,.2)}
.shell{max-width:560px;margin:auto;padding:48px 16px 80px}
.back{color:var(--muted);font-size:13px;text-decoration:none}.back:hover{color:var(--text)}.back:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:2px}
h1{font-size:clamp(28px,5vw,36px);letter-spacing:-.04em;margin:18px 0 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px}
@media(min-width:640px){.card{padding:28px}}
.eyebrow{margin:0;font-size:13px;font-weight:600;color:var(--accent)}
.plan{margin:6px 0 0;font-size:22px;font-weight:700;letter-spacing:-.02em}
.dim{margin:8px 0 0;color:var(--muted);font-size:14px;line-height:1.6}
form{margin:22px 0 0;padding-top:22px;border-top:1px solid var(--line)}
.consent{display:flex;gap:12px;align-items:flex-start;padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--bg);cursor:pointer}
.consent.err{border-color:var(--danger)}
.consent input{flex:none;width:20px;height:20px;margin:2px 0 0;accent-color:var(--accent);cursor:pointer}
.consent input:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.consent span{font-size:14px;line-height:1.6;color:var(--text)}
.consent a{color:var(--text);text-decoration:underline;text-underline-offset:3px}
.consent a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:2px}
.error{margin:8px 0 0;font-size:13px;color:var(--danger)}.error[hidden]{display:none}
.notice{margin:0 0 16px;padding:12px 14px;border:1px solid var(--danger);border-radius:10px;color:var(--danger);font-size:14px;line-height:1.5}
.cta{margin-top:16px;width:100%;border:0;border-radius:12px;padding:16px 20px;background:var(--accent);color:#fff;font:700 16px Inter,ui-sans-serif,system-ui,sans-serif;cursor:pointer;-webkit-user-select:none;user-select:none}
.cta:hover{filter:brightness(1.08)}.cta:active{transform:translateY(1px)}.cta:focus-visible{outline:2px solid var(--text);outline-offset:3px}
`;

export type PageInput = {
  lang: Language | null;
  token?: string;
  intent?: Pick<CheckoutIntent, "plan" | "interval" | "seats" | "startTrial" | "app"> | null;
  trialDays?: number;
  error?: PageError | null;
};

/** The consent page, or the "link expired" page when there is no intent. */
export function consentPage({ lang, token, intent, trialDays = 3, error = null }: PageInput): string {
  const c = COPY[lang ?? "en"] ?? EN;
  const app = intent?.app ?? "https://redaxa.getcertsprint.com";
  const head = (title: string) => `<!doctype html><html lang="${lang ?? "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} — Redaxa</title><link rel="icon" type="image/svg+xml" href="/outputs/redaxa-mark.svg"><style>${STYLE}</style></head><body><main class="shell"><a class="back" href="${esc(app)}/dashboard.html#plans">← ${esc(c.back)}</a>`;
  if (!intent || !token) return `${head(c.expiredTitle)}<h1>${esc(c.expiredTitle)}</h1><div class="card"><p class="dim" style="margin:0">${esc(c.expired)}</p></div></main></body></html>`;
  const tier = intent.plan === "business" ? "Business" : "Pro";
  const plan = `${tier} — ${intent.interval === "yearly" ? c.yearly : c.monthly}${intent.plan === "business" && intent.seats > 1 ? `, ${c.seats.replace("{n}", String(intent.seats))}` : ""}`;
  const start = intent.startTrial === true ? c.trial.replace("{days}", String(trialDays)) : intent.startTrial === false ? c.now : "";
  const boxError = error === "consent" || error === "terms";
  const notice = error && !boxError ? `<p class="notice" role="alert">${esc(c.errors[error])}</p>` : "";
  return `${head(c.title)}<h1>${esc(c.h1)}</h1><section class="card" aria-labelledby="plan">
<p class="eyebrow">${esc(c.selected)}</p><p class="plan" id="plan">${esc(plan)}</p>${start ? `<p class="dim">${esc(start)}</p>` : ""}<p class="dim">${esc(c.price)}</p>
<form method="post" action="/checkout" id="consent-form" novalidate>${notice}
<input type="hidden" name="t" value="${esc(token)}"><input type="hidden" name="terms" value="${TERMS_VERSION}">
<label class="consent${boxError ? " err" : ""}" id="consent-box"><input type="checkbox" name="agree" value="yes" id="agree" aria-describedby="consent-error"${boxError ? ' aria-invalid="true" autofocus' : ""}><span>${esc(c.before)}<a href="${TERMS_URL}" target="_blank" rel="noopener">${esc(c.terms)}</a>${esc(c.after)}</span></label>
<p class="error" id="consent-error" role="alert" data-required="${esc(c.errors.consent)}"${boxError ? "" : " hidden"}>${boxError ? esc(c.errors[error as "consent" | "terms"]) : ""}</p>
<button class="cta" type="submit">${esc(c.cta)}</button>
</form></section></main><script src="/checkout.js" defer></script></body></html>`;
}
