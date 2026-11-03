import { isTauri, usesDesktopPreviewTransport } from "./desktop.js";
import type { PromoOffer } from "./promo.js";

/**
 * The free trial as the workspace, the site and the Windows app show it.
 * Display only: the server decides whether a checkout carries a trial
 * (POST /api/billing with start_trial) and refuses one the account cannot
 * have. Prices come from Stripe through GET /api/billing?action=prices; the
 * lines that quote what will be charged are left out when they cannot be read.
 */

export type Lang = "en" | "it" | "es" | "fr" | "de";
export type PlanPrice = { plan: string; interval: string; amount: number; currency: string; taxBehavior: string | null; perSeat: boolean };
export type PriceList = { serverTime: string; trialEnabled: boolean; trialDays: number; prices: PlanPrice[]; receivedAt: number };
/** `billing` in GET /api/account. */
export type BillingView = {
  trialEnabled: boolean;
  trialDays: number;
  trialLength?: number | null;
  state: "none" | "trialing" | "active" | "blocked";
  blockedReason: "none" | "payment_failed" | "canceled" | "trial_already_used";
  plan: string | null;
  interval: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canStartTrial: boolean;
  trialUsed?: boolean;
  portalAvailable: boolean;
};

const STATES = ["none", "trialing", "active", "blocked"];
const REASONS = ["none", "payment_failed", "canceled", "trial_already_used"];

/** Null for anything malformed: the screens then fall back to what they showed before the trial. */
export function parseBilling(value: unknown): BillingView | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || typeof v.trialEnabled !== "boolean" || !STATES.includes(v.state as string)) return null;
  const date = (d: unknown) => typeof d === "string" && Number.isFinite(Date.parse(d)) ? d : null;
  return {
    trialEnabled: v.trialEnabled,
    trialDays: Number.isInteger(v.trialDays) && (v.trialDays as number) > 0 ? v.trialDays as number : 3,
    trialLength: Number.isInteger(v.trialLength) && (v.trialLength as number) > 0 ? v.trialLength as number : null,
    state: v.state as BillingView["state"],
    blockedReason: REASONS.includes(v.blockedReason as string) ? v.blockedReason as BillingView["blockedReason"] : "canceled",
    plan: typeof v.plan === "string" ? v.plan : null,
    interval: typeof v.interval === "string" ? v.interval : null,
    trialEndsAt: date(v.trialEndsAt),
    currentPeriodEnd: date(v.currentPeriodEnd),
    cancelAtPeriodEnd: v.cancelAtPeriodEnd === true,
    canStartTrial: v.canStartTrial === true,
    trialUsed: v.trialUsed === true,
    portalAvailable: v.portalAvailable === true,
  };
}

export function parsePrices(value: unknown, receivedAt = Date.now()): PriceList | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || typeof v.serverTime !== "string" || !Number.isFinite(Date.parse(v.serverTime)) || !Array.isArray(v.prices)) return null;
  const prices = (v.prices as Record<string, unknown>[]).filter((p) => p && typeof p.plan === "string" && typeof p.interval === "string"
    && Number.isInteger(p.amount) && (p.amount as number) > 0 && typeof p.currency === "string" && /^[a-z]{3}$/.test(p.currency as string))
    .map((p) => ({ plan: p.plan as string, interval: p.interval as string, amount: p.amount as number, currency: p.currency as string, taxBehavior: typeof p.taxBehavior === "string" ? p.taxBehavior : null, perSeat: p.perSeat === true }));
  return { serverTime: v.serverTime, trialEnabled: v.trialEnabled === true, trialDays: Number.isInteger(v.trialDays) && (v.trialDays as number) > 0 ? v.trialDays as number : 3, prices, receivedAt };
}

let pending: Promise<PriceList | null> | null = null;
/** The plan prices and the trial switch, read once per page; a failure is retried on the next call. */
export function loadPrices(): Promise<PriceList | null> {
  if (pending) return pending;
  let preview = false;
  let url = "";
  try {
    preview = usesDesktopPreviewTransport(isTauri(), location.origin);
    url = preview ? "/api/desktop-preview/api/billing?action=prices" : `${isTauri() ? "https://promptshield-beta.vercel.app" : ""}/api/billing?action=prices`;
  } catch {
    return Promise.resolve(null);
  }
  pending = Promise.resolve()
    .then(() => fetch(url, { headers: preview ? { "x-redaxa-desktop": "1" } : undefined, signal: AbortSignal.timeout(8000) }))
    .then(async (response) => response.ok ? parsePrices(await response.json()) : null)
    .catch(() => null)
    .then((prices) => { if (!prices) pending = null; return prices; });
  return pending;
}

export function priceFor(prices: PriceList | null, plan: string, interval: string): PlanPrice | null {
  return prices?.prices.find((p) => p.plan === plan && p.interval === interval) ?? null;
}

