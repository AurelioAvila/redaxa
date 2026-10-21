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
    linePromo: "Gratis durante {days} días; después, {first} {period} a partir del {date} y luego {amount}.",
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
    startTrial: "Commencer l’essai gratuit de {days} jours", subscribeNow: "S’abonner maintenant", updatePayment: "Mettre à jour le paiement",
    perUser: "{amount} par utilisateur", perMonth: "{amount} par mois", perYear: "{amount} par an", perUserMonth: "{amount} par utilisateur et par mois", perUserYear: "{amount} par utilisateur et par an",
    firstMonth: "le premier mois", firstYear: "la première année",
    line: "Gratuit pendant {days} jours, puis {amount} à partir du {date}.",
    linePromo: "Gratuit pendant {days} jours, puis {first} {period} à partir du {date}, et {amount} ensuite.",
    cancelHint: "Annulez avant et vous ne payez rien.",
    nowLine: "Ou abonnez-vous maintenant : {first} aujourd’hui, sans essai.",
    consent: "Une carte ou un autre moyen de paiement est nécessaire pour commencer. {first} est prélevé automatiquement le {date}, sauf si vous annulez avant. Prix HT.",
    trialUsed: "Vous avez déjà utilisé votre essai gratuit : l’offre démarre donc tout de suite.",
    statusTrial: "Votre essai de {plan} se termine le {date}. L’offre démarre ensuite, sauf si vous l’annulez avant.",
    statusTrialCancelled: "Votre essai de {plan} se termine le {date}. Il est annulé : rien ne sera prélevé.",
    statusPaused: "{plan} est suspendu jusqu’à ce qu’un paiement aboutisse.",
    statusRefused: "Un essai gratuit a déjà été utilisé avec cette adresse e-mail ou cette carte, celui-ci a donc été annulé. Rien n’a été prélevé.",
    noteTrialEnds: "Gratuit jusqu’au {date}.",
    pausedBadge: "Échec du paiement",
    sidebarTrialNote: "Vérifications illimitées jusqu’au {date}. L’offre démarre ensuite, sauf si vous l’annulez.",
    sidebarTrialCancelled: "Vérifications illimitées jusqu’au {date}. Annulé : rien ne sera prélevé.",
    sidebarPausedNote: "{plan} est suspendu. Mettez à jour le moyen de paiement pour le réactiver.",
    copy: {
      plansIntro: "Commencez Pro ou Business par un essai gratuit de 3 jours, ou abonnez-vous tout de suite. Une carte ou un autre moyen de paiement est nécessaire pour commencer ; si vous annulez avant la fin de l’essai, vous ne payez rien. Pro est le nouveau nom de Personal, au même prix.",
      planNoneNote: "5 vérifications par jour sans carte. Pro supprime la limite : essayez-le gratuitement pendant 3 jours.",
      startTrialToInspect: "Vous avez utilisé les 5 vérifications gratuites du jour. Choisissez une offre pour continuer : vous pouvez l’essayer gratuitement pendant 3 jours.",
      faqTrialQ: "Comment fonctionne l’essai de 3 jours ?",
      faqTrialA: "Choisissez Commencer l’essai gratuit de 3 jours sur Pro ou Business. Une carte ou un autre moyen de paiement est nécessaire, et rien n’est prélevé pendant 3 jours. L’offre démarre ensuite et est prélevée automatiquement, sauf si vous l’annulez avant la fin de l’essai depuis Gérer l’abonnement. Chaque personne a droit à un seul essai gratuit ; pour payer tout de suite, choisissez S’abonner maintenant.",
    },
    promoFine: "Les prix barrés sont nos plus bas des 30 jours précédant l'offre. Nouveaux abonnements uniquement ; le prix de l’offre est le premier paiement, après l’essai gratuit si vous en commencez un, et les renouvellements se font au prix normal. Prix hors TVA.",
  },
  de: {
    startTrial: "{days} Tage kostenlos testen", subscribeNow: "Jetzt abonnieren", updatePayment: "Zahlungsmethode aktualisieren",
    perUser: "{amount} pro Nutzer", perMonth: "{amount} pro Monat", perYear: "{amount} pro Jahr", perUserMonth: "{amount} pro Nutzer und Monat", perUserYear: "{amount} pro Nutzer und Jahr",
    firstMonth: "den ersten Monat", firstYear: "das erste Jahr",
    line: "{days} Tage kostenlos, danach {amount} ab dem {date}.",
    linePromo: "{days} Tage kostenlos, danach {first} für {period} ab dem {date} und anschließend {amount}.",
    cancelHint: "Wenn Sie vorher kündigen, zahlen Sie nichts.",
    nowLine: "Oder jetzt abonnieren: {first} heute, ohne Testphase.",
    consent: "Zum Start ist eine Karte oder eine andere Zahlungsmethode nötig. {first} wird am {date} automatisch abgebucht, sofern Sie nicht vorher kündigen. Preise zzgl. MwSt.",
    trialUsed: "Sie haben die kostenlose Testphase bereits genutzt, daher beginnt der Tarif sofort.",
    statusTrial: "Ihre Testphase für {plan} endet am {date}. Danach beginnt der Tarif, sofern Sie nicht vorher kündigen.",
    statusTrialCancelled: "Ihre Testphase für {plan} endet am {date}. Sie ist gekündigt, es wird nichts abgebucht.",
    statusPaused: "{plan} ist pausiert, bis eine Zahlung erfolgt.",
    statusRefused: "Mit dieser E-Mail-Adresse oder Karte wurde bereits eine kostenlose Testphase genutzt, daher wurde diese beendet. Es wurde nichts abgebucht.",
    noteTrialEnds: "Kostenlos bis zum {date}.",
    pausedBadge: "Zahlung fehlgeschlagen",
    sidebarTrialNote: "Unbegrenzte Prüfungen bis zum {date}. Danach beginnt der Tarif, sofern Sie nicht kündigen.",
    sidebarTrialCancelled: "Unbegrenzte Prüfungen bis zum {date}. Gekündigt: Es wird nichts abgebucht.",
    sidebarPausedNote: "{plan} ist pausiert. Aktualisieren Sie die Zahlungsmethode, um den Tarif wieder zu aktivieren.",
    copy: {
      plansIntro: "Starten Sie Pro oder Business mit einer kostenlosen Testphase von 3 Tagen oder abonnieren Sie sofort. Zum Start ist eine Karte oder eine andere Zahlungsmethode nötig; wenn Sie vor Ende der Testphase kündigen, zahlen Sie nichts. Pro ist der neue Name von Personal, zum gleichen Preis.",
      planNoneNote: "5 Prüfungen pro Tag ohne Karte. Pro hebt das Limit auf: 3 Tage kostenlos testen.",
      startTrialToInspect: "Sie haben die 5 kostenlosen Prüfungen für heute genutzt. Wählen Sie einen Tarif, um weiterzumachen: Sie können ihn 3 Tage kostenlos testen.",
      faqTrialQ: "Wie funktioniert die 3-tägige Testphase?",
      faqTrialA: "Wählen Sie bei Pro oder Business „3 Tage kostenlos testen“. Eine Karte oder eine andere Zahlungsmethode ist nötig, und 3 Tage lang wird nichts abgebucht. Danach beginnt der Tarif und wird automatisch abgebucht, sofern Sie nicht vor Ende der Testphase unter „Abonnement verwalten“ kündigen. Pro Person gibt es eine kostenlose Testphase; wenn Sie lieber sofort zahlen, wählen Sie „Jetzt abonnieren“.",
    },
    promoFine: "Durchgestrichene Preise sind unsere niedrigsten der 30 Tage vor dem Angebot. Nur für neue Abos; der Angebotspreis ist die erste Zahlung, nach der kostenlosen Testphase, falls Sie eine starten, und Verlängerungen erfolgen zum regulären Preis. Preise ohne MwSt.",
  },
};

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

export { fill as fillTrial };
