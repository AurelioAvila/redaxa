/**
 * The free-trial emails, in the language the customer used at checkout
 * (subscription metadata `lang`; English otherwise), drawn by the same
 * Paper & copper renderer as every other Redaxa email.
 *
 * Every amount and date arrives as data from Stripe: the first charge from
 * the invoice preview (coupon and tax included), the renewal from the Price
 * on the subscription. Nothing here quotes a price of its own.
 */
import { renderEmail, send, SITE_URL, type Block, type EmailFrame } from "./_email.js";
import type { Language } from "./_trial.js";

export type TrialMailKind = "trial_started" | "trial_ending" | "trial_paid" | "payment_failed" | "trial_ended" | "trial_rejected";
export type FailureKey = "insufficient_funds" | "card_declined" | "expired_card" | "authentication_required" | "processing_error" | "generic";
type Money = { amount: number; currency: string };

export type TrialMailInput = {
  to: string;
  firstName?: string | null;
  lang: Language;
  /** "personal" (Pro) or "business". */
  plan: string | null;
  /** "monthly" or "yearly". */
  interval: string | null;
  seats: number;
  /** Length of the trial in days. */
  days: number;
  /** Unix seconds. */
  trialEnd?: number | null;
  /** The first charge after the trial (preview), or what was charged. */
  charge?: Money | null;
  /** What each renewal costs, from the Price on the subscription. */
  renew?: (Money & { taxExclusive: boolean }) | null;
  renewsOn?: number | null;
  failure?: FailureKey | null;
  endedOn?: number | null;
};

type Lines = {
  subject: string; preheader: string; kicker: string; h1: string; intro: string;
  rows: Array<[string, string | null]>; key?: [string, string | null];
  button: [string, string]; h2?: string; list?: string[]; after?: string; moment?: [string, string, string];
  footer: string; help: [string, string]; reply: boolean;
};

type Words = {
  locale: string;
  frame: Omit<EmailFrame, "write"> & { writeOr: string; writeTo: string };
  monthly: string; yearly: string; seats: string; perMonth: string; perYear: string; taxExclusive: string; planPrice: string;
  failures: Record<FailureKey, string>;
  mail: Record<TrialMailKind, (v: Record<string, string>, business: boolean) => Lines>;
};

const W = `${SITE_URL}/dashboard.html`;
const OPEN: [string, string] = ["", W];
const PLANS: [string, string] = ["", `${W}#plans`];
const ACCOUNT: [string, string] = ["", `${W}#workspace`];
const b = (label: string, target: [string, string]): [string, string] => [label, target[1]];

const EN: Words = {
  locale: "en-GB",
  frame: { lang: "en", writeOr: "Or write to", writeTo: "Write to", never: "Never send a password or an API key by email.", privacy: "Privacy", terms: "Terms", support: "Support" },
  monthly: "Monthly", yearly: "Yearly", seats: "{n} users", perMonth: "{amount} a month", perYear: "{amount} a year", taxExclusive: "excl. VAT", planPrice: "the plan's price",
  failures: { insufficient_funds: "insufficient funds", card_declined: "the card was declined", expired_card: "the card has expired", authentication_required: "the bank asked for a confirmation that was not completed", processing_error: "a processing error at the bank", generic: "the payment was not accepted" },
  mail: {
    trial_started: (v, business) => ({
      subject: `Your Redaxa ${v.tier} trial has started`,
      preheader: `${v.tier} is on until ${v.end}. Then ${v.charge} is charged, unless you cancel first.`,
      kicker: "Free trial",
      h1: `${v.tier} is on for ${v.days} days`,
      intro: `Your ${v.days}-day trial of Redaxa ${v.tier} started today. Nothing has been charged. On ${v.end} the trial ends and ${v.plan} starts at ${v.charge}, unless you cancel before then.`,
      rows: [["Plan", v.plan], ["Charged today", "Nothing"], ["First charge", v.chargeOnly], ["After that", v.renew]],
      key: ["Trial ends", v.end],
      button: b("Open Redaxa", OPEN),
      h2: "Three things to try first",
      list: business
        ? ["Add the client and project names your team must never paste into a chat under Protected terms. They apply to every member.",
          "Choose a policy per category (warn, redact or block sending in the Chrome extension) so everyone follows the same rule.",
          "Invite your colleagues from Account & team. Admins see metadata-only activity, never the prompt text, and can export it as CSV."]
        : ["Add your client and project names under Protected terms, so every check flags them.",
          "Check a public repository on the web, or review one locally with its Git history in the Windows app.",
          "Install the Chrome extension. It checks what you are about to send on ChatGPT, Claude, Gemini and Perplexity."],
      after: `To keep ${v.tier}, there is nothing to do. To stop, open Account & team, then Manage subscription, and cancel before ${v.end}: nothing is charged and ${v.tier} stays on until the trial ends.`,
      moment: ["Trial ends", v.endShort, `Then ${v.charge} for ${v.plan}, unless you cancel before then.`],
      footer: "You received this email because you started a Redaxa trial with this address. There is one free trial per person.",
      help: ["Billing question, or something not working?", "Reply to this email from the address on the account."], reply: true,
    }),
    trial_ending: (v) => ({
      subject: `Your Redaxa trial ends on ${v.endShort}`,
      preheader: `On ${v.end}, ${v.charge} is charged for ${v.plan}. Nothing to do if you want to keep ${v.tier}.`,
      kicker: "Trial ending",
      h1: `Your trial ends on ${v.endShort}`,
      intro: `Your Redaxa ${v.tier} trial ends on ${v.end}. ${v.plan} then starts and ${v.charge} is charged to the payment method you added. To keep ${v.tier}, there is nothing to do. If you would rather not, cancel before then and nothing is charged.`,
      rows: [["Plan", v.plan], ["When", v.end]],
      key: ["First charge", v.chargeOnly],
      button: b("Review your plan", PLANS),
      h2: "Before the trial ends",
      list: [`To cancel, open Account & team, then Manage subscription. ${v.tier} stays on until the trial ends, and the account then returns to the free plan.`,
        "To pay with another card, change the payment method in the same place. The charge uses whichever method is on file at that moment.",
        `If the payment cannot be taken, ${v.tier} is paused straight away and we email you the reason.`],
      after: "This is the only reminder we send.",
      moment: ["First charge", v.chargeOnly, `On ${v.end}, unless you cancel before then.`],
      footer: "You received this email because your Redaxa trial ends in about a day.",
      help: ["Not sure which card is on file?", "Account & team, then Manage subscription, shows it. Reply to this email if anything looks wrong."], reply: true,
    }),
    trial_paid: (v, business) => ({
      subject: `Your Redaxa ${v.tier} plan is active`,
      preheader: `${v.charge} charged for ${v.plan}. Next renewal on ${v.renewsOn}.`,
      kicker: "Plan active",
      h1: `Your trial is over and ${v.tier} stays on`,
      intro: `Your free trial has ended and the first payment went through: ${v.charge} for ${v.plan}. Nothing changes on the web, in the Windows app or in the Chrome extension. The next charge is on ${v.renewsOn}.`,
      rows: [["Plan", v.plan], ["Charged", v.chargeOnly], ["After that", v.renew]],
      key: ["Renews on", v.renewsOn],
      button: b("Open Redaxa", OPEN),
      h2: "Good to know",
      list: [`Account & team, then Manage subscription, shows the plan and the next charge. Change the card or cancel there; a cancelled plan stays on until ${v.renewsOn}.`,
        "Sign in with the same address in the Windows app and in the Chrome extension: the plan follows your account, not the device.",
        business ? "Invite your colleagues from Account & team: each one takes a seat of your plan." : "Protected terms you added during the trial stay in place and apply to every check."],
      moment: ["Next renewal", v.renewsShort, v.renew ? `${v.renew}. Change or cancel any time from Account & team.` : "Change or cancel any time from Account & team."],
      footer: "You received this email because your Redaxa trial became a paid subscription.",
      help: ["Charged something you did not expect?", "Reply with the account address and the date of the charge, and we will check it with you."], reply: true,
    }),
    payment_failed: (v) => ({
      subject: `Redaxa: payment failed, ${v.tier} is paused`,
      preheader: `${v.charge} could not be taken. Update the payment method to turn ${v.tier} back on.`,
      kicker: "Payment failed",
      h1: `${v.tier} is paused until the payment goes through`,
      intro: `We could not take the payment of ${v.charge} for ${v.plan}${v.reason ? `: ${v.reason}` : ""}. ${v.tier} is paused from now and the account is on the free plan, with 5 prompt checks a day on the web and in the Windows app. No money has been taken.`,
      rows: [["Status", `${v.tier} paused`], ["Amount", v.chargeOnly], ["Reason", v.reason || null], ["Plan", v.plan]],
      button: b("Update payment method", ACCOUNT),
      h2: `To turn ${v.tier} back on`,
      list: ["Sign in, open Account & team, then Manage subscription. Add a card or another payment method that works, and pay the open invoice.",
        `${v.tier} comes back by itself as soon as the payment goes through, with the same plan and renewal date.`,
        "If you would rather stop, cancel the plan in the same place. Until then, the payment may be retried over the next few days."],
      after: "We never see or store card details; Stripe, our payment provider, handles them.",
      moment: ["Status", `${v.tier} paused`, "Until a payment goes through."],
      footer: "You received this email because a payment for the Redaxa subscription on this address failed.",
      help: ["Card updated, but Redaxa still shows the free plan?", "Check that the invoice shows as paid, then sign out and in again. If nothing changes within an hour, reply with the account address."], reply: true,
    }),
    trial_ended: (v) => ({
      subject: "Your Redaxa trial has ended",
      preheader: "Nothing was charged. The account is back on the free plan.",
      kicker: "Trial ended",
      h1: `${v.tier} is off and nothing was charged`,
      intro: `Your free trial of Redaxa ${v.tier} ended on ${v.ended} without a payment, so nothing was charged and nothing will be. The account is back on the free plan.`,
      rows: [["Charged", "Nothing"], ["Ended on", v.ended]],
      key: ["Now on", "Free plan"],
      button: b("See the plans", PLANS),
      h2: "On the free plan",
      list: ["5 prompt checks a day on the web and in the Windows app, and 3 public repository checks a day on the web.",
        "Free checks in the Chrome extension keep running on your device, with no daily limit.",
        `Your account and your protected terms stay as they are. To come back to ${v.tier}, choose a plan on Plans & pricing: the trial is one per person, so the plan starts straight away.`],
      moment: ["Charged", "Nothing", `The trial ended on ${v.endedShort}.`],
      footer: "You received this email because your Redaxa trial ended without a payment.",
      help: ["Did not cancel, or the date looks wrong?", "Reply with the date on this email and we will check the record with you."], reply: true,
    }),
    trial_rejected: (v) => ({
      subject: "Your Redaxa trial could not start",
      preheader: "A free trial was already used with this email address or card. Nothing was charged.",
      kicker: "Trial not available",
      h1: "Your trial could not start",
      intro: "A free trial of Redaxa has already been used with this email address or this card, so the new one was cancelled straight away. Nothing was charged and nothing will be.",
      rows: [["Charged", "Nothing"], ["Subscription", "Cancelled"]],
      button: b("See the plans", PLANS),
      after: `To use ${v.tier}, choose Subscribe now on Plans & pricing: the plan starts at once, at the price shown there.`,
      footer: "You received this email because a Redaxa trial was started with this address. There is one free trial per person.",
      help: ["Think this is a mistake?", "Reply to this email from the address on the account."], reply: true,
    }),
  },
};