/** €7.99, €39, 7,99 €: the plan pages' own money format, in the reader's language. */
export function money(cents: number, currency = "eur", lang = "en"): string {
  return new Intl.NumberFormat(lang === "en" ? "en-IE" : lang, { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}

/** "17 October 2026": the day a trial ends or the first charge falls. */
export function longDay(at: Date | string | number, lang = "en"): string {
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : lang, { day: "numeric", month: "long", year: "numeric" }).format(new Date(at));
}

/** When a trial started now would end: the server's clock plus the time since it answered. */
export function chargeDate(prices: Pick<PriceList, "serverTime" | "trialDays" | "receivedAt">, now = Date.now()): Date {
  return new Date(Date.parse(prices.serverTime) + Math.max(0, now - prices.receivedAt) + prices.trialDays * 86_400_000);
}

export type TrialWords = {
  startTrial: string; subscribeNow: string; updatePayment: string;
  perUser: string; perMonth: string; perYear: string; perUserMonth: string; perUserYear: string; firstMonth: string; firstYear: string;
  line: string; linePromo: string; cancelHint: string; nowLine: string; consent: string; trialUsed: string;
  statusTrial: string; statusTrialCancelled: string; statusPaused: string; statusRefused: string;
  noteTrialEnds: string; pausedBadge: string; sidebarTrialNote: string; sidebarTrialCancelled: string; sidebarPausedNote: string;
  /** Workspace copy that names the trial's length, for when the 3-day trial is on. */
  copy: Record<string, string>;
  promoFine: string;
};

export const TRIAL_UI: Record<Lang, TrialWords> = {
  en: {
    startTrial: "Start {days}-day free trial", subscribeNow: "Subscribe now", updatePayment: "Update payment method",
    perUser: "{amount} per user", perMonth: "{amount} a month", perYear: "{amount} a year", perUserMonth: "{amount} per user a month", perUserYear: "{amount} per user a year",
    firstMonth: "the first month", firstYear: "the first year",
    line: "Free for {days} days, then {amount} from {date}.",
    linePromo: "Free for {days} days, then {first} for {period} from {date}, and {amount} after that.",
    cancelHint: "Cancel before then and you pay nothing.",
    nowLine: "Or subscribe now: {first} today, no trial.",
    consent: "A card or another payment method is needed to start. {first} is charged automatically on {date} unless you cancel before then. Prices exclude VAT.",
    trialUsed: "You have already used your free trial, so the plan starts straight away.",
    statusTrial: "Your {plan} trial ends on {date}. The plan then starts, unless you cancel it first.",
    statusTrialCancelled: "Your {plan} trial ends on {date}. It is cancelled, so nothing will be charged.",
    statusPaused: "{plan} is paused until a payment goes through.",
    statusRefused: "A free trial was already used with this email address or card, so this one was cancelled. Nothing was charged.",
    noteTrialEnds: "Free until {date}.",
    pausedBadge: "Payment failed",
    sidebarTrialNote: "Unlimited checks until {date}. The plan then starts, unless you cancel.",
    sidebarTrialCancelled: "Unlimited checks until {date}. Cancelled: nothing will be charged.",
    sidebarPausedNote: "{plan} is paused. Update the payment method to turn it back on.",
    copy: {
      plansIntro: "Start Pro or Business with a 3-day free trial, or subscribe straight away. A card or another payment method is needed to start; cancel before the trial ends and nothing is charged. Pro is the new name for Personal, at the same price.",
      planNoneNote: "5 checks a day, no card needed. Pro removes the limit; try it free for 3 days.",
      startTrialToInspect: "Today's 5 free checks are used up. Choose a plan to keep going; you can try it free for 3 days.",
      faqTrialQ: "How does the 3-day trial work?",
      faqTrialA: "Choose Start 3-day free trial on Pro or Business. A card or another payment method is needed, and nothing is charged for 3 days. Then the plan starts and is charged automatically, unless you cancel before the trial ends from Manage subscription. There is one free trial per person; if you would rather pay straight away, choose Subscribe now.",
    },
    promoFine: "Struck-through prices are our lowest in the 30 days before the offer. New subscriptions only; the offer price is the first payment, after the free trial if you start one, and renewals are at the regular price. Prices exclude VAT.",
  },
  it: {
    startTrial: "Inizia la prova gratuita di {days} giorni", subscribeNow: "Abbonati subito", updatePayment: "Aggiorna il metodo di pagamento",
    perUser: "{amount} per utente", perMonth: "{amount} al mese", perYear: "{amount} all'anno", perUserMonth: "{amount} per utente al mese", perUserYear: "{amount} per utente all'anno",
    firstMonth: "il primo mese", firstYear: "il primo anno",
    line: "Gratis per {days} giorni, poi {amount} dal {date}.",
    linePromo: "Gratis per {days} giorni, poi {first} per {period} dal {date} e in seguito {amount}.",
    cancelHint: "Se annulli prima, non paghi nulla.",
    nowLine: "Oppure abbonati subito: {first} oggi, senza prova.",
    consent: "Per iniziare serve una carta o un altro metodo di pagamento. {first} viene addebitato automaticamente il {date}, a meno che tu non annulli prima. Prezzi IVA esclusa.",
    trialUsed: "Hai già usato la prova gratuita, quindi il piano parte subito.",
    statusTrial: "La tua prova di {plan} finisce il {date}. Poi il piano parte, a meno che tu non lo annulli prima.",
    statusTrialCancelled: "La tua prova di {plan} finisce il {date}. È annullata, quindi non verrà addebitato nulla.",
    statusPaused: "{plan} è sospeso finché un pagamento non va a buon fine.",
    statusRefused: "Con questo indirizzo email o con questa carta è già stata usata una prova gratuita, quindi questa è stata annullata. Non è stato addebitato nulla.",
    noteTrialEnds: "Gratis fino al {date}.",
    pausedBadge: "Pagamento non riuscito",
    sidebarTrialNote: "Controlli illimitati fino al {date}. Poi il piano parte, a meno che tu non lo annulli.",
    sidebarTrialCancelled: "Controlli illimitati fino al {date}. Annullata: non verrà addebitato nulla.",
    sidebarPausedNote: "{plan} è sospeso. Aggiorna il metodo di pagamento per riattivarlo.",
    copy: {
      plansIntro: "Inizia Pro o Business con una prova gratuita di 3 giorni, oppure abbonati subito. Per iniziare serve una carta o un altro metodo di pagamento; se annulli prima della fine della prova non paghi nulla. Pro è il nuovo nome di Personal, allo stesso prezzo.",
      planNoneNote: "5 controlli al giorno senza carta. Pro toglie il limite: provalo gratis per 3 giorni.",
      startTrialToInspect: "Hai usato i 5 controlli gratuiti di oggi. Scegli un piano per continuare: puoi provarlo gratis per 3 giorni.",
      faqTrialQ: "Come funziona la prova di 3 giorni?",
      faqTrialA: "Scegli Inizia la prova gratuita di 3 giorni su Pro o Business. Serve una carta o un altro metodo di pagamento, e per 3 giorni non paghi nulla. Poi il piano parte e viene addebitato automaticamente, a meno che tu non lo annulli prima della fine della prova da Gestisci abbonamento. È prevista una sola prova gratuita per persona; se preferisci pagare subito, scegli Abbonati subito.",
    },
    promoFine: "I prezzi barrati sono i più bassi dei 30 giorni prima dell'offerta. Solo per nuovi abbonamenti; il prezzo dell'offerta è il primo pagamento, dopo la prova gratuita se la inizi, e i rinnovi sono al prezzo normale. Prezzi IVA esclusa.",
  },
  es: {
    startTrial: "Empezar prueba gratuita de {days} días", subscribeNow: "Suscribirse ahora", updatePayment: "Actualizar el método de pago",
    perUser: "{amount} por usuario", perMonth: "{amount} al mes", perYear: "{amount} al año", perUserMonth: "{amount} por usuario al mes", perUserYear: "{amount} por usuario al año",
    firstMonth: "el primer mes", firstYear: "el primer año",
    line: "Gratis durante {days} días; después, {amount} a partir del {date}.",
    linePromo: "Gratis durante {days} días; después, {first} durante {period} a partir del {date} y luego {amount}.",
    cancelHint: "Si cancelas antes, no pagas nada.",
    nowLine: "O suscríbete ahora: {first} hoy, sin prueba.",
    consent: "Para empezar se necesita una tarjeta u otro método de pago. {first} se cobra automáticamente el {date}, salvo que canceles antes. Precios sin IVA.",
    trialUsed: "Ya has usado la prueba gratuita, así que el plan empieza al momento.",
    statusTrial: "Tu prueba de {plan} termina el {date}. Después empieza el plan, salvo que lo canceles antes.",
    statusTrialCancelled: "Tu prueba de {plan} termina el {date}. Está cancelada, así que no se cobrará nada.",
    statusPaused: "{plan} está en pausa hasta que se complete un pago.",
    statusRefused: "Ya se usó una prueba gratuita con esta dirección de correo o esta tarjeta, así que esta se ha cancelado. No se ha cobrado nada.",
    noteTrialEnds: "Gratis hasta el {date}.",
    pausedBadge: "Pago fallido",
    sidebarTrialNote: "Revisiones ilimitadas hasta el {date}. Después empieza el plan, salvo que lo canceles.",
    sidebarTrialCancelled: "Revisiones ilimitadas hasta el {date}. Cancelada: no se cobrará nada.",
    sidebarPausedNote: "{plan} está en pausa. Actualiza el método de pago para reactivarlo.",
    copy: {
      plansIntro: "Empieza Pro o Business con una prueba gratuita de 3 días, o suscríbete al momento. Para empezar se necesita una tarjeta u otro método de pago; si cancelas antes de que termine la prueba, no pagas nada. Pro es el nuevo nombre de Personal, al mismo precio.",
      planNoneNote: "5 revisiones al día sin tarjeta. Pro quita el límite: pruébalo gratis durante 3 días.",
      startTrialToInspect: "Has usado las 5 revisiones gratuitas de hoy. Elige un plan para continuar: puedes probarlo gratis durante 3 días.",
      faqTrialQ: "¿Cómo funciona la prueba de 3 días?",
      faqTrialA: "Elige Empezar prueba gratuita de 3 días en Pro o Business. Se necesita una tarjeta u otro método de pago, y durante 3 días no pagas nada. Después el plan empieza y se cobra automáticamente, salvo que lo canceles antes de que termine la prueba desde Gestionar suscripción. Hay una sola prueba gratuita por persona; si prefieres pagar ya, elige Suscribirse ahora.",
    },
    promoFine: "Los precios tachados son los más bajos de los 30 días previos a la oferta. Solo para nuevas suscripciones; el precio de la oferta es el primer pago, después de la prueba gratuita si la empiezas, y las renovaciones se cobran al precio habitual. Precios sin IVA.",
  },
  fr: {
    startTrial: "Commencer l’essai gratuit de {days} jours", subscribeNow: "S’abonner maintenant", updatePayment: "Mettre à jour le moyen de paiement",
    perUser: "{amount} par utilisateur", perMonth: "{amount} par mois", perYear: "{amount} par an", perUserMonth: "{amount} par utilisateur et par mois", perUserYear: "{amount} par utilisateur et par an",
    firstMonth: "le premier mois", firstYear: "la première année",
    line: "Gratuit pendant {days} jours, puis {amount} à partir du {date}.",
    linePromo: "Gratuit pendant {days} jours, puis {first} pour {period} à partir du {date}, et {amount} ensuite.",
    cancelHint: "Annulez avant et vous ne payez rien.",
    nowLine: "Ou abonnez-vous maintenant : {first} aujourd’hui, sans essai.",
    consent: "Une carte ou un autre moyen de paiement est nécessaire pour commencer. {first} est prélevé automatiquement le {date}, sauf si vous annulez avant. Prix HT.",
    trialUsed: "Vous avez déjà utilisé votre essai gratuit : l’offre démarre donc tout de suite.",
    statusTrial: "Votre essai de {plan} se termine le {date}. L’offre démarre ensuite, sauf si vous l’annulez avant.",
    statusTrialCancelled: "Votre essai de {plan} se termine le {date}. Il est annulé : rien ne sera prélevé.",
    statusPaused: "{plan} est suspendu jusqu’à ce qu’un paiement aboutisse.",
    statusRefused: "Un essai gratuit a déjà été utilisé avec cette adresse e-mail ou cette carte, celui-ci a donc été annulé. Rien n’a été prélevé.",
    noteTrialEnds: "Gratuit jusqu’au {date}.",
    pausedBadge: "Échec du paiement",
    sidebarTrialNote: "Vérifications illimitées jusqu’au {date}. L’offre démarre ensuite, sauf si vous l’annulez.",
    sidebarTrialCancelled: "Vérifications illimitées jusqu’au {date}. Annulé : rien ne sera prélevé.",
    sidebarPausedNote: "{plan} est suspendu. Mettez à jour le moyen de paiement pour le réactiver.",
    copy: {
      plansIntro: "Commencez Pro ou Business par un essai gratuit de 3 jours, ou abonnez-vous tout de suite. Une carte ou un autre moyen de paiement est nécessaire pour commencer ; si vous annulez avant la fin de l’essai, vous ne payez rien. Pro est le nouveau nom de Personal, au même prix.",
      planNoneNote: "5 vérifications par jour sans carte. Pro supprime la limite : essayez-le gratuitement pendant 3 jours.",
      startTrialToInspect: "Vous avez utilisé les 5 vérifications gratuites du jour. Choisissez une offre pour continuer : vous pouvez l’essayer gratuitement pendant 3 jours.",
      faqTrialQ: "Comment fonctionne l’essai de 3 jours ?",
      faqTrialA: "Choisissez Commencer l’essai gratuit de 3 jours sur Pro ou Business. Une carte ou un autre moyen de paiement est nécessaire, et rien n’est prélevé pendant 3 jours. L’offre démarre ensuite et est prélevée automatiquement, sauf si vous l’annulez avant la fin de l’essai depuis Gérer l’abonnement. Chaque personne a droit à un seul essai gratuit ; pour payer tout de suite, choisissez S’abonner maintenant.",
    },
    promoFine: "Les prix barrés sont nos plus bas des 30 jours précédant l’offre. Nouveaux abonnements uniquement ; le prix de l’offre est le premier paiement, après l’essai gratuit si vous en commencez un, et les renouvellements se font au prix normal. Prix hors TVA.",
  },
  de: {
    startTrial: "{days} Tage kostenlos testen", subscribeNow: "Jetzt abonnieren", updatePayment: "Zahlungsmethode aktualisieren",
    perUser: "{amount} pro Nutzer", perMonth: "{amount} pro Monat", perYear: "{amount} pro Jahr", perUserMonth: "{amount} pro Nutzer und Monat", perUserYear: "{amount} pro Nutzer und Jahr",
    firstMonth: "den ersten Monat", firstYear: "das erste Jahr",
    line: "{days} Tage kostenlos, danach {amount} ab dem {date}.",
    linePromo: "{days} Tage kostenlos, danach {first} für {period} ab dem {date} und anschließend {amount}.",
    cancelHint: "Wenn du vorher kündigst, zahlst du nichts.",
    nowLine: "Oder jetzt abonnieren: {first} heute, ohne Testphase.",
    consent: "Zum Start ist eine Karte oder eine andere Zahlungsmethode nötig. {first} wird am {date} automatisch abgebucht, sofern du nicht vorher kündigst. Preise zzgl. MwSt.",
    trialUsed: "Du hast die kostenlose Testphase bereits genutzt, daher beginnt der Tarif sofort.",
    statusTrial: "Deine Testphase für {plan} endet am {date}. Danach beginnt der Tarif, sofern du nicht vorher kündigst.",
    statusTrialCancelled: "Deine Testphase für {plan} endet am {date}. Sie ist gekündigt, es wird nichts abgebucht.",
    statusPaused: "{plan} ist pausiert, bis eine Zahlung erfolgt.",
    statusRefused: "Mit dieser E-Mail-Adresse oder Karte wurde bereits eine kostenlose Testphase genutzt, daher wurde diese storniert. Es wurde nichts abgebucht.",
    noteTrialEnds: "Kostenlos bis zum {date}.",
    pausedBadge: "Zahlung fehlgeschlagen",
    sidebarTrialNote: "Unbegrenzte Prüfungen bis zum {date}. Danach beginnt der Tarif, sofern du nicht kündigst.",
    sidebarTrialCancelled: "Unbegrenzte Prüfungen bis zum {date}. Gekündigt: Es wird nichts abgebucht.",
    sidebarPausedNote: "{plan} ist pausiert. Aktualisiere die Zahlungsmethode, um den Tarif wieder zu aktivieren.",
    copy: {
      plansIntro: "Starte Pro oder Business mit einer kostenlosen Testphase von 3 Tagen oder abonniere sofort. Zum Start ist eine Karte oder eine andere Zahlungsmethode nötig; wenn du vor Ende der Testphase kündigst, zahlst du nichts. Pro ist der neue Name von Personal, zum gleichen Preis.",
      planNoneNote: "5 Prüfungen pro Tag ohne Karte. Pro hebt das Limit auf: 3 Tage kostenlos testen.",
      startTrialToInspect: "Du hast die 5 kostenlosen Prüfungen für heute genutzt. Wähle einen Tarif, um weiterzumachen: du kannst ihn 3 Tage kostenlos testen.",
      faqTrialQ: "Wie funktioniert die 3-tägige Testphase?",
      faqTrialA: "Wähle bei Pro oder Business „3 Tage kostenlos testen“. Eine Karte oder eine andere Zahlungsmethode ist nötig, und 3 Tage lang wird nichts abgebucht. Danach beginnt der Tarif und wird automatisch abgebucht, sofern du nicht vor Ende der Testphase unter „Abonnement verwalten“ kündigen. Pro Person gibt es eine kostenlose Testphase; wenn du lieber sofort zahlst, wähle „Jetzt abonnieren“.",
    },
    promoFine: "Durchgestrichene Preise sind unsere niedrigsten der 30 Tage vor dem Angebot. Nur für neue Abos; der Angebotspreis ist die erste Zahlung, nach der kostenlosen Testphase, falls du eine startest, und Verlängerungen erfolgen zum regulären Preis. Preise ohne MwSt.",
  },
};

/** The banner that offers, reports or explains the free trial, per language. */
export const TRIAL_BANNER: Record<Lang, { offerTitle: string; offerText: string; offerButton: string; runningTitle: string; usedTitle: string; usedText: string; sideOffer: string }> = {
  en: {
    offerTitle: "Try Pro free for {days} days",
    offerText: "Everything in Pro, with no daily limit. A card or another payment method is needed to start; cancel before the {days} days are up and nothing is charged. One free trial per person.",
    offerButton: "Start your {days}-day free trial",
    runningTitle: "Trial — {left}",
    usedTitle: "Free trial already used",
    usedText: "This account has already had its free trial, so Pro and Business start straight away when you subscribe.",
    sideOffer: "Start your {days}-day free trial →",
  },
  it: {
    offerTitle: "Prova Pro gratis per {days} giorni",
    offerText: "Tutto Pro, senza limite giornaliero. Per iniziare serve una carta o un altro metodo di pagamento; se annulli prima che finiscano i {days} giorni non paghi nulla. Una sola prova gratuita per persona.",
    offerButton: "Inizia la prova gratuita di {days} giorni",
    runningTitle: "Prova — {left}",
    usedTitle: "Prova gratuita già usata",
    usedText: "Questo account ha già avuto la sua prova gratuita, quindi Pro e Business partono subito quando ti abboni.",
    sideOffer: "Inizia la prova gratuita di {days} giorni →",
  },
  es: {
    offerTitle: "Prueba Pro gratis durante {days} días",
    offerText: "Todo Pro, sin límite diario. Para empezar se necesita una tarjeta u otro método de pago; si cancelas antes de que pasen los {days} días, no pagas nada. Una sola prueba gratuita por persona.",
    offerButton: "Empezar la prueba gratuita de {days} días",
    runningTitle: "Prueba — {left}",
    usedTitle: "Prueba gratuita ya usada",
    usedText: "Esta cuenta ya ha tenido su prueba gratuita, así que Pro y Business empiezan al momento cuando te suscribes.",
    sideOffer: "Empezar la prueba gratuita de {days} días →",
  },
  fr: {
    offerTitle: "Essayez Pro gratuitement pendant {days} jours",
    offerText: "Tout Pro, sans limite quotidienne. Une carte ou un autre moyen de paiement est nécessaire pour commencer ; annulez avant la fin des {days} jours et rien n’est prélevé. Un seul essai gratuit par personne.",
    offerButton: "Commencer l’essai gratuit de {days} jours",
    runningTitle: "Essai — {left}",
    usedTitle: "Essai gratuit déjà utilisé",
    usedText: "Ce compte a déjà eu son essai gratuit : Pro et Business démarrent donc dès que vous vous abonnez.",
    sideOffer: "Commencer l’essai gratuit de {days} jours →",
  },
  de: {
    offerTitle: "Pro {days} Tage kostenlos testen",
    offerText: "Alles aus Pro, ohne Tageslimit. Zum Start ist eine Karte oder eine andere Zahlungsmethode nötig; wenn du vor Ablauf der {days} Tage kündigst, wird nichts abgebucht. Eine kostenlose Testphase pro Person.",
    offerButton: "{days} Tage kostenlos testen",
    runningTitle: "Testphase — {left}",
    usedTitle: "Testphase bereits genutzt",
    usedText: "Dieses Konto hatte bereits seine kostenlose Testphase, daher beginnen Pro und Business sofort, wenn du abonnierst.",
    sideOffer: "{days} Tage kostenlos testen →",
  },
};

/** A call to action's trailing arrow, glued to the last word by a no-break space: it never wraps onto a line of its own. */
export const keepArrow = (text: string): string => text.replace(/\s+→$/u, " →");

export type Tier = "free" | "personal" | "business";
const RANK: Record<Tier, number> = { free: 0, personal: 1, business: 2 };

/**
 * What Plans & pricing shows, from the account alone: every tier below the
 * one held is included in it, the held one is current (with Manage
 * subscription), higher ones are upgrades. The trial banner offers the trial
 * only to accounts without a plan that the server says may start one (or to
 * signed-out visitors, where checkout decides), reports a running one, and
 * explains a used one. A paying account is never offered it.
 */
export function planView(input: { held: Tier; paused: boolean; trialOn: boolean; signedIn: boolean; billing: Pick<BillingView, "state" | "canStartTrial" | "trialUsed"> | null }): { cards: Record<Tier, "current" | "included" | "upgrade">; trial: "offer" | "running" | "used" | null } {
  const cards = { free: "upgrade", personal: "upgrade", business: "upgrade" } as Record<Tier, "current" | "included" | "upgrade">;
  for (const tier of Object.keys(RANK) as Tier[]) cards[tier] = tier === input.held ? "current" : RANK[tier] < RANK[input.held] ? "included" : "upgrade";
  const b = input.billing;
  const trial = b?.state === "trialing" && input.held !== "free" ? "running"
    : input.held !== "free" || input.paused || !input.trialOn ? null
    : !input.signedIn || b?.canStartTrial === true ? "offer"
    : b?.trialUsed ? "used"
    : null;
  return { cards, trial };
}

const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);