const IT: Words = {
  locale: "it-IT",
  frame: { lang: "it", writeOr: "Oppure scrivi a", writeTo: "Scrivi a", never: "Non inviare mai una password o una chiave API via email.", privacy: "Privacy", terms: "Termini", support: "Assistenza" },
  monthly: "Mensile", yearly: "Annuale", seats: "{n} utenti", perMonth: "{amount} al mese", perYear: "{amount} all'anno", taxExclusive: "IVA esclusa", planPrice: "il prezzo del piano",
  failures: { insufficient_funds: "fondi insufficienti", card_declined: "la carta è stata rifiutata", expired_card: "la carta è scaduta", authentication_required: "la banca ha chiesto una conferma che non è stata completata", processing_error: "un errore di elaborazione della banca", generic: "il pagamento non è stato accettato" },
  mail: {
    trial_started: (v, business) => ({
      subject: `La tua prova di Redaxa ${v.tier} è iniziata`,
      preheader: `${v.tier} è attivo fino al ${v.end}. Poi vengono addebitati ${v.charge}, a meno che tu non annulli prima.`,
      kicker: "Prova gratuita",
      h1: `${v.tier} è attivo per ${v.days} giorni`,
      intro: `La tua prova di ${v.days} giorni di Redaxa ${v.tier} è iniziata oggi. Non ti è stato addebitato nulla. Il ${v.end} la prova finisce e inizia il piano ${v.plan}, con un addebito di ${v.charge}, a meno che tu non lo annulli prima.`,
      rows: [["Piano", v.plan], ["Addebitato oggi", "Niente"], ["Primo addebito", v.chargeOnly], ["In seguito", v.renew]],
      key: ["La prova finisce", v.end],
      button: b("Apri Redaxa", OPEN),
      h2: "Tre cose da provare subito",
      list: business
        ? ["Aggiungi nei Termini protetti i nomi di clienti e progetti che il team non deve mai incollare in una chat: valgono per ogni membro.",
          "Scegli una policy per categoria (avvisa, oscura o blocca l'invio nell'estensione per Chrome), così tutti seguono la stessa regola.",
          "Invita i colleghi da Account e team. Gli amministratori vedono solo i metadati dell'attività, mai il testo dei prompt, e possono esportarli in CSV."]
        : ["Aggiungi i nomi di clienti e progetti nei Termini protetti: ogni controllo li segnalerà.",
          "Controlla un repository pubblico sul web, oppure analizzane uno in locale, con la cronologia Git, nell'app per Windows.",
          "Installa l'estensione per Chrome: controlla quello che stai per inviare su ChatGPT, Claude, Gemini e Perplexity."],
      after: `Per tenere ${v.tier} non devi fare nulla. Per fermarti, apri Account e team, poi Gestisci abbonamento, e annulla prima del ${v.end}: non ti verrà addebitato nulla e ${v.tier} resta attivo fino alla fine della prova.`,
      moment: ["La prova finisce", v.endShort, `Poi ${v.charge} per ${v.plan}, a meno che tu non annulli prima.`],
      footer: "Hai ricevuto questa email perché hai iniziato una prova di Redaxa con questo indirizzo. È prevista una sola prova gratuita per persona.",
      help: ["Domande sulla fatturazione o qualcosa non funziona?", "Rispondi a questa email dall'indirizzo dell'account."], reply: true,
    }),
    trial_ending: (v) => ({
      subject: `La tua prova di Redaxa finisce il ${v.endShort}`,
      preheader: `Il ${v.end} vengono addebitati ${v.charge} per ${v.plan}. Se vuoi tenere ${v.tier}, non devi fare nulla.`,
      kicker: "Prova in scadenza",
      h1: `La tua prova finisce il ${v.endShort}`,
      intro: `La tua prova di Redaxa ${v.tier} finisce il ${v.end}. A quel punto inizia il piano ${v.plan} e vengono addebitati ${v.charge} sul metodo di pagamento che hai aggiunto. Se vuoi tenere ${v.tier}, non devi fare nulla. Altrimenti annulla prima di quel momento: non ti verrà addebitato nulla.`,
      rows: [["Piano", v.plan], ["Quando", v.end]],
      key: ["Primo addebito", v.chargeOnly],
      button: b("Rivedi il tuo piano", PLANS),
      h2: "Prima che la prova finisca",
      list: [`Per annullare, apri Account e team, poi Gestisci abbonamento. ${v.tier} resta attivo fino alla fine della prova, poi l'account torna al piano gratuito.`,
        "Per pagare con un'altra carta, cambia il metodo di pagamento nello stesso punto. L'addebito usa il metodo registrato in quel momento.",
        `Se il pagamento non va a buon fine, ${v.tier} viene sospeso subito e ti scriviamo il motivo.`],
      after: "È l'unico promemoria che inviamo.",
      moment: ["Primo addebito", v.chargeOnly, `Il ${v.end}, a meno che tu non annulli prima.`],
      footer: "Hai ricevuto questa email perché la tua prova di Redaxa finisce tra circa un giorno.",
      help: ["Non sai quale carta è registrata?", "La trovi in Account e team, sotto Gestisci abbonamento. Rispondi a questa email se qualcosa non torna."], reply: true,
    }),
    trial_paid: (v, business) => ({
      subject: `Il tuo piano Redaxa ${v.tier} è attivo`,
      preheader: `Addebitati ${v.charge} per ${v.plan}. Prossimo rinnovo il ${v.renewsOn}.`,
      kicker: "Piano attivo",
      h1: `La prova è finita e ${v.tier} resta attivo`,
      intro: `La prova gratuita è finita e il primo pagamento è andato a buon fine: ${v.charge} per ${v.plan}. Non cambia nulla sul web, nell'app per Windows e nell'estensione per Chrome. Il prossimo addebito è il ${v.renewsOn}.`,
      rows: [["Piano", v.plan], ["Addebitato", v.chargeOnly], ["In seguito", v.renew]],
      key: ["Si rinnova il", v.renewsOn],
      button: b("Apri Redaxa", OPEN),
      h2: "Da sapere",
      list: [`In Account e team, sotto Gestisci abbonamento, trovi il piano e il prossimo addebito. Lì puoi cambiare la carta o annullare; un piano annullato resta attivo fino al ${v.renewsOn}.`,
        "Accedi con lo stesso indirizzo nell'app per Windows e nell'estensione per Chrome: il piano segue il tuo account, non il dispositivo.",
        business ? "Invita i colleghi da Account e team: ognuno occupa un posto del tuo piano." : "I termini protetti che hai aggiunto durante la prova restano dove sono e valgono per ogni controllo."],
      moment: ["Prossimo rinnovo", v.renewsShort, v.renew ? `${v.renew}. Puoi cambiare o annullare quando vuoi da Account e team.` : "Puoi cambiare o annullare quando vuoi da Account e team."],
      footer: "Hai ricevuto questa email perché la tua prova di Redaxa è diventata un abbonamento a pagamento.",
      help: ["Un addebito che non ti aspettavi?", "Rispondi con l'indirizzo dell'account e la data dell'addebito: lo verifichiamo insieme."], reply: true,
    }),
    payment_failed: (v) => ({
      subject: `Redaxa: pagamento non riuscito, ${v.tier} è sospeso`,
      preheader: `Non è stato possibile addebitare ${v.charge}. Aggiorna il metodo di pagamento per riattivare ${v.tier}.`,
      kicker: "Pagamento non riuscito",
      h1: `${v.tier} è sospeso finché il pagamento non va a buon fine`,
      intro: `Non siamo riusciti ad addebitare ${v.charge} per ${v.plan}${v.reason ? `: ${v.reason}` : ""}. Da ora ${v.tier} è sospeso e l'account è sul piano gratuito, con 5 controlli di prompt al giorno sul web e nell'app per Windows. Non è stato prelevato alcun importo.`,
      rows: [["Stato", `${v.tier} sospeso`], ["Importo", v.chargeOnly], ["Motivo", v.reason || null], ["Piano", v.plan]],
      button: b("Aggiorna il metodo di pagamento", ACCOUNT),
      h2: `Per riattivare ${v.tier}`,
      list: ["Accedi, apri Account e team, poi Gestisci abbonamento. Aggiungi una carta o un altro metodo di pagamento valido e paga la fattura aperta.",
        `${v.tier} torna da solo appena il pagamento va a buon fine, con lo stesso piano e la stessa data di rinnovo.`,
        "Se preferisci fermarti, annulla il piano nello stesso punto. Fino ad allora il pagamento potrebbe essere ritentato nei prossimi giorni."],
      after: "Non vediamo né conserviamo i dati delle carte: li gestisce Stripe, il nostro fornitore di pagamenti.",
      moment: ["Stato", `${v.tier} sospeso`, "Finché un pagamento non va a buon fine."],
      footer: "Hai ricevuto questa email perché un pagamento dell'abbonamento Redaxa legato a questo indirizzo non è riuscito.",
      help: ["Hai aggiornato la carta ma Redaxa mostra ancora il piano gratuito?", "Verifica che la fattura risulti pagata, poi esci e accedi di nuovo. Se entro un'ora non cambia nulla, rispondi con l'indirizzo dell'account."], reply: true,
    }),
    trial_ended: (v) => ({
      subject: "La tua prova di Redaxa è finita",
      preheader: "Non ti è stato addebitato nulla. L'account è tornato al piano gratuito.",
      kicker: "Prova finita",
      h1: `${v.tier} non è più attivo e non ti è stato addebitato nulla`,
      intro: `La tua prova gratuita di Redaxa ${v.tier} è finita il ${v.ended} senza un pagamento: non ti è stato addebitato nulla e non lo sarà. L'account è tornato al piano gratuito.`,
      rows: [["Addebitato", "Niente"], ["Finita il", v.ended]],
      key: ["Ora sei sul", "Piano gratuito"],
      button: b("Vedi i piani", PLANS),
      h2: "Con il piano gratuito",
      list: ["5 controlli di prompt al giorno sul web e nell'app per Windows, e 3 controlli di repository pubblici al giorno sul web.",
        "I controlli gratuiti nell'estensione per Chrome continuano sul tuo dispositivo, senza limite giornaliero.",
        `Il tuo account e i tuoi termini protetti restano come sono. Per tornare a ${v.tier}, scegli un piano in Piani e prezzi: la prova è una per persona, quindi il piano parte subito.`],
      moment: ["Addebitato", "Niente", `La prova è finita il ${v.endedShort}.`],
      footer: "Hai ricevuto questa email perché la tua prova di Redaxa è finita senza un pagamento.",
      help: ["Non avevi annullato, o la data non ti torna?", "Rispondi indicando la data di questa email e verifichiamo insieme."], reply: true,
    }),
    trial_rejected: (v) => ({
      subject: "La tua prova di Redaxa non è partita",
      preheader: "Con questo indirizzo email o con questa carta è già stata usata una prova gratuita. Non è stato addebitato nulla.",
      kicker: "Prova non disponibile",
      h1: "La tua prova non è partita",
      intro: "Con questo indirizzo email o con questa carta è già stata usata una prova gratuita di Redaxa, quindi la nuova prova è stata annullata subito. Non ti è stato addebitato nulla e non lo sarà.",
      rows: [["Addebitato", "Niente"], ["Abbonamento", "Annullato"]],
      button: b("Vedi i piani", PLANS),
      after: `Per usare ${v.tier}, scegli Abbonati subito in Piani e prezzi: il piano parte subito, al prezzo indicato.`,
      footer: "Hai ricevuto questa email perché con questo indirizzo è stata avviata una prova di Redaxa. È prevista una sola prova gratuita per persona.",
      help: ["Pensi che sia un errore?", "Rispondi a questa email dall'indirizzo dell'account."], reply: true,
    }),
  },
};

const ES: Words = {
  locale: "es-ES",
  frame: { lang: "es", writeOr: "O escribe a", writeTo: "Escribe a", never: "No envíes nunca una contraseña ni una clave API por correo.", privacy: "Privacidad", terms: "Términos", support: "Soporte" },
  monthly: "Mensual", yearly: "Anual", seats: "{n} usuarios", perMonth: "{amount} al mes", perYear: "{amount} al año", taxExclusive: "sin IVA", planPrice: "el precio del plan",
  failures: { insufficient_funds: "fondos insuficientes", card_declined: "la tarjeta fue rechazada", expired_card: "la tarjeta ha caducado", authentication_required: "el banco pidió una confirmación que no se completó", processing_error: "un error de procesamiento del banco", generic: "el pago no fue aceptado" },
  mail: {
    trial_started: (v, business) => ({
      subject: `Tu prueba de Redaxa ${v.tier} ha empezado`,
      preheader: `${v.tier} está activo hasta el ${v.end}. Después se cobran ${v.charge}, salvo que canceles antes.`,
      kicker: "Prueba gratuita",
      h1: `${v.tier} está activo durante ${v.days} días`,
      intro: `Tu prueba de ${v.days} días de Redaxa ${v.tier} ha empezado hoy. No se te ha cobrado nada. El ${v.end} termina la prueba y empieza el plan ${v.plan}, con un cargo de ${v.charge}, salvo que lo canceles antes.`,
      rows: [["Plan", v.plan], ["Cobrado hoy", "Nada"], ["Primer cargo", v.chargeOnly], ["Después", v.renew]],
      key: ["La prueba termina", v.end],
      button: b("Abrir Redaxa", OPEN),
      h2: "Tres cosas para probar primero",
      list: business
        ? ["Añade en Términos protegidos los nombres de clientes y proyectos que tu equipo nunca debe pegar en un chat: se aplican a todos los miembros.",
          "Elige una política por categoría (avisar, ocultar o bloquear el envío en la extensión para Chrome) para que todos sigan la misma regla.",
          "Invita a tus compañeros desde Cuenta y equipo. Los administradores solo ven metadatos de la actividad, nunca el texto de los prompts, y pueden exportarlos en CSV."]
        : ["Añade los nombres de clientes y proyectos en Términos protegidos: cada revisión los señalará.",
          "Revisa un repositorio público en la web, o analiza uno en local, con su historial de Git, en la app para Windows.",
          "Instala la extensión para Chrome: revisa lo que vas a enviar en ChatGPT, Claude, Gemini y Perplexity."],
      after: `Para quedarte con ${v.tier} no tienes que hacer nada. Para pararlo, abre Cuenta y equipo, luego Gestionar suscripción, y cancela antes del ${v.end}: no se te cobrará nada y ${v.tier} seguirá activo hasta que termine la prueba.`,
      moment: ["La prueba termina", v.endShort, `Después, ${v.charge} por ${v.plan}, salvo que canceles antes.`],
      footer: "Has recibido este correo porque has empezado una prueba de Redaxa con esta dirección. Hay una sola prueba gratuita por persona.",
      help: ["¿Una pregunta sobre la facturación o algo no funciona?", "Responde a este correo desde la dirección de la cuenta."], reply: true,
    }),
    trial_ending: (v) => ({
      subject: `Tu prueba de Redaxa termina el ${v.endShort}`,
      preheader: `El ${v.end} se cobran ${v.charge} por ${v.plan}. Si quieres seguir con ${v.tier}, no tienes que hacer nada.`,
      kicker: "La prueba termina",
      h1: `Tu prueba termina el ${v.endShort}`,
      intro: `Tu prueba de Redaxa ${v.tier} termina el ${v.end}. Entonces empieza el plan ${v.plan} y se cobran ${v.charge} con el método de pago que añadiste. Si quieres seguir con ${v.tier}, no tienes que hacer nada. Si no, cancela antes y no se te cobrará nada.`,
      rows: [["Plan", v.plan], ["Cuándo", v.end]],
      key: ["Primer cargo", v.chargeOnly],
      button: b("Revisar tu plan", PLANS),
      h2: "Antes de que termine la prueba",
      list: [`Para cancelar, abre Cuenta y equipo y luego Gestionar suscripción. ${v.tier} sigue activo hasta que termina la prueba y después la cuenta vuelve al plan gratuito.`,
        "Para pagar con otra tarjeta, cambia el método de pago en el mismo sitio. El cargo usa el método que esté guardado en ese momento.",
        `Si no se puede cobrar el pago, ${v.tier} se suspende al momento y te escribimos con el motivo.`],
      after: "Es el único recordatorio que enviamos.",
      moment: ["Primer cargo", v.chargeOnly, `El ${v.end}, salvo que canceles antes.`],
      footer: "Has recibido este correo porque tu prueba de Redaxa termina en aproximadamente un día.",
      help: ["¿No sabes qué tarjeta está guardada?", "La ves en Cuenta y equipo, en Gestionar suscripción. Responde a este correo si algo no cuadra."], reply: true,
    }),
    trial_paid: (v, business) => ({
      subject: `Tu plan Redaxa ${v.tier} está activo`,
      preheader: `Se han cobrado ${v.charge} por ${v.plan}. Próxima renovación el ${v.renewsOn}.`,
      kicker: "Plan activo",
      h1: `La prueba ha terminado y ${v.tier} sigue activo`,
      intro: `Tu prueba gratuita ha terminado y el primer pago se ha completado: ${v.charge} por ${v.plan}. No cambia nada en la web, en la app para Windows ni en la extensión para Chrome. El próximo cargo es el ${v.renewsOn}.`,
      rows: [["Plan", v.plan], ["Cobrado", v.chargeOnly], ["Después", v.renew]],
      key: ["Se renueva el", v.renewsOn],
      button: b("Abrir Redaxa", OPEN),
      h2: "Conviene saber",
      list: [`En Cuenta y equipo, en Gestionar suscripción, ves el plan y el próximo cargo. Allí cambias la tarjeta o cancelas; un plan cancelado sigue activo hasta el ${v.renewsOn}.`,
        "Inicia sesión con la misma dirección en la app para Windows y en la extensión para Chrome: el plan va con tu cuenta, no con el dispositivo.",
        business ? "Invita a tus compañeros desde Cuenta y equipo: cada uno ocupa un puesto de tu plan." : "Los términos protegidos que añadiste durante la prueba se quedan donde están y se aplican a cada revisión."],
      moment: ["Próxima renovación", v.renewsShort, v.renew ? `${v.renew}. Cambia o cancela cuando quieras desde Cuenta y equipo.` : "Cambia o cancela cuando quieras desde Cuenta y equipo."],
      footer: "Has recibido este correo porque tu prueba de Redaxa se ha convertido en una suscripción de pago.",
      help: ["¿Un cargo que no esperabas?", "Responde con la dirección de la cuenta y la fecha del cargo, y lo revisamos contigo."], reply: true,
    }),
    payment_failed: (v) => ({
      subject: `Redaxa: el pago no se ha completado y ${v.tier} está en pausa`,
      preheader: `No se han podido cobrar ${v.charge}. Actualiza el método de pago para reactivar ${v.tier}.`,
      kicker: "Pago fallido",
      h1: `${v.tier} está en pausa hasta que se complete el pago`,
      intro: `No hemos podido cobrar ${v.charge} por ${v.plan}${v.reason ? `: ${v.reason}` : ""}. Desde ahora ${v.tier} está en pausa y la cuenta está en el plan gratuito, con 5 revisiones de prompts al día en la web y en la app para Windows. No se ha cobrado ningún importe.`,
      rows: [["Estado", `${v.tier} en pausa`], ["Importe", v.chargeOnly], ["Motivo", v.reason || null], ["Plan", v.plan]],
      button: b("Actualizar el método de pago", ACCOUNT),
      h2: `Para reactivar ${v.tier}`,
      list: ["Inicia sesión, abre Cuenta y equipo y luego Gestionar suscripción. Añade una tarjeta u otro método de pago que funcione y paga la factura pendiente.",
        `${v.tier} vuelve solo en cuanto se completa el pago, con el mismo plan y la misma fecha de renovación.`,
        "Si prefieres dejarlo aquí, cancela el plan en el mismo sitio. Mientras tanto, el pago puede reintentarse en los próximos días."],
      after: "Nunca vemos ni guardamos los datos de las tarjetas: los gestiona Stripe, nuestro proveedor de pagos.",
      moment: ["Estado", `${v.tier} en pausa`, "Hasta que se complete un pago."],
      footer: "Has recibido este correo porque ha fallado un pago de la suscripción de Redaxa asociada a esta dirección.",
      help: ["¿Has actualizado la tarjeta y Redaxa sigue mostrando el plan gratuito?", "Comprueba que la factura aparece como pagada, cierra sesión y vuelve a entrar. Si en una hora no cambia nada, responde con la dirección de la cuenta."], reply: true,
    }),
    trial_ended: (v) => ({
      subject: "Tu prueba de Redaxa ha terminado",
      preheader: "No se ha cobrado nada. La cuenta ha vuelto al plan gratuito.",
      kicker: "Prueba terminada",
      h1: `${v.tier} se ha desactivado y no se ha cobrado nada`,
      intro: `Tu prueba gratuita de Redaxa ${v.tier} terminó el ${v.ended} sin ningún pago, así que no se ha cobrado nada ni se cobrará. La cuenta ha vuelto al plan gratuito.`,
      rows: [["Cobrado", "Nada"], ["Terminó el", v.ended]],
      key: ["Ahora estás en", "Plan gratuito"],
      button: b("Ver los planes", PLANS),
      h2: "Con el plan gratuito",
      list: ["5 revisiones de prompts al día en la web y en la app para Windows, y 3 revisiones de repositorios públicos al día en la web.",
        "Las revisiones gratuitas en la extensión para Chrome siguen funcionando en tu dispositivo, sin límite diario.",
        `Tu cuenta y tus términos protegidos se quedan como están. Para volver a ${v.tier}, elige un plan en Planes y precios: hay una prueba por persona, así que el plan empieza al momento.`],
      moment: ["Cobrado", "Nada", `La prueba terminó el ${v.endedShort}.`],
      footer: "Has recibido este correo porque tu prueba de Redaxa ha terminado sin ningún pago.",
      help: ["¿No la cancelaste o la fecha no te cuadra?", "Responde indicando la fecha de este correo y lo revisamos contigo."], reply: true,
    }),
    trial_rejected: (v) => ({
      subject: "Tu prueba de Redaxa no ha podido empezar",
      preheader: "Ya se usó una prueba gratuita con esta dirección de correo o esta tarjeta. No se ha cobrado nada.",
      kicker: "Prueba no disponible",
      h1: "Tu prueba no ha podido empezar",
      intro: "Ya se ha usado una prueba gratuita de Redaxa con esta dirección de correo o con esta tarjeta, así que la nueva prueba se ha cancelado al momento. No se ha cobrado nada ni se cobrará.",
      rows: [["Cobrado", "Nada"], ["Suscripción", "Cancelada"]],
      button: b("Ver los planes", PLANS),
      after: `Para usar ${v.tier}, elige Suscribirse ahora en Planes y precios: el plan empieza al momento, con el precio indicado.`,
      footer: "Has recibido este correo porque se empezó una prueba de Redaxa con esta dirección. Hay una sola prueba gratuita por persona.",
      help: ["¿Crees que es un error?", "Responde a este correo desde la dirección de la cuenta."], reply: true,
    }),
  },
};