export type ChoiceCopy = { trialLabel: string; nowLabel: string; trialLine: string | null; nowLine: string | null; consent: string | null };

/** The two buttons and the lines under them, from the prices the server read
 *  from Stripe and the offer it published. Lines that would need a price the
 *  page does not have are null rather than guessed. */
export function choiceCopy(lang: Lang, input: { interval: "monthly" | "yearly"; price: PlanPrice | null; promo: PromoOffer | null; trialDays: number; date: Date }): ChoiceCopy {
  const w = TRIAL_UI[lang] ?? TRIAL_UI.en;
  const yearly = input.interval === "yearly";
  const perSeat = input.price?.perSeat ?? input.promo?.perSeat ?? false;
  const unit = perSeat ? (yearly ? w.perUserYear : w.perUserMonth) : (yearly ? w.perYear : w.perMonth);
  const currency = input.price?.currency ?? "eur";
  const regular = input.price ? fill(unit, { amount: money(input.price.amount, currency, lang) }) : null;
  const firstPrice = input.promo ? money(input.promo.price, "eur", lang) : input.price ? money(input.price.amount, currency, lang) : null;
  const firstAmount = firstPrice && perSeat ? fill(w.perUser, { amount: firstPrice }) : firstPrice;
  // One unit on screen: "17 October 2026" never breaks across lines.
  const date = longDay(input.date, lang).replace(/ /g, " ");
  const days = input.trialDays;
  const trialLine = !regular ? null : input.promo && firstAmount
    ? fill(w.linePromo, { days, first: firstAmount, period: yearly ? w.firstYear : w.firstMonth, date, amount: regular })
    : fill(w.line, { days, amount: regular, date });
  return {
    trialLabel: fill(w.startTrial, { days }),
    nowLabel: w.subscribeNow,
    trialLine: trialLine ? `${trialLine} ${w.cancelHint}` : null,
    nowLine: firstAmount ? fill(w.nowLine, { first: firstAmount }) : null,
    consent: firstAmount ? fill(w.consent, { first: firstAmount, date }) : null,
  };
}