const FR: Words = {
  locale: "fr-FR",
  frame: { lang: "fr", writeOr: "Ou écrivez à", writeTo: "Écrivez à", never: "N’envoyez jamais de mot de passe ni de clé API par e-mail.", privacy: "Confidentialité", terms: "Conditions", support: "Assistance" },
  monthly: "Mensuel", yearly: "Annuel", seats: "{n} utilisateurs", perMonth: "{amount} par mois", perYear: "{amount} par an", taxExclusive: "HT", planPrice: "le prix de l’offre",
  failures: { insufficient_funds: "fonds insuffisants", card_declined: "la carte a été refusée", expired_card: "la carte a expiré", authentication_required: "la banque a demandé une confirmation qui n’a pas été effectuée", processing_error: "une erreur de traitement à la banque", generic: "le paiement n’a pas été accepté" },
  mail: {
    trial_started: (v, business) => ({
      subject: `Votre essai de Redaxa ${v.tier} a commencé`,
      preheader: `${v.tier} est actif jusqu’au ${v.end}. Ensuite, ${v.charge} seront prélevés, sauf si vous annulez avant.`,
      kicker: "Essai gratuit",
      h1: `${v.tier} est actif pendant ${v.days} jours`,
      intro: `Votre essai de ${v.days} jours de Redaxa ${v.tier} a commencé aujourd’hui. Rien n’a été prélevé. Le ${v.end}, l’essai se termine et l’offre ${v.plan} démarre avec un prélèvement de ${v.charge}, sauf si vous l’annulez avant.`,
      rows: [["Offre", v.plan], ["Prélevé aujourd’hui", "Rien"], ["Premier prélèvement", v.chargeOnly], ["Ensuite", v.renew]],
      key: ["Fin de l’essai", v.end],
      button: b("Ouvrir Redaxa", OPEN),
      h2: "Trois choses à essayer d’abord",
      list: business
        ? ["Ajoutez dans Termes protégés les noms de clients et de projets que votre équipe ne doit jamais coller dans un chat : ils s’appliquent à chaque membre.",
          "Choisissez une règle par catégorie (avertir, masquer ou bloquer l’envoi dans l’extension Chrome) pour que tout le monde suive la même.",
          "Invitez vos collègues depuis Compte et équipe. Les administrateurs ne voient que les métadonnées de l’activité, jamais le texte des prompts, et peuvent les exporter en CSV."]
        : ["Ajoutez les noms de vos clients et projets dans Termes protégés : chaque vérification les signalera.",
          "Vérifiez un dépôt public sur le web, ou analysez-en un en local, avec son historique Git, dans l’application Windows.",
          "Installez l’extension Chrome : elle vérifie ce que vous vous apprêtez à envoyer sur ChatGPT, Claude, Gemini et Perplexity."],
      after: `Pour garder ${v.tier}, vous n’avez rien à faire. Pour arrêter, ouvrez Compte et équipe, puis Gérer l’abonnement, et annulez avant le ${v.end} : rien ne sera prélevé et ${v.tier} restera actif jusqu’à la fin de l’essai.`,
      moment: ["Fin de l’essai", v.endShort, `Ensuite, ${v.charge} pour ${v.plan}, sauf si vous annulez avant.`],
      footer: "Vous recevez cet e-mail parce que vous avez commencé un essai de Redaxa avec cette adresse. Chaque personne a droit à un seul essai gratuit.",
      help: ["Une question de facturation, ou quelque chose ne fonctionne pas ?", "Répondez à cet e-mail depuis l’adresse du compte."], reply: true,
    }),
    trial_ending: (v) => ({
      subject: `Votre essai de Redaxa se termine le ${v.endShort}`,
      preheader: `Le ${v.end}, ${v.charge} seront prélevés pour ${v.plan}. Rien à faire si vous voulez garder ${v.tier}.`,
      kicker: "Fin de l’essai",
      h1: `Votre essai se termine le ${v.endShort}`,
      intro: `Votre essai de Redaxa ${v.tier} se termine le ${v.end}. L’offre ${v.plan} démarre alors et ${v.charge} sont prélevés sur le moyen de paiement que vous avez ajouté. Pour garder ${v.tier}, vous n’avez rien à faire. Sinon, annulez avant cette date et rien ne sera prélevé.`,
      rows: [["Offre", v.plan], ["Quand", v.end]],
      key: ["Premier prélèvement", v.chargeOnly],
      button: b("Voir votre offre", PLANS),
      h2: "Avant la fin de l’essai",
      list: [`Pour annuler, ouvrez Compte et équipe, puis Gérer l’abonnement. ${v.tier} reste actif jusqu’à la fin de l’essai, puis le compte repasse à l’offre gratuite.`,
        "Pour payer avec une autre carte, changez le moyen de paiement au même endroit. Le prélèvement utilise le moyen enregistré à ce moment-là.",
        `Si le paiement ne peut pas être prélevé, ${v.tier} est suspendu aussitôt et nous vous écrivons pour vous en indiquer la raison.`],
      after: "C’est le seul rappel que nous envoyons.",
      moment: ["Premier prélèvement", v.chargeOnly, `Le ${v.end}, sauf si vous annulez avant.`],
      footer: "Vous recevez cet e-mail parce que votre essai de Redaxa se termine dans environ une journée.",
      help: ["Vous ne savez pas quelle carte est enregistrée ?", "Elle apparaît dans Compte et équipe, sous Gérer l’abonnement. Répondez à cet e-mail si quelque chose vous semble anormal."], reply: true,
    }),
    trial_paid: (v, business) => ({
      subject: `Votre offre Redaxa ${v.tier} est active`,
      preheader: `${v.charge} prélevés pour ${v.plan}. Prochain renouvellement le ${v.renewsOn}.`,
      kicker: "Offre active",
      h1: `L’essai est terminé et ${v.tier} reste actif`,
      intro: `Votre essai gratuit est terminé et le premier paiement a réussi : ${v.charge} pour ${v.plan}. Rien ne change sur le web, dans l’application Windows ni dans l’extension Chrome. Le prochain prélèvement aura lieu le ${v.renewsOn}.`,
      rows: [["Offre", v.plan], ["Prélevé", v.chargeOnly], ["Ensuite", v.renew]],
      key: ["Renouvellement le", v.renewsOn],
      button: b("Ouvrir Redaxa", OPEN),
      h2: "Bon à savoir",
      list: [`Dans Compte et équipe, sous Gérer l’abonnement, vous voyez l’offre et le prochain prélèvement. C’est là que vous changez de carte ou que vous annulez ; une offre annulée reste active jusqu’au ${v.renewsOn}.`,
        "Connectez-vous avec la même adresse dans l’application Windows et dans l’extension Chrome : l’offre suit votre compte, pas l’appareil.",
        business ? "Invitez vos collègues depuis Compte et équipe : chacun occupe un poste de votre offre." : "Les termes protégés ajoutés pendant l’essai restent en place et s’appliquent à chaque vérification."],
      moment: ["Prochain renouvellement", v.renewsShort, v.renew ? `${v.renew}. Modifiez ou annulez quand vous voulez depuis Compte et équipe.` : "Modifiez ou annulez quand vous voulez depuis Compte et équipe."],
      footer: "Vous recevez cet e-mail parce que votre essai de Redaxa est devenu un abonnement payant.",
      help: ["Un prélèvement inattendu ?", "Répondez en indiquant l’adresse du compte et la date du prélèvement, et nous vérifierons avec vous."], reply: true,
    }),
    payment_failed: (v) => ({
      subject: `Redaxa : échec du paiement, ${v.tier} est suspendu`,
      preheader: `${v.charge} n’ont pas pu être prélevés. Mettez à jour le moyen de paiement pour réactiver ${v.tier}.`,
      kicker: "Échec du paiement",
      h1: `${v.tier} est suspendu jusqu’à ce que le paiement aboutisse`,
      intro: `Nous n’avons pas pu prélever ${v.charge} pour ${v.plan}${v.reason ? ` : ${v.reason}` : ""}. ${v.tier} est suspendu dès maintenant et le compte est sur l’offre gratuite, avec 5 vérifications de prompts par jour sur le web et dans l’application Windows. Aucun montant n’a été prélevé.`,
      rows: [["Statut", `${v.tier} suspendu`], ["Montant", v.chargeOnly], ["Motif", v.reason || null], ["Offre", v.plan]],
      button: b("Mettre à jour le paiement", ACCOUNT),
      h2: `Pour réactiver ${v.tier}`,
      list: ["Connectez-vous, ouvrez Compte et équipe, puis Gérer l’abonnement. Ajoutez une carte ou un autre moyen de paiement valable et réglez la facture en attente.",
        `${v.tier} revient tout seul dès que le paiement aboutit, avec la même offre et la même date de renouvellement.`,
        "Si vous préférez arrêter, annulez l’offre au même endroit. D’ici là, le paiement pourra être retenté dans les prochains jours."],
      after: "Nous ne voyons ni ne conservons jamais les données de carte : c’est Stripe, notre prestataire de paiement, qui les gère.",
      moment: ["Statut", `${v.tier} suspendu`, "Jusqu’à ce qu’un paiement aboutisse."],
      footer: "Vous recevez cet e-mail parce qu’un paiement de l’abonnement Redaxa associé à cette adresse a échoué.",
      help: ["Carte mise à jour, mais Redaxa affiche toujours l’offre gratuite ?", "Vérifiez que la facture apparaît comme payée, puis déconnectez-vous et reconnectez-vous. Si rien ne change dans l’heure, répondez avec l’adresse du compte."], reply: true,
    }),
    trial_ended: (v) => ({
      subject: "Votre essai de Redaxa est terminé",
      preheader: "Rien n’a été prélevé. Le compte est repassé à l’offre gratuite.",
      kicker: "Essai terminé",
      h1: `${v.tier} est désactivé et rien n’a été prélevé`,
      intro: `Votre essai gratuit de Redaxa ${v.tier} s’est terminé le ${v.ended} sans paiement : rien n’a été prélevé et rien ne le sera. Le compte est repassé à l’offre gratuite.`,
      rows: [["Prélevé", "Rien"], ["Terminé le", v.ended]],
      key: ["Offre actuelle", "Gratuite"],
      button: b("Voir les offres", PLANS),
      h2: "Avec l’offre gratuite",
      list: ["5 vérifications de prompts par jour sur le web et dans l’application Windows, et 3 vérifications de dépôts publics par jour sur le web.",
        "Les vérifications gratuites dans l’extension Chrome continuent sur votre appareil, sans limite quotidienne.",
        `Votre compte et vos termes protégés restent tels quels. Pour revenir à ${v.tier}, choisissez une offre dans Offres et tarifs : l’essai est unique par personne, l’offre démarre donc tout de suite.`],
      moment: ["Prélevé", "Rien", `L’essai s’est terminé le ${v.endedShort}.`],
      footer: "Vous recevez cet e-mail parce que votre essai de Redaxa s’est terminé sans paiement.",
      help: ["Vous n’aviez pas annulé, ou la date vous semble fausse ?", "Répondez en indiquant la date de cet e-mail et nous vérifierons avec vous."], reply: true,
    }),
    trial_rejected: (v) => ({
      subject: "Votre essai de Redaxa n’a pas pu commencer",
      preheader: "Un essai gratuit a déjà été utilisé avec cette adresse e-mail ou cette carte. Rien n’a été prélevé.",
      kicker: "Essai indisponible",
      h1: "Votre essai n’a pas pu commencer",
      intro: "Un essai gratuit de Redaxa a déjà été utilisé avec cette adresse e-mail ou cette carte : le nouvel essai a donc été annulé aussitôt. Rien n’a été prélevé et rien ne le sera.",
      rows: [["Prélevé", "Rien"], ["Abonnement", "Annulé"]],
      button: b("Voir les offres", PLANS),
      after: `Pour utiliser ${v.tier}, choisissez S’abonner maintenant dans Offres et tarifs : l’offre démarre aussitôt, au prix indiqué.`,
      footer: "Vous recevez cet e-mail parce qu’un essai de Redaxa a été commencé avec cette adresse. Chaque personne a droit à un seul essai gratuit.",
      help: ["Vous pensez qu’il s’agit d’une erreur ?", "Répondez à cet e-mail depuis l’adresse du compte."], reply: true,
    }),
  },
};

const DE: Words = {
  locale: "de-DE",
  frame: { lang: "de", writeOr: "Oder schreiben Sie an", writeTo: "Schreiben Sie an", never: "Senden Sie niemals ein Passwort oder einen API-Schlüssel per E-Mail.", privacy: "Datenschutz", terms: "Bedingungen", support: "Support" },
  monthly: "Monatlich", yearly: "Jährlich", seats: "{n} Nutzer", perMonth: "{amount} pro Monat", perYear: "{amount} pro Jahr", taxExclusive: "zzgl. MwSt.", planPrice: "der Tarifpreis",
  failures: { insufficient_funds: "keine ausreichende Deckung", card_declined: "die Karte wurde abgelehnt", expired_card: "die Karte ist abgelaufen", authentication_required: "die Bank hat eine Bestätigung verlangt, die nicht abgeschlossen wurde", processing_error: "ein Verarbeitungsfehler bei der Bank", generic: "die Zahlung wurde nicht akzeptiert" },
  mail: {
    trial_started: (v, business) => ({
      subject: `Ihre Testphase für Redaxa ${v.tier} hat begonnen`,
      preheader: `${v.tier} ist bis zum ${v.end} aktiv. Danach werden ${v.charge} abgebucht, sofern Sie nicht vorher kündigen.`,
      kicker: "Kostenlose Testphase",
      h1: `${v.tier} ist ${v.days} Tage lang aktiv`,
      intro: `Ihre ${v.days}-tägige Testphase für Redaxa ${v.tier} hat heute begonnen. Es wurde nichts abgebucht. Am ${v.end} endet die Testphase und der Tarif ${v.plan} beginnt mit einer Abbuchung von ${v.charge}, sofern Sie nicht vorher kündigen.`,
      rows: [["Tarif", v.plan], ["Heute abgebucht", "Nichts"], ["Erste Abbuchung", v.chargeOnly], ["Danach", v.renew]],
      key: ["Testphase endet", v.end],
      button: b("Redaxa öffnen", OPEN),
      h2: "Drei Dinge zum Ausprobieren",
      list: business
        ? ["Tragen Sie unter Geschützte Begriffe die Kunden- und Projektnamen ein, die Ihr Team nie in einen Chat einfügen darf. Sie gelten für jedes Mitglied.",
          "Wählen Sie pro Kategorie eine Richtlinie (warnen, schwärzen oder das Senden in der Chrome-Erweiterung blockieren), damit alle derselben Regel folgen.",
          "Laden Sie Ihr Team unter Konto und Team ein. Admins sehen nur Metadaten der Aktivität, nie den Text der Prompts, und können sie als CSV exportieren."]
        : ["Tragen Sie Kunden- und Projektnamen unter Geschützte Begriffe ein, damit jede Prüfung sie markiert.",
          "Prüfen Sie ein öffentliches Repository im Web oder analysieren Sie eines lokal mit seinem Git-Verlauf in der Windows-App.",
          "Installieren Sie die Chrome-Erweiterung. Sie prüft, was Sie gleich auf ChatGPT, Claude, Gemini und Perplexity senden."],
      after: `Um ${v.tier} zu behalten, müssen Sie nichts tun. Zum Beenden öffnen Sie Konto und Team, dann Abonnement verwalten, und kündigen vor dem ${v.end}: Es wird nichts abgebucht, und ${v.tier} bleibt bis zum Ende der Testphase aktiv.`,
      moment: ["Testphase endet", v.endShort, `Danach ${v.charge} für ${v.plan}, sofern Sie nicht vorher kündigen.`],
      footer: "Sie erhalten diese E-Mail, weil Sie mit dieser Adresse eine Testphase für Redaxa gestartet haben. Pro Person gibt es eine kostenlose Testphase.",
      help: ["Fragen zur Abrechnung, oder funktioniert etwas nicht?", "Antworten Sie auf diese E-Mail von der Adresse des Kontos."], reply: true,
    }),
    trial_ending: (v) => ({
      subject: `Ihre Testphase für Redaxa endet am ${v.endShort}`,
      preheader: `Am ${v.end} werden ${v.charge} für ${v.plan} abgebucht. Um ${v.tier} zu behalten, müssen Sie nichts tun.`,
      kicker: "Testphase endet",
      h1: `Ihre Testphase endet am ${v.endShort}`,
      intro: `Ihre Testphase für Redaxa ${v.tier} endet am ${v.end}. Dann beginnt der Tarif ${v.plan}, und ${v.charge} werden von der hinterlegten Zahlungsmethode abgebucht. Um ${v.tier} zu behalten, müssen Sie nichts tun. Andernfalls kündigen Sie vorher, dann wird nichts abgebucht.`,
      rows: [["Tarif", v.plan], ["Wann", v.end]],
      key: ["Erste Abbuchung", v.chargeOnly],
      button: b("Tarif ansehen", PLANS),
      h2: "Vor dem Ende der Testphase",
      list: [`Zum Kündigen öffnen Sie Konto und Team, dann Abonnement verwalten. ${v.tier} bleibt bis zum Ende der Testphase aktiv, danach wechselt das Konto zum kostenlosen Tarif.`,
        "Um mit einer anderen Karte zu zahlen, ändern Sie dort die Zahlungsmethode. Abgebucht wird von der Methode, die zu diesem Zeitpunkt hinterlegt ist.",
        `Kann die Zahlung nicht abgebucht werden, wird ${v.tier} sofort pausiert, und wir schreiben Ihnen den Grund.`],
      after: "Dies ist die einzige Erinnerung, die wir senden.",
      moment: ["Erste Abbuchung", v.chargeOnly, `Am ${v.end}, sofern Sie nicht vorher kündigen.`],
      footer: "Sie erhalten diese E-Mail, weil Ihre Testphase für Redaxa in etwa einem Tag endet.",
      help: ["Nicht sicher, welche Karte hinterlegt ist?", "Sie sehen sie unter Konto und Team, Abonnement verwalten. Antworten Sie auf diese E-Mail, wenn etwas nicht stimmt."], reply: true,
    }),
    trial_paid: (v, business) => ({
      subject: `Ihr Tarif Redaxa ${v.tier} ist aktiv`,
      preheader: `${v.charge} für ${v.plan} abgebucht. Nächste Verlängerung am ${v.renewsOn}.`,
      kicker: "Tarif aktiv",
      h1: `Die Testphase ist vorbei und ${v.tier} bleibt aktiv`,
      intro: `Ihre kostenlose Testphase ist beendet und die erste Zahlung war erfolgreich: ${v.charge} für ${v.plan}. Im Web, in der Windows-App und in der Chrome-Erweiterung ändert sich nichts. Die nächste Abbuchung erfolgt am ${v.renewsOn}.`,
      rows: [["Tarif", v.plan], ["Abgebucht", v.chargeOnly], ["Danach", v.renew]],
      key: ["Verlängerung am", v.renewsOn],
      button: b("Redaxa öffnen", OPEN),
      h2: "Gut zu wissen",
      list: [`Unter Konto und Team, Abonnement verwalten, sehen Sie den Tarif und die nächste Abbuchung. Dort ändern Sie die Karte oder kündigen; ein gekündigter Tarif bleibt bis zum ${v.renewsOn} aktiv.`,
        "Melden Sie sich in der Windows-App und in der Chrome-Erweiterung mit derselben Adresse an: Der Tarif gehört zu Ihrem Konto, nicht zum Gerät.",
        business ? "Laden Sie Ihr Team unter Konto und Team ein: Jede Person belegt einen Platz Ihres Tarifs." : "Geschützte Begriffe, die Sie während der Testphase angelegt haben, bleiben erhalten und gelten für jede Prüfung."],
      moment: ["Nächste Verlängerung", v.renewsShort, v.renew ? `${v.renew}. Ändern oder kündigen Sie jederzeit unter Konto und Team.` : "Ändern oder kündigen Sie jederzeit unter Konto und Team."],
      footer: "Sie erhalten diese E-Mail, weil Ihre Testphase für Redaxa in ein kostenpflichtiges Abonnement übergegangen ist.",
      help: ["Eine unerwartete Abbuchung?", "Antworten Sie mit der Adresse des Kontos und dem Datum der Abbuchung, dann prüfen wir es mit Ihnen."], reply: true,
    }),
    payment_failed: (v) => ({
      subject: `Redaxa: Zahlung fehlgeschlagen, ${v.tier} ist pausiert`,
      preheader: `${v.charge} konnten nicht abgebucht werden. Aktualisieren Sie die Zahlungsmethode, um ${v.tier} wieder zu aktivieren.`,
      kicker: "Zahlung fehlgeschlagen",
      h1: `${v.tier} ist pausiert, bis die Zahlung erfolgt`,
      intro: `Wir konnten ${v.charge} für ${v.plan} nicht abbuchen${v.reason ? `: ${v.reason}` : ""}. ${v.tier} ist ab sofort pausiert, und das Konto nutzt den kostenlosen Tarif mit 5 Prompt-Prüfungen pro Tag im Web und in der Windows-App. Es wurde kein Betrag abgebucht.`,
      rows: [["Status", `${v.tier} pausiert`], ["Betrag", v.chargeOnly], ["Grund", v.reason || null], ["Tarif", v.plan]],
      button: b("Zahlungsmethode aktualisieren", ACCOUNT),
      h2: `So aktivieren Sie ${v.tier} wieder`,
      list: ["Melden Sie sich an, öffnen Sie Konto und Team, dann Abonnement verwalten. Hinterlegen Sie eine funktionierende Karte oder eine andere Zahlungsmethode und begleichen Sie die offene Rechnung.",
        `${v.tier} kommt von selbst zurück, sobald die Zahlung erfolgt ist, mit demselben Tarif und demselben Verlängerungsdatum.`,
        "Wenn Sie lieber aufhören möchten, kündigen Sie den Tarif an derselben Stelle. Bis dahin kann die Zahlung in den nächsten Tagen erneut versucht werden."],
      after: "Wir sehen und speichern keine Kartendaten; diese verwaltet Stripe, unser Zahlungsdienstleister.",
      moment: ["Status", `${v.tier} pausiert`, "Bis eine Zahlung erfolgt."],
      footer: "Sie erhalten diese E-Mail, weil eine Zahlung für das Redaxa-Abonnement dieser Adresse fehlgeschlagen ist.",
      help: ["Karte aktualisiert, aber Redaxa zeigt noch den kostenlosen Tarif?", "Prüfen Sie, ob die Rechnung als bezahlt angezeigt wird, und melden Sie sich ab und wieder an. Ändert sich innerhalb einer Stunde nichts, antworten Sie mit der Adresse des Kontos."], reply: true,
    }),
    trial_ended: (v) => ({
      subject: "Ihre Testphase für Redaxa ist beendet",
      preheader: "Es wurde nichts abgebucht. Das Konto nutzt wieder den kostenlosen Tarif.",
      kicker: "Testphase beendet",
      h1: `${v.tier} ist beendet, und es wurde nichts abgebucht`,
      intro: `Ihre kostenlose Testphase für Redaxa ${v.tier} endete am ${v.ended} ohne Zahlung: Es wurde nichts abgebucht, und es wird nichts abgebucht. Das Konto nutzt wieder den kostenlosen Tarif.`,
      rows: [["Abgebucht", "Nichts"], ["Beendet am", v.ended]],
      key: ["Jetzt", "Kostenloser Tarif"],
      button: b("Tarife ansehen", PLANS),
      h2: "Im kostenlosen Tarif",
      list: ["5 Prompt-Prüfungen pro Tag im Web und in der Windows-App sowie 3 Prüfungen öffentlicher Repositorys pro Tag im Web.",
        "Kostenlose Prüfungen in der Chrome-Erweiterung laufen weiter auf Ihrem Gerät, ohne Tageslimit.",
        `Ihr Konto und Ihre geschützten Begriffe bleiben, wie sie sind. Um zu ${v.tier} zurückzukehren, wählen Sie einen Tarif unter Tarife & Preise: Die Testphase gibt es einmal pro Person, der Tarif beginnt also sofort.`],
      moment: ["Abgebucht", "Nichts", `Die Testphase endete am ${v.endedShort}.`],
      footer: "Sie erhalten diese E-Mail, weil Ihre Testphase für Redaxa ohne Zahlung beendet wurde.",
      help: ["Nicht gekündigt, oder das Datum stimmt nicht?", "Antworten Sie mit dem Datum dieser E-Mail, dann prüfen wir es mit Ihnen."], reply: true,
    }),
    trial_rejected: (v) => ({
      subject: "Ihre Testphase für Redaxa konnte nicht starten",
      preheader: "Mit dieser E-Mail-Adresse oder Karte wurde bereits eine kostenlose Testphase genutzt. Es wurde nichts abgebucht.",
      kicker: "Testphase nicht verfügbar",
      h1: "Ihre Testphase konnte nicht starten",
      intro: "Mit dieser E-Mail-Adresse oder dieser Karte wurde bereits eine kostenlose Testphase für Redaxa genutzt, daher wurde die neue Testphase sofort beendet. Es wurde nichts abgebucht, und es wird nichts abgebucht.",
      rows: [["Abgebucht", "Nichts"], ["Abonnement", "Beendet"]],
      button: b("Tarife ansehen", PLANS),
      after: `Um ${v.tier} zu nutzen, wählen Sie unter Tarife & Preise „Jetzt abonnieren“: Der Tarif beginnt sofort zum dort angezeigten Preis.`,
      footer: "Sie erhalten diese E-Mail, weil mit dieser Adresse eine Testphase für Redaxa gestartet wurde. Pro Person gibt es eine kostenlose Testphase.",
      help: ["Halten Sie das für einen Fehler?", "Antworten Sie auf diese E-Mail von der Adresse des Kontos."], reply: true,
    }),
  },
};