// ---------------------------------------------------------------------------
// Back from Stripe: Checkout returns to /?checkout=success|cancelled (with the
// checkout's `lang`), the billing portal to /?billing=managed (api/billing.ts).
// auth.ts draws the notice; what it says is decided here.

export type StripeReturn = "success" | "cancelled" | "managed";
type ReturnWords = {
  pendingTitle: string; pending: string; signedOut: string; slow: string;
  trialTitle: string; trial: string; activeTitle: string; active: string;
  stepsTitle: string; workspace: string; windows: string; extension: string; sameEmail: string;
  cancelledTitle: string; cancelled: string; seePlans: string;
  managedTitle: string; managed: string; dismiss: string;
};
// French keeps a no-break space before : ; ! ?; German speaks to the reader as "du".
export const RETURN_COPY: Record<Lang, ReturnWords> = {
  en: {
    pendingTitle: "Thank you, your checkout is complete", pending: "We’re confirming your plan with Stripe. It usually takes a few seconds.",
    signedOut: "Sign in with the email you used at checkout to see your plan. A confirmation email is on its way.",
    slow: "Your plan is still being confirmed. Refresh this page in a minute; a confirmation email is on its way.",
    trialTitle: "Your {plan} trial has started", trial: "Free until {date}. Nothing is charged before then, and you can cancel any time from Manage subscription.",
    activeTitle: "Redaxa {plan} is active", active: "Thank you! Your plan is on, and a confirmation email is on its way.",
    stepsTitle: "Next steps", workspace: "Open your workspace", windows: "Download the Windows app", extension: "Add the Chrome extension",
    sameEmail: "In the app and the extension, sign in with the same email: your plan follows your account.",
    cancelledTitle: "Checkout cancelled", cancelled: "Nothing was charged. Choose a plan whenever you’re ready.", seePlans: "See plans",
    managedTitle: "Back from billing", managed: "Changes to your payment method or subscription can take a few seconds to show here.", dismiss: "Dismiss",
  },
  it: {
    pendingTitle: "Grazie, l’acquisto è completato", pending: "Stiamo confermando il tuo piano con Stripe: di solito bastano pochi secondi.",
    signedOut: "Accedi con l’email usata per il pagamento per vedere il tuo piano. È in arrivo un’email di conferma.",
    slow: "Il piano è ancora in fase di conferma. Aggiorna la pagina tra un minuto; è in arrivo un’email di conferma.",
    trialTitle: "La tua prova di {plan} è iniziata", trial: "Gratis fino al {date}. Prima di allora non ti viene addebitato nulla e puoi annullare quando vuoi da Gestisci abbonamento.",
    activeTitle: "Redaxa {plan} è attivo", active: "Grazie! Il tuo piano è attivo ed è in arrivo un’email di conferma.",
    stepsTitle: "Prossimi passi", workspace: "Apri il tuo spazio di lavoro", windows: "Scarica l’app per Windows", extension: "Aggiungi l’estensione per Chrome",
    sameEmail: "Nell’app e nell’estensione accedi con la stessa email: il piano segue il tuo account.",
    cancelledTitle: "Acquisto annullato", cancelled: "Non è stato addebitato nulla. Scegli un piano quando vuoi.", seePlans: "Vedi i piani",
    managedTitle: "Di nuovo su Redaxa", managed: "Le modifiche al metodo di pagamento o all’abbonamento possono richiedere qualche secondo per comparire qui.", dismiss: "Chiudi",
  },
  es: {
    pendingTitle: "Gracias, la compra se ha completado", pending: "Estamos confirmando tu plan con Stripe; suele tardar unos segundos.",
    signedOut: "Inicia sesión con el correo que usaste en el pago para ver tu plan. Te llegará un correo de confirmación.",
    slow: "Tu plan aún se está confirmando. Actualiza la página en un minuto; te llegará un correo de confirmación.",
    trialTitle: "Tu prueba de {plan} ha empezado", trial: "Gratis hasta el {date}. No se te cobra nada antes y puedes cancelar cuando quieras desde Gestionar suscripción.",
    activeTitle: "Redaxa {plan} está activo", active: "¡Gracias! Tu plan está activo y te llegará un correo de confirmación.",
    stepsTitle: "Próximos pasos", workspace: "Abrir tu espacio de trabajo", windows: "Descargar la app para Windows", extension: "Añadir la extensión para Chrome",
    sameEmail: "En la app y en la extensión, inicia sesión con el mismo correo: tu plan va con tu cuenta.",
    cancelledTitle: "Compra cancelada", cancelled: "No se ha cobrado nada. Elige un plan cuando quieras.", seePlans: "Ver los planes",
    managedTitle: "De vuelta en Redaxa", managed: "Los cambios en el método de pago o en la suscripción pueden tardar unos segundos en aparecer aquí.", dismiss: "Cerrar",
  },
  fr: {
    pendingTitle: "Merci, votre achat est terminé", pending: "Nous confirmons votre offre avec Stripe. Cela prend généralement quelques secondes.",
    signedOut: "Connectez-vous avec l’adresse e-mail utilisée pour le paiement pour voir votre offre. Un e-mail de confirmation est en route.",
    slow: "Votre offre est encore en cours de confirmation. Actualisez la page dans une minute ; un e-mail de confirmation est en route.",
    trialTitle: "Votre essai de {plan} a commencé", trial: "Gratuit jusqu’au {date}. Rien n’est prélevé d’ici là, et vous pouvez annuler à tout moment depuis Gérer l’abonnement.",
    activeTitle: "Redaxa {plan} est actif", active: "Merci ! Votre offre est active et un e-mail de confirmation est en route.",
    stepsTitle: "Prochaines étapes", workspace: "Ouvrir votre espace de travail", windows: "Télécharger l’application Windows", extension: "Ajouter l’extension Chrome",
    sameEmail: "Dans l’application et l’extension, connectez-vous avec la même adresse e-mail : votre offre suit votre compte.",
    cancelledTitle: "Achat annulé", cancelled: "Rien n’a été prélevé. Choisissez une offre quand vous le souhaitez.", seePlans: "Voir les offres",
    managedTitle: "De retour sur Redaxa", managed: "Les modifications du moyen de paiement ou de l’abonnement peuvent mettre quelques secondes à apparaître ici.", dismiss: "Fermer",
  },
  de: {
    pendingTitle: "Danke, dein Kauf ist abgeschlossen", pending: "Wir bestätigen deinen Tarif gerade mit Stripe. Das dauert meist nur ein paar Sekunden.",
    signedOut: "Melde dich mit der E-Mail-Adresse an, die du beim Bezahlen verwendet hast, um deinen Tarif zu sehen. Eine Bestätigung per E-Mail ist unterwegs.",
    slow: "Dein Tarif wird noch bestätigt. Lade die Seite in einer Minute neu; eine Bestätigung per E-Mail ist unterwegs.",
    trialTitle: "Deine Testphase für {plan} hat begonnen", trial: "Kostenlos bis zum {date}. Bis dahin wird nichts abgebucht, und du kannst jederzeit unter „Abonnement verwalten“ kündigen.",
    activeTitle: "Redaxa {plan} ist aktiv", active: "Danke! Dein Tarif ist aktiv, und eine Bestätigung per E-Mail ist unterwegs.",
    stepsTitle: "Nächste Schritte", workspace: "Arbeitsbereich öffnen", windows: "Windows-App herunterladen", extension: "Chrome-Erweiterung hinzufügen",
    sameEmail: "Melde dich in der App und in der Erweiterung mit derselben E-Mail-Adresse an: Dein Tarif gehört zu deinem Konto.",
    cancelledTitle: "Kauf abgebrochen", cancelled: "Es wurde nichts abgebucht. Wähle einen Tarif, wann immer du so weit bist.", seePlans: "Tarife ansehen",
    managedTitle: "Zurück bei Redaxa", managed: "Änderungen an Zahlungsmethode oder Abonnement können ein paar Sekunden brauchen, bis sie hier erscheinen.", dismiss: "Schließen",
  },
};