export const TRIAL_WORDS: Record<Language, Words> = { en: EN, it: IT, es: ES, fr: FR, de: DE };

const greet = (lead: string, firstName: string | null | undefined): string => {
  const name = firstName?.trim();
  return name ? `${lead}, ${name}.` : `${lead}.`;
};

export function money(value: Money | null | undefined, locale: string): string | null {
  if (!value || !Number.isFinite(value.amount) || !value.currency) return null;
  const zero = ["jpy", "krw", "vnd", "clp"].includes(value.currency.toLowerCase());
  try {
    return new Intl.NumberFormat(locale === "en-GB" ? "en-IE" : locale, { style: "currency", currency: value.currency.toUpperCase(), minimumFractionDigits: zero ? 0 : 2 })
      .format(zero ? value.amount : value.amount / 100).replace(/ | /g, " ");
  } catch {
    return `${(value.amount / 100).toFixed(2)} ${value.currency.toUpperCase()}`;
  }
}

/** "17 October 2026 at 14:05 UTC": the moment named with its zone, so it cannot be misread. */
export function longDate(seconds: number, locale: string): string {
  return `${new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(seconds * 1000))} UTC`;
}
export function dayDate(seconds: number, locale: string, withYear = false): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(seconds * 1000));
}

/** Renders one trial email as HTML and plain text. */
export function trialMail(kind: TrialMailKind, input: TrialMailInput): { subject: string; html: string; text: string } {
  const w = TRIAL_WORDS[input.lang] ?? EN;
  const business = input.plan === "business";
  const tier = business ? "Business" : "Pro";
  const cadence = input.interval === "yearly" || input.interval === "year" ? w.yearly : input.interval === "monthly" || input.interval === "month" ? w.monthly : null;
  const plan = `${tier}${cadence ? ` — ${cadence}` : ""}${business && input.seats > 1 ? `, ${w.seats.replace("{n}", String(input.seats))}` : ""}`;
  const renewAmount = money(input.renew, w.locale);
  const yearlyRenew = input.renew && (input.interval === "yearly" || input.interval === "year");
  const renew = renewAmount ? `${(yearlyRenew ? w.perYear : w.perMonth).replace("{amount}", renewAmount)}${input.renew?.taxExclusive ? ` ${w.taxExclusive}` : ""}` : null;
  const chargeOnly = money(input.charge, w.locale);
  const v: Record<string, string> = {
    tier, plan, days: String(input.days),
    charge: chargeOnly ?? renewAmount ?? w.planPrice,
    chargeOnly: chargeOnly as string,
    renew: renew as string,
    end: input.trialEnd ? longDate(input.trialEnd, w.locale) : "",
    endShort: input.trialEnd ? dayDate(input.trialEnd, w.locale) : "",
    renewsOn: input.renewsOn ? dayDate(input.renewsOn, w.locale, true) : "",
    renewsShort: input.renewsOn ? dayDate(input.renewsOn, w.locale) : "",
    ended: input.endedOn ? dayDate(input.endedOn, w.locale, true) : "",
    endedShort: input.endedOn ? dayDate(input.endedOn, w.locale) : "",
    reason: input.failure ? w.failures[input.failure] : "",
  };
  const l = w.mail[kind](v, business);
  const blocks: Block[] = [{ kicker: l.kicker }, { h1: greet(l.h1, input.firstName) }, { p: l.intro }];
  const rows = l.rows.filter((row): row is [string, string] => Boolean(row[1]));
  const key = l.key && l.key[1] ? l.key as [string, string] : null;
  if (rows.length || key) blocks.push({ rows: key ? [...rows, key] : rows, total: Boolean(key) });
  blocks.push({ button: { href: l.button[1], label: l.button[0] } });
  if (l.h2 && l.list) blocks.push({ h2: l.h2 }, { list: l.list, numbered: true });
  if (l.after) blocks.push({ p: l.after, muted: true });
  if (l.moment && l.moment[1]) blocks.push({ moment: { kicker: l.moment[0], big: l.moment[1], text: l.moment[2] }, text: `${l.moment[0]}: ${l.moment[1]}. ${l.moment[2]}` });
  return renderEmail({
    subject: l.subject,
    kind: "billing",
    preheader: l.preheader,
    footer: l.footer,
    help: l.help,
    frame: { ...w.frame, write: l.reply ? w.frame.writeOr : w.frame.writeTo },
    blocks,
  });
}

/** Sends one trial email. Never throws: access never depends on a message. */
export async function sendTrialMail(kind: TrialMailKind, input: TrialMailInput, idempotencyKey: string): Promise<boolean> {
  try {
    const mail = trialMail(kind, input);
    return await send(input.to, mail.subject, mail.html, mail.text, idempotencyKey);
  } catch (error) {
    console.error(`redaxa ${kind} mail failed`, String(error).slice(0, 300));
    return false;
  }
}