/** Which return this address is, and the language to say it in (the
 *  checkout's, else the workspace's saved one, else the page's). */
export function readStripeReturn(search: string, fallbackLang: string): { kind: StripeReturn; lang: Lang } | null {
  const params = new URLSearchParams(search);
  const checkout = params.get("checkout");
  const kind: StripeReturn | null = checkout === "success" || checkout === "cancelled" ? checkout : params.get("billing") === "managed" ? "managed" : null;
  if (!kind) return null;
  const known = (value: string | null): Lang | null => (["en", "it", "es", "fr", "de"] as const).find((l) => l === value?.slice(0, 2)) ?? null;
  return { kind, lang: known(params.get("lang")) ?? known(fallbackLang) ?? "en" };
}

/** The same address without the return parameters, so a reload or a shared link does not repeat the notice. */
export function withoutStripeReturn(href: string): string {
  const url = new URL(href);
  for (const key of ["checkout", "billing", "lang"]) url.searchParams.delete(key);
  return url.pathname + url.search + url.hash;
}

/** Title and text of the notice. `settled` turns true once the page has stopped
 *  waiting for the webhook to record the plan. */
export function returnView(kind: StripeReturn, lang: Lang, input: { signedIn: boolean; billing: Pick<BillingView, "state" | "plan" | "trialEndsAt"> | null; settled: boolean }): { title: string; text: string; confirmed: boolean } {
  const w = RETURN_COPY[lang];
  if (kind === "cancelled") return { title: w.cancelledTitle, text: w.cancelled, confirmed: false };
  if (kind === "managed") return { title: w.managedTitle, text: w.managed, confirmed: false };
  const plan = input.billing?.plan === "business" ? "Business" : "Pro";
  if (input.billing?.state === "trialing" && input.billing.trialEndsAt) {
    return { title: fill(w.trialTitle, { plan }), text: fill(w.trial, { date: longDay(input.billing.trialEndsAt, lang) }), confirmed: true };
  }
  if (input.billing?.state === "trialing" || input.billing?.state === "active") return { title: fill(w.activeTitle, { plan }), text: w.active, confirmed: true };
  return { title: w.pendingTitle, text: !input.signedIn ? w.signedOut : input.settled ? w.slow : w.pending, confirmed: false };
}

export { fill as fillTrial };
