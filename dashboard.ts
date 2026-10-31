import type { Finding, FindingSeverity, ScanOptions } from "./scanner.js";
import type { AccountState } from "./auth.js";
import { enableAppShell } from "./pwa.js";
import { track } from "./growth.js";
import { enableDesktopCompanion, openSupportEmail, shellCopyByLanguage, syncTrayLanguage } from "./desktop.js";
import { PROMO_WORDS_EN, euro, mountPromo, promoPriceHtml, type PromoView, type PromoWords } from "./promo.js";
import { TRIAL_BANNER, TRIAL_UI, chargeDate, choiceCopy, fillTrial, keepArrow, loadPrices, longDay, planView, priceFor, type PriceList, type Tier } from "./trial.js";

type HistoryEntry = { id: string; createdAt: string; findings: number; preview: string; byKind: Record<string, number> };
type Language = "en" | "it" | "es" | "fr" | "de";
import { maxPromptLength } from "./prompt-limit.js";
import { themes, restoreTheme, applyTheme, chosenTheme, type ThemeName } from "./themes.js";
type Preferences = ScanOptions & { language: Language; theme: ThemeName; themeChosen: boolean; scanMode: "standard" | "strict"; saveHistory: boolean; autoClearAfterCopy: boolean; showRawValues: boolean; customTerms: string[] };
type RiskLevel = "none" | "medium" | "high";

const storageKey = "redaxa.personal-history.v1";
const preferencesKey = "redaxa.personal-preferences.v1";

const defaultPreferences: Preferences = { language: "en", theme: "paper", themeChosen: false, scanMode: "standard", includePersonalData: true, includeCredentials: true, includeFinancialData: true, saveHistory: true, autoClearAfterCopy: false, showRawValues: true, customTerms: [] };

const languageNames: Record<Language, string> = { en: "English", it: "Italiano", es: "Español", fr: "Français", de: "Deutsch" };
// Halloween offer copy. Units and renewal lines are spelled out per language
// rather than assembled, so every sentence reads as written.
const promoWordsByLanguage: Record<Language, PromoWords> = {
  en: PROMO_WORDS_EN,
  it: {
    kicker: "Offerta di Halloween",
    lead: "Almeno il {percent} di sconto sul primo mese o sul primo anno.",
    ends: "Termina il {date}.",
    endsIn: "Termina tra",
    units: ["Giorni", "Ore", "Minuti", "Secondi"],
    fine: "I prezzi barrati sono i più bassi dei 30 giorni prima dell’offerta. Solo per nuovi abbonamenti; i rinnovi sono al prezzo normale e i nuovi abbonati idonei iniziano comunque con la prova gratuita di 3 giorni. Prezzi IVA esclusa.",
    thenMonth: "Primo mese, poi {price} al mese",
    thenYear: "Primo anno, poi {price} all’anno",
    thenUserMonth: "Primo mese, poi {price} per utente al mese",
    thenUserYear: "Primo anno, poi {price} per utente all’anno",
    perMonth: "/ mese", perYear: "/ anno", perUserMonth: "/ utente / mese", perUserYear: "/ utente / anno",
  },
  es: {
    kicker: "Oferta de Halloween",
    lead: "Al menos un {percent} de descuento en el primer mes o el primer año.",
    ends: "Termina el {date}.",
    endsIn: "Termina en",
    units: ["Días", "Horas", "Minutos", "Segundos"],
    fine: "Los precios tachados son los más bajos de los 30 días previos a la oferta. Solo para nuevas suscripciones; las renovaciones se cobran al precio habitual y los nuevos suscriptores que cumplan los requisitos siguen empezando con la prueba gratuita de 3 días. Precios sin IVA.",
    thenMonth: "Primer mes, luego {price} al mes",
    thenYear: "Primer año, luego {price} al año",
    thenUserMonth: "Primer mes, luego {price} por usuario al mes",
    thenUserYear: "Primer año, luego {price} por usuario al año",
    perMonth: "/ mes", perYear: "/ año", perUserMonth: "/ usuario / mes", perUserYear: "/ usuario / año",
  },
  fr: {
    kicker: "Offre d’Halloween",
    lead: "Au moins {percent} de réduction sur le premier mois ou la première année.",
    ends: "Se termine le {date}.",
    endsIn: "Se termine dans",
    units: ["Jours", "Heures", "Minutes", "Secondes"],
    fine: "Les prix barrés sont nos plus bas des 30 jours précédant l’offre. Nouveaux abonnements uniquement ; les renouvellements se font au prix normal et les nouveaux abonnés éligibles commencent toujours par l’essai gratuit de 3 jours. Prix hors TVA.",
    thenMonth: "Premier mois, puis {price} par mois",
    thenYear: "Première année, puis {price} par an",
    thenUserMonth: "Premier mois, puis {price} par mois et par utilisateur",
    thenUserYear: "Première année, puis {price} par an et par utilisateur",
    perMonth: "/ mois", perYear: "/ an", perUserMonth: "/ utilisateur / mois", perUserYear: "/ utilisateur / an",
  },
  de: {
    kicker: "Halloween-Angebot",
    lead: "Mindestens {percent} Rabatt auf den ersten Monat oder das erste Jahr.",
    ends: "Endet am {date}.",
    endsIn: "Endet in",
    units: ["Tage", "Stunden", "Minuten", "Sekunden"],
    fine: "Durchgestrichene Preise sind unsere niedrigsten der 30 Tage vor dem Angebot. Nur für neue Abonnements; Verlängerungen erfolgen zum regulären Preis, und berechtigte neue Abonnenten starten weiterhin mit der kostenlosen 3-Tage-Testphase. Preise ohne MwSt.",
    thenMonth: "Erster Monat, danach {price} pro Monat",
    thenYear: "Erstes Jahr, danach {price} pro Jahr",
    thenUserMonth: "Erster Monat, danach {price} pro Nutzer und Monat",
    thenUserYear: "Erstes Jahr, danach {price} pro Nutzer und Jahr",
    perMonth: "/ Monat", perYear: "/ Jahr", perUserMonth: "/ Nutzer / Monat", perUserYear: "/ Nutzer / Jahr",
  },
};

const copyByLanguage: Record<Language, Record<string, string>> = {
  en: {
    textMode: "Prompt check", textModeNote: "Remove private details before you send", repoMode: "GitHub repository", repoModeNote: "Exposed keys and vulnerable dependencies · free", stepInput: "Add your text", stepReview: "Review what was found", stepCopy: "Copy the safer version", previewHeadline: "See what stays private.", previewExplain: "An example of what you could share after the check.", compareAction: "Show safer version", sampleLead: "Start with a sample",
    workspace: "Workspace", privateCheck: "Check a prompt", recent: "Recent checks", account: "Account", plans: "Plans & pricing", preferences: "Preferences",
    eyebrow: "Personal workspace", title: "Review before you share.", subtitle: "Find sensitive details in a prompt, or exposed keys and vulnerable dependencies in a GitHub repository.",
    scan: "Check prompt →", clear: "Clear", history: "Recent checks", clearHistory: "Clear history",
    placeholder: "Paste the text you want to check…",
    composerTitle: "What are you about to share?", composerSub: "Paste your message, email or code. Nothing is sent to an AI provider.", promptLabel: "Prompt to check",
    tryLabel: "Try an example", sampleBrief: "Client brief", sampleApiKey: "API key", sampleEmail: "Email draft", samplePersonal: "Personal details",
    metaLabel: "Private check — your text is never stored or logged.", howPrivacyWorks: "How privacy works", interfaceLanguage: "Interface language",
    scanModeStandard: "Standard — balanced", scanModeStrict: "Strict — flags likely matches too",
    resultsTitle: "Results", previewItems: "3 sensitive items in this prompt",
    redactBeforeSharing: "Redact before sharing", previewFoot: "Paste your own text to run a real check.", detectsLabel: "Also detects",
    riskHigh: "High risk", riskMedium: "Review before sharing", riskNone: "No risks found",
    actionHigh: "{n} sensitive item found. Replace it, or copy the redacted version below.|{n} sensitive items found. Replace them, or copy the redacted version below.",
    actionMedium: "{n} item to review before sharing this prompt.|{n} items to review before sharing this prompt.",
    actionNone: "Nothing obvious found. This is a helpful signal, not a guarantee.",
    checking: "Checking…", promptTooLong: "Prompt is too long", keepUnder: "Keep it under {max} characters for a check.",
    checkFailed: "Check failed", couldNotRunCheck: "We could not run that check. Please try again.",
    sensitiveValueHidden: "Value hidden", saferVersion: "Safer version", copySafer: "Copy safer version", copied: "Copied",
    readyToInspect: "Ready to check", willCheckFor: "Results appear here: personal data, credentials and financial details.",
    noChecksYet: "No checks yet", lastEightWillAppear: "Summaries of your last eight checks appear here. They stay in this browser.", nothingFlagged: "Nothing flagged in this check.",
    itemsReviewed: "{n} item reviewed|{n} items reviewed",
    createAccountTrial: "Create an account to choose a plan and keep checking.", startTrialToInspect: "Today's 5 free checks are used up. Choose a plan to keep going; eligible new subscribers start with a 3-day free trial.",
    usageLabel: "Checks this week", freeTrialBadge: "Go further with Pro", freeTrialDesc: "Prompt checks, protected terms, and local repository reviews on Windows.", seePlans: "Compare plans →",
    zeroRetentionDesc: "Prompts are checked, never stored or logged.", createAccountBtn: "Create account", protectionActive: "Review before sharing",
    onboardCheckTitle: "Run your first check", onboardCheckDesc: "Paste a prompt and check it once.",
    onboardTermsTitle: "Add a custom term", onboardTermsDesc: "Protect a client or project name in Preferences.",
    onboardThemeTitle: "Pick a theme", onboardThemeDesc: "Make the workspace yours in Preferences.",
    activityTitle: "Your activity", activityEmpty: "Your privacy activity will appear here after your first check.", last7: "Last 7 days", byType: "By detection type",
    metricChecked: "Prompts checked", metricItems: "Sensitive items found", metricTop: "Most common detection", metricLast: "Last check",
    plansTitle: "Plans & pricing", plansIntro: "3-day free trial for eligible new subscribers. Card required; cancel before the trial ends to avoid a charge. Pro is the new name for Personal, at the same price.",
    personalTag: "Your everyday privacy toolkit", personalName: "Pro", personalDesc: "Review sensitive data in your prompts and repositories, with clear findings and practical next steps.",
    startTrial: "Continue to checkout", yearlyPersonal: "€79.90 yearly",
    businessTag: "For teams · up to 3 users", businessName: "Business", businessDesc: "Everything in Pro, plus shared protected terms, category policies and metadata-only activity for your team.",
    seatsLabel: "Seats", seat1: "1 user", seat2: "2 users", seat3: "3 users", yearlyBusiness: "€149.90 yearly / user",
    manageTag: "Already subscribed?", manageTitle: "Manage billing", manageDesc: "Update your payment method, download invoices, or cancel renewal whenever you need to.", manageBtn: "Manage subscription",
    teamTitle: "Team", teamSeatsUsed: "{used} of {total} seats used.", inviteCreate: "Create invite link", copyLink: "Copy link", noInvites: "No invites yet.", teammateJoined: "Teammate joined", invitePending: "Invite pending", revoke: "Revoke", removeTeammate: "Remove", couldNotRemoveTeammate: "We could not remove this teammate or invite.", couldNotCreateInvite: "We could not create an invite.",
    orgTitle: "Organization", orgIntro: "Shared protection for your whole workspace. Protected terms apply to every member's checks, on every device.", orgMembersLabel: "Members", orgTermsLabel: "Protected terms", orgTermsHint: "Project codenames, client names — flagged in every member's prompts.", orgTermAdd: "Add", orgTermPlaceholder: "e.g. Project Falcon", orgRoleOwner: "Owner", orgRoleAdmin: "Admin", orgRoleMember: "Member", orgYou: "you", orgRenameSave: "Save name", orgNoTerms: "No protected terms yet.", orgRemove: "Remove", orgLeave: "Leave workspace", orgLeaveConfirm: "Leave this workspace? Its protected terms and policies will stop applying to your checks, and the owner will need to invite you again to rejoin.", orgLeaveFailed: "We could not remove you from this workspace.", acctActivity: "Across your account — all devices", orgActivity: "Organization activity", orgChecks: "Team checks", orgFlagged: "Flagged", orgBlocked: "Blocked", orgTopCat: "Top category", orgByMember: "By member", orgExport: "Export CSV (metadata only)", auditFrom: "From", auditTo: "To", auditRange: "Range", auditShowing: "Showing the most recent {shown} of {total} in this range. The export covers the whole range.", auditComplete: "{total} event(s) in this range.", orgPoliciesLabel: "Policies", orgPoliciesHint: "What happens when a category is found in a member's prompt. Block prevents sending from the extension until fixed.", polDefault: "Default", polWarn: "Warn", polRedact: "Redact", polBlock: "Block", catPersonal: "Personal data", catCredentials: "Credentials", catFinancial: "Financial data", catCustom: "Protected terms", sevAny: "any severity",
    previewBadge: "Preview", previewLabel: "example result — not your prompt", planNone: "Free checks", planNoneNote: "5 checks a day, no card needed. Pro removes the limit; eligible new subscribers start with a 3-day free trial.", planTrial: "Free trial", planTrialNote: "Unlimited checks during the trial. Choose a plan to keep them after it ends.", planActive: "Active plan", planActiveNote: "Unlimited checks and your protected terms are on.", planDayOf: "Day {day} of {total}", planEndsToday: "Ends today", planDaysLeft: "{n} day left|{n} days left", foundInPrompt: "Found in your prompt"
  },
  it: {
    textMode: "Controllo prompt", textModeNote: "Rimuovi i dati privati prima di inviare", repoMode: "Repository GitHub", repoModeNote: "Chiavi esposte e dipendenze vulnerabili · gratis", stepInput: "Aggiungi il testo", stepReview: "Rivedi i risultati", stepCopy: "Copia la versione più sicura", previewHeadline: "Scopri cosa resta privato.", previewExplain: "Un esempio di ciò che potresti condividere dopo il controllo.", compareAction: "Mostra la versione più sicura", sampleLead: "Parti da un esempio",
    workspace: "Spazio di lavoro", privateCheck: "Controlla un prompt", recent: "Controlli recenti", account: "Account", plans: "Piani e prezzi", preferences: "Preferenze",
    eyebrow: "Spazio di lavoro personale", title: "Controlla prima di condividere.", subtitle: "Trova dati sensibili in un prompt, oppure chiavi esposte e dipendenze vulnerabili in un repository GitHub.",
    scan: "Controlla il prompt →", clear: "Cancella", history: "Controlli recenti", clearHistory: "Cancella cronologia",
    placeholder: "Incolla il testo da controllare…",
    composerTitle: "Che cosa stai per condividere?", composerSub: "Incolla il tuo messaggio, la tua email o il tuo codice. Non viene inviato nulla a un fornitore di AI.", promptLabel: "Prompt da controllare",
    tryLabel: "Prova un esempio", sampleBrief: "Brief del cliente", sampleApiKey: "Chiave API", sampleEmail: "Bozza di email", samplePersonal: "Dati personali",
    metaLabel: "Controllo privato — il tuo testo non viene mai salvato né registrato.", howPrivacyWorks: "Come funziona la privacy", interfaceLanguage: "Lingua dell’interfaccia",
    scanModeStandard: "Standard — equilibrata", scanModeStrict: "Rigorosa — segnala anche le corrispondenze probabili",
    resultsTitle: "Risultati", previewItems: "3 elementi sensibili in questo prompt",
    redactBeforeSharing: "Oscura prima di condividere", previewFoot: "Incolla il tuo testo per eseguire un controllo reale.", detectsLabel: "Rileva anche",
    riskHigh: "Rischio alto", riskMedium: "Da rivedere prima di condividere", riskNone: "Nessun rischio trovato",
    actionHigh: "{n} elemento sensibile trovato. Sostituiscilo oppure copia qui sotto la versione oscurata.|{n} elementi sensibili trovati. Sostituiscili oppure copia qui sotto la versione oscurata.",
    actionMedium: "{n} elemento da rivedere prima di condividere questo prompt.|{n} elementi da rivedere prima di condividere questo prompt.",
    actionNone: "Non è stato trovato nulla di evidente. È un segnale utile, non una garanzia.",
    checking: "Controllo in corso…", promptTooLong: "Il prompt è troppo lungo", keepUnder: "Per il controllo, resta sotto i {max} caratteri.",
    checkFailed: "Controllo non riuscito", couldNotRunCheck: "Non è stato possibile eseguire il controllo. Riprova.",
    sensitiveValueHidden: "Valore nascosto", saferVersion: "Versione più sicura", copySafer: "Copia la versione più sicura", copied: "Copiato",
    readyToInspect: "Pronto per il controllo", willCheckFor: "I risultati compaiono qui: dati personali, credenziali e dati finanziari.",
    noChecksYet: "Ancora nessun controllo", lastEightWillAppear: "Qui compaiono i riepiloghi degli ultimi otto controlli. Restano in questo browser.", nothingFlagged: "Nessuna segnalazione in questo controllo.",
    itemsReviewed: "{n} elemento esaminato|{n} elementi esaminati",
    createAccountTrial: "Crea un account per scegliere un piano e continuare a controllare.", startTrialToInspect: "I 5 controlli gratuiti di oggi sono esauriti. Scegli un piano per continuare; i nuovi abbonati idonei iniziano con una prova gratuita di 3 giorni.",
    usageLabel: "Controlli questa settimana", freeTrialBadge: "Vai oltre con Pro", freeTrialDesc: "Controlli dei prompt, termini protetti e revisioni locali dei repository su Windows.", seePlans: "Confronta i piani →",
    zeroRetentionDesc: "I prompt vengono controllati, mai salvati né registrati.", createAccountBtn: "Crea account", protectionActive: "Rivedi prima di condividere",
    onboardCheckTitle: "Esegui il primo controllo", onboardCheckDesc: "Incolla un prompt e controllalo una volta.",
    onboardTermsTitle: "Aggiungi un termine personalizzato", onboardTermsDesc: "Proteggi il nome di un cliente o di un progetto nelle Preferenze.",
    onboardThemeTitle: "Scegli un tema", onboardThemeDesc: "Personalizza lo spazio di lavoro nelle Preferenze.",
    activityTitle: "La tua attività", activityEmpty: "La tua attività sulla privacy comparirà qui dopo il primo controllo.", last7: "Ultimi 7 giorni", byType: "Per tipo di rilevamento",
    metricChecked: "Prompt controllati", metricItems: "Elementi sensibili trovati", metricTop: "Rilevamento più frequente", metricLast: "Ultimo controllo",
    plansTitle: "Piani e prezzi", plansIntro: "Prova gratuita di 3 giorni per i nuovi abbonati idonei. Carta richiesta; disdici prima della fine della prova per evitare l’addebito. Pro è il nuovo nome di Personal, allo stesso prezzo.",
    personalTag: "Il tuo kit quotidiano per la privacy", personalName: "Pro", personalDesc: "Rivedi i dati sensibili nei tuoi prompt e nei tuoi repository, con risultati chiari e prossimi passi concreti.",
    startTrial: "Continua al pagamento", yearlyPersonal: "€79,90 all’anno",
    businessTag: "Per i team · fino a 3 utenti", businessName: "Business", businessDesc: "Tutto ciò che è in Pro, più termini protetti condivisi, policy per categoria e attività solo con metadati per il tuo team.",
    seatsLabel: "Posti", seat1: "1 utente", seat2: "2 utenti", seat3: "3 utenti", yearlyBusiness: "€149,90 all’anno / utente",
    manageTag: "Sei già abbonato?", manageTitle: "Gestisci la fatturazione", manageDesc: "Aggiorna il metodo di pagamento, scarica le fatture o disdici il rinnovo quando vuoi.", manageBtn: "Gestisci abbonamento",
    teamTitle: "Team", teamSeatsUsed: "{used} posti su {total} utilizzati.", inviteCreate: "Crea link di invito", copyLink: "Copia link", noInvites: "Ancora nessun invito.", teammateJoined: "Collega entrato", invitePending: "Invito in sospeso", revoke: "Revoca", removeTeammate: "Rimuovi", couldNotRemoveTeammate: "Non è stato possibile rimuovere questo collega o il suo invito.", couldNotCreateInvite: "Non è stato possibile creare un invito.",
    orgTitle: "Organizzazione", orgIntro: "Protezione condivisa per l’intero spazio di lavoro. I termini protetti valgono per i controlli di ogni membro, su ogni dispositivo.", orgMembersLabel: "Membri", orgTermsLabel: "Termini protetti", orgTermsHint: "Nomi in codice dei progetti, nomi dei clienti: vengono segnalati nei prompt di ogni membro.", orgTermAdd: "Aggiungi", orgTermPlaceholder: "es. Progetto Falco", orgRoleOwner: "Proprietario", orgRoleAdmin: "Amministratore", orgRoleMember: "Membro", orgYou: "tu", orgRenameSave: "Salva nome", orgNoTerms: "Ancora nessun termine protetto.", orgRemove: "Rimuovi", orgLeave: "Lascia lo spazio di lavoro", orgLeaveConfirm: "Vuoi lasciare questo spazio di lavoro? I suoi termini protetti e le sue policy non si applicheranno più ai tuoi controlli e, per rientrare, il proprietario dovrà invitarti di nuovo.", orgLeaveFailed: "Non è stato possibile farti uscire da questo spazio di lavoro.", acctActivity: "Sul tuo account — tutti i dispositivi", orgActivity: "Attività dell’organizzazione", orgChecks: "Controlli del team", orgFlagged: "Segnalati", orgBlocked: "Bloccati", orgTopCat: "Categoria principale", orgByMember: "Per membro", orgExport: "Esporta CSV (solo metadati)", auditFrom: "Dal", auditTo: "Al", auditRange: "Periodo", auditShowing: "Mostrati i {shown} più recenti su {total} in questo periodo. L’esportazione comprende l’intero periodo.", auditComplete: "Eventi in questo periodo: {total}.", orgPoliciesLabel: "Policy", orgPoliciesHint: "Cosa succede quando in un prompt di un membro viene trovata una categoria. Blocca impedisce l’invio dall’estensione finché il problema non è risolto.", polDefault: "Predefinito", polWarn: "Avvisa", polRedact: "Oscura", polBlock: "Blocca", catPersonal: "Dati personali", catCredentials: "Credenziali", catFinancial: "Dati finanziari", catCustom: "Termini protetti", sevAny: "qualsiasi gravità",
    previewBadge: "Anteprima", previewLabel: "risultato di esempio — non il tuo prompt", planNone: "Controlli gratuiti", planNoneNote: "5 controlli al giorno, senza carta. Con Pro il limite scompare; i nuovi abbonati idonei iniziano con una prova gratuita di 3 giorni.", planTrial: "Prova gratuita", planTrialNote: "Controlli illimitati durante la prova. Scegli un piano per mantenerli dopo la fine.", planActive: "Piano attivo", planActiveNote: "Controlli illimitati e termini protetti attivi.", planDayOf: "Giorno {day} di {total}", planEndsToday: "Termina oggi", planDaysLeft: "{n} giorno rimasto|{n} giorni rimasti", foundInPrompt: "Trovato nel tuo prompt"
  },
  es: {
    textMode: "Revisión de prompts", textModeNote: "Elimina los datos privados antes de enviar", repoMode: "Repositorio de GitHub", repoModeNote: "Claves expuestas y dependencias vulnerables · gratis", stepInput: "Añade tu texto", stepReview: "Revisa lo que se encontró", stepCopy: "Copia la versión más segura", previewHeadline: "Descubre qué se mantiene privado.", previewExplain: "Un ejemplo de lo que podrías compartir después de la revisión.", compareAction: "Mostrar versión más segura", sampleLead: "Empieza con un ejemplo",
    workspace: "Espacio de trabajo", privateCheck: "Revisar un prompt", recent: "Revisiones recientes", account: "Cuenta", plans: "Planes y precios", preferences: "Preferencias",
    eyebrow: "Espacio personal", title: "Revisa antes de compartir.", subtitle: "Encuentra datos sensibles en un prompt, o claves expuestas y dependencias vulnerables en un repositorio de GitHub.",
    scan: "Revisar prompt →", clear: "Borrar", history: "Revisiones recientes", clearHistory: "Borrar historial",
    placeholder: "Pega el texto que quieres revisar…",
    composerTitle: "¿Qué vas a compartir?", composerSub: "Pega tu mensaje, correo o código. No se envía nada a ningún proveedor de IA.", promptLabel: "Prompt que revisar",
    tryLabel: "Prueba un ejemplo", sampleBrief: "Briefing de cliente", sampleApiKey: "Clave API", sampleEmail: "Borrador de correo", samplePersonal: "Datos personales",
    metaLabel: "Revisión privada — tu texto nunca se guarda ni se registra.", howPrivacyWorks: "Cómo funciona la privacidad", interfaceLanguage: "Idioma de la interfaz",
    scanModeStandard: "Estándar — equilibrado", scanModeStrict: "Estricto — marca también posibles coincidencias",
    resultsTitle: "Resultados", previewItems: "3 elementos sensibles en este prompt",
    redactBeforeSharing: "Oculta antes de compartir", previewFoot: "Pega tu propio texto para hacer una revisión real.", detectsLabel: "También detecta",
    riskHigh: "Riesgo alto", riskMedium: "Revisa antes de compartir", riskNone: "No se encontraron riesgos",
    actionHigh: "Se encontró {n} elemento sensible. Sustitúyelo o copia abajo la versión con los datos ocultos.|Se encontraron {n} elementos sensibles. Sustitúyelos o copia abajo la versión con los datos ocultos.",
    actionMedium: "{n} elemento por revisar antes de compartir este prompt.|{n} elementos por revisar antes de compartir este prompt.",
    actionNone: "No se encontró nada evidente. Es una señal útil, no una garantía.",
    checking: "Revisando…", promptTooLong: "El prompt es demasiado largo", keepUnder: "Mantenlo por debajo de {max} caracteres para poder revisarlo.",
    checkFailed: "La revisión ha fallado", couldNotRunCheck: "No hemos podido hacer esa revisión. Inténtalo de nuevo.",
    sensitiveValueHidden: "Valor oculto", saferVersion: "Versión más segura", copySafer: "Copiar versión más segura", copied: "Copiado",
    readyToInspect: "Listo para revisar", willCheckFor: "Los resultados aparecen aquí: datos personales, credenciales y datos financieros.",
    noChecksYet: "Aún no hay revisiones", lastEightWillAppear: "Aquí aparecen los resúmenes de tus últimas ocho revisiones. Se quedan en este navegador.", nothingFlagged: "No se marcó nada en esta revisión.",
    itemsReviewed: "{n} elemento revisado|{n} elementos revisados",
    createAccountTrial: "Crea una cuenta para elegir un plan y seguir revisando.", startTrialToInspect: "Has agotado las 5 revisiones gratuitas de hoy. Elige un plan para seguir; los nuevos suscriptores que cumplan los requisitos empiezan con una prueba gratuita de 3 días.",
    usageLabel: "Revisiones esta semana", freeTrialBadge: "Ve más allá con Pro", freeTrialDesc: "Revisiones de prompts, términos protegidos y revisiones locales de repositorios en Windows.", seePlans: "Comparar planes →",
    zeroRetentionDesc: "Los prompts se revisan, nunca se guardan ni se registran.", createAccountBtn: "Crear cuenta", protectionActive: "Revisa antes de compartir",
    onboardCheckTitle: "Haz tu primera revisión", onboardCheckDesc: "Pega un prompt y revísalo una vez.",
    onboardTermsTitle: "Añade un término personalizado", onboardTermsDesc: "Protege el nombre de un cliente o proyecto en Preferencias.",
    onboardThemeTitle: "Elige un tema", onboardThemeDesc: "Haz tuyo el espacio de trabajo en Preferencias.",
    activityTitle: "Tu actividad", activityEmpty: "Tu actividad de privacidad aparecerá aquí después de tu primera revisión.", last7: "Últimos 7 días", byType: "Por tipo de detección",
    metricChecked: "Prompts revisados", metricItems: "Elementos sensibles encontrados", metricTop: "Detección más frecuente", metricLast: "Última revisión",
    plansTitle: "Planes y precios", plansIntro: "Prueba gratuita de 3 días para los nuevos suscriptores que cumplan los requisitos. Se requiere tarjeta; cancela antes de que termine la prueba para evitar el cargo. Pro es el nuevo nombre de Personal, al mismo precio.",
    personalTag: "Tu kit diario de privacidad", personalName: "Pro", personalDesc: "Revisa los datos sensibles de tus prompts y repositorios, con resultados claros y próximos pasos prácticos.",
    startTrial: "Continuar al pago", yearlyPersonal: "79,90 € al año",
    businessTag: "Para equipos · hasta 3 usuarios", businessName: "Business", businessDesc: "Todo lo de Pro, más términos protegidos compartidos, políticas por categoría y actividad solo con metadatos para tu equipo.",
    seatsLabel: "Puestos", seat1: "1 usuario", seat2: "2 usuarios", seat3: "3 usuarios", yearlyBusiness: "149,90 € al año / usuario",
    manageTag: "¿Ya estás suscrito?", manageTitle: "Gestionar la facturación", manageDesc: "Actualiza tu método de pago, descarga facturas o cancela la renovación cuando lo necesites.", manageBtn: "Gestionar suscripción",
    teamTitle: "Equipo", teamSeatsUsed: "{used} de {total} puestos en uso.", inviteCreate: "Crear enlace de invitación", copyLink: "Copiar enlace", noInvites: "Aún no hay invitaciones.", teammateJoined: "Compañero incorporado", invitePending: "Invitación pendiente", revoke: "Revocar", removeTeammate: "Quitar", couldNotRemoveTeammate: "No hemos podido quitar a este compañero ni su invitación.", couldNotCreateInvite: "No hemos podido crear una invitación.",
    orgTitle: "Organización", orgIntro: "Protección compartida para todo tu espacio de trabajo. Los términos protegidos se aplican a las revisiones de todos los miembros, en cualquier dispositivo.", orgMembersLabel: "Miembros", orgTermsLabel: "Términos protegidos", orgTermsHint: "Nombres en clave de proyectos, nombres de clientes: se marcan en los prompts de todos los miembros.", orgTermAdd: "Añadir", orgTermPlaceholder: "p. ej. Proyecto Halcón", orgRoleOwner: "Propietario", orgRoleAdmin: "Administrador", orgRoleMember: "Miembro", orgYou: "tú", orgRenameSave: "Guardar nombre", orgNoTerms: "Aún no hay términos protegidos.", orgRemove: "Quitar", orgLeave: "Salir del espacio de trabajo", orgLeaveConfirm: "¿Salir de este espacio de trabajo? Sus términos protegidos y políticas dejarán de aplicarse a tus revisiones, y el propietario tendrá que volver a invitarte para que te reincorpores.", orgLeaveFailed: "No hemos podido sacarte de este espacio de trabajo.", acctActivity: "En toda tu cuenta — todos los dispositivos", orgActivity: "Actividad de la organización", orgChecks: "Revisiones del equipo", orgFlagged: "Marcados", orgBlocked: "Bloqueados", orgTopCat: "Categoría principal", orgByMember: "Por miembro", orgExport: "Exportar CSV (solo metadatos)", auditFrom: "Desde", auditTo: "Hasta", auditRange: "Periodo", auditShowing: "Se muestran los {shown} más recientes de {total} en este periodo. La exportación incluye todo el periodo.", auditComplete: "Eventos en este periodo: {total}.", orgPoliciesLabel: "Políticas", orgPoliciesHint: "Qué ocurre cuando se encuentra una categoría en el prompt de un miembro. Bloquear impide enviarlo desde la extensión hasta que se corrija.", polDefault: "Predeterminado", polWarn: "Avisar", polRedact: "Ocultar", polBlock: "Bloquear", catPersonal: "Datos personales", catCredentials: "Credenciales", catFinancial: "Datos financieros", catCustom: "Términos protegidos", sevAny: "cualquier gravedad",
    previewBadge: "Vista previa", previewLabel: "resultado de ejemplo — no es tu prompt", planNone: "Revisiones gratuitas", planNoneNote: "5 revisiones al día, sin tarjeta. Pro quita el límite; los nuevos suscriptores que cumplan los requisitos empiezan con una prueba gratuita de 3 días.", planTrial: "Prueba gratuita", planTrialNote: "Revisiones ilimitadas durante la prueba. Elige un plan para conservarlas cuando termine.", planActive: "Plan activo", planActiveNote: "Revisiones ilimitadas y tus términos protegidos activados.", planDayOf: "Día {day} de {total}", planEndsToday: "Termina hoy", planDaysLeft: "Queda {n} día|Quedan {n} días", foundInPrompt: "Encontrado en tu prompt"
  },
  fr: {
    textMode: "Vérification de prompt", textModeNote: "Retirez les données privées avant l’envoi", repoMode: "Dépôt GitHub", repoModeNote: "Clés exposées et dépendances vulnérables · gratuit", stepInput: "Ajoutez votre texte", stepReview: "Examinez ce qui a été trouvé", stepCopy: "Copiez la version plus sûre", previewHeadline: "Voyez ce qui reste privé.", previewExplain: "Un exemple de ce que vous pourriez partager après la vérification.", compareAction: "Afficher la version plus sûre", sampleLead: "Commencez par un exemple",
    workspace: "Espace de travail", privateCheck: "Vérifier un prompt", recent: "Vérifications récentes", account: "Compte", plans: "Offres et tarifs", preferences: "Préférences",
    eyebrow: "Espace personnel", title: "Vérifiez avant de partager.", subtitle: "Repérez les données sensibles dans un prompt, ou les clés exposées et les dépendances vulnérables dans un dépôt GitHub.",
    scan: "Vérifier le prompt →", clear: "Effacer", history: "Vérifications récentes", clearHistory: "Effacer l’historique",
    placeholder: "Collez le texte à vérifier…",
    composerTitle: "Que vous apprêtez-vous à partager ?", composerSub: "Collez votre message, votre e-mail ou votre code. Rien n’est envoyé à un fournisseur d’IA.", promptLabel: "Prompt à vérifier",
    tryLabel: "Essayer un exemple", sampleBrief: "Brief client", sampleApiKey: "Clé API", sampleEmail: "Brouillon d’e-mail", samplePersonal: "Données personnelles",
    metaLabel: "Vérification privée — votre texte n’est jamais enregistré ni journalisé.", howPrivacyWorks: "Comment fonctionne la confidentialité", interfaceLanguage: "Langue de l’interface",
    scanModeStandard: "Standard — équilibré", scanModeStrict: "Strict — signale aussi les correspondances probables",
    resultsTitle: "Résultats", previewItems: "3 éléments sensibles dans ce prompt",
    redactBeforeSharing: "Masquer avant de partager", previewFoot: "Collez votre propre texte pour lancer une vraie vérification.", detectsLabel: "Détecte aussi",
    riskHigh: "Risque élevé", riskMedium: "À examiner avant de partager", riskNone: "Aucun risque trouvé",
    actionHigh: "{n} élément sensible trouvé. Remplacez-le ou copiez la version masquée ci-dessous.|{n} éléments sensibles trouvés. Remplacez-les ou copiez la version masquée ci-dessous.",
    actionMedium: "{n} élément à examiner avant de partager ce prompt.|{n} éléments à examiner avant de partager ce prompt.",
    actionNone: "Rien d’évident n’a été trouvé. C’est un signal utile, pas une garantie.",
    checking: "Vérification en cours…", promptTooLong: "Le prompt est trop long", keepUnder: "Gardez-le sous {max} caractères pour une vérification.",
    checkFailed: "Échec de la vérification", couldNotRunCheck: "Nous n’avons pas pu effectuer cette vérification. Veuillez réessayer.",
    sensitiveValueHidden: "Valeur masquée", saferVersion: "Version plus sûre", copySafer: "Copier la version plus sûre", copied: "Copié",
    readyToInspect: "Prêt à vérifier", willCheckFor: "Les résultats s’affichent ici : données personnelles, identifiants et données financières.",
    noChecksYet: "Aucune vérification pour l’instant", lastEightWillAppear: "Les résumés de vos huit dernières vérifications apparaissent ici. Ils restent dans ce navigateur.", nothingFlagged: "Rien n’a été signalé dans cette vérification.",
    itemsReviewed: "{n} élément examiné|{n} éléments examinés",
    createAccountTrial: "Créez un compte pour choisir une offre et continuer à vérifier.", startTrialToInspect: "Les 5 vérifications gratuites du jour sont épuisées. Choisissez une offre pour continuer ; les nouveaux abonnés éligibles commencent par un essai gratuit de 3 jours.",
    usageLabel: "Vérifications cette semaine", freeTrialBadge: "Allez plus loin avec Pro", freeTrialDesc: "Vérifications de prompts, termes protégés et analyses locales de dépôts sous Windows.", seePlans: "Comparer les offres →",
    zeroRetentionDesc: "Les prompts sont vérifiés, jamais enregistrés ni journalisés.", createAccountBtn: "Créer un compte", protectionActive: "Examinez avant de partager",
    onboardCheckTitle: "Lancez votre première vérification", onboardCheckDesc: "Collez un prompt et vérifiez-le une fois.",
    onboardTermsTitle: "Ajoutez un terme personnalisé", onboardTermsDesc: "Protégez le nom d’un client ou d’un projet dans les Préférences.",
    onboardThemeTitle: "Choisissez un thème", onboardThemeDesc: "Personnalisez l’espace de travail dans les Préférences.",
    activityTitle: "Votre activité", activityEmpty: "Votre activité de confidentialité apparaîtra ici après votre première vérification.", last7: "7 derniers jours", byType: "Par type de détection",
    metricChecked: "Prompts vérifiés", metricItems: "Éléments sensibles trouvés", metricTop: "Détection la plus fréquente", metricLast: "Dernière vérification",
    plansTitle: "Offres et tarifs", plansIntro: "Essai gratuit de 3 jours pour les nouveaux abonnés éligibles. Carte requise ; annulez avant la fin de l’essai pour éviter tout prélèvement. Pro est le nouveau nom de Personal, au même prix.",
    personalTag: "Votre boîte à outils de confidentialité au quotidien", personalName: "Pro", personalDesc: "Examinez les données sensibles de vos prompts et de vos dépôts, avec des résultats clairs et des étapes suivantes concrètes.",
    startTrial: "Continuer vers le paiement", yearlyPersonal: "79,90 € par an",
    businessTag: "Pour les équipes · jusqu’à 3 utilisateurs", businessName: "Business", businessDesc: "Tout ce qui est dans Pro, plus des termes protégés partagés, des politiques par catégorie et une activité limitée aux métadonnées pour votre équipe.",
    seatsLabel: "Places", seat1: "1 utilisateur", seat2: "2 utilisateurs", seat3: "3 utilisateurs", yearlyBusiness: "149,90 € par an / utilisateur",
    manageTag: "Déjà abonné ?", manageTitle: "Gérer la facturation", manageDesc: "Mettez à jour votre moyen de paiement, téléchargez vos factures ou annulez le renouvellement quand vous le souhaitez.", manageBtn: "Gérer l’abonnement",
    teamTitle: "Équipe", teamSeatsUsed: "{used} places utilisées sur {total}.", inviteCreate: "Créer un lien d’invitation", copyLink: "Copier le lien", noInvites: "Aucune invitation pour l’instant.", teammateJoined: "Coéquipier ayant rejoint l’équipe", invitePending: "Invitation en attente", revoke: "Révoquer", removeTeammate: "Retirer", couldNotRemoveTeammate: "Nous n’avons pas pu retirer ce coéquipier ni son invitation.", couldNotCreateInvite: "Nous n’avons pas pu créer d’invitation.",
    orgTitle: "Organisation", orgIntro: "Protection partagée pour tout votre espace de travail. Les termes protégés s’appliquent aux vérifications de chaque membre, sur tous les appareils.", orgMembersLabel: "Membres", orgTermsLabel: "Termes protégés", orgTermsHint: "Noms de code de projets, noms de clients : signalés dans les prompts de chaque membre.", orgTermAdd: "Ajouter", orgTermPlaceholder: "p. ex. Projet Faucon", orgRoleOwner: "Propriétaire", orgRoleAdmin: "Administrateur", orgRoleMember: "Membre", orgYou: "vous", orgRenameSave: "Enregistrer le nom", orgNoTerms: "Aucun terme protégé pour l’instant.", orgRemove: "Retirer", orgLeave: "Quitter l’espace de travail", orgLeaveConfirm: "Quitter cet espace de travail ? Ses termes protégés et ses politiques ne s’appliqueront plus à vos vérifications, et le propriétaire devra vous inviter à nouveau pour que vous puissiez le rejoindre.", orgLeaveFailed: "Nous n’avons pas pu vous retirer de cet espace de travail.", acctActivity: "Sur l’ensemble de votre compte — tous les appareils", orgActivity: "Activité de l’organisation", orgChecks: "Vérifications de l’équipe", orgFlagged: "Signalés", orgBlocked: "Bloqués", orgTopCat: "Catégorie principale", orgByMember: "Par membre", orgExport: "Exporter en CSV (métadonnées uniquement)", auditFrom: "Du", auditTo: "Au", auditRange: "Période", auditShowing: "Affichage des {shown} plus récents sur {total} dans cette période. L’export couvre toute la période.", auditComplete: "Événements dans cette période : {total}.", orgPoliciesLabel: "Politiques", orgPoliciesHint: "Ce qui se passe lorsqu’une catégorie est trouvée dans le prompt d’un membre. Bloquer empêche l’envoi depuis l’extension tant que le problème n’est pas corrigé.", polDefault: "Par défaut", polWarn: "Avertir", polRedact: "Masquer", polBlock: "Bloquer", catPersonal: "Données personnelles", catCredentials: "Identifiants", catFinancial: "Données financières", catCustom: "Termes protégés", sevAny: "toute gravité",
    previewBadge: "Aperçu", previewLabel: "exemple de résultat — pas votre prompt", planNone: "Vérifications gratuites", planNoneNote: "5 vérifications par jour, sans carte. Pro supprime la limite ; les nouveaux abonnés éligibles commencent par un essai gratuit de 3 jours.", planTrial: "Essai gratuit", planTrialNote: "Vérifications illimitées pendant l’essai. Choisissez une offre pour les conserver ensuite.", planActive: "Offre active", planActiveNote: "Vérifications illimitées et vos termes protégés activés.", planDayOf: "Jour {day} sur {total}", planEndsToday: "Se termine aujourd’hui", planDaysLeft: "{n} jour restant|{n} jours restants", foundInPrompt: "Trouvé dans votre prompt"
  },
  de: {
    textMode: "Prompt-Prüfung", textModeNote: "Private Angaben vor dem Senden entfernen", repoMode: "GitHub-Repository", repoModeNote: "Offengelegte Schlüssel und anfällige Abhängigkeiten · kostenlos", stepInput: "Text hinzufügen", stepReview: "Ergebnisse prüfen", stepCopy: "Sicherere Version kopieren", previewHeadline: "Sehen Sie, was privat bleibt.", previewExplain: "Ein Beispiel dafür, was Sie nach der Prüfung teilen könnten.", compareAction: "Sicherere Version anzeigen", sampleLead: "Mit einem Beispiel beginnen",
    workspace: "Arbeitsbereich", privateCheck: "Prompt prüfen", recent: "Letzte Prüfungen", account: "Konto", plans: "Tarife & Preise", preferences: "Einstellungen",
    eyebrow: "Persönlicher Arbeitsbereich", title: "Prüfen, bevor Sie teilen.", subtitle: "Finden Sie sensible Angaben in einem Prompt oder offengelegte Schlüssel und anfällige Abhängigkeiten in einem GitHub-Repository.",
    scan: "Prompt prüfen →", clear: "Leeren", history: "Letzte Prüfungen", clearHistory: "Verlauf löschen",
    placeholder: "Fügen Sie den Text ein, den Sie prüfen möchten …",
    composerTitle: "Was möchten Sie teilen?", composerSub: "Fügen Sie Ihre Nachricht, E-Mail oder Ihren Code ein. Es wird nichts an einen KI-Anbieter gesendet.", promptLabel: "Zu prüfender Prompt",
    tryLabel: "Beispiel ausprobieren", sampleBrief: "Kunden-Briefing", sampleApiKey: "API-Schlüssel", sampleEmail: "E-Mail-Entwurf", samplePersonal: "Persönliche Angaben",
    metaLabel: "Private Prüfung – Ihr Text wird nie gespeichert oder protokolliert.", howPrivacyWorks: "So funktioniert der Datenschutz", interfaceLanguage: "Oberflächensprache",
    scanModeStandard: "Standard – ausgewogen", scanModeStrict: "Streng – meldet auch wahrscheinliche Treffer",
    resultsTitle: "Ergebnisse", previewItems: "3 sensible Elemente in diesem Prompt",
    redactBeforeSharing: "Vor dem Teilen schwärzen", previewFoot: "Fügen Sie Ihren eigenen Text ein, um eine echte Prüfung auszuführen.", detectsLabel: "Erkennt auch",
    riskHigh: "Hohes Risiko", riskMedium: "Vor dem Teilen prüfen", riskNone: "Keine Risiken gefunden",
    actionHigh: "{n} sensibles Element gefunden. Ersetzen Sie es oder kopieren Sie unten die geschwärzte Version.|{n} sensible Elemente gefunden. Ersetzen Sie sie oder kopieren Sie unten die geschwärzte Version.",
    actionMedium: "{n} Element vor dem Teilen dieses Prompts prüfen.|{n} Elemente vor dem Teilen dieses Prompts prüfen.",
    actionNone: "Nichts Auffälliges gefunden. Das ist ein hilfreiches Signal, aber keine Garantie.",
    checking: "Prüfung läuft …", promptTooLong: "Der Prompt ist zu lang", keepUnder: "Halten Sie ihn für eine Prüfung unter {max} Zeichen.",
    checkFailed: "Prüfung fehlgeschlagen", couldNotRunCheck: "Wir konnten diese Prüfung nicht ausführen. Bitte versuchen Sie es erneut.",
    sensitiveValueHidden: "Wert ausgeblendet", saferVersion: "Sicherere Version", copySafer: "Sicherere Version kopieren", copied: "Kopiert",
    readyToInspect: "Bereit zur Prüfung", willCheckFor: "Ergebnisse erscheinen hier: persönliche Daten, Zugangsdaten und Finanzangaben.",
    noChecksYet: "Noch keine Prüfungen", lastEightWillAppear: "Hier erscheinen Zusammenfassungen Ihrer letzten acht Prüfungen. Sie bleiben in diesem Browser.", nothingFlagged: "Bei dieser Prüfung wurde nichts gemeldet.",
    itemsReviewed: "{n} Element geprüft|{n} Elemente geprüft",
    createAccountTrial: "Erstellen Sie ein Konto, um einen Tarif zu wählen und weiter zu prüfen.", startTrialToInspect: "Die 5 kostenlosen Prüfungen von heute sind aufgebraucht. Wählen Sie einen Tarif, um fortzufahren; berechtigte neue Abonnenten starten mit einer kostenlosen 3-Tage-Testphase.",
    usageLabel: "Prüfungen diese Woche", freeTrialBadge: "Mehr erreichen mit Pro", freeTrialDesc: "Prompt-Prüfungen, geschützte Begriffe und lokale Repository-Prüfungen unter Windows.", seePlans: "Tarife vergleichen →",
    zeroRetentionDesc: "Prompts werden geprüft, aber nie gespeichert oder protokolliert.", createAccountBtn: "Konto erstellen", protectionActive: "Vor dem Teilen prüfen",
    onboardCheckTitle: "Führen Sie Ihre erste Prüfung durch", onboardCheckDesc: "Fügen Sie einen Prompt ein und prüfen Sie ihn einmal.",
    onboardTermsTitle: "Eigenen Begriff hinzufügen", onboardTermsDesc: "Schützen Sie den Namen eines Kunden oder Projekts in den Einstellungen.",
    onboardThemeTitle: "Design wählen", onboardThemeDesc: "Gestalten Sie den Arbeitsbereich in den Einstellungen nach Ihrem Geschmack.",
    activityTitle: "Ihre Aktivität", activityEmpty: "Ihre Datenschutzaktivität erscheint hier nach Ihrer ersten Prüfung.", last7: "Letzte 7 Tage", byType: "Nach Erkennungsart",
    metricChecked: "Geprüfte Prompts", metricItems: "Gefundene sensible Elemente", metricTop: "Häufigste Erkennung", metricLast: "Letzte Prüfung",
    plansTitle: "Tarife & Preise", plansIntro: "3 Tage kostenlos testen für berechtigte neue Abonnenten. Karte erforderlich; kündigen Sie vor Ende der Testphase, um eine Abbuchung zu vermeiden. Pro ist der neue Name von Personal, zum selben Preis.",
    personalTag: "Ihr tägliches Datenschutz-Werkzeug", personalName: "Pro", personalDesc: "Prüfen Sie sensible Daten in Ihren Prompts und Repositories – mit klaren Ergebnissen und praktischen nächsten Schritten.",
    startTrial: "Weiter zur Kasse", yearlyPersonal: "79,90 € pro Jahr",
    businessTag: "Für Teams · bis zu 3 Nutzer", businessName: "Business", businessDesc: "Alles aus Pro, plus gemeinsame geschützte Begriffe, Kategorierichtlinien und Aktivität nur mit Metadaten für Ihr Team.",
    seatsLabel: "Plätze", seat1: "1 Nutzer", seat2: "2 Nutzer", seat3: "3 Nutzer", yearlyBusiness: "149,90 € pro Jahr / Nutzer",
    manageTag: "Schon abonniert?", manageTitle: "Abrechnung verwalten", manageDesc: "Aktualisieren Sie Ihre Zahlungsmethode, laden Sie Rechnungen herunter oder kündigen Sie die Verlängerung, wann immer Sie möchten.", manageBtn: "Abonnement verwalten",
    teamTitle: "Team", teamSeatsUsed: "{used} von {total} Plätzen belegt.", inviteCreate: "Einladungslink erstellen", copyLink: "Link kopieren", noInvites: "Noch keine Einladungen.", teammateJoined: "Teammitglied beigetreten", invitePending: "Einladung ausstehend", revoke: "Widerrufen", removeTeammate: "Entfernen", couldNotRemoveTeammate: "Wir konnten dieses Teammitglied oder die Einladung nicht entfernen.", couldNotCreateInvite: "Wir konnten keine Einladung erstellen.",
    orgTitle: "Organisation", orgIntro: "Gemeinsamer Schutz für Ihren gesamten Arbeitsbereich. Geschützte Begriffe gelten für die Prüfungen jedes Mitglieds, auf jedem Gerät.", orgMembersLabel: "Mitglieder", orgTermsLabel: "Geschützte Begriffe", orgTermsHint: "Projekt-Codenamen, Kundennamen – werden in den Prompts jedes Mitglieds gemeldet.", orgTermAdd: "Hinzufügen", orgTermPlaceholder: "z. B. Projekt Falke", orgRoleOwner: "Inhaber", orgRoleAdmin: "Administrator", orgRoleMember: "Mitglied", orgYou: "Sie", orgRenameSave: "Namen speichern", orgNoTerms: "Noch keine geschützten Begriffe.", orgRemove: "Entfernen", orgLeave: "Arbeitsbereich verlassen", orgLeaveConfirm: "Diesen Arbeitsbereich verlassen? Seine geschützten Begriffe und Richtlinien gelten dann nicht mehr für Ihre Prüfungen, und der Inhaber muss Sie erneut einladen, damit Sie wieder beitreten können.", orgLeaveFailed: "Wir konnten Sie nicht aus diesem Arbeitsbereich entfernen.", acctActivity: "In Ihrem gesamten Konto – alle Geräte", orgActivity: "Aktivität der Organisation", orgChecks: "Team-Prüfungen", orgFlagged: "Gemeldet", orgBlocked: "Blockiert", orgTopCat: "Häufigste Kategorie", orgByMember: "Nach Mitglied", orgExport: "CSV exportieren (nur Metadaten)", auditFrom: "Von", auditTo: "Bis", auditRange: "Zeitraum", auditShowing: "Angezeigt werden die neuesten {shown} von {total} in diesem Zeitraum. Der Export umfasst den gesamten Zeitraum.", auditComplete: "Ereignisse in diesem Zeitraum: {total}.", orgPoliciesLabel: "Richtlinien", orgPoliciesHint: "Was passiert, wenn in einem Prompt eines Mitglieds eine Kategorie gefunden wird. Blockieren verhindert das Senden über die Erweiterung, bis das Problem behoben ist.", polDefault: "Standard", polWarn: "Warnen", polRedact: "Schwärzen", polBlock: "Blockieren", catPersonal: "Persönliche Daten", catCredentials: "Zugangsdaten", catFinancial: "Finanzdaten", catCustom: "Geschützte Begriffe", sevAny: "beliebiger Schweregrad",
    previewBadge: "Vorschau", previewLabel: "Beispielergebnis – nicht Ihr Prompt", planNone: "Kostenlose Prüfungen", planNoneNote: "5 Prüfungen pro Tag, ohne Karte. Mit Pro entfällt das Limit; berechtigte neue Abonnenten starten mit einer kostenlosen 3-Tage-Testphase.", planTrial: "Kostenlose Testphase", planTrialNote: "Unbegrenzte Prüfungen während der Testphase. Wählen Sie einen Tarif, um sie danach zu behalten.", planActive: "Aktiver Tarif", planActiveNote: "Unbegrenzte Prüfungen und Ihre geschützten Begriffe sind aktiv.", planDayOf: "Tag {day} von {total}", planEndsToday: "Endet heute", planDaysLeft: "Noch {n} Tag|Noch {n} Tage", foundInPrompt: "In Ihrem Prompt gefunden"
  }
};
// Copy for the workspace shell, its views and the Plans & pricing page.
// Merged into copyByLanguage below, so data-i18n and words() reach it too.
// Benefit lines carry <strong> markup and are only ever set as trusted HTML.
const viewCopyByLanguage: Record<Language, Record<string, string>> = {
  en: {
    ctaPro: "Go Pro", ctaBusiness: "Get Business", freeCurrent: "You’re on the Free plan", includedInPlan: "Included in your plan", clearResults: "Clear results", resultsCleared: "Results cleared. Run a new check when you are ready.", previewPersonal: "Personal data", previewCredential: "Credentials", previewUse: "Try this type of check →",
    onboardTitle: "Get set up", onboardDismiss: "Dismiss checklist", onboardTermsDesc: "Protect a client or project name.", onboardThemeDesc: "Make the workspace yours.",
    activityPageTitle: "Activity", activityPageSub: "What your recent checks found. Local summaries stay on this device; account activity never includes your text.", clearLocalActivity: "Clear local activity",
    termsTitle: "Protected terms", termsSub: "Names Redaxa should always flag, such as clients, projects and codenames.", ownTermsTitle: "Your protected terms", ownTermsHint: "One term per line, up to 30. Every check you run looks for them.", ownTermsPlaceholder: "Acme Client\nProject Falcon", saveTerms: "Save terms", termsSaved: "Saved.", termsCount: "{n} term|{n} terms",
    settingsTitle: "Settings", settingsAppearance: "Appearance and language", settingsDetection: "Detection", settingsDevice: "On this device", themeLabel: "Theme", prefsSaved: "Preferences saved.",
    apiTitle: "Developer API keys", apiHint: "For scripts and pipelines.", apiDocs: "API documentation", apiSignIn: "Sign in to manage API keys.", apiNone: "No API keys yet.", apiCreate: "Create API key", apiCopy: "Copy", apiOnce: "This key is shown once. Store it now — it cannot be recovered.", apiNewKey: "New API key",
    accountTitle: "Account & team", accountSub: "Manage your subscription, members and shared protection.", accountEmpty: "Sign in to manage your workspace. Team controls are available with Business.",
    deleteTitle: "Delete account", deleteDesc: "Removes your Redaxa account for good: settings, protected terms, API keys, activity history and, if you own one, your Business workspace. A running subscription ends at once, including any time already paid for.", deleteOpen: "Delete account…", deleteDialogTitle: "Delete your account?", deleteDialogIntro: "This cannot be undone. Your subscription ends immediately, including any time already paid for, and nothing more is charged. Your settings, protected terms, API keys and activity history are deleted; a Business workspace you own is deleted too, and its members lose access. Stripe keeps your invoices, as tax law requires.", deleteConfirmLabel: "Type {email} to confirm", deleteConfirmBtn: "Delete account permanently", deleteDoneTitle: "Account deleted", deleteCancel: "Cancel", deleteWorking: "Deleting your account…", deleteMismatch: "That is not the address of this account.", deleteDone: "Your account has been deleted. A confirmation is on its way to {email}.", deleteDoneKept: "Your Redaxa account has been deleted. The sign-in stays because Frame Witness uses it. A confirmation is on its way to {email}.", deleteFailed: "We could not delete your account. Please try again.", deleteClose: "Close",
    plansHeadline: "Choose how much Redaxa checks for you.", billingPeriod: "Billing period", billingMonthly: "Monthly", billingYearly: "Yearly · 2 months free",
    recommended: "Recommended", currentPlan: "Current plan", equivYearly: "{price} a month, billed yearly",
    freeName: "Free", freeDesc: "Check what you share, with no account needed.", freeNote: "No card needed", freeCta: "Start checking",
    freeB1: "<strong>5 prompt checks a day</strong> on the web and in the Windows app", freeB2: "<strong>No limit in the Chrome extension:</strong> free checks run on your device", freeB3: "<strong>Public repository checks</strong> on the web, 3 a day", freeB4: "<strong>Grouped findings</strong> and a redacted copy to share",
    proB1: "<strong>Prompt checks with no daily limit</strong> on the web, in Windows and in Chrome", proB2: "<strong>Your protected terms</strong> for client and project names, on every device", proB3: "<strong>Repository checks:</strong> 60 a day on the web, plus reviews in the Windows app with history and a prioritized recap", proB4: "<strong>Redacted text reports</strong> for repository reviews",
    bizB1: "<strong>Everything in Pro</strong>", bizB2: "<strong>Shared protected terms</strong> for every member", bizB3: "<strong>Warn, redact or block</strong> through team policies", bizB4: "<strong>Activity and CSV export</strong> without prompt content",
    statusFree: "You are on the free plan: 5 prompt checks a day on the web and in the Windows app.", statusTrial: "Your free trial is running: {left}.", statusActive: "Your {plan} plan is active.",
    checkoutNote: "Payments are processed by Stripe. Manage subscription opens the billing portal, where you can update your card, download invoices or cancel renewal.",
    compareTitle: "Compare plans", compareFeature: "Feature", included: "Included", notIncluded: "Not included",
    cmpPrompt: "Prompt checks on the web and in the Windows app", cmpExtension: "Checks in the Chrome extension", cmpTerms: "Your protected terms", cmpRepoWeb: "Public repository checks on the web", cmpRepoLocal: "Repository reviews in the Windows app, with history and archives", cmpReports: "Redacted repository reports", cmpPolicies: "Team policies: warn, redact or block", cmpActivity: "Team activity and CSV export, metadata only", cmpSeats: "Users",
    cellFiveDaily: "5 a day", cellNoLimit: "No daily limit", cellExtFree: "No limit, on your device", cellExtPlan: "No limit, on Redaxa's server", cellTermsFree: "Web and Windows app", cellTermsPro: "Web, Windows and Chrome", cellTermsBiz: "Plus shared terms", cellThreeDaily: "3 a day", cellSixtyDaily: "60 a day", cellOneUser: "1", cellSeats: "1–3",
    trustTitle: "What leaves your device", trustExtT: "Free checks in Chrome", trustExt: "Run in your browser. The text you check does not leave your device.", trustServerT: "Checks on the web, in Windows and with a plan", trustServer: "Sent over an encrypted connection, analyzed and discarded. Never stored and never forwarded to an AI provider.", trustMetaT: "Activity record", trustMeta: "Metadata only: time, application, finding categories and counts. Never your text.", trustRepoT: "Repository reviews", trustRepo: "Public repositories only; reviews in the Windows app run locally. Private repositories are not supported.", trustTermsT: "Business workspace", trustTerms: "Protected terms, category policies and the member list are stored on our servers while the workspace exists, so they apply on every member's device. Members can read them; owners and admins change them.", trustLimit: "Detection can miss sensitive information or flag harmless text. Review every result before sharing.", privacyPolicy: "Read the privacy policy",
    faqTitle: "Questions", faqTrialQ: "How does the 3-day trial work?", faqTrialA: "Eligible new subscribers start with a 3-day free trial. A card is required; cancel before the trial ends to avoid a charge.", faqCancelQ: "Can I cancel or change my plan?", faqCancelA: "Yes. Manage subscription opens the billing portal, where you can update your payment method, download invoices or cancel renewal whenever you need to.", faqBizQ: "What does Business add?", faqBizA: "Everything in Pro, plus shared protected terms, category policies and metadata-only activity for your team. Choose one to three users.", faqStoredQ: "Is the text I check stored?", faqStoredA: "No. Checks on the web, in the Windows app and with a plan are analyzed and discarded, and Redaxa keeps metadata only. Free checks in the Chrome extension never leave your device.", faqMissQ: "Will Redaxa find everything?", faqMissA: "No tool can promise that. Detection can miss sensitive information or flag harmless text, so review every result before you share it.",
    sevCritical: "Critical", sevHigh: "High", sevMedium: "Medium", sevLow: "Low", sevCriticalHint: "Could give someone access to an account or system", sevHighHint: "Direct financial exposure or a strong identifier", sevMediumHint: "Personal details with indirect harm", sevLowHint: "Weak identifiers that depend on context"
  },
  it: {
    ctaPro: "Passa a Pro", ctaBusiness: "Scegli Business", freeCurrent: "Stai usando il piano Free", includedInPlan: "Incluso nel tuo piano", clearResults: "Cancella i risultati", resultsCleared: "Risultati cancellati. Esegui un nuovo controllo quando vuoi.", previewPersonal: "Dati personali", previewCredential: "Credenziali", previewUse: "Prova questo tipo di controllo →",
    onboardTitle: "Per iniziare", onboardDismiss: "Chiudi l’elenco", onboardTermsDesc: "Proteggi il nome di un cliente o di un progetto.", onboardThemeDesc: "Personalizza lo spazio di lavoro.",
    activityPageTitle: "Attività", activityPageSub: "Che cosa hanno trovato i tuoi controlli recenti. I riepiloghi locali restano su questo dispositivo; l’attività dell’account non include mai il tuo testo.", clearLocalActivity: "Cancella l’attività locale",
    termsTitle: "Termini protetti", termsSub: "Nomi che Redaxa deve sempre segnalare, come clienti, progetti e nomi in codice.", ownTermsTitle: "I tuoi termini protetti", ownTermsHint: "Un termine per riga, fino a 30. Ogni controllo che esegui li cerca.", ownTermsPlaceholder: "Cliente Acme\nProgetto Falco", saveTerms: "Salva i termini", termsSaved: "Salvato.", termsCount: "{n} termine|{n} termini",
    settingsTitle: "Impostazioni", settingsAppearance: "Aspetto e lingua", settingsDetection: "Rilevamento", settingsDevice: "Su questo dispositivo", themeLabel: "Tema", prefsSaved: "Preferenze salvate.",
    apiTitle: "Chiavi API per sviluppatori", apiHint: "Per script e pipeline.", apiDocs: "Documentazione API", apiSignIn: "Accedi per gestire le chiavi API.", apiNone: "Ancora nessuna chiave API.", apiCreate: "Crea chiave API", apiCopy: "Copia", apiOnce: "Questa chiave viene mostrata una sola volta. Conservala ora: non può essere recuperata.", apiNewKey: "Nuova chiave API",
    accountTitle: "Account e team", accountSub: "Gestisci abbonamento, membri e protezione condivisa.", accountEmpty: "Accedi per gestire il tuo spazio di lavoro. I controlli del team sono disponibili con Business.",
    deleteTitle: "Elimina account", deleteDesc: "Rimuove definitivamente il tuo account Redaxa: impostazioni, termini protetti, chiavi API, cronologia attività e, se ne possiedi uno, lo spazio di lavoro Business. Un abbonamento in corso termina subito, compreso il periodo già pagato.", deleteOpen: "Elimina account…", deleteDialogTitle: "Eliminare il tuo account?", deleteDialogIntro: "L’operazione non si può annullare. L’abbonamento termina subito, compreso il periodo già pagato, e non verrà addebitato altro. Impostazioni, termini protetti, chiavi API e cronologia attività vengono eliminati; anche lo spazio di lavoro Business di cui sei proprietario viene eliminato e i suoi membri perdono l’accesso. Le fatture restano presso Stripe, come richiede la normativa fiscale.", deleteConfirmLabel: "Digita {email} per confermare", deleteConfirmBtn: "Elimina definitivamente l’account", deleteDoneTitle: "Account eliminato", deleteCancel: "Annulla", deleteWorking: "Eliminazione dell’account in corso…", deleteMismatch: "Non è l’indirizzo di questo account.", deleteDone: "Il tuo account è stato eliminato. Ti abbiamo inviato una conferma a {email}.", deleteDoneKept: "Il tuo account Redaxa è stato eliminato. L’accesso resta attivo perché lo usa Frame Witness. Ti abbiamo inviato una conferma a {email}.", deleteFailed: "Non è stato possibile eliminare il tuo account. Riprova.", deleteClose: "Chiudi",
    plansHeadline: "Scegli quanto Redaxa controlla per te.", billingPeriod: "Periodo di fatturazione", billingMonthly: "Mensile", billingYearly: "Annuale · 2 mesi gratis",
    recommended: "Consigliato", currentPlan: "Piano attuale", equivYearly: "{price} al mese, fatturati annualmente",
    freeName: "Free", freeDesc: "Controlla ciò che condividi, senza bisogno di un account.", freeNote: "Nessuna carta richiesta", freeCta: "Inizia a controllare",
    freeB1: "<strong>5 controlli di prompt al giorno</strong> sul web e nell’app per Windows", freeB2: "<strong>Nessun limite nell’estensione per Chrome:</strong> i controlli gratuiti vengono eseguiti sul tuo dispositivo", freeB3: "<strong>Controlli di repository pubblici</strong> sul web, 3 al giorno", freeB4: "<strong>Risultati raggruppati</strong> e una copia oscurata da condividere",
    proB1: "<strong>Controlli di prompt senza limite giornaliero</strong> sul web, in Windows e in Chrome", proB2: "<strong>I tuoi termini protetti</strong> per nomi di clienti e progetti, su ogni dispositivo", proB3: "<strong>Controlli dei repository:</strong> 60 al giorno sul web, più revisioni nell’app per Windows con cronologia e riepilogo prioritizzato", proB4: "<strong>Report di testo oscurati</strong> per le revisioni dei repository",
    bizB1: "<strong>Tutto ciò che è in Pro</strong>", bizB2: "<strong>Termini protetti condivisi</strong> per ogni membro", bizB3: "<strong>Avvisa, oscura o blocca</strong> con le policy del team", bizB4: "<strong>Attività ed esportazione CSV</strong> senza il contenuto dei prompt",
    statusFree: "Stai usando il piano gratuito: 5 controlli di prompt al giorno sul web e nell’app per Windows.", statusTrial: "La tua prova gratuita è in corso: {left}.", statusActive: "Il tuo piano {plan} è attivo.",
    checkoutNote: "I pagamenti sono elaborati da Stripe. Gestisci abbonamento apre il portale di fatturazione, dove puoi aggiornare la carta, scaricare le fatture o disdire il rinnovo.",
    compareTitle: "Confronta i piani", compareFeature: "Funzione", included: "Incluso", notIncluded: "Non incluso",
    cmpPrompt: "Controlli di prompt sul web e nell’app per Windows", cmpExtension: "Controlli nell’estensione per Chrome", cmpTerms: "I tuoi termini protetti", cmpRepoWeb: "Controlli di repository pubblici sul web", cmpRepoLocal: "Revisioni dei repository nell’app per Windows, con cronologia e archivi", cmpReports: "Report dei repository oscurati", cmpPolicies: "Policy del team: avvisa, oscura o blocca", cmpActivity: "Attività del team ed esportazione CSV, solo metadati", cmpSeats: "Utenti",
    cellFiveDaily: "5 al giorno", cellNoLimit: "Nessun limite giornaliero", cellExtFree: "Nessun limite, sul tuo dispositivo", cellExtPlan: "Nessun limite, sul server di Redaxa", cellTermsFree: "Web e app per Windows", cellTermsPro: "Web, Windows e Chrome", cellTermsBiz: "Più termini condivisi", cellThreeDaily: "3 al giorno", cellSixtyDaily: "60 al giorno", cellOneUser: "1", cellSeats: "1–3",
    trustTitle: "Cosa esce dal tuo dispositivo", trustExtT: "Controlli gratuiti in Chrome", trustExt: "Vengono eseguiti nel tuo browser. Il testo che controlli non lascia il tuo dispositivo.", trustServerT: "Controlli sul web, in Windows e con un piano", trustServer: "Inviati su una connessione cifrata, analizzati ed eliminati. Mai conservati e mai inoltrati a un fornitore di AI.", trustMetaT: "Registro attività", trustMeta: "Solo metadati: ora, applicazione, categorie e numero di risultati. Mai il tuo testo.", trustRepoT: "Revisioni dei repository", trustRepo: "Solo repository pubblici; le revisioni nell’app per Windows vengono eseguite in locale. I repository privati non sono supportati.", trustTermsT: "Spazio di lavoro Business", trustTerms: "I termini protetti, le policy per categoria e l’elenco dei membri sono conservati sui nostri server finché lo spazio di lavoro esiste, così si applicano sul dispositivo di ogni membro. I membri possono leggerli; proprietari e amministratori li modificano.", trustLimit: "Il rilevamento può non individuare informazioni sensibili o segnalare testo innocuo. Rivedi ogni risultato prima di condividere.", privacyPolicy: "Leggi l’informativa sulla privacy",
    faqTitle: "Domande", faqTrialQ: "Come funziona la prova di 3 giorni?", faqTrialA: "I nuovi abbonati idonei iniziano con una prova gratuita di 3 giorni. È richiesta una carta; disdici prima della fine della prova per evitare l’addebito.", faqCancelQ: "Posso disdire o cambiare piano?", faqCancelA: "Sì. Gestisci abbonamento apre il portale di fatturazione, dove puoi aggiornare il metodo di pagamento, scaricare le fatture o disdire il rinnovo quando vuoi.", faqBizQ: "Cosa aggiunge Business?", faqBizA: "Tutto ciò che è in Pro, più termini protetti condivisi, policy per categoria e attività solo con metadati per il tuo team. Scegli da uno a tre utenti.", faqStoredQ: "Il testo che controllo viene conservato?", faqStoredA: "No. I controlli sul web, nell’app per Windows e con un piano vengono analizzati ed eliminati, e Redaxa conserva solo metadati. I controlli gratuiti nell’estensione per Chrome non lasciano mai il tuo dispositivo.", faqMissQ: "Redaxa troverà tutto?", faqMissA: "Nessuno strumento può prometterlo. Il rilevamento può non individuare informazioni sensibili o segnalare testo innocuo: rivedi ogni risultato prima di condividerlo.",
    sevCritical: "Critico", sevHigh: "Alto", sevMedium: "Medio", sevLow: "Basso", sevCriticalHint: "Potrebbe dare accesso a un account o a un sistema", sevHighHint: "Esposizione finanziaria diretta o identificatore forte", sevMediumHint: "Dati personali con danno indiretto", sevLowHint: "Identificatori deboli che dipendono dal contesto"
  },
  es: {
    ctaPro: "Pasar a Pro", ctaBusiness: "Elegir Business", freeCurrent: "Estás en el plan Free", includedInPlan: "Incluido en tu plan", clearResults: "Borrar resultados", resultsCleared: "Resultados borrados. Haz una nueva revisión cuando quieras.", previewPersonal: "Datos personales", previewCredential: "Credenciales", previewUse: "Prueba este tipo de revisión →",
    onboardTitle: "Primeros pasos", onboardDismiss: "Cerrar la lista", onboardTermsDesc: "Protege el nombre de un cliente o proyecto.", onboardThemeDesc: "Haz tuyo el espacio de trabajo.",
    activityPageTitle: "Actividad", activityPageSub: "Lo que encontraron tus revisiones recientes. Los resúmenes locales se quedan en este dispositivo; la actividad de la cuenta nunca incluye tu texto.", clearLocalActivity: "Borrar actividad local",
    termsTitle: "Términos protegidos", termsSub: "Nombres que Redaxa debe marcar siempre, como clientes, proyectos y nombres en clave.", ownTermsTitle: "Tus términos protegidos", ownTermsHint: "Un término por línea, hasta 30. Todas las revisiones que hagas los buscan.", ownTermsPlaceholder: "Cliente Acme\nProyecto Halcón", saveTerms: "Guardar términos", termsSaved: "Guardado.", termsCount: "{n} término|{n} términos",
    settingsTitle: "Ajustes", settingsAppearance: "Apariencia e idioma", settingsDetection: "Detección", settingsDevice: "En este dispositivo", themeLabel: "Tema", prefsSaved: "Preferencias guardadas.",
    apiTitle: "Claves API para desarrolladores", apiHint: "Para scripts y pipelines.", apiDocs: "Documentación de la API", apiSignIn: "Inicia sesión para gestionar las claves API.", apiNone: "Aún no hay claves API.", apiCreate: "Crear clave API", apiCopy: "Copiar", apiOnce: "Esta clave se muestra una sola vez. Guárdala ahora: no se puede recuperar.", apiNewKey: "Nueva clave API",
    accountTitle: "Cuenta y equipo", accountSub: "Gestiona tu suscripción, los miembros y la protección compartida.", accountEmpty: "Inicia sesión para gestionar tu espacio de trabajo. Los controles de equipo están disponibles con Business.",
    deleteTitle: "Eliminar cuenta", deleteDesc: "Elimina definitivamente tu cuenta de Redaxa: ajustes, términos protegidos, claves de API, historial de actividad y, si tienes uno, tu espacio de trabajo Business. Una suscripción activa termina al momento, incluido el tiempo ya pagado.", deleteOpen: "Eliminar cuenta…", deleteDialogTitle: "¿Eliminar tu cuenta?", deleteDialogIntro: "No se puede deshacer. Tu suscripción termina de inmediato, incluido el tiempo ya pagado, y no se cobrará nada más. Se eliminan tus ajustes, términos protegidos, claves de API e historial de actividad; si eres propietario de un espacio de trabajo Business, también se elimina y sus miembros pierden el acceso. Stripe conserva tus facturas, como exige la normativa fiscal.", deleteConfirmLabel: "Escribe {email} para confirmar", deleteConfirmBtn: "Eliminar la cuenta definitivamente", deleteDoneTitle: "Cuenta eliminada", deleteCancel: "Cancelar", deleteWorking: "Eliminando tu cuenta…", deleteMismatch: "Esa no es la dirección de esta cuenta.", deleteDone: "Tu cuenta se ha eliminado. Te hemos enviado una confirmación a {email}.", deleteDoneKept: "Tu cuenta de Redaxa se ha eliminado. El acceso se mantiene porque lo usa Frame Witness. Te hemos enviado una confirmación a {email}.", deleteFailed: "No hemos podido eliminar tu cuenta. Inténtalo de nuevo.", deleteClose: "Cerrar",
    plansHeadline: "Elige cuánto revisa Redaxa por ti.", billingPeriod: "Periodo de facturación", billingMonthly: "Mensual", billingYearly: "Anual · 2 meses gratis",
    recommended: "Recomendado", currentPlan: "Plan actual", equivYearly: "{price} al mes, facturado anualmente",
    freeName: "Free", freeDesc: "Revisa lo que compartes, sin necesidad de cuenta.", freeNote: "Sin tarjeta", freeCta: "Empezar a revisar",
    freeB1: "<strong>5 revisiones de prompts al día</strong> en la web y en la app de Windows", freeB2: "<strong>Sin límite en la extensión de Chrome:</strong> las revisiones gratuitas se hacen en tu dispositivo", freeB3: "<strong>Revisiones de repositorios públicos</strong> en la web, 3 al día", freeB4: "<strong>Resultados agrupados</strong> y una copia con los datos ocultos para compartir",
    proB1: "<strong>Revisiones de prompts sin límite diario</strong> en la web, en Windows y en Chrome", proB2: "<strong>Tus términos protegidos</strong> para nombres de clientes y proyectos, en todos tus dispositivos", proB3: "<strong>Revisiones de repositorios:</strong> 60 al día en la web, más revisiones en la app de Windows con historial y un resumen priorizado", proB4: "<strong>Informes de texto con datos ocultos</strong> para las revisiones de repositorios",
    bizB1: "<strong>Todo lo de Pro</strong>", bizB2: "<strong>Términos protegidos compartidos</strong> para todos los miembros", bizB3: "<strong>Avisar, ocultar o bloquear</strong> mediante políticas de equipo", bizB4: "<strong>Actividad y exportación CSV</strong> sin el contenido de los prompts",
    statusFree: "Estás en el plan gratuito: 5 revisiones de prompts al día en la web y en la app de Windows.", statusTrial: "Tu prueba gratuita está en curso: {left}.", statusActive: "Tu plan {plan} está activo.",
    checkoutNote: "Los pagos los procesa Stripe. Gestionar suscripción abre el portal de facturación, donde puedes actualizar tu tarjeta, descargar facturas o cancelar la renovación.",
    compareTitle: "Comparar planes", compareFeature: "Función", included: "Incluido", notIncluded: "No incluido",
    cmpPrompt: "Revisiones de prompts en la web y en la app de Windows", cmpExtension: "Revisiones en la extensión de Chrome", cmpTerms: "Tus términos protegidos", cmpRepoWeb: "Revisiones de repositorios públicos en la web", cmpRepoLocal: "Revisiones de repositorios en la app de Windows, con historial y archivos", cmpReports: "Informes de repositorios con datos ocultos", cmpPolicies: "Políticas de equipo: avisar, ocultar o bloquear", cmpActivity: "Actividad del equipo y exportación CSV, solo metadatos", cmpSeats: "Usuarios",
    cellFiveDaily: "5 al día", cellNoLimit: "Sin límite diario", cellExtFree: "Sin límite, en tu dispositivo", cellExtPlan: "Sin límite, en el servidor de Redaxa", cellTermsFree: "Web y app de Windows", cellTermsPro: "Web, Windows y Chrome", cellTermsBiz: "Más términos compartidos", cellThreeDaily: "3 al día", cellSixtyDaily: "60 al día", cellOneUser: "1", cellSeats: "1–3",
    trustTitle: "Qué sale de tu dispositivo", trustExtT: "Revisiones gratuitas en Chrome", trustExt: "Se ejecutan en tu navegador. El texto que revisas no sale de tu dispositivo.", trustServerT: "Revisiones en la web, en Windows y con un plan", trustServer: "Se envían por una conexión cifrada, se analizan y se descartan. Nunca se guardan ni se reenvían a un proveedor de IA.", trustMetaT: "Registro de actividad", trustMeta: "Solo metadatos: hora, aplicación, categorías de detecciones y recuentos. Nunca tu texto.", trustRepoT: "Revisiones de repositorios", trustRepo: "Solo repositorios públicos; las revisiones en la app de Windows se ejecutan en local. No se admiten repositorios privados.", trustTermsT: "Espacio de trabajo Business", trustTerms: "Los términos protegidos, las políticas por categoría y la lista de miembros se guardan en nuestros servidores mientras exista el espacio de trabajo, para que se apliquen en el dispositivo de cada miembro. Los miembros pueden leerlos; los propietarios y administradores los cambian.", trustLimit: "La detección puede pasar por alto información sensible o marcar texto inofensivo. Revisa cada resultado antes de compartir.", privacyPolicy: "Lee la política de privacidad",
    faqTitle: "Preguntas", faqTrialQ: "¿Cómo funciona la prueba de 3 días?", faqTrialA: "Los nuevos suscriptores que cumplan los requisitos empiezan con una prueba gratuita de 3 días. Se requiere tarjeta; cancela antes de que termine la prueba para evitar el cargo.", faqCancelQ: "¿Puedo cancelar o cambiar de plan?", faqCancelA: "Sí. Gestionar suscripción abre el portal de facturación, donde puedes actualizar tu método de pago, descargar facturas o cancelar la renovación cuando lo necesites.", faqBizQ: "¿Qué añade Business?", faqBizA: "Todo lo de Pro, más términos protegidos compartidos, políticas por categoría y actividad solo con metadatos para tu equipo. Elige de uno a tres usuarios.", faqStoredQ: "¿Se guarda el texto que reviso?", faqStoredA: "No. Las revisiones en la web, en la app de Windows y con un plan se analizan y se descartan, y Redaxa conserva solo metadatos. Las revisiones gratuitas de la extensión de Chrome nunca salen de tu dispositivo.", faqMissQ: "¿Encontrará Redaxa todo?", faqMissA: "Ninguna herramienta puede prometerlo. La detección puede pasar por alto información sensible o marcar texto inofensivo, así que revisa cada resultado antes de compartirlo.",
    sevCritical: "Crítico", sevHigh: "Alto", sevMedium: "Medio", sevLow: "Bajo", sevCriticalHint: "Podría dar acceso a una cuenta o a un sistema", sevHighHint: "Exposición financiera directa o un identificador fuerte", sevMediumHint: "Datos personales con daño indirecto", sevLowHint: "Identificadores débiles que dependen del contexto"
  },
  fr: {
    ctaPro: "Passer à Pro", ctaBusiness: "Choisir Business", freeCurrent: "Vous êtes sur l’offre Free", includedInPlan: "Inclus dans votre offre", clearResults: "Effacer les résultats", resultsCleared: "Résultats effacés. Lancez une nouvelle vérification quand vous le souhaitez.", previewPersonal: "Données personnelles", previewCredential: "Identifiants", previewUse: "Essayer ce type de vérification →",
    onboardTitle: "Pour bien démarrer", onboardDismiss: "Fermer la liste", onboardTermsDesc: "Protégez le nom d’un client ou d’un projet.", onboardThemeDesc: "Personnalisez l’espace de travail.",
    activityPageTitle: "Activité", activityPageSub: "Ce qu’ont trouvé vos dernières vérifications. Les résumés locaux restent sur cet appareil ; l’activité du compte n’inclut jamais votre texte.", clearLocalActivity: "Effacer l’activité locale",
    termsTitle: "Termes protégés", termsSub: "Les noms que Redaxa doit toujours signaler, comme les clients, les projets et les noms de code.", ownTermsTitle: "Vos termes protégés", ownTermsHint: "Un terme par ligne, jusqu’à 30. Chaque vérification que vous lancez les recherche.", ownTermsPlaceholder: "Client Acme\nProjet Faucon", saveTerms: "Enregistrer les termes", termsSaved: "Enregistré.", termsCount: "{n} terme|{n} termes",
    settingsTitle: "Réglages", settingsAppearance: "Apparence et langue", settingsDetection: "Détection", settingsDevice: "Sur cet appareil", themeLabel: "Thème", prefsSaved: "Préférences enregistrées.",
    apiTitle: "Clés API pour développeurs", apiHint: "Pour les scripts et les pipelines.", apiDocs: "Documentation de l’API", apiSignIn: "Connectez-vous pour gérer les clés API.", apiNone: "Aucune clé API pour l’instant.", apiCreate: "Créer une clé API", apiCopy: "Copier", apiOnce: "Cette clé n’est affichée qu’une seule fois. Conservez-la maintenant : elle ne peut pas être récupérée.", apiNewKey: "Nouvelle clé API",
    accountTitle: "Compte et équipe", accountSub: "Gérez votre abonnement, vos membres et la protection partagée.", accountEmpty: "Connectez-vous pour gérer votre espace de travail. Les contrôles d’équipe sont disponibles avec Business.",
    deleteTitle: "Supprimer le compte", deleteDesc: "Supprime définitivement votre compte Redaxa : réglages, termes protégés, clés API, historique d’activité et, si vous en possédez un, votre espace de travail Business. Un abonnement en cours prend fin immédiatement, y compris la période déjà payée.", deleteOpen: "Supprimer le compte…", deleteDialogTitle: "Supprimer votre compte ?", deleteDialogIntro: "Cette action est irréversible. Votre abonnement prend fin immédiatement, y compris la période déjà payée, et plus rien ne sera prélevé. Vos réglages, termes protégés, clés API et historique d’activité sont supprimés ; l’espace de travail Business dont vous êtes propriétaire est également supprimé et ses membres perdent l’accès. Stripe conserve vos factures, comme l’exige la législation fiscale.", deleteConfirmLabel: "Saisissez {email} pour confirmer", deleteConfirmBtn: "Supprimer définitivement le compte", deleteDoneTitle: "Compte supprimé", deleteCancel: "Annuler", deleteWorking: "Suppression de votre compte…", deleteMismatch: "Ce n’est pas l’adresse de ce compte.", deleteDone: "Votre compte a été supprimé. Une confirmation a été envoyée à {email}.", deleteDoneKept: "Votre compte Redaxa a été supprimé. L’identifiant de connexion reste actif, car Frame Witness l’utilise. Une confirmation a été envoyée à {email}.", deleteFailed: "Nous n’avons pas pu supprimer votre compte. Veuillez réessayer.", deleteClose: "Fermer",
    plansHeadline: "Choisissez l’étendue des vérifications de Redaxa.", billingPeriod: "Période de facturation", billingMonthly: "Mensuel", billingYearly: "Annuel · 2 mois offerts",
    recommended: "Recommandé", currentPlan: "Offre actuelle", equivYearly: "{price} par mois, facturé annuellement",
    freeName: "Free", freeDesc: "Vérifiez ce que vous partagez, sans compte.", freeNote: "Aucune carte requise", freeCta: "Commencer à vérifier",
    freeB1: "<strong>5 vérifications de prompts par jour</strong> sur le web et dans l’application Windows", freeB2: "<strong>Aucune limite dans l’extension Chrome :</strong> les vérifications gratuites s’exécutent sur votre appareil", freeB3: "<strong>Vérifications de dépôts publics</strong> sur le web, 3 par jour", freeB4: "<strong>Résultats regroupés</strong> et une copie masquée à partager",
    proB1: "<strong>Vérifications de prompts sans limite quotidienne</strong> sur le web, dans Windows et dans Chrome", proB2: "<strong>Vos termes protégés</strong> pour les noms de clients et de projets, sur tous vos appareils", proB3: "<strong>Vérifications de dépôts :</strong> 60 par jour sur le web, plus des analyses dans l’application Windows avec historique et récapitulatif priorisé", proB4: "<strong>Rapports texte masqués</strong> pour les analyses de dépôts",
    bizB1: "<strong>Tout ce qui est dans Pro</strong>", bizB2: "<strong>Termes protégés partagés</strong> pour chaque membre", bizB3: "<strong>Avertir, masquer ou bloquer</strong> grâce aux politiques d’équipe", bizB4: "<strong>Activité et export CSV</strong> sans le contenu des prompts",
    statusFree: "Vous êtes sur l’offre gratuite : 5 vérifications de prompts par jour sur le web et dans l’application Windows.", statusTrial: "Votre essai gratuit est en cours : {left}.", statusActive: "Votre offre {plan} est active.",
    checkoutNote: "Les paiements sont traités par Stripe. Gérer l’abonnement ouvre le portail de facturation, où vous pouvez mettre à jour votre carte, télécharger vos factures ou annuler le renouvellement.",
    compareTitle: "Comparer les offres", compareFeature: "Fonctionnalité", included: "Inclus", notIncluded: "Non inclus",
    cmpPrompt: "Vérifications de prompts sur le web et dans l’application Windows", cmpExtension: "Vérifications dans l’extension Chrome", cmpTerms: "Vos termes protégés", cmpRepoWeb: "Vérifications de dépôts publics sur le web", cmpRepoLocal: "Analyses de dépôts dans l’application Windows, avec historique et archives", cmpReports: "Rapports de dépôts masqués", cmpPolicies: "Politiques d’équipe : avertir, masquer ou bloquer", cmpActivity: "Activité de l’équipe et export CSV, métadonnées uniquement", cmpSeats: "Utilisateurs",
    cellFiveDaily: "5 par jour", cellNoLimit: "Aucune limite quotidienne", cellExtFree: "Sans limite, sur votre appareil", cellExtPlan: "Sans limite, sur le serveur de Redaxa", cellTermsFree: "Web et application Windows", cellTermsPro: "Web, Windows et Chrome", cellTermsBiz: "Plus des termes partagés", cellThreeDaily: "3 par jour", cellSixtyDaily: "60 par jour", cellOneUser: "1", cellSeats: "1–3",
    trustTitle: "Ce qui quitte votre appareil", trustExtT: "Vérifications gratuites dans Chrome", trustExt: "Elles s’exécutent dans votre navigateur. Le texte que vous vérifiez ne quitte pas votre appareil.", trustServerT: "Vérifications sur le web, dans Windows et avec une offre", trustServer: "Envoyées via une connexion chiffrée, analysées puis supprimées. Jamais conservées et jamais transmises à un fournisseur d’IA.", trustMetaT: "Journal d’activité", trustMeta: "Métadonnées uniquement : heure, application, catégories de détections et nombres. Jamais votre texte.", trustRepoT: "Analyses de dépôts", trustRepo: "Dépôts publics uniquement ; les analyses dans l’application Windows s’exécutent en local. Les dépôts privés ne sont pas pris en charge.", trustTermsT: "Espace de travail Business", trustTerms: "Les termes protégés, les politiques par catégorie et la liste des membres sont stockés sur nos serveurs tant que l’espace de travail existe, afin de s’appliquer sur l’appareil de chaque membre. Les membres peuvent les lire ; les propriétaires et les administrateurs les modifient.", trustLimit: "La détection peut manquer des informations sensibles ou signaler un texte inoffensif. Examinez chaque résultat avant de partager.", privacyPolicy: "Lire la politique de confidentialité",
    faqTitle: "Questions", faqTrialQ: "Comment fonctionne l’essai de 3 jours ?", faqTrialA: "Les nouveaux abonnés éligibles commencent par un essai gratuit de 3 jours. Une carte est requise ; annulez avant la fin de l’essai pour éviter tout prélèvement.", faqCancelQ: "Puis-je annuler ou changer d’offre ?", faqCancelA: "Oui. Gérer l’abonnement ouvre le portail de facturation, où vous pouvez mettre à jour votre moyen de paiement, télécharger vos factures ou annuler le renouvellement quand vous le souhaitez.", faqBizQ: "Qu’apporte Business en plus ?", faqBizA: "Tout ce qui est dans Pro, plus des termes protégés partagés, des politiques par catégorie et une activité limitée aux métadonnées pour votre équipe. Choisissez de un à trois utilisateurs.", faqStoredQ: "Le texte que je vérifie est-il conservé ?", faqStoredA: "Non. Les vérifications sur le web, dans l’application Windows et avec une offre sont analysées puis supprimées, et Redaxa ne conserve que des métadonnées. Les vérifications gratuites de l’extension Chrome ne quittent jamais votre appareil.", faqMissQ: "Redaxa trouvera-t-il tout ?", faqMissA: "Aucun outil ne peut le promettre. La détection peut manquer des informations sensibles ou signaler un texte inoffensif : examinez chaque résultat avant de partager.",
    sevCritical: "Critique", sevHigh: "Élevée", sevMedium: "Moyenne", sevLow: "Faible", sevCriticalHint: "Pourrait donner accès à un compte ou à un système", sevHighHint: "Exposition financière directe ou identifiant fort", sevMediumHint: "Données personnelles pouvant causer un préjudice indirect", sevLowHint: "Identifiants faibles qui dépendent du contexte"
  },
  de: {
    ctaPro: "Zu Pro wechseln", ctaBusiness: "Business wählen", freeCurrent: "Sie nutzen den Free-Tarif", includedInPlan: "In Ihrem Tarif enthalten", clearResults: "Ergebnisse löschen", resultsCleared: "Ergebnisse gelöscht. Starten Sie eine neue Prüfung, wann immer Sie möchten.", previewPersonal: "Persönliche Daten", previewCredential: "Zugangsdaten", previewUse: "Diese Art der Prüfung ausprobieren →",
    onboardTitle: "Erste Schritte", onboardDismiss: "Checkliste schließen", onboardTermsDesc: "Schützen Sie den Namen eines Kunden oder Projekts.", onboardThemeDesc: "Gestalten Sie den Arbeitsbereich nach Ihrem Geschmack.",
    activityPageTitle: "Aktivität", activityPageSub: "Was Ihre letzten Prüfungen gefunden haben. Lokale Zusammenfassungen bleiben auf diesem Gerät; die Kontoaktivität enthält nie Ihren Text.", clearLocalActivity: "Lokale Aktivität löschen",
    termsTitle: "Geschützte Begriffe", termsSub: "Namen, die Redaxa immer melden soll, etwa Kunden, Projekte und Codenamen.", ownTermsTitle: "Ihre geschützten Begriffe", ownTermsHint: "Ein Begriff pro Zeile, bis zu 30. Jede Prüfung, die Sie ausführen, sucht danach.", ownTermsPlaceholder: "Acme-Kunde\nProjekt Falke", saveTerms: "Begriffe speichern", termsSaved: "Gespeichert.", termsCount: "{n} Begriff|{n} Begriffe",
    settingsTitle: "Einstellungen", settingsAppearance: "Darstellung und Sprache", settingsDetection: "Erkennung", settingsDevice: "Auf diesem Gerät", themeLabel: "Design", prefsSaved: "Einstellungen gespeichert.",
    apiTitle: "API-Schlüssel für Entwickler", apiHint: "Für Skripte und Pipelines.", apiDocs: "API-Dokumentation", apiSignIn: "Melden Sie sich an, um API-Schlüssel zu verwalten.", apiNone: "Noch keine API-Schlüssel.", apiCreate: "API-Schlüssel erstellen", apiCopy: "Kopieren", apiOnce: "Dieser Schlüssel wird nur einmal angezeigt. Speichern Sie ihn jetzt – er lässt sich nicht wiederherstellen.", apiNewKey: "Neuer API-Schlüssel",
    accountTitle: "Konto & Team", accountSub: "Verwalten Sie Ihr Abonnement, Ihre Mitglieder und den gemeinsamen Schutz.", accountEmpty: "Melden Sie sich an, um Ihren Arbeitsbereich zu verwalten. Team-Funktionen gibt es mit Business.",
    deleteTitle: "Konto löschen", deleteDesc: "Entfernt Ihr Redaxa-Konto endgültig: Einstellungen, geschützte Begriffe, API-Schlüssel, Aktivitätsverlauf und, falls Sie einen besitzen, Ihren Business-Arbeitsbereich. Ein laufendes Abonnement endet sofort, einschließlich der bereits bezahlten Zeit.", deleteOpen: "Konto löschen…", deleteDialogTitle: "Ihr Konto löschen?", deleteDialogIntro: "Dies lässt sich nicht rückgängig machen. Ihr Abonnement endet sofort, einschließlich der bereits bezahlten Zeit, und es wird nichts mehr abgebucht. Ihre Einstellungen, geschützten Begriffe, API-Schlüssel und Ihr Aktivitätsverlauf werden gelöscht; ein Business-Arbeitsbereich, dessen Inhaber Sie sind, wird ebenfalls gelöscht, und seine Mitglieder verlieren den Zugriff. Stripe bewahrt Ihre Rechnungen auf, wie es das Steuerrecht verlangt.", deleteConfirmLabel: "Geben Sie zur Bestätigung {email} ein", deleteConfirmBtn: "Konto endgültig löschen", deleteDoneTitle: "Konto gelöscht", deleteCancel: "Abbrechen", deleteWorking: "Ihr Konto wird gelöscht…", deleteMismatch: "Das ist nicht die Adresse dieses Kontos.", deleteDone: "Ihr Konto wurde gelöscht. Eine Bestätigung ist an {email} unterwegs.", deleteDoneKept: "Ihr Redaxa-Konto wurde gelöscht. Die Anmeldung bleibt bestehen, weil Frame Witness sie verwendet. Eine Bestätigung ist an {email} unterwegs.", deleteFailed: "Ihr Konto konnte nicht gelöscht werden. Bitte versuchen Sie es erneut.", deleteClose: "Schließen",
    plansHeadline: "Wählen Sie, wie viel Redaxa für Sie prüft.", billingPeriod: "Abrechnungszeitraum", billingMonthly: "Monatlich", billingYearly: "Jährlich · 2 Monate gratis",
    recommended: "Empfohlen", currentPlan: "Aktueller Tarif", equivYearly: "{price} pro Monat, jährlich abgerechnet",
    freeName: "Free", freeDesc: "Prüfen Sie, was Sie teilen – ganz ohne Konto.", freeNote: "Keine Karte nötig", freeCta: "Jetzt prüfen",
    freeB1: "<strong>5 Prompt-Prüfungen pro Tag</strong> im Web und in der Windows-App", freeB2: "<strong>Kein Limit in der Chrome-Erweiterung:</strong> Kostenlose Prüfungen laufen auf Ihrem Gerät", freeB3: "<strong>Prüfungen öffentlicher Repositories</strong> im Web, 3 pro Tag", freeB4: "<strong>Gruppierte Ergebnisse</strong> und eine geschwärzte Kopie zum Teilen",
    proB1: "<strong>Prompt-Prüfungen ohne Tageslimit</strong> im Web, unter Windows und in Chrome", proB2: "<strong>Ihre geschützten Begriffe</strong> für Kunden- und Projektnamen, auf jedem Gerät", proB3: "<strong>Repository-Prüfungen:</strong> 60 pro Tag im Web, dazu Prüfungen in der Windows-App mit Verlauf und priorisierter Zusammenfassung", proB4: "<strong>Geschwärzte Textberichte</strong> für Repository-Prüfungen",
    bizB1: "<strong>Alles aus Pro</strong>", bizB2: "<strong>Gemeinsame geschützte Begriffe</strong> für alle Mitglieder", bizB3: "<strong>Warnen, schwärzen oder blockieren</strong> über Team-Richtlinien", bizB4: "<strong>Aktivität und CSV-Export</strong> ohne Prompt-Inhalte",
    statusFree: "Sie nutzen den kostenlosen Tarif: 5 Prompt-Prüfungen pro Tag im Web und in der Windows-App.", statusTrial: "Ihre kostenlose Testphase läuft: {left}.", statusActive: "Ihr Tarif {plan} ist aktiv.",
    checkoutNote: "Zahlungen werden von Stripe abgewickelt. „Abonnement verwalten“ öffnet das Abrechnungsportal, in dem Sie Ihre Karte aktualisieren, Rechnungen herunterladen oder die Verlängerung kündigen können.",
    compareTitle: "Tarife vergleichen", compareFeature: "Funktion", included: "Enthalten", notIncluded: "Nicht enthalten",
    cmpPrompt: "Prompt-Prüfungen im Web und in der Windows-App", cmpExtension: "Prüfungen in der Chrome-Erweiterung", cmpTerms: "Ihre geschützten Begriffe", cmpRepoWeb: "Prüfungen öffentlicher Repositories im Web", cmpRepoLocal: "Repository-Prüfungen in der Windows-App, mit Verlauf und Archiven", cmpReports: "Geschwärzte Repository-Berichte", cmpPolicies: "Team-Richtlinien: warnen, schwärzen oder blockieren", cmpActivity: "Team-Aktivität und CSV-Export, nur Metadaten", cmpSeats: "Nutzer",
    cellFiveDaily: "5 pro Tag", cellNoLimit: "Kein Tageslimit", cellExtFree: "Kein Limit, auf Ihrem Gerät", cellExtPlan: "Kein Limit, auf dem Server von Redaxa", cellTermsFree: "Web und Windows-App", cellTermsPro: "Web, Windows und Chrome", cellTermsBiz: "Plus gemeinsame Begriffe", cellThreeDaily: "3 pro Tag", cellSixtyDaily: "60 pro Tag", cellOneUser: "1", cellSeats: "1–3",
    trustTitle: "Was Ihr Gerät verlässt", trustExtT: "Kostenlose Prüfungen in Chrome", trustExt: "Laufen in Ihrem Browser. Der geprüfte Text verlässt Ihr Gerät nicht.", trustServerT: "Prüfungen im Web, unter Windows und mit einem Tarif", trustServer: "Über eine verschlüsselte Verbindung gesendet, analysiert und verworfen. Nie gespeichert und nie an einen KI-Anbieter weitergegeben.", trustMetaT: "Aktivitätsprotokoll", trustMeta: "Nur Metadaten: Zeit, Anwendung, Erkennungskategorien und Anzahlen. Nie Ihr Text.", trustRepoT: "Repository-Prüfungen", trustRepo: "Nur öffentliche Repositories; Prüfungen in der Windows-App laufen lokal. Private Repositories werden nicht unterstützt.", trustTermsT: "Business-Arbeitsbereich", trustTerms: "Geschützte Begriffe, Kategorierichtlinien und die Mitgliederliste werden auf unseren Servern gespeichert, solange der Arbeitsbereich besteht, damit sie auf dem Gerät jedes Mitglieds gelten. Mitglieder können sie lesen; Inhaber und Administratoren ändern sie.", trustLimit: "Die Erkennung kann sensible Informationen übersehen oder harmlosen Text melden. Prüfen Sie jedes Ergebnis, bevor Sie etwas teilen.", privacyPolicy: "Datenschutzerklärung lesen",
    faqTitle: "Fragen", faqTrialQ: "Wie funktioniert die 3-Tage-Testphase?", faqTrialA: "Berechtigte neue Abonnenten starten mit einer kostenlosen 3-Tage-Testphase. Eine Karte ist erforderlich; kündigen Sie vor Ende der Testphase, um eine Abbuchung zu vermeiden.", faqCancelQ: "Kann ich kündigen oder meinen Tarif ändern?", faqCancelA: "Ja. „Abonnement verwalten“ öffnet das Abrechnungsportal, in dem Sie Ihre Zahlungsmethode aktualisieren, Rechnungen herunterladen oder die Verlängerung kündigen können, wann immer Sie möchten.", faqBizQ: "Was bringt Business zusätzlich?", faqBizA: "Alles aus Pro, plus gemeinsame geschützte Begriffe, Kategorierichtlinien und Aktivität nur mit Metadaten für Ihr Team. Wählen Sie ein bis drei Nutzer.", faqStoredQ: "Wird der Text, den ich prüfe, gespeichert?", faqStoredA: "Nein. Prüfungen im Web, in der Windows-App und mit einem Tarif werden analysiert und verworfen; Redaxa behält nur Metadaten. Kostenlose Prüfungen in der Chrome-Erweiterung verlassen Ihr Gerät nie.", faqMissQ: "Findet Redaxa alles?", faqMissA: "Das kann kein Tool versprechen. Die Erkennung kann sensible Informationen übersehen oder harmlosen Text melden. Prüfen Sie daher jedes Ergebnis, bevor Sie es teilen.",
    sevCritical: "Kritisch", sevHigh: "Hoch", sevMedium: "Mittel", sevLow: "Niedrig", sevCriticalHint: "Könnte jemandem Zugriff auf ein Konto oder System geben", sevHighHint: "Direkte finanzielle Gefährdung oder ein starkes Identifizierungsmerkmal", sevMediumHint: "Persönliche Angaben mit indirektem Schadenspotenzial", sevLowHint: "Schwache Merkmale, die vom Kontext abhängen"
  }
};
for (const language of Object.keys(viewCopyByLanguage) as Language[]) Object.assign(copyByLanguage[language], shellCopyByLanguage[language], viewCopyByLanguage[language]);

const settingsByLanguage: Record<Language, string[]> = {
  en: ["Preferences", "Saved in this browser only. Nothing here creates an account or uploads your text.", "Interface language", "Check mode", "Detect personal data (email, phone, IP, fiscal code)", "Detect API keys and credentials", "Detect cards and IBANs", "Keep local check summaries", "Show the detected value on screen", "Clear the prompt after copying its safer version", "Close", "Save preferences", "Custom protected terms"],
  it: ["Preferenze", "Salvate solo in questo browser. Niente qui crea un account o carica il tuo testo.", "Lingua dell’interfaccia", "Modalità di controllo", "Rileva dati personali (email, telefono, IP, codice fiscale)", "Rileva chiavi API e credenziali", "Rileva carte e IBAN", "Conserva i riepiloghi locali dei controlli", "Mostra a schermo il valore rilevato", "Svuota il prompt dopo aver copiato la versione più sicura", "Chiudi", "Salva preferenze", "Termini protetti personalizzati"],
  es: ["Preferencias", "Se guardan solo en este navegador. Nada de esto crea una cuenta ni sube tu texto.", "Idioma de la interfaz", "Modo de revisión", "Detectar datos personales (correo, teléfono, IP, código fiscal)", "Detectar claves API y credenciales", "Detectar tarjetas e IBAN", "Conservar resúmenes locales de las revisiones", "Mostrar el valor detectado en pantalla", "Borrar el prompt tras copiar su versión más segura", "Cerrar", "Guardar preferencias", "Términos protegidos personalizados"],
  fr: ["Préférences", "Enregistrées uniquement dans ce navigateur. Rien ici ne crée de compte ni n’envoie votre texte.", "Langue de l’interface", "Mode de vérification", "Détecter les données personnelles (e-mail, téléphone, IP, code fiscal)", "Détecter les clés API et les identifiants", "Détecter les cartes et les IBAN", "Conserver les résumés locaux des vérifications", "Afficher la valeur détectée à l’écran", "Effacer le prompt après la copie de sa version plus sûre", "Fermer", "Enregistrer les préférences", "Termes protégés personnalisés"],
  de: ["Einstellungen", "Nur in diesem Browser gespeichert. Hier wird weder ein Konto erstellt noch Ihr Text hochgeladen.", "Oberflächensprache", "Prüfmodus", "Personenbezogene Daten erkennen (E-Mail, Telefon, IP, Steuernummer)", "API-Schlüssel und Zugangsdaten erkennen", "Karten und IBAN erkennen", "Lokale Zusammenfassungen der Prüfungen speichern", "Erkannten Wert auf dem Bildschirm anzeigen", "Prompt nach dem Kopieren der sichereren Version leeren", "Schließen", "Einstellungen speichern", "Eigene geschützte Begriffe"]
};
const findingLabelsByLanguage: Record<Language, Record<string, string>> = {
  en: { email: "Email", phone: "Phone", secret: "API key", card: "Card", ip: "IP address", iban: "IBAN", fiscalCode: "Fiscal code", credential: "Credential", ssn: "SSN", niNumber: "NI number", crypto: "Wallet address", privateKey: "Private key", name: "Personal name", address: "Street address", custom: "Custom term" },
  it: { email: "Email", phone: "Telefono", secret: "Chiave API", card: "Carta", ip: "Indirizzo IP", iban: "IBAN", fiscalCode: "Codice fiscale", credential: "Credenziale", ssn: "SSN", niNumber: "Numero NI", crypto: "Indirizzo wallet", privateKey: "Chiave privata", name: "Nome di persona", address: "Indirizzo postale", custom: "Termine personalizzato" },
  es: { email: "Correo electrónico", phone: "Teléfono", secret: "Clave API", card: "Tarjeta", ip: "Dirección IP", iban: "IBAN", fiscalCode: "Código fiscal", credential: "Credencial", ssn: "SSN", niNumber: "Número NI", crypto: "Dirección de wallet", privateKey: "Clave privada", name: "Nombre de persona", address: "Dirección postal", custom: "Término personalizado" },
  fr: { email: "E-mail", phone: "Téléphone", secret: "Clé API", card: "Carte", ip: "Adresse IP", iban: "IBAN", fiscalCode: "Code fiscal", credential: "Identifiant", ssn: "SSN", niNumber: "Numéro NI", crypto: "Adresse de portefeuille", privateKey: "Clé privée", name: "Nom de personne", address: "Adresse postale", custom: "Terme personnalisé" },
  de: { email: "E-Mail", phone: "Telefon", secret: "API-Schlüssel", card: "Karte", ip: "IP-Adresse", iban: "IBAN", fiscalCode: "Steuernummer", credential: "Zugangsdaten", ssn: "SSN", niNumber: "NI-Nummer", crypto: "Wallet-Adresse", privateKey: "Privater Schlüssel", name: "Personenname", address: "Straßenadresse", custom: "Eigener Begriff" }
};

// Sample prompts are real, detector-exercising text rather than lorem ipsum:
// each one is written so the categories its chip advertises actually fire.
const samplePrompts: Record<string, string> = {
  brief: "Prepare a project brief for Marco Rossi at ACME Ltd. Main contact: m.rossi@acme.com, direct line +39 02 5555 0180. Payments go to IT60 X054 2811 1010 0000 0123 456.",
  apikey: "Debug this webhook handler, it keeps returning 401. The Stripe key is sk_live_51H8x9zAbCdEfGhIjKlMnOpQrSt and the service runs on 192.168.1.20 behind our proxy.",
  email: "Draft a polite follow-up to laura.bianchi@studio-legale.it about the contract we sent on Monday. If she has not replied by Friday, call 348 771 2290.",
  personal: "Fill in this delivery form for me: Dear Anna Conti, ship to 221 Baker Street, card on file 4111 1111 1111 1111, and use password=Sunrise-4821 for the tracking portal."
};

// Anything in this set means a leak with immediate, concrete consequences (money
// moved, an account taken over) rather than a privacy annoyance -- that is the
// line between "high risk" and "review this".
const highRiskKinds = new Set(["secret", "privateKey", "credential", "card", "iban", "ssn", "niNumber", "crypto"]);

// "one|other" plural forms split on the pipe; index 0 for n===1, index 1 otherwise.
// English/Romance/German all use a simple singular/plural split -- good enough
// for these five languages without pulling in a full ICU pluralization library.
function plural(template: string, n: number): string {
  const forms = template.split("|");
  return (n === 1 ? forms[0] : forms[forms.length - 1]).replace("{n}", String(n));
}
function format(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

export function saveHistory(text: string, findings: Finding[]): HistoryEntry[] {
  const byKind: Record<string, number> = {};
  for (const finding of findings) byKind[finding.kind] = (byKind[finding.kind] ?? 0) + 1;
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    findings: findings.length,
    preview: "Prompt content is not stored.",
    byKind
  };
  // Stores more than the 8 shown in the "Recent checks" list so the weekly
  // analytics panel has enough data to be useful. Never stores raw finding
  // values, only counts by kind, to stay consistent with zero-retention scanning.
  const history = [entry, ...readHistory()].slice(0, 40);
  localStorage.setItem(storageKey, JSON.stringify(history));
  return history;
}

export function readHistory(): HistoryEntry[] {
  try {
    const serialized = localStorage.getItem(storageKey) ?? "[]";
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value)) { localStorage.removeItem(storageKey); return []; }
    const valid: HistoryEntry[] = [];
    for (const item of value.slice(0, 40)) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || item.id.length > 100 ||
          typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt)) ||
          !Number.isSafeInteger(item.findings) || item.findings < 0 || item.findings > 10000 ||
          !item.byKind || typeof item.byKind !== "object" || Array.isArray(item.byKind)) continue;
      const byKind: Record<string, number> = {};
      for (const [kind, amount] of Object.entries(item.byKind)) {
        if (Object.hasOwn(findingLabelsByLanguage.en, kind) && typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0 && amount <= 10000) byKind[kind] = amount;
      }
      // Migrate previous versions which retained the first 76 raw characters.
      // Reconstruct allowed fields so old prompt content and unknown fields disappear.
      valid.push({ id: item.id, createdAt: new Date(item.createdAt).toISOString(), findings: item.findings,
        preview: "Prompt content is not stored.", byKind });
    }
    const sanitized = JSON.stringify(valid);
    if (sanitized !== serialized) localStorage.setItem(storageKey, sanitized);
    return valid;
  } catch {
    try { localStorage.removeItem(storageKey); } catch { /* Storage can be unavailable. */ }
    return [];
  }
}

export function clearHistory(): void {
  localStorage.removeItem(storageKey);
}

function readPreferences(): Preferences {
  restoreTheme();
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(preferencesKey) ?? "{}");
    if (typeof stored === "object" && stored !== null) {
      const candidate = stored as Partial<Preferences>;
      return {
        ...defaultPreferences,
        language: ["en", "it", "es", "fr", "de"].includes(String(candidate.language)) ? candidate.language as Language : "en",
        theme: chosenTheme(candidate),
        themeChosen: candidate.themeChosen === true,
        scanMode: candidate.scanMode === "strict" ? "strict" : "standard",
        includePersonalData: candidate.includePersonalData !== false,
        includeCredentials: candidate.includeCredentials !== false,
        includeFinancialData: candidate.includeFinancialData !== false,
        saveHistory: candidate.saveHistory !== false,
        autoClearAfterCopy: candidate.autoClearAfterCopy === true,
        showRawValues: candidate.showRawValues !== false,
        customTerms: Array.isArray(candidate.customTerms) ? candidate.customTerms.filter((term): term is string => typeof term === "string").slice(0, 30) : []
      };
    }
  } catch { /* Fall back to the private local defaults. */ }
  return defaultPreferences;
}

function savePreferences(preferences: Preferences): void {
  localStorage.setItem(preferencesKey, JSON.stringify(preferences));
}

export function storeResult(text: string, findings: Finding[], redactedText: string, preferences: Preferences) {
  return { findings, redactedText, history: preferences.saveHistory ? saveHistory(text, findings) : readHistory() };
}

export function riskLevel(findings: Finding[]): RiskLevel {
  if (!findings.length) return "none";
  return findings.some((finding) => highRiskKinds.has(finding.kind)) ? "high" : "medium";
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Redaxa dashboard element missing: ${selector}`);
  return element;
}

// The engine sets severity on every finding; older servers may not send it,
// so the same mapping as scanner.ts is the fallback.
const severityOrder: FindingSeverity[] = ["critical", "high", "medium", "low"];
const fallbackSeverity: Record<string, FindingSeverity> = { secret: "critical", privateKey: "critical", credential: "critical", card: "high", iban: "high", ssn: "high", niNumber: "high", crypto: "high", fiscalCode: "high", email: "medium", phone: "medium", address: "medium", custom: "medium", name: "low", ip: "low" };
export function severityOf(finding: Pick<Finding, "kind"> & { severity?: FindingSeverity }): FindingSeverity {
  return finding.severity && severityOrder.includes(finding.severity) ? finding.severity : fallbackSeverity[finding.kind] ?? "medium";
}
const severityIcons: Record<FindingSeverity, string> = {
  critical: '<svg class="sev-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.4 1.8h5.2l3.6 3.6v5.2l-3.6 3.6H5.4l-3.6-3.6V5.4z"/><path d="M8 4.8v3.8M8 11.2h.01"/></svg>',
  high: '<svg class="sev-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l6.2 11H1.8z"/><path d="M8 6.4v3M8 11.4h.01"/></svg>',
  medium: '<svg class="sev-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 7.2v4M8 4.9h.01"/></svg>',
  low: '<svg class="sev-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="1.6"/></svg>'
};

export function mountDashboard(): void {
  enableAppShell();
  const prompt = required<HTMLTextAreaElement>("#prompt");
  const findingsRoot = required<HTMLElement>("#findings");
  const safeRoot = required<HTMLElement>("#safe");
  const redacted = required<HTMLElement>("#redacted");
  const riskBanner = required<HTMLElement>("#risk-banner");
  const count = required<HTMLElement>("#risk-count");
  const title = required<HTMLElement>("#risk-title");
  const copy = required<HTMLElement>("#risk-copy");
  const resPreview = required<HTMLElement>("#res-preview");
  const resLive = required<HTMLElement>("#res-live");
  const resultsCard = required<HTMLElement>("#results-card");
  const resultsTitle = required<HTMLElement>("#results-title");
  const resultsScroll = required<HTMLElement>("#results-scroll");
  const resultsFoot = required<HTMLElement>("#results-foot");
  const workspace = required<HTMLElement>(".workspace");

  // #pwa-install and #inspect-clipboard float at the viewport's bottom-right
  // corner. The results panel is capped to calc(100vh - 48px) and can be that
  // tall in BOTH its pre-scan preview state and its live-result state, on
  // perfectly ordinary viewport heights -- a fixed "hide while state X" rule
  // guessed wrong in both directions when checked against real content
  // (verified: the preview demo's own bottom chip row collided with the pill
  // at 1280x800 with nothing scrolled). Measuring the actual overlap is the
  // only version of this that doesn't need re-guessing every time the layout
  // changes.
  // Debounced with setTimeout rather than requestAnimationFrame: rAF only
  // fires on a rendered/visible tab, and this must still run (e.g. right
  // after a scan while the tab could be backgrounded) rather than silently
  // never correct the pill's visibility.
  let cornerCheckTimer: number | null = null;
  const measureCornerOverlap = (): void => {
    const cardRect = resultsCard.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    // Mirrors the pills' own fixed footprint (right:24/bottom:24, ~140x96
    // combined) without needing to read two separate elements that may not
    // exist yet (#inspect-clipboard is desktop-app-only).
    const cornerLeft = vw - 164, cornerTop = vh - 120;
    const overlaps = cardRect.right > cornerLeft && cardRect.bottom > cornerTop
      && cardRect.left < vw && cardRect.top < vh;
    document.body.classList.toggle("corner-blocked", overlaps);
  };
  const avoidCornerOverlap = (): void => {
    if (cornerCheckTimer !== null) return;
    cornerCheckTimer = window.setTimeout(() => { cornerCheckTimer = null; measureCornerOverlap(); }, 16);
  };
  window.addEventListener("resize", avoidCornerOverlap);
  window.addEventListener("scroll", avoidCornerOverlap, { passive: true });
  resultsScroll.addEventListener("scroll", avoidCornerOverlap, { passive: true });
  // Belt-and-braces: browsers throttle or drop scroll events for a tab that
  // isn't actually compositing frames (backgrounded, minimized, some embedded
  // contexts) -- confirmed live, not hypothetical: window.scrollTo() in this
  // exact app, in this environment, did not raise 'scroll' at all in testing.
  // A slow poll costs nothing while idle and guarantees the corner pills
  // never get stuck hidden (or stuck overlapping) if the event never arrives.
  window.setInterval(measureCornerOverlap, 800);
  const historyRoot = required<HTMLElement>("#history");
  const historyCard = required<HTMLElement>("#history-card");
  const scanButton = required<HTMLButtonElement>("#scan");
  const clearPrompt = required<HTMLButtonElement>("#clear-prompt");
  const clearHistoryButton = required<HTMLButtonElement>("#clear-history");
  const characterCount = required<HTMLElement>("#character-count");
  const snippetLabel = required<HTMLElement>("#snippet-label");
  const resultSnippet = required<HTMLElement>("#result-snippet");
  const planLabel = required<HTMLElement>("#plan-status-label");
  const planValue = required<HTMLElement>("#plan-status-value");
  const planNote = required<HTMLElement>("#plan-status-note");
  const planTrack = required<HTMLElement>("#plan-track");
  const planFill = required<HTMLElement>("#plan-fill");
  const activityEmpty = required<HTMLElement>("#analytics-empty");
  const activityBody = required<HTMLElement>("#activity-body");
  const analyticsRoot = required<HTMLElement>("#analytics-bars");
  const navItems = Array.from(document.querySelectorAll<HTMLElement>(".nav-item"));

  const preferences = readPreferences();
  applyTheme(preferences.theme);
  // The plan prices and the trial switch, from Stripe through the server.
  // Until they arrive (or if they cannot be read) the page shows what it did
  // before the trial: the list prices below and one checkout button per plan.
  let prices: PriceList | null = null;
  let trialAccount: AccountState | null = null;
  const trialOn = (): boolean => (trialAccount?.billing?.trialEnabled ?? prices?.trialEnabled) === true;
  const trialWords = () => TRIAL_UI[preferences.language];
  const words = (): Record<string, string> => trialOn() ? { ...copyByLanguage[preferences.language], ...trialWords().copy } : copyByLanguage[preferences.language];
  const labels = (): Record<string, string> => findingLabelsByLanguage[preferences.language];
  // Numbers and dates follow the language picked in Preferences, not the
  // browser's own locale: an English UI showing "10.000" (or an Italian one
  // showing "10,000") reads like a bug.
  const num = (value: number): string => value.toLocaleString(preferences.language);
  const dateTime = (iso: string): string => new Date(iso).toLocaleString(preferences.language);
  const dateOnly = (iso: string): string => new Date(iso).toLocaleDateString(preferences.language);

  // Settings, Plans & pricing and Account & team are pages of the workspace,
  // not dialogs: each lives in its own [data-view] section and the rail and
  // the address hash choose which one is on screen.
  const viewRoot = (name: string): HTMLElement => required<HTMLElement>(`[data-view="${name}"]`);
  const settingsView = viewRoot("settings");
  settingsView.innerHTML = `
    <header class="view-head"><h1 id="preferences-title" tabindex="-1" data-i18n="settingsTitle">Settings</h1><p data-s="1">Saved in this browser only. Nothing here creates an account or uploads your text.</p></header>
    <section class="card settings-card" aria-labelledby="settings-appearance">
      <div class="card-head"><h2 id="settings-appearance" data-i18n="settingsAppearance">Appearance and language</h2></div>
      <label class="pref-row"><span data-s="2">Interface language</span><select id="language"><option value="en">English</option><option value="it">Italiano</option><option value="es">Español</option><option value="fr">Français</option><option value="de">Deutsch</option></select></label>
      <div class="pref-row theme-pref-row"><span id="theme-label" data-i18n="themeLabel">Theme</span><div class="theme-row" id="theme-row" role="group" aria-labelledby="theme-label"></div></div>
    </section>
    <section class="card settings-card" aria-labelledby="settings-detection">
      <div class="card-head"><h2 id="settings-detection" data-i18n="settingsDetection">Detection</h2></div>
      <label class="pref-row"><span data-s="3">Check mode</span><select id="scan-mode"><option value="standard">Standard</option><option value="strict">Strict</option></select></label>
      <label class="switch"><input id="detect-personal" type="checkbox" checked><span data-s="4">Detect personal data</span></label>
      <label class="switch"><input id="detect-credentials" type="checkbox" checked><span data-s="5">Detect API keys and credentials</span></label>
      <label class="switch"><input id="detect-financial" type="checkbox" checked><span data-s="6">Detect cards and IBANs</span></label>
    </section>
    <section class="card settings-card" aria-labelledby="settings-device">
      <div class="card-head"><h2 id="settings-device" data-i18n="settingsDevice">On this device</h2></div>
      <label class="switch"><input id="save-history" type="checkbox" checked><span data-s="7">Keep local check summaries</span></label>
      <label class="switch"><input id="show-raw" type="checkbox" checked><span data-s="8">Show the detected value on screen</span></label>
      <label class="switch"><input id="clear-after-copy" type="checkbox"><span data-s="9">Clear the prompt after copying its safer version</span></label>
    </section>
    <div class="settings-actions"><span class="form-status" id="prefs-status" role="status"></span><button class="primary" id="save-preferences" type="button" data-s="11">Save preferences</button></div>
    <section class="card settings-card" id="api-keys-block" aria-labelledby="api-keys-title">
      <div class="card-head"><h2 id="api-keys-title" data-i18n="apiTitle">Developer API keys</h2><a class="text-link" href="https://redaxa.getcertsprint.com/api-docs.html" target="_blank" rel="noopener" data-i18n="apiDocs">API documentation</a></div>
      <p class="card-note" data-i18n="apiHint">For scripts and pipelines.</p>
      <ul id="api-key-list"></ul>
      <div id="api-key-new" hidden>
        <input type="text" id="api-key-value" readonly aria-label="New API key" data-i18n-label="apiNewKey">
        <button type="button" class="secondary" id="api-key-copy" data-i18n="apiCopy">Copy</button>
        <p class="pref-note" data-i18n="apiOnce">This key is shown once. Store it now — it cannot be recovered.</p>
      </div>
      <button type="button" class="secondary" id="api-key-create" data-i18n="apiCreate">Create API key</button>
    </section>`;
  // Static palette classes work under desktop CSP and repaint every surface.
  const themeRow = required<HTMLElement>("#theme-row");
  themeRow.innerHTML = themes.map((theme) => `<button type="button" class="theme-swatch theme-swatch-${theme.code}${theme.code === preferences.theme ? " active" : ""}" data-theme="${theme.code}" title="${theme.label}" aria-label="${theme.label}" aria-pressed="${theme.code === preferences.theme}"><span class="theme-dot" aria-hidden="true"></span><span>${theme.label}</span></button>`).join("");
  themeRow.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".theme-swatch");
    const code = button?.dataset.theme as ThemeName | undefined;
    if (!code) return;
    preferences.theme = code;
    preferences.themeChosen = true;
    applyTheme(code);
    savePreferences(preferences);
    themeRow.querySelectorAll(".theme-swatch").forEach((swatch) => { swatch.classList.toggle("active", swatch === button); swatch.setAttribute("aria-pressed", String(swatch === button)); });
    renderOnboarding();
  });

  // API keys: metadata list + one-time plaintext display on create.
  const apiKeyList = required<HTMLUListElement>("#api-key-list");
  const apiKeyNew = required<HTMLElement>("#api-key-new");
  const apiKeyValue = required<HTMLInputElement>("#api-key-value");
  const loadApiKeys = async (): Promise<void> => {
    if (!window.promptShieldAuth?.hasAccess()) { apiKeyList.innerHTML = `<li class="empty">${escapeHtml(words().apiSignIn)}</li>`; return; }
    try {
      const data = await window.promptShieldAuth.request("/api/account?action=keys", undefined, "GET") as { keys?: { id: string; name: string; prefix: string; createdAt: string; revoked: boolean }[] };
      const keys = (data.keys ?? []).filter((key) => !key.revoked);
      apiKeyList.innerHTML = keys.map((key) =>
        `<li><span><code>${escapeHtml(key.prefix)}…</code> ${escapeHtml(key.name)}</span><button type="button" class="secondary" data-key-revoke="${escapeHtml(key.id)}">${escapeHtml(words().revoke)}</button></li>`
      ).join("") || `<li class="empty">${escapeHtml(words().apiNone)}</li>`;
    } catch { apiKeyList.innerHTML = ""; }
  };
  required<HTMLButtonElement>("#api-key-create").addEventListener("click", async () => {
    try {
      const created = await window.promptShieldAuth?.request("/api/account?action=key-create", { name: `Key ${dateOnly(new Date().toISOString())}` }, "POST") as { key?: string };
      if (created?.key) {
        apiKeyValue.value = created.key;
        apiKeyNew.hidden = false;
      }
      await loadApiKeys();
    } catch { /* rate-limited or offline; the list simply doesn't change */ }
  });
  required<HTMLButtonElement>("#api-key-copy").addEventListener("click", () => {
    void navigator.clipboard.writeText(apiKeyValue.value);
  });
  apiKeyList.addEventListener("click", async (event) => {
    const keyId = (event.target as HTMLElement).dataset.keyRevoke;
    if (!keyId) return;
    await window.promptShieldAuth?.request("/api/account?action=key-revoke", { keyId }, "POST").catch(() => undefined);
    await loadApiKeys();
  });

  // Plans & pricing is a full page. Regular prices are fixed here as before;
  // an offer replaces them only once the server confirms it (promo.ts).
  const plansView = viewRoot("plans");
  const w0 = words();
  const checkIcon = '<svg class="cmp-yes" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4l2.9 2.9 6.1-6.6"/></svg>';
  const sparkIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l1.5 4.2 4.3 1.5-4.3 1.5L8 13.2 6.5 9 2.2 7.5 6.5 6z"/></svg>';
  const benefits = (keys: string[]): string => `<ul class="rx-benefits">${keys.map((key) => `<li data-i18n-html="${key}">${w0[key]}</li>`).join("")}</ul>`;
  type CompareCell = string | boolean;
  const compareRows: [string, CompareCell, CompareCell, CompareCell][] = [
    ["cmpPrompt", "cellFiveDaily", "cellNoLimit", "cellNoLimit"],
    ["cmpExtension", "cellExtFree", "cellExtPlan", "cellExtPlan"],
    ["cmpTerms", "cellTermsFree", "cellTermsPro", "cellTermsBiz"],
    ["cmpRepoWeb", "cellThreeDaily", "cellSixtyDaily", "cellSixtyDaily"],
    ["cmpRepoLocal", false, true, true],
    ["cmpReports", false, true, true],
    ["cmpPolicies", false, false, true],
    ["cmpActivity", false, false, true],
    ["cmpSeats", "cellOneUser", "cellOneUser", "cellSeats"]
  ];
  const compareCell = (value: CompareCell): string => typeof value === "string"
    ? `<td data-i18n="${value}">${w0[value]}</td>`
    : value ? `<td class="cmp-cell-yes">${checkIcon}<span class="sr-only" data-i18n="included">${w0.included}</span></td>`
    : `<td class="cmp-cell-no"><span aria-hidden="true">—</span><span class="sr-only" data-i18n="notIncluded">${w0.notIncluded}</span></td>`;
  const faq = ["Trial", "Cancel", "Biz", "Stored", "Miss"].map((key) => `<details class="faq-item"><summary data-i18n="faq${key}Q">${w0[`faq${key}Q`]}</summary><p data-i18n="faq${key}A">${w0[`faq${key}A`]}</p></details>`).join("");
  plansView.innerHTML = `
    <header class="view-head plans-head">
      <p class="eyebrow" data-i18n="plansTitle">${w0.plansTitle}</p>
      <h1 id="plans-title" tabindex="-1" data-i18n="plansHeadline">${w0.plansHeadline}</h1>
      <p class="plans-intro" data-i18n="plansIntro">${w0.plansIntro}</p>
    </header>
    <div class="plans-status" id="plans-status" role="status">
      <span class="rx-badge" id="plans-status-badge"></span>
      <p id="plans-status-text"></p>
      <button type="button" class="secondary" id="plans-manage" hidden data-i18n="manageBtn">${w0.manageBtn}</button>
    </div>
    <div class="plans-trial" id="plans-trial" hidden>
      <div class="plans-trial-copy"><h2 id="plans-trial-title"></h2><p id="plans-trial-text"></p></div>
      <button type="button" class="primary" id="plans-trial-start" hidden></button>
    </div>
    <div class="billing-switch" role="group" aria-label="${w0.billingPeriod}" data-i18n-label="billingPeriod"><button type="button" data-billing="monthly" aria-pressed="false" data-i18n="billingMonthly">${w0.billingMonthly}</button><button type="button" data-billing="yearly" aria-pressed="true" data-i18n="billingYearly">${w0.billingYearly}</button></div>
    <div class="plan-grid">
      <article class="plan-card plan-free" data-plan-card="free" aria-labelledby="plan-free-name">
        <div class="plan-top"><h2 id="plan-free-name" data-i18n="freeName">${w0.freeName}</h2><span class="rx-badge rx-badge-current" data-current hidden data-i18n="currentPlan">${w0.currentPlan}</span></div>
        <p class="plan-desc" data-i18n="freeDesc">${w0.freeDesc}</p>
        <div class="plan-price" id="free-plan-price"></div>
        <p class="plan-note" data-i18n="freeNote">${w0.freeNote}</p>
        <div class="plan-actions"><button type="button" class="secondary plan-free-status" disabled>${w0.freeCurrent}</button></div>
        ${benefits(["freeB1", "freeB2", "freeB3", "freeB4"])}
      </article>
      <article class="plan-card featured" data-plan-card="personal" aria-labelledby="plan-pro-name">
        <span class="plan-ribbon">${sparkIcon}<span data-i18n="recommended">${w0.recommended}</span></span>
        <div class="plan-top"><h2 id="plan-pro-name" data-i18n="personalName">${w0.personalName}</h2><span class="rx-badge rx-badge-current" data-current hidden data-i18n="currentPlan">${w0.currentPlan}</span></div>
        <p class="plan-desc" data-i18n="personalDesc">${w0.personalDesc}</p>
        <div class="plan-price"></div>
        <p class="plan-note"></p>
        <div class="plan-actions">
          <button type="button" class="primary" data-plan="personal" data-interval="yearly" data-choice="">${w0.startTrial}</button>
          <button type="button" class="secondary plan-now" data-plan="personal" data-interval="yearly" data-choice="now" hidden></button>
          <button type="button" class="secondary plan-manage" hidden data-i18n="manageBtn">${w0.manageBtn}</button>
          <button type="button" class="secondary plan-included" disabled hidden data-i18n="includedInPlan">${w0.includedInPlan}</button>
          <p class="plan-choice-line" hidden></p>
          <p class="plan-choice-note" role="status" hidden></p>
        </div>
        ${benefits(["proB1", "proB2", "proB3", "proB4"])}
      </article>
      <article class="plan-card" data-plan-card="business" aria-labelledby="plan-business-name">
        <div class="plan-top"><h2 id="plan-business-name" data-i18n="businessName">${w0.businessName}</h2><span class="rx-badge rx-badge-current" data-current hidden data-i18n="currentPlan">${w0.currentPlan}</span></div>
        <p class="plan-tagline" data-i18n="businessTag">${w0.businessTag}</p>
        <p class="plan-desc" data-i18n="businessDesc">${w0.businessDesc}</p>
        <div class="plan-price"></div>
        <p class="plan-note"></p>
        <label class="pref-row seats-row"><span data-i18n="seatsLabel">${w0.seatsLabel}</span><select id="business-seats"><option value="1" data-i18n="seat1">${w0.seat1}</option><option value="2" data-i18n="seat2">${w0.seat2}</option><option value="3" data-i18n="seat3">${w0.seat3}</option></select></label>
        <div class="plan-actions">
          <button type="button" class="primary" data-plan="business" data-interval="yearly" data-choice="">${w0.startTrial}</button>
          <button type="button" class="secondary plan-now" data-plan="business" data-interval="yearly" data-choice="now" hidden></button>
          <button type="button" class="secondary plan-manage" hidden data-i18n="manageBtn">${w0.manageBtn}</button>
          <p class="plan-choice-line" hidden></p>
          <p class="plan-choice-note" role="status" hidden></p>
        </div>
        ${benefits(["bizB1", "bizB2", "bizB3", "bizB4"])}
      </article>
    </div>
    <p class="plans-checkout-note" data-i18n="checkoutNote">${w0.checkoutNote}</p>
    <section class="plans-section" aria-labelledby="compare-title">
      <h2 id="compare-title" data-i18n="compareTitle">${w0.compareTitle}</h2>
      <div class="compare-wrap" tabindex="0" role="region" aria-labelledby="compare-title">
        <table class="compare-table">
          <thead><tr><th scope="col" data-i18n="compareFeature">${w0.compareFeature}</th><th scope="col" data-i18n="freeName">${w0.freeName}</th><th scope="col" class="cmp-featured" data-i18n="personalName">${w0.personalName}</th><th scope="col" data-i18n="businessName">${w0.businessName}</th></tr></thead>
          <tbody>${compareRows.map(([label, free, pro, business]) => `<tr><th scope="row" data-i18n="${label}">${w0[label]}</th>${compareCell(free)}${compareCell(pro)}${compareCell(business)}</tr>`).join("")}</tbody>
        </table>
      </div>
    </section>
    <section class="plans-section plans-trust" aria-labelledby="trust-title">
      <h2 id="trust-title" data-i18n="trustTitle">${w0.trustTitle}</h2>
      <div class="trust-grid">
        ${["Ext", "Server", "Meta", "Terms", "Repo"].map((key) => `<article class="trust-item"><h3 data-i18n="trust${key}T">${w0[`trust${key}T`]}</h3><p data-i18n="trust${key}">${w0[`trust${key}`]}</p></article>`).join("")}
      </div>
      <p class="trust-limit"><span data-i18n="trustLimit">${w0.trustLimit}</span> <a href="https://redaxa.getcertsprint.com/privacy.html" target="_blank" rel="noopener" data-i18n="privacyPolicy">${w0.privacyPolicy}</a></p>
    </section>
    <section class="plans-section" aria-labelledby="faq-title">
      <h2 id="faq-title" data-i18n="faqTitle">${w0.faqTitle}</h2>
      <div class="faq-list">${faq}</div>
    </section>`;

  const accountView = viewRoot("account");
  accountView.innerHTML = `
    <header class="view-head"><h1 id="workspace-title" tabindex="-1" data-i18n="accountTitle">${w0.accountTitle}</h1><p data-i18n="accountSub">${w0.accountSub}</p></header>
    <p class="empty" id="workspace-empty" hidden data-i18n="accountEmpty">${w0.accountEmpty}</p>
    <section class="card billing-card" aria-labelledby="billing-title">
      <div class="card-head"><h2 id="billing-title" data-i18n="manageTitle">${w0.manageTitle}</h2><span class="rx-badge" id="account-plan-badge"></span></div>
      <p class="card-note" data-i18n="manageDesc">${w0.manageDesc}</p>
      <p class="billing-state" id="account-billing-state" role="status" hidden></p>
      <div class="card-actions"><a class="ghost-btn" id="account-compare" href="#plans" data-i18n="seePlans">${w0.seePlans}</a><button type="button" class="primary" id="manage-billing" data-i18n="manageBtn">${w0.manageBtn}</button></div>
    </section>
    <section id="team-section" class="card team-section" hidden aria-labelledby="team-title">
      <div class="card-head"><h2 id="team-title" data-i18n="teamTitle">${w0.teamTitle}</h2></div>
      <p id="team-seats"></p>
      <ul id="team-invite-list"></ul>
      <button type="button" class="secondary" id="team-invite-btn" data-i18n="inviteCreate">${w0.inviteCreate}</button>
      <div id="team-invite-result"></div>
    </section>
    <section id="org-section" class="card team-section" hidden aria-labelledby="org-title">
      <div class="card-head"><h2 id="org-title">${w0.orgTitle}</h2></div>
      <p class="card-note" data-i18n="orgIntro">${w0.orgIntro}</p>
      <div class="pref-row" id="org-name-row" hidden>
        <input type="text" id="org-name-input" maxlength="80" aria-labelledby="org-title">
        <button type="button" class="secondary" id="org-name-save" data-i18n="orgRenameSave">${w0.orgRenameSave}</button>
      </div>
      <h3 data-i18n="orgMembersLabel">${w0.orgMembersLabel}</h3>
      <ul id="org-member-list"></ul>
      <div class="card-actions" id="org-leave-row" hidden><button type="button" class="secondary" id="org-leave" data-i18n="orgLeave">${w0.orgLeave}</button></div>
      <p class="card-note" id="org-leave-result" role="status"></p>
      <h3 data-i18n="orgPoliciesLabel">${w0.orgPoliciesLabel}</h3>
      <p class="card-note" data-i18n="orgPoliciesHint">${w0.orgPoliciesHint}</p>
      <ul id="org-policy-list"></ul>
    </section>
    <section id="delete-account-section" class="card delete-account" hidden aria-labelledby="delete-account-heading">
      <div class="card-head"><h2 id="delete-account-heading" data-i18n="deleteTitle">${w0.deleteTitle}</h2></div>
      <p class="card-note" data-i18n="deleteDesc">${w0.deleteDesc}</p>
      <div class="card-actions"><button type="button" class="secondary" id="delete-account-open" data-i18n="deleteOpen">${w0.deleteOpen}</button></div>
    </section>`;
  // The workspace's shared terms are edited on the Protected terms page.
  required<HTMLElement>("#org-terms-slot").innerHTML = `<ul id="org-term-list"></ul>
    <div class="pref-row" id="org-term-row" hidden>
      <input type="text" id="org-term-input" maxlength="64" placeholder="${w0.orgTermPlaceholder}" data-i18n-placeholder="orgTermPlaceholder" aria-labelledby="org-terms-title">
      <button type="button" class="secondary" id="org-term-add" data-i18n="orgTermAdd">${w0.orgTermAdd}</button>
    </div>`;

  let billingInterval: "monthly" | "yearly" = "yearly";
  // The Halloween offer, as last confirmed by the server. Regular prices until
  // then, and again the moment it ends or cannot be read.
  let promoView: PromoView | null = null;
  // With the trial on, the offer's fine print says the discount is the first payment after it.
  const promoWordsFor = (): PromoWords => trialOn() ? { ...promoWordsByLanguage[preferences.language], fine: trialWords().promoFine } : promoWordsByLanguage[preferences.language];
  const promo = mountPromo(banner => required("#plans-status").after(banner), promoWordsFor, () => preferences.language, view => {
    promoView = view;
    renderBilling();
  });
  const planCard = (plan: string): HTMLElement => required<HTMLElement>(`[data-plan-card="${plan}"]`);
  // Regular prices in euro cents, unchanged; only their formatting follows the language.
  const regularPrice = (cents: number, unit: string, monthlyEquivalent?: number): string =>
    `${euro(cents, preferences.language)} <small>${unit}</small>${monthlyEquivalent ? `<small class="price-equiv">${format(words().equivYearly, { price: euro(monthlyEquivalent, preferences.language) })}</small>` : ""}`;
  // Stripe's price once the server has read it; until then the list price the page always showed.
  const listAmount = (plan: string, fallback: number): number => priceFor(prices, plan, billingInterval)?.amount ?? fallback;
  const renderBilling = (): void => {
    const promoWords = promoWordsFor();
    plansView.querySelectorAll<HTMLElement>("[data-billing]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.billing === billingInterval)));
    plansView.querySelectorAll<HTMLElement>("[data-plan]").forEach(button => { button.dataset.interval = billingInterval; });
    const yearly = billingInterval === "yearly";
    const pro = promoView?.offer("personal", billingInterval) ?? null;
    const business = promoView?.offer("business", billingInterval) ?? null;
    promo.relabel();
    required<HTMLElement>("#free-plan-price").textContent = euro(0, preferences.language);
    const proAmount = listAmount("personal", yearly ? 7990 : 799);
    const businessAmount = listAmount("business", yearly ? 14990 : 1499);
    planCard("personal").querySelector(".plan-price")!.innerHTML = pro ? promoPriceHtml(pro, promoWords, preferences.language) : yearly ? regularPrice(proAmount, promoWords.perYear, Math.round(proAmount / 12)) : regularPrice(proAmount, promoWords.perMonth);
    planCard("business").querySelector(".plan-price")!.innerHTML = business ? promoPriceHtml(business, promoWords, preferences.language) : yearly ? regularPrice(businessAmount, promoWords.perUserYear, Math.round(businessAmount / 12)) : regularPrice(businessAmount, promoWords.perUserMonth);
    renderPlanChoice();
  };
  plansView.querySelectorAll<HTMLElement>("[data-billing]").forEach(button => button.addEventListener("click", () => { billingInterval = button.dataset.billing === "monthly" ? "monthly" : "yearly"; renderBilling(); }));
  // Every "Manage subscription" control reaches the one button auth.ts binds to the billing portal.
  [required<HTMLButtonElement>("#plans-manage"), ...plansView.querySelectorAll<HTMLButtonElement>(".plan-manage")]
    .forEach(button => button.addEventListener("click", () => required<HTMLButtonElement>("#manage-billing").click()));
  // The banner's trial is Pro's own "Start free trial" button: same checkout, same consent.
  required<HTMLButtonElement>("#plans-trial-start").addEventListener("click", () => planCard("personal").querySelector<HTMLButtonElement>("[data-plan]:not(.plan-now)")?.click());

  const teamSection = required<HTMLElement>("#team-section");
  const teamSeats = required<HTMLElement>("#team-seats");
  const teamInviteList = required<HTMLUListElement>("#team-invite-list");
  const teamInviteBtn = required<HTMLButtonElement>("#team-invite-btn");
  const teamInviteResult = required<HTMLElement>("#team-invite-result");
  const loadTeam = async (): Promise<void> => {
    if (!window.promptShieldAuth?.hasAccess()) { teamSection.hidden = true; return; }
    try {
      const data = await window.promptShieldAuth.request("/api/team?action=list", undefined, "GET") as {
        seatCount?: number; seatsUsed?: number; invites?: { id: string; status: string; createdAt: string; acceptedAt: string | null }[];
      };
      if (!data.invites || (data.seatCount ?? 1) <= 1) { teamSection.hidden = true; return; }
      teamSection.hidden = false;
      teamSeats.textContent = format(words().teamSeatsUsed, { used: data.seatsUsed ?? 0, total: data.seatCount ?? 1 });
      teamInviteBtn.disabled = (data.seatsUsed ?? 1) >= (data.seatCount ?? 1);
      teamInviteList.innerHTML = data.invites.map((invite) => `<li data-id="${escapeHtml(invite.id)}"><span>${invite.status === "accepted" ? words().teammateJoined : words().invitePending} · ${dateOnly(invite.createdAt)}</span><button type="button" class="secondary" data-revoke="${escapeHtml(invite.id)}">${invite.status === "accepted" ? words().removeTeammate : words().revoke}</button></li>`).join("") || `<li class="empty">${words().noInvites}</li>`;
    } catch { teamSection.hidden = true; }
  };
  teamInviteBtn.addEventListener("click", async () => {
    teamInviteBtn.disabled = true;
    try {
      const payload = await window.promptShieldAuth!.request("/api/team", {}, "POST") as { url?: string; error?: string };
      if (payload.url) {
        teamInviteResult.innerHTML = `<input type="text" readonly value="${escapeHtml(payload.url)}"><button type="button" class="secondary" id="team-copy-link">${words().copyLink}</button>`;
        document.querySelector("#team-copy-link")?.addEventListener("click", () => { void navigator.clipboard.writeText(payload.url ?? ""); });
        await loadTeam();
      }
    } catch (error) {
      teamInviteResult.textContent = error instanceof Error ? error.message : words().couldNotCreateInvite;
    } finally { teamInviteBtn.disabled = false; }
  });
  teamInviteList.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-revoke]");
    const inviteId = button?.dataset.revoke;
    if (!inviteId) return;
    button!.disabled = true;
    try {
      await window.promptShieldAuth!.request("/api/team?action=revoke", { inviteId }, "POST");
      teamInviteResult.textContent = "";
      await Promise.all([loadTeam(), loadOrganization()]);
    } catch (error) {
      teamInviteResult.textContent = error instanceof Error ? error.message : words().couldNotRemoveTeammate;
      button!.disabled = false;
    }
  });

  // Organization panel: workspace name, member roster, shared protected terms.
  // Writes are offered only to owners/admins (the server enforces it anyway).
  const orgSection = required<HTMLElement>("#org-section");
  const orgNameRow = required<HTMLElement>("#org-name-row");
  const orgNameInput = required<HTMLInputElement>("#org-name-input");
  const orgMemberList = required<HTMLUListElement>("#org-member-list");
  const orgTermList = required<HTMLUListElement>("#org-term-list");
  const orgTermRow = required<HTMLElement>("#org-term-row");
  const orgTermInput = required<HTMLInputElement>("#org-term-input");
  const orgPolicyList = required<HTMLUListElement>("#org-policy-list");
  const orgTermsCard = required<HTMLElement>("#org-terms-card");
  const orgLeaveRow = required<HTMLElement>("#org-leave-row");
  const orgLeaveResult = required<HTMLElement>("#org-leave-result");
  type OrgPayload = {
    organization: { id: string; name: string } | null;
    role?: "owner" | "admin" | "member";
    members?: { role: string; email: string | null; you: boolean }[];
    protectedTerms?: { id: string; term: string }[];
    policies?: { category: string; action: string; minSeverity?: string | null }[];
  };
  const policyCategories = ["credentials", "financial", "personal", "custom"] as const;
  const categoryLabel = (category: string): string =>
    category === "credentials" ? words().catCredentials : category === "financial" ? words().catFinancial : category === "personal" ? words().catPersonal : words().catCustom;
  const roleLabel = (role: string): string => role === "owner" ? words().orgRoleOwner : role === "admin" ? words().orgRoleAdmin : words().orgRoleMember;
  // The last payload is kept so re-opening the drawer paints instantly from
  // cache while a background refresh fetches the current state — without it
  // the whole Organization section popped in ~400ms after the drawer opened.
  let orgCache: OrgPayload | null = null;
  const renderOrganization = (data: OrgPayload): void => {
    orgTermsCard.hidden = !data.organization;
    if (!data.organization) { orgSection.hidden = true; return; }
    orgSection.hidden = false;
      const canManage = data.role === "owner" || data.role === "admin";
      required<HTMLElement>("#org-title").textContent = data.organization.name === "Workspace" ? words().orgTitle : data.organization.name;
      orgNameRow.hidden = !canManage;
      // The owner holds the workspace and cannot leave it.
      orgLeaveRow.hidden = data.role === "owner";
      orgTermRow.hidden = !canManage;
      if (canManage && document.activeElement !== orgNameInput) orgNameInput.value = data.organization.name;
      orgMemberList.innerHTML = (data.members ?? []).map((member) =>
        `<li><span>${escapeHtml(member.email ?? "—")}${member.you ? ` (${words().orgYou})` : ""} · ${roleLabel(member.role)}</span></li>`
      ).join("");
      orgTermList.innerHTML = (data.protectedTerms ?? []).map((term) =>
        `<li><span>${escapeHtml(term.term)}</span>${canManage ? `<button type="button" class="secondary" data-term-remove="${escapeHtml(term.id)}">${words().orgRemove}</button>` : ""}</li>`
      ).join("") || `<li class="empty">${words().orgNoTerms}</li>`;
      const chosen = new Map((data.policies ?? []).map((policy) => [policy.category, policy]));
      orgPolicyList.innerHTML = policyCategories.map((category) => {
        const row = chosen.get(category);
        const current = row?.action ?? "default";
        const severity = row?.minSeverity ?? "";
        if (!canManage) {
          const label = current === "default" ? words().polDefault : current === "warn" ? words().polWarn : current === "redact" ? words().polRedact : words().polBlock;
          const sevLabel = severity ? ` (≥ ${words()[`sev${severity[0].toUpperCase()}${severity.slice(1)}`] ?? severity})` : "";
          return `<li><span>${categoryLabel(category)}</span><span>${label}${sevLabel}</span></li>`;
        }
        const option = (value: string, label: string, selected: string): string => `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`;
        const actions = `<select data-policy-category="${category}">${option("default", words().polDefault, current)}${option("warn", words().polWarn, current)}${option("redact", words().polRedact, current)}${option("block", words().polBlock, current)}</select>`;
        // Severity floor only makes sense once an override exists.
        const severities = `<select data-policy-severity="${category}"${current === "default" ? " disabled" : ""}>${option("", words().sevAny, severity)}${option("medium", `≥ ${words().sevMedium}`, severity)}${option("high", `≥ ${words().sevHigh}`, severity)}${option("critical", `≥ ${words().sevCritical}`, severity)}</select>`;
        return `<li><span>${categoryLabel(category)}</span><span class="policy-selects">${actions}${severities}</span></li>`;
      }).join("");
  };
  const loadOrganization = async (): Promise<void> => {
    if (!window.promptShieldAuth?.hasAccess()) { orgSection.hidden = true; orgTermsCard.hidden = true; return; }
    if (orgCache) renderOrganization(orgCache);
    try {
      const data = await window.promptShieldAuth.request("/api/team?action=org", undefined, "GET") as OrgPayload;
      orgCache = data;
      renderOrganization(data);
    } catch { if (!orgCache) { orgSection.hidden = true; orgTermsCard.hidden = true; } }
  };
  required<HTMLButtonElement>("#org-leave").addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    if (!window.confirm(words().orgLeaveConfirm)) return;
    button.disabled = true;
    orgLeaveResult.textContent = "";
    try {
      await window.promptShieldAuth!.request("/api/team?action=leave", {}, "POST");
      // Leaving changes what this account is entitled to, not only the
      // roster: a fresh load reads plan, workspace and terms again.
      location.reload();
    } catch (error) {
      orgLeaveResult.textContent = error instanceof Error ? error.message : words().orgLeaveFailed;
      button.disabled = false;
    }
  });
  // Delete account: the server checks everything again (api/_account-delete.ts);
  // typing the address here only stops a slip of the mouse.
  const deleteSection = required<HTMLElement>("#delete-account-section");
  const deleteDialog = document.createElement("dialog");
  deleteDialog.className = "ps-account-sheet delete-account-dialog";
  deleteDialog.setAttribute("aria-labelledby", "delete-account-title");
  deleteDialog.innerHTML = `<header><h2 id="delete-account-title" data-i18n="deleteDialogTitle">${w0.deleteDialogTitle}</h2><button type="button" data-sheet-close data-i18n-label="deleteClose" aria-label="${w0.deleteClose}">×</button></header>
    <p id="delete-account-intro" data-i18n="deleteDialogIntro">${w0.deleteDialogIntro}</p>
    <p id="delete-account-done" role="status" hidden></p>
    <div class="ps-account-actions" id="delete-account-done-actions" hidden><button type="button" data-delete-cancel data-i18n="deleteClose">${w0.deleteClose}</button></div>
    <form id="delete-account-form" novalidate>
      <label class="ps-auth-field" for="delete-account-email"><span id="delete-account-label"></span><input id="delete-account-email" type="email" autocomplete="off" autocapitalize="off" spellcheck="false" required aria-describedby="delete-account-message"></label>
      <p class="ps-account-message" id="delete-account-message" role="status"></p>
      <div class="ps-account-actions"><button type="submit" class="delete-account-confirm" data-i18n="deleteConfirmBtn">${w0.deleteConfirmBtn}</button><button type="button" data-delete-cancel data-i18n="deleteCancel">${w0.deleteCancel}</button></div>
    </form>`;
  document.body.append(deleteDialog);
  const deleteForm = required<HTMLFormElement>("#delete-account-form");
  const deleteEmail = required<HTMLInputElement>("#delete-account-email");
  const deleteMessage = required<HTMLElement>("#delete-account-message");
  const deleteConfirm = deleteDialog.querySelector<HTMLButtonElement>(".delete-account-confirm")!;
  let deleteBusy = false;
  let accountDeleted = false;
  // Any signed-in account, whatever its plan. The first account event comes
  // before auth.ts has published promptShieldAuth, hence auth-ready as well.
  const syncDeleteSection = (): void => { deleteSection.hidden = !window.promptShieldAuth?.hasAccount(); };
  document.addEventListener("redaxa:account", syncDeleteSection);
  document.addEventListener("redaxa:auth-ready", syncDeleteSection);
  syncDeleteSection();
  const closeDelete = (): void => {
    if (deleteBusy) return;
    deleteDialog.close();
    // Signed out already: a fresh load shows the workspace as a visitor sees it.
    if (accountDeleted) location.reload();
  };
  deleteDialog.querySelectorAll("[data-sheet-close], [data-delete-cancel]").forEach(button => button.addEventListener("click", closeDelete));
  deleteDialog.addEventListener("cancel", event => { event.preventDefault(); closeDelete(); });
  required<HTMLButtonElement>("#delete-account-open").addEventListener("click", () => {
    const email = window.promptShieldAuth?.email();
    if (!email) return;
    required<HTMLElement>("#delete-account-label").textContent = format(words().deleteConfirmLabel, { email });
    deleteEmail.value = "";
    deleteEmail.removeAttribute("aria-invalid");
    deleteMessage.textContent = "";
    deleteMessage.classList.remove("error");
    deleteDialog.showModal();
    deleteEmail.focus();
  });
  deleteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = window.promptShieldAuth?.email();
    if (deleteBusy || !email) return;
    const typed = deleteEmail.value.trim();
    if (typed.toLowerCase() !== email.toLowerCase()) {
      deleteEmail.setAttribute("aria-invalid", "true");
      deleteMessage.classList.add("error");
      deleteMessage.textContent = words().deleteMismatch;
      deleteEmail.focus();
      return;
    }
    deleteBusy = true;
    deleteConfirm.disabled = deleteEmail.disabled = true;
    deleteEmail.removeAttribute("aria-invalid");
    deleteMessage.classList.remove("error");
    deleteMessage.textContent = words().deleteWorking;
    try {
      const result = await window.promptShieldAuth!.request("/api/account?action=delete", { email: typed }, "POST") as { signInKept?: boolean };
      accountDeleted = true;
      await window.promptShieldAuth!.signOut().catch(() => undefined);
      deleteForm.hidden = true;
      required<HTMLElement>("#delete-account-intro").hidden = true;
      const title = required<HTMLElement>("#delete-account-title");
      title.dataset.i18n = "deleteDoneTitle";
      title.textContent = words().deleteDoneTitle;
      const done = required<HTMLElement>("#delete-account-done");
      done.textContent = format(result.signInKept ? words().deleteDoneKept : words().deleteDone, { email });
      done.hidden = false;
      const doneActions = required<HTMLElement>("#delete-account-done-actions");
      doneActions.hidden = false;
      doneActions.querySelector<HTMLButtonElement>("button")!.focus();
    } catch (error) {
      deleteMessage.classList.add("error");
      deleteMessage.textContent = error instanceof Error && error.message && error.message !== "UNAUTHORIZED" ? error.message : words().deleteFailed;
      deleteConfirm.disabled = deleteEmail.disabled = false;
    } finally {
      deleteBusy = false;
    }
  });

  required<HTMLButtonElement>("#org-name-save").addEventListener("click", async () => {
    const name = orgNameInput.value.trim();
    if (!name) return;
    await window.promptShieldAuth?.request("/api/team?action=org-rename", { name }, "POST").catch(() => undefined);
    await loadOrganization();
  });
  required<HTMLButtonElement>("#org-term-add").addEventListener("click", async () => {
    const term = orgTermInput.value.trim();
    if (term.length < 2) return;
    await window.promptShieldAuth?.request("/api/team?action=term-add", { term }, "POST").catch(() => undefined);
    orgTermInput.value = "";
    await loadOrganization();
  });
  orgPolicyList.addEventListener("change", async (event) => {
    const select = (event.target as HTMLElement).closest("select");
    const category = select?.dataset.policyCategory ?? select?.dataset.policySeverity;
    if (!select || !category) return;
    const actionSelect = orgPolicyList.querySelector<HTMLSelectElement>(`select[data-policy-category="${category}"]`);
    const severitySelect = orgPolicyList.querySelector<HTMLSelectElement>(`select[data-policy-severity="${category}"]`);
    await window.promptShieldAuth?.request("/api/team?action=policy-set", {
      category,
      action: actionSelect?.value ?? "default",
      minSeverity: severitySelect?.value || undefined
    }, "POST").catch(() => undefined);
    await loadOrganization();
  });
  orgTermList.addEventListener("click", async (event) => {
    const termId = (event.target as HTMLElement).dataset.termRemove;
    if (!termId) return;
    await window.promptShieldAuth?.request("/api/team?action=term-remove", { termId }, "POST").catch(() => undefined);
    await loadOrganization();
  });

  // ---- Views ---------------------------------------------------------------
  // One page per task, chosen by the address hash. The links of the earlier
  // dialogs (#preferences, #history, #api-keys, #workspace) still land on the
  // right page: e-mails, the account menu and the repository page use them.
  // "#account" stays with auth.ts, which opens its sign-in dialog on it.
  type ViewName = "check" | "activity" | "terms" | "settings" | "plans" | "account";
  const viewForHash: Record<string, ViewName> = { "": "check", "#": "check", "#check": "check", "#prompt-workspace": "check", "#activity": "activity", "#history": "activity", "#terms": "terms", "#settings": "settings", "#preferences": "settings", "#api-keys": "settings", "#plans": "plans", "#workspace": "account" };
  const viewLabelKey: Record<ViewName, string> = { check: "navCheck", activity: "navActivity", terms: "navTerms", settings: "navSettings", plans: "navPlans", account: "navAccount" };
  const viewSections = Array.from(document.querySelectorAll<HTMLElement>("main [data-view]"));
  const viewLabel = required<HTMLElement>("#view-label");
  let currentView: ViewName = "check";
  const showView = (hash: string, moveFocus: boolean): boolean => {
    const name = viewForHash[hash];
    if (!name) return false;
    currentView = name;
    viewSections.forEach((section) => { section.hidden = section.dataset.view !== name; });
    navItems.forEach((item) => {
      const active = item.dataset.nav === name;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current");
    });
    viewLabel.textContent = words()[viewLabelKey[name]];
    window.scrollTo(0, 0);
    if (name === "settings") void loadApiKeys();
    if (name === "plans") renderBilling();
    if (name === "terms") void loadOrganization();
    if (name === "account") {
      required<HTMLElement>("#workspace-empty").hidden = !!window.promptShieldAuth?.hasAccess();
      void loadTeam(); void loadOrganization();
    }
    // A deep link to one block of a page goes to that block.
    const block = hash === "#api-keys" ? required<HTMLElement>("#api-key-create") : hash === "#history" ? historyCard : null;
    if (block) {
      if (block === historyCard) historyCard.tabIndex = -1;
      block.scrollIntoView({ block: "center" });
      block.focus({ preventScroll: true });
    } else if (moveFocus) {
      (name === "check" ? prompt : required<HTMLElement>(`[data-view="${name}"] h1`)).focus({ preventScroll: true });
    }
    return true;
  };
  // Page links switch the view in the same task as the click: the address is
  // updated with pushState instead of waiting for a hashchange round trip.
  // Back and forward, and hashes set elsewhere, still arrive as events.
  window.addEventListener("hashchange", () => { showView(location.hash, true); });
  window.addEventListener("popstate", () => { showView(location.hash, true); });
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    if (!link || link.target === "_blank") return;
    const url = new URL(link.href);
    // The desktop app serves this workspace as "/", the site as "/dashboard.html".
    const samePage = url.pathname === location.pathname || (url.pathname === "/dashboard.html" && location.pathname === "/");
    if (url.origin !== location.origin || !samePage || !viewForHash[url.hash]) return;
    event.preventDefault();
    if (url.hash !== location.hash) history.pushState(null, "", url.hash);
    showView(url.hash, true);
  });
  document.addEventListener("redaxa:account", () => {
    if (currentView !== "account") return;
    required<HTMLElement>("#workspace-empty").hidden = !!window.promptShieldAuth?.hasAccess();
    void loadTeam(); void loadOrganization();
  });
  document.addEventListener("redaxa:need-upgrade", () => { if (location.hash === "#plans") showView("#plans", true); else location.hash = "#plans"; });
  document.addEventListener("redaxa:auth-ready", () => { if (currentView === "settings") void loadApiKeys(); });
  required<HTMLButtonElement>("#help-link").addEventListener("click", openSupportEmail);

  const languageSelect = required<HTMLSelectElement>("#language");
  const scanModeSelect = required<HTMLSelectElement>("#scan-mode");
  const personalToggle = required<HTMLInputElement>("#detect-personal");
  const credentialToggle = required<HTMLInputElement>("#detect-credentials");
  const financialToggle = required<HTMLInputElement>("#detect-financial");
  const historyToggle = required<HTMLInputElement>("#save-history");
  const rawValueToggle = required<HTMLInputElement>("#show-raw");
  const clearAfterCopyToggle = required<HTMLInputElement>("#clear-after-copy");
  const customTermsInput = required<HTMLTextAreaElement>("#custom-terms");
  const syncPreferenceControls = (): void => {
    languageSelect.value = preferences.language;
    scanModeSelect.value = preferences.scanMode;
    personalToggle.checked = preferences.includePersonalData;
    credentialToggle.checked = preferences.includeCredentials;
    financialToggle.checked = preferences.includeFinancialData;
    historyToggle.checked = preferences.saveHistory;
    rawValueToggle.checked = preferences.showRawValues;
    clearAfterCopyToggle.checked = preferences.autoClearAfterCopy;
    customTermsInput.value = preferences.customTerms.join("\n");
  };
  syncPreferenceControls();
  const renderTermsCount = (): void => {
    required<HTMLElement>("#own-terms-count").textContent = plural(words().termsCount, preferences.customTerms.length);
  };
  // A short confirmation next to the button that saved, cleared after a moment.
  const flash = (element: HTMLElement, message: string): void => {
    element.textContent = message;
    window.setTimeout(() => { if (element.textContent === message) element.textContent = ""; }, 2400);
  };

  // Every translatable string carries a data-i18n key in the markup instead of
  // being reached through a positional selector (".top h1", navItems[2], ...).
  // The positional version silently mistranslated or threw whenever the markup
  // was reordered, which is exactly what a redesign does.
  const applyLanguage = (): void => {
    const w = words();
    const settings = settingsByLanguage[preferences.language];
    document.documentElement.lang = preferences.language;
    syncTrayLanguage(preferences.language);
    document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
      const value = w[element.dataset.i18n ?? ""];
      if (value !== undefined) element.textContent = value;
    });
    // Only this file's own copy, which carries <strong> emphasis, is set as HTML.
    document.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((element) => {
      const value = w[element.dataset.i18nHtml ?? ""];
      if (value !== undefined) element.innerHTML = value;
    });
    document.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((element) => {
      const value = w[element.dataset.i18nPlaceholder ?? ""];
      if (value !== undefined) element.setAttribute("placeholder", value);
    });
    document.querySelectorAll<HTMLElement>("[data-i18n-label]").forEach((element) => {
      const value = w[element.dataset.i18nLabel ?? ""];
      if (value !== undefined) element.setAttribute("aria-label", value);
    });
    document.querySelectorAll<HTMLElement>("[data-kind]").forEach((element) => {
      const value = labels()[element.dataset.kind ?? ""];
      if (value !== undefined) element.textContent = value;
    });
    document.querySelectorAll<HTMLElement>("[data-s]").forEach((element) => {
      const value = settings[Number(element.dataset.s)];
      if (value !== undefined) element.textContent = value;
    });
    languageSelect.setAttribute("aria-label", `${w.interfaceLanguage}: ${languageNames[preferences.language]}`);
    scanModeSelect.options[0].textContent = w.scanModeStandard;
    scanModeSelect.options[1].textContent = w.scanModeStrict;
    viewLabel.textContent = w[viewLabelKey[currentView]];

    renderBilling();
    updateCharacterCount();
    renderPlanStatus();
    renderHistory();
    renderTermsCount();
    if (!resLive.hidden) renderRiskCopy();
  };

  const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", "\"": "&quot;"
  }[character] ?? character));

  const onboardingKey = "redaxa.onboarding-dismissed.v1";
  const onboardingSection = document.querySelector<HTMLElement>("#onboarding");
  const renderOnboarding = (): void => {
    if (!onboardingSection) return;
    if (localStorage.getItem(onboardingKey) === "1") { onboardingSection.hidden = true; return; }
    const tasks: Record<string, boolean> = {
      check: readHistory().length > 0,
      terms: preferences.customTerms.length > 0,
      theme: preferences.themeChosen
    };
    // Completed steps are removed rather than struck through: a checklist that
    // keeps showing "Run your first check" after the first check is just noise.
    onboardingSection.querySelectorAll<HTMLElement>("#onboarding-list li[data-task]").forEach((item) => {
      item.hidden = Boolean(tasks[item.dataset.task ?? ""]);
    });
    onboardingSection.hidden = Object.values(tasks).every(Boolean);
  };
  document.querySelector("#onboarding-close")?.addEventListener("click", () => {
    localStorage.setItem(onboardingKey, "1");
    if (onboardingSection) onboardingSection.hidden = true;
  });

  // The sidebar reports the real plan/trial state rather than a checks-used
  // meter: the only free allowance is the server's 5 checks a day
  // (api/scan.ts), so a "N / 10 free checks" meter would promise a tier that
  // does not exist.
  const trialLengthDays = 7;
  let accountState: AccountState | null = null;
  // "personal" is the billing name of Pro.
  const planName = (plan: string | null | undefined): string => plan === "business" ? words().businessName : words().personalName;
  const renderPlanStatus = (): void => {
    const w = words();
    const t = trialWords();
    const billing = accountState?.billing ?? null;
    const paid = Boolean(accountState?.active);
    const paused = billing?.state === "blocked" && billing.blockedReason === "payment_failed";
    required<HTMLElement>("#side-fill").hidden = paid || paused;
    if (paused) {
      planTrack.hidden = true;
      planLabel.textContent = t.pausedBadge;
      planValue.textContent = planName(billing?.plan);
      planNote.textContent = fillTrial(t.sidebarPausedNote, { plan: planName(billing?.plan) });
    } else if (accountState?.status === "trialing" && accountState.currentPeriodEnd) {
      // The running trial's own length: three days now, seven for trials sold before.
      const total = billing?.trialLength ?? trialLengthDays;
      const daysLeft = Math.max(0, Math.ceil((new Date(accountState.currentPeriodEnd).getTime() - Date.now()) / 86_400_000));
      const dayNumber = Math.min(total, Math.max(1, total - daysLeft + 1));
      planLabel.textContent = w.planTrial;
      planValue.textContent = daysLeft <= 0 ? w.planEndsToday : plural(w.planDaysLeft, daysLeft);
      planTrack.hidden = false;
      planFill.style.width = `${Math.round((dayNumber / total) * 100)}%`;
      planTrack.setAttribute("aria-label", format(w.planDayOf, { day: dayNumber, total }));
      planNote.textContent = billing ? fillTrial(billing.cancelAtPeriodEnd ? t.sidebarTrialCancelled : t.sidebarTrialNote, { date: longDay(accountState.currentPeriodEnd, preferences.language) }) : w.planTrialNote;
    } else {
      planTrack.hidden = true;
      if (paid) {
        planLabel.textContent = w.planActive;
        planValue.textContent = planName(accountState?.plan);
        planNote.textContent = w.planActiveNote;
      } else {
        planLabel.textContent = w.planNone;
        planValue.textContent = "";
        planNote.textContent = w.planNoneNote;
      }
    }
    renderPlanChoice();
  };
  // The plan this account holds is marked on Plans & pricing, and its checkout
  // buttons give way to the billing portal so nobody subscribes twice.
  const renderPlanChoice = (): void => {
    const w = words();
    const t = trialWords();
    const lang = preferences.language;
    const billing = accountState?.billing ?? null;
    const held = accountState?.active ? (accountState.plan === "business" ? "business" : "personal") : "free";
    // A failed payment pauses the plan: the server refuses a second checkout, the card can be fixed.
    const paused = billing?.state === "blocked" && billing.blockedReason === "payment_failed";
    const pausedPlan = paused ? (billing?.plan === "business" ? "business" : "personal") : null;
    const refused = billing?.state === "blocked" && billing.blockedReason === "trial_already_used";
    const trial = trialOn();
    // Signed out, the trial is offered and the server decides at checkout; signed in, the account says.
    const offerTrial = trial && (!accountState || billing?.canStartTrial === true);
    const trialDays = prices?.trialDays ?? billing?.trialDays ?? 3;
    const date = prices ? chargeDate(prices) : new Date(Date.now() + trialDays * 86_400_000);
    const view = planView({ held, paused, trialOn: trial, signedIn: Boolean(accountState), billing });
    const trialingNow = accountState?.status === "trialing" && accountState.currentPeriodEnd;
    const daysLeft = trialingNow ? Math.max(0, Math.ceil((new Date(accountState!.currentPeriodEnd!).getTime() - Date.now()) / 86_400_000)) : 0;
    const leftText = daysLeft <= 0 ? w.planEndsToday : plural(w.planDaysLeft, daysLeft);
    const banner = TRIAL_BANNER[lang] ?? TRIAL_BANNER.en;
    const trialBox = required<HTMLElement>("#plans-trial");
    const trialStart = required<HTMLButtonElement>("#plans-trial-start");
    trialBox.hidden = view.trial === null;
    trialBox.dataset.state = view.trial ?? "";
    trialStart.hidden = view.trial !== "offer";
    trialStart.textContent = fillTrial(banner.offerButton, { days: trialDays });
    required<HTMLElement>("#plans-trial-title").textContent = view.trial === "running" ? fillTrial(banner.runningTitle, { left: leftText })
      : view.trial === "used" ? banner.usedTitle : fillTrial(banner.offerTitle, { days: trialDays });
    required<HTMLElement>("#plans-trial-text").textContent = view.trial === "running" && billing?.trialEndsAt
      ? fillTrial(billing.cancelAtPeriodEnd ? t.statusTrialCancelled : t.statusTrial, { plan: planName(billing.plan), date: longDay(billing.trialEndsAt, lang) })
      : view.trial === "used" ? banner.usedText : fillTrial(banner.offerText, { days: trialDays });
    // The main screen's entry point: the same offer, one click from anywhere.
    const sideCta = required<HTMLAnchorElement>("#side-fill-cta");
    sideCta.classList.toggle("is-trial", view.trial === "offer");
    sideCta.textContent = keepArrow(view.trial === "offer" ? fillTrial(banner.sideOffer, { days: trialDays }) : w.seePlans);
    plansView.querySelectorAll<HTMLElement>("[data-plan-card]").forEach((card) => {
      const plan = (card.dataset.planCard ?? "free") as Tier;
      const mine = plan === held;
      card.classList.toggle("is-current", mine);
      const badge = card.querySelector<HTMLElement>("[data-current]")!;
      badge.hidden = !mine;
      badge.textContent = mine && view.trial === "running" ? fillTrial(banner.runningTitle, { left: leftText }) : w.currentPlan;
      const included = card.querySelector<HTMLElement>(".plan-included");
      if (included) included.hidden = view.cards[plan] !== "included";
      const manage = card.querySelector<HTMLElement>(".plan-manage");
      if (!manage) return;
      const primary = card.querySelector<HTMLButtonElement>("[data-plan]:not(.plan-now)")!;
      const now = card.querySelector<HTMLButtonElement>(".plan-now")!;
      const line = card.querySelector<HTMLElement>(".plan-choice-line")!;
      const note = card.querySelector<HTMLElement>(".plan-choice-note")!;
      const fixHere = plan === pausedPlan;
      manage.hidden = !(mine || fixHere);
      manage.textContent = fixHere ? t.updatePayment : w.manageBtn;
      manage.classList.toggle("primary", fixHere);
      manage.classList.toggle("secondary", !fixHere);
      const checkout = held === "free" && !paused;
      primary.hidden = !checkout;
      // Seats only matter for a checkout this card can still start.
      const seats = card.querySelector<HTMLElement>(".seats-row");
      if (seats) seats.hidden = !checkout;
      now.hidden = true;
      line.hidden = true;
      note.hidden = true;
      note.classList.remove("is-error");
      const show = (el: HTMLElement, text: string | null): void => { el.textContent = text ?? ""; el.hidden = !text; };
      if (checkout) {
        const copy = choiceCopy(lang, { interval: billingInterval, price: priceFor(prices, plan, billingInterval), promo: promoView?.offer(plan, billingInterval) ?? null, trialDays, date });
        if (offerTrial) {
          primary.dataset.choice = "trial";
          primary.textContent = copy.trialLabel;
          now.hidden = false;
          now.textContent = copy.nowLabel;
          show(line, copy.trialLine);
          show(note, copy.nowLine);
        } else if (trial) {
          // No trial for this account: the one choice left is to subscribe now.
          primary.dataset.choice = "now";
          primary.textContent = copy.nowLabel;
          show(note, accountState ? t.trialUsed : null);
        } else {
          primary.dataset.choice = "";
          primary.textContent = plan === "business" ? w.ctaBusiness : w.ctaPro;
        }
      } else if (mine && billing?.state === "trialing" && billing.trialEndsAt) {
        show(note, fillTrial(t.noteTrialEnds, { date: longDay(billing.trialEndsAt, lang) }));
      } else if (fixHere) {
        show(note, fillTrial(t.statusPaused, { plan: planName(plan) }));
        note.classList.add("is-error");
      }
    });
    required<HTMLElement>(".plan-free-status").textContent = held === "free" ? w.freeCurrent : w.includedInPlan;
    const trialing = accountState?.status === "trialing" && accountState.currentPeriodEnd;
    const left = trialing ? Math.max(0, Math.ceil((new Date(accountState!.currentPeriodEnd!).getTime() - Date.now()) / 86_400_000)) : 0;
    const label = held === "free" ? w.freeName : planName(accountState?.plan);
    const badge = paused ? t.pausedBadge : trialing ? w.planTrial : label;
    const trialEnd = billing?.trialEndsAt ? longDay(billing.trialEndsAt, lang) : null;
    // What the account's own subscription is doing, when there is more to say than "free" or "active".
    const state = paused ? fillTrial(t.statusPaused, { plan: planName(billing?.plan) })
      : refused && held === "free" ? t.statusRefused
      : trialing && trialEnd ? fillTrial(billing?.cancelAtPeriodEnd ? t.statusTrialCancelled : t.statusTrial, { plan: label, date: trialEnd })
      : null;
    required<HTMLElement>("#plans-status-badge").textContent = badge;
    required<HTMLElement>("#plans-status-text").textContent = state ?? (trialing
      ? format(w.statusTrial, { left: left <= 0 ? w.planEndsToday : plural(w.planDaysLeft, left) })
      : held === "free" ? w.statusFree : format(w.statusActive, { plan: label }));
    const plansManage = required<HTMLElement>("#plans-manage");
    plansManage.hidden = held === "free" && !paused;
    plansManage.textContent = paused ? t.updatePayment : w.manageBtn;
    // Without a subscription there is nothing to manage yet: plans come first.
    const manageBilling = required<HTMLElement>("#manage-billing");
    manageBilling.hidden = held === "free" && !paused;
    manageBilling.textContent = paused ? t.updatePayment : w.manageBtn;
    required<HTMLElement>("#account-compare").classList.toggle("primary", held === "free" && !paused);
    required<HTMLElement>("#account-compare").classList.toggle("ghost-btn", held !== "free" || paused);
    required<HTMLElement>("#plans-status").classList.toggle("is-paid", held !== "free");
    required<HTMLElement>("#plans-status").classList.toggle("is-paused", paused);
    required<HTMLElement>("#account-plan-badge").textContent = badge;
    const billingState = required<HTMLElement>("#account-billing-state");
    billingState.textContent = state ?? "";
    billingState.hidden = !state;
    billingState.classList.toggle("is-error", paused);
  };
  // Account activity: the metadata-only audit trail (kinds, counts, decision,
  // surface — never prompt content), pulled from the server so it spans every
  // device and surface, unlike the purely local history below it.
  const serverActivity = required<HTMLElement>("#server-activity");
  const serverActivityList = required<HTMLElement>("#server-activity-list");
  type ScanEvent = { created_at: string; application: string; finding_kinds: string[]; finding_categories?: string[]; finding_count: number; action: string };
  let serverActivityLoaded = false;
  const loadServerActivity = async (): Promise<void> => {
    if (serverActivityLoaded || !window.promptShieldAuth?.hasAccess()) return;
    serverActivityLoaded = true;
    try {
      const data = await window.promptShieldAuth.request("/api/scan", undefined, "GET") as { events?: ScanEvent[] };
      const events = (data.events ?? []).slice(0, 8);
      if (events.length === 0) return;
      required<HTMLElement>("#server-activity-label").textContent = words().acctActivity;
      serverActivityList.innerHTML = events.map((event) => {
        const kinds = [...new Set(event.finding_kinds)].map((kind) => labels()[kind] ?? kind).join(", ");
        return `<article class="entry"><strong>${escapeHtml(event.application)} · ${escapeHtml(event.action)}</strong><span>${event.finding_count > 0 ? escapeHtml(kinds) : words().nothingFlagged}</span><em>${dateTime(event.created_at)}</em></article>`;
      }).join("");
      serverActivity.hidden = false;
      activityEmpty.hidden = true;
    } catch { /* best-effort: the local activity card still renders */ }
  };
  // Organization activity: what the Business plan buys — an owner/admin view
  // of the whole team's scan events (still metadata only; a member email, a
  // decision, a list of kinds — never content). The server enforces the role.
  const orgActivity = required<HTMLElement>("#org-activity");
  const orgActivityList = required<HTMLElement>("#org-activity-list");
  // The range the admin is looking at. Empty means "everything on record",
  // which is what an audit question defaults to before it is narrowed.
  let auditFrom = "";
  let auditTo = "";
  let orgActivityLoaded = false;

  const auditQuery = (extra: string): string => {
    const parts = ["scope=org"];
    if (auditFrom) parts.push(`from=${encodeURIComponent(auditFrom)}`);
    if (auditTo) parts.push(`to=${encodeURIComponent(auditTo)}`);
    if (extra) parts.push(extra);
    return `/api/scan?${parts.join("&")}`;
  };

  // `force` separates the two callers. The page retries this on a timer
  // while the session settles, and those retries must not re-render over a
  // range the admin has just typed — but a range change has to re-run it.
  const loadOrgActivity = async (force = false): Promise<void> => {
    if (!window.promptShieldAuth?.hasAccess()) return;
    if (orgActivityLoaded && !force) return;
    try {
      const data = await window.promptShieldAuth.request(auditQuery(""), undefined, "GET") as { events?: (ScanEvent & { member?: string | null })[]; total?: number; truncated?: boolean; error?: string };
      const allEvents = data.events ?? [];
      // An empty *first* load means there is nothing to show at all. An empty
      // load after a range has been narrowed is a real answer, and hiding the
      // panel then would look like the feature had broken.
      if (allEvents.length === 0 && !orgActivityLoaded && !auditFrom && !auditTo) return;
      orgActivityLoaded = true;
      required<HTMLElement>("#org-activity-label").textContent = words().orgActivity;

      // The number of events in the range, which is not the number this page
      // is holding. The metrics used to be computed over the fetched page and
      // labelled "Team checks", so an organization with five thousand checks
      // read as fifty — a dashboard quietly stating a wrong number about its
      // own customer's activity.
      const total = typeof data.total === "number" ? data.total : allEvents.length;
      const truncated = data.truncated === true;

      // The rates below are proportions of the loaded sample. Stated as such:
      // scaling them up to `total` would be inventing figures, and reporting
      // the raw sample counts under a total of a different size would be
      // worse. The export is what answers the exact question.
      const flagged = allEvents.filter((event) => event.finding_count > 0).length;
      const blocked = allEvents.filter((event) => event.action === "block").length;
      const categoryCounts: Record<string, number> = {};
      for (const event of allEvents) for (const category of new Set(event.finding_categories ?? [])) categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
      const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
      const memberCounts = new Map<string, { checks: number; flagged: number }>();
      for (const event of allEvents) {
        const who = event.member ?? "—";
        const bucket = memberCounts.get(who) ?? { checks: 0, flagged: 0 };
        bucket.checks += 1;
        if (event.finding_count > 0) bucket.flagged += 1;
        memberCounts.set(who, bucket);
      }
      const denominator = Math.max(1, allEvents.length);
      const metricsHtml = `<div class="metrics">
        <div class="metric"><span>${words().orgChecks}</span><b>${num(total)}</b></div>
        <div class="metric"><span>${words().orgFlagged}</span><b>${num(flagged)}</b></div>
        <div class="metric"><span>${words().orgBlocked}</span><b>${num(blocked)}</b></div>
        <div class="metric is-text"><span>${words().orgTopCat}</span><b>${topCategory ? escapeHtml(categoryLabel(topCategory)) : "—"}</b></div>
      </div>
      <span class="bars-label">${words().orgByMember}</span>
      ${[...memberCounts.entries()].sort((a, b) => b[1].checks - a[1].checks).map(([who, counts]) =>
        `<div class="analytics-row"><span class="analytics-label">${escapeHtml(who)}</span><div class="analytics-track"><div class="analytics-fill" style="width:${Math.max(6, Math.round((counts.checks / denominator) * 100))}%"></div></div><span class="analytics-value">${num(counts.checks)}</span></div>`
      ).join("")}`;

      const listHtml = allEvents.slice(0, 8).map((event) => {
        const kinds = [...new Set(event.finding_kinds)].map((kind) => labels()[kind] ?? kind).join(", ");
        return `<article class="entry"><strong>${escapeHtml(event.member ?? "—")} · ${escapeHtml(event.application)} · ${escapeHtml(event.action)}</strong><span>${event.finding_count > 0 ? escapeHtml(kinds) : words().nothingFlagged}</span><em>${dateTime(event.created_at)}</em></article>`;
      }).join("");

      // Says what is on screen versus what exists. Without this line the
      // panel is a confident summary of an unstated fraction of the record.
      const coverage = truncated
        ? words().auditShowing.replace("{shown}", num(allEvents.length)).replace("{total}", num(total))
        : words().auditComplete.replace("{total}", num(total));

      const rangeHtml = `<div class="audit-range">
        <label>${words().auditFrom} <input type="date" id="audit-from" value="${escapeHtml(auditFrom)}"></label>
        <label>${words().auditTo} <input type="date" id="audit-to" value="${escapeHtml(auditTo)}"></label>
      </div>
      <p class="audit-coverage">${escapeHtml(coverage)}</p>`;

      orgActivityList.innerHTML = `${rangeHtml}${metricsHtml}${listHtml}<button type="button" class="secondary" id="org-export-csv">${words().orgExport}</button>`;

      // Native date inputs rather than a picker library: they are keyboard
      // accessible, localised by the browser, and already on every platform
      // this ships to.
      const onRangeChange = (): void => {
        auditFrom = (orgActivityList.querySelector<HTMLInputElement>("#audit-from")?.value ?? "").trim();
        auditTo = (orgActivityList.querySelector<HTMLInputElement>("#audit-to")?.value ?? "").trim();
        void loadOrgActivity(true);
      };
      orgActivityList.querySelector("#audit-from")?.addEventListener("change", onRangeChange);
      orgActivityList.querySelector("#audit-to")?.addEventListener("change", onRangeChange);

      // The export is built by the server over the whole range, not from the
      // rows this page happens to be holding. It used to be the latter, under
      // a filename that read as the organization's record — a file that looks
      // complete and is not is worse than no export, because it is the one
      // someone hands to an auditor.
      orgActivityList.querySelector("#org-export-csv")?.addEventListener("click", (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true;
        void (async () => {
          try {
            const blob = await window.promptShieldAuth!.download(auditQuery("format=csv"));
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `redaxa-audit-organization-${auditFrom || "start"}_${auditTo || new Date().toISOString().slice(0, 10)}.csv`;
            link.click();
            URL.revokeObjectURL(link.href);
          } catch {
            // Best-effort, like the rest of this panel: the activity view
            // stays usable even when the download cannot be prepared.
          } finally {
            button.disabled = false;
          }
        })();
      });
      orgActivity.hidden = false;
      activityEmpty.hidden = true;
    } catch { /* members and solo users simply don't see this block */ }
  };
  // Cross-device sync: the account payload carries the synced settings
  // (detection toggles, scan mode, custom terms). Applied once per page load,
  // server wins — the server copy is whatever this user last saved anywhere.
  // Theme and language deliberately stay per-device.
  let syncedSettingsApplied = false;
  const applySyncedSettings = (settings: NonNullable<AccountState["settings"]>): void => {
    if (syncedSettingsApplied) return;
    syncedSettingsApplied = true;
    if (typeof settings.detectPersonal === "boolean") preferences.includePersonalData = settings.detectPersonal;
    if (typeof settings.detectCredentials === "boolean") preferences.includeCredentials = settings.detectCredentials;
    if (typeof settings.detectFinancial === "boolean") preferences.includeFinancialData = settings.detectFinancial;
    if (settings.scanMode === "standard" || settings.scanMode === "strict") preferences.scanMode = settings.scanMode;
    if (Array.isArray(settings.customTerms)) preferences.customTerms = settings.customTerms.slice(0, 30);
    savePreferences(preferences);
    syncPreferenceControls();
  };
  const pushSyncedSettings = (): void => {
    if (!window.promptShieldAuth?.hasAccess()) return;
    void window.promptShieldAuth.request("/api/account", {
      settings: {
        detectPersonal: preferences.includePersonalData,
        detectCredentials: preferences.includeCredentials,
        detectFinancial: preferences.includeFinancialData,
        scanMode: preferences.scanMode,
        customTerms: preferences.customTerms
      }
    }, "POST").catch(() => undefined);
  };
  document.addEventListener("redaxa:account", (event) => {
    accountState = (event as CustomEvent<AccountState | null>).detail;
    const wasOn = trialOn();
    trialAccount = accountState;
    if (trialOn() !== wasOn) applyLanguage(); else renderPlanStatus();
    if (accountState?.settings) applySyncedSettings(accountState.settings);
    void loadServerActivity();
    void loadOrgActivity();
  });
  // The account event can fire before entitlement is known (hasAccess() still
  // false), and there is no later event on some sign-in paths — poll briefly
  // instead of missing the load.
  for (const delay of [2000, 5000, 10_000]) setTimeout(() => { void loadServerActivity(); void loadOrgActivity(); if (!orgCache) void loadOrganization(); }, delay);

  const metricChecked = document.querySelector<HTMLElement>("#metric-checked");
  const metricItems = document.querySelector<HTMLElement>("#metric-items");
  const metricTop = document.querySelector<HTMLElement>("#metric-top");
  const metricLast = document.querySelector<HTMLElement>("#metric-last");

  const relativeTime = (iso: string): string => {
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    const formatter = new Intl.RelativeTimeFormat(preferences.language, { numeric: "auto" });
    if (Math.abs(minutes) < 60) return formatter.format(-minutes, "minute");
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return formatter.format(-hours, "hour");
    return formatter.format(-Math.round(hours / 24), "day");
  };

  const renderHistory = (): void => {
    const history = readHistory();
    const visible = history.slice(0, 8);
    historyRoot.replaceChildren();
    if (visible.length) {
      for (const entry of visible) {
        const article = document.createElement("article");
        article.className = "entry";
        article.dataset.id = entry.id;
        article.tabIndex = 0;
        article.setAttribute("role", "button");
        article.setAttribute("aria-expanded", "false");

        const summary = document.createElement("strong");
        summary.textContent = plural(words().itemsReviewed, entry.findings);
        const preview = document.createElement("span");
        preview.textContent = entry.preview;
        const timestamp = document.createElement("em");
        timestamp.textContent = dateTime(entry.createdAt);
        const detail = document.createElement("div");
        detail.className = "entry-detail";
        const breakdown = Object.entries(entry.byKind).map(([kind, n]) => `${labels()[kind] ?? kind} × ${n}`).join(", ");
        detail.textContent = breakdown || words().nothingFlagged;
        article.append(summary, preview, timestamp, detail);
        historyRoot.append(article);
      }
    } else {
      const empty = document.createElement("div");
      empty.className = "entry";
      const title = document.createElement("strong");
      title.textContent = words().noChecksYet;
      const copy = document.createElement("span");
      copy.textContent = words().lastEightWillAppear;
      empty.append(title, copy);
      historyRoot.append(empty);
    }

    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weekly = history.filter((entry) => new Date(entry.createdAt).getTime() >= weekAgo);

    // Empty bar charts and zeroed metric tiles say nothing; hide the whole
    // activity body until there is at least one check to describe.
    const hasHistory = history.length > 0;
    activityEmpty.hidden = hasHistory;
    activityBody.hidden = !hasHistory;
    if (!hasHistory) { renderOnboarding(); return; }

    const totals: Record<string, number> = {};
    for (const entry of weekly) for (const [kind, n] of Object.entries(entry.byKind)) totals[kind] = (totals[kind] ?? 0) + n;
    const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const max = rows.length ? rows[0][1] : 0;
    analyticsRoot.innerHTML = rows.map(([kind, n]) => `<div class="analytics-row"><span class="analytics-label">${escapeHtml(labels()[kind] ?? kind)}</span><div class="analytics-track"><div class="analytics-fill" style="width:${Math.max(6, Math.round((n / max) * 100))}%"></div></div><span class="analytics-value">${n}</span></div>`).join("");

    if (metricChecked) metricChecked.textContent = String(weekly.length);
    if (metricItems) metricItems.textContent = String(weekly.reduce((sum, entry) => sum + entry.findings, 0));
    if (metricTop) metricTop.textContent = rows.length ? (labels()[rows[0][0]] ?? rows[0][0]) : "—";
    if (metricLast) metricLast.textContent = history[0] ? relativeTime(history[0].createdAt) : "—";
    renderOnboarding();
  };

  const updateCharacterCount = (): void => {
    characterCount.innerHTML = `<strong>${num(prompt.value.length)}</strong> / ${num(maxPromptLength)}`;
  };
  let scanInFlight = false;
  const syncScanButton = (): void => { scanButton.disabled = scanInFlight || !prompt.value.trim(); };
  // Derived from the textarea contents rather than tracked in a variable, so
  // the selected chip clears itself as soon as the user edits or replaces the
  // sample, instead of lying about what is in the box.
  const sampleChips = Array.from(document.querySelectorAll<HTMLButtonElement>(".sample-chip"));
  const syncChipSelection = (): void => {
    sampleChips.forEach((chip) => {
      const sample = samplePrompts[chip.dataset.sample ?? ""];
      chip.setAttribute("aria-pressed", String(Boolean(sample) && sample === prompt.value));
    });
  };

  // Kept out of scan() so a language switch can re-render an on-screen result
  // without re-running the check.
  let lastResult: { findings: Finding[]; redactedText: string; sourceText: string; decision?: ScanDecision } | null = null;

  // Shows the user's own text with each detected value marked, so the result
  // answers "where in my prompt?" and not just "how many". Honours the
  // "show the detected value on screen" preference.
  const buildSnippet = (source: string, findings: Finding[]): string => {
    const ranges: { start: number; end: number; severity: FindingSeverity }[] = [];
    for (const finding of findings) {
      if (!finding.value) continue;
      let from = 0;
      for (;;) {
        const at = source.indexOf(finding.value, from);
        if (at === -1) break;
        if (!ranges.some((range) => at < range.end && at + finding.value.length > range.start)) {
          ranges.push({ start: at, end: at + finding.value.length, severity: severityOf(finding) });
          break;
        }
        from = at + 1;
      }
    }
    if (!ranges.length) return "";
    ranges.sort((a, b) => a.start - b.start);

    // Long prompts are windowed around the first detection so the marked text
    // stays the visible part instead of scrolling off the bottom.
    const windowSize = 420;
    let offset = 0;
    let text = source;
    if (source.length > windowSize) {
      offset = Math.max(0, ranges[0].start - 60);
      text = source.slice(offset, offset + windowSize);
    }
    const visible = ranges
      .map((range) => ({ start: range.start - offset, end: range.end - offset, severity: range.severity }))
      .filter((range) => range.start >= 0 && range.end <= text.length);

    let html = offset > 0 ? "… " : "";
    let cursor = 0;
    for (const range of visible) {
      html += escapeHtml(text.slice(cursor, range.start));
      const raw = text.slice(range.start, range.end);
      html += `<mark class="sev-${range.severity}">${escapeHtml(preferences.showRawValues ? raw : "•".repeat(Math.min(10, raw.length)))}</mark>`;
      cursor = range.end;
    }
    html += escapeHtml(text.slice(cursor));
    if (offset + text.length < source.length) html += " …";
    return html;
  };
  const renderRiskCopy = (): void => {
    if (!lastResult) return;
    const level = riskLevel(lastResult.findings);
    const n = lastResult.findings.length;
    riskBanner.className = `risk-banner risk-${level}`;
    count.textContent = level === "none" ? "✓" : String(n);
    title.textContent = level === "high" ? words().riskHigh : level === "medium" ? words().riskMedium : words().riskNone;
    // When the policy layer supplied a decision, its human-written reason is
    // more specific than the generic level copy — show it instead.
    const reason = n > 0 ? lastResult.decision?.decidedBy?.reason : undefined;
    copy.textContent = reason ?? (level === "high" ? plural(words().actionHigh, n)
      : level === "medium" ? plural(words().actionMedium, n)
      : words().actionNone);

    const snippet = buildSnippet(lastResult.sourceText, lastResult.findings);
    resultSnippet.innerHTML = snippet;
    resultSnippet.hidden = !snippet;
    snippetLabel.hidden = !snippet;

    // Grouped by what a leak would cost, worst first. Each group says so in
    // words and with its own icon, not with colour alone.
    const shorten = (value: string): string => value.length > 42 ? `${value.slice(0, 20)}…${value.slice(-14)}` : value;
    const bySeverity = new Map<FindingSeverity, Finding[]>();
    for (const finding of lastResult.findings) {
      const severity = severityOf(finding);
      bySeverity.set(severity, [...(bySeverity.get(severity) ?? []), finding]);
    }
    const severityKey: Record<FindingSeverity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
    findingsRoot.innerHTML = severityOrder.filter((severity) => bySeverity.has(severity)).map((severity) => {
      const items = bySeverity.get(severity)!;
      const rows = items.map((finding) => {
        const shown = preferences.showRawValues ? escapeHtml(shorten(finding.value)) : `<em>${escapeHtml(words().sensitiveValueHidden)}</em>`;
        const context = finding.credential;
        const advice = context ? `<details class="credential-advice"><summary>${escapeHtml(context.service + " · " + context.type)}</summary><p>${escapeHtml(context.evidence)}</p><p>${escapeHtml(context.response + ": " + context.guidance)}</p></details>` : "";
        return `<li class="fitem"><span class="fkind">${escapeHtml(labels()[finding.kind] ?? finding.kind)}</span><code>${shown}</code><span class="arrow" aria-hidden="true">→</span><span class="repl">${escapeHtml(finding.replacement.replace("$1$2", ""))}</span>${advice}</li>`;
      }).join("");
      const key = severityKey[severity];
      return `<section class="fgroup sev-${severity}" aria-label="${escapeHtml(words()[`sev${key}`])}"><div class="fgroup-head">${severityIcons[severity]}<b>${escapeHtml(words()[`sev${key}`])}</b><span class="fgroup-hint">${escapeHtml(words()[`sev${key}Hint`])}</span><span class="fgroup-count">${items.length}</span></div><ul>${rows}</ul></section>`;
    }).join("");
    safeRoot.style.display = n ? "block" : "none";
    resultsFoot.hidden = !n;
  };

  const showResults = (): void => {
    required<HTMLElement>("#res-empty").hidden = true;
    resPreview.hidden = true;
    resLive.hidden = false;
    riskBanner.hidden = false;
    document.getElementById("pwa-install")?.classList.add("promoted");
  };

  // After a check the answer must be on screen without hunting for it. On the
  // two-column layout the whole analysis area is brought into view; in one
  // column the results panel itself is, since it sits below the input. Focus
  // then moves to the "Results" heading so keyboard and screen-reader users
  // land on the new content rather than staying in the textarea.
  const revealResults = (): void => {
    avoidCornerOverlap();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const singleColumn = getComputedStyle(workspace).gridTemplateColumns.split(" ").length === 1;
    const target = singleColumn ? resultsCard : workspace;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    resultsScroll.scrollTop = 0;
    resultsTitle.focus({ preventScroll: true });
    // scrollIntoView's own motion doesn't reliably raise a 'scroll' event in
    // every embedding context, so the corner-overlap measurement above (taken
    // before the scroll) can go stale once the smooth scroll settles. Re-check
    // once the animation has had time to finish, in addition to the ordinary
    // scroll listener.
    window.setTimeout(avoidCornerOverlap, reduceMotion ? 50 : 450);
  };

  const scan = async (): Promise<void> => {
    if (scanInFlight) return;
    if (!prompt.value.trim()) { prompt.focus(); return; }
    // Visitors and accounts without a plan get the free daily checks; the
    // server counts them (anonymousDailyScans in api/scan.ts) and answers
    // TRIAL_REQUIRED when they are spent, which opens the account dialog
    // below. Gating here bounced the first real check off a signup form.
    if (prompt.value.length > maxPromptLength) {
      showResults();
      lastResult = null;
      riskBanner.className = "risk-banner risk-medium";
      count.textContent = "!";
      title.textContent = words().promptTooLong;
      copy.textContent = format(words().keepUnder, { max: num(maxPromptLength) });
      findingsRoot.innerHTML = "";
      resultSnippet.hidden = true;
      snippetLabel.hidden = true;
      safeRoot.style.display = "none";
      resultsFoot.hidden = true;
      revealResults();
      return;
    }
    const sourceText = prompt.value;
    scanInFlight = true;
    scanButton.disabled = true;
    scanButton.setAttribute("aria-busy", "true");
    clearPrompt.disabled = true; required<HTMLButtonElement>("#clear-results").disabled = true;
    scanButton.textContent = words().checking;
    try {
      const scanned = await window.promptShieldAuth!.scanPrompt(sourceText, preferences);
      track("scan_success");
      const result = storeResult(sourceText, scanned.findings, scanned.redactedText, preferences);
      lastResult = { findings: result.findings, redactedText: result.redactedText, sourceText, decision: scanned.decision };
      showResults();
      renderRiskCopy();
      redacted.textContent = result.redactedText;
      renderHistory();
      revealResults();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "TRIAL_REQUIRED") {
        track("trial_gate");
        window.promptShieldAuth?.requestAccess(words().startTrialToInspect);
      } else {
        showResults();
        lastResult = null;
        riskBanner.className = "risk-banner risk-medium";
        count.textContent = "!";
        title.textContent = words().checkFailed;
        copy.textContent = words().couldNotRunCheck;
        findingsRoot.innerHTML = "";
        resultSnippet.hidden = true;
        snippetLabel.hidden = true;
        safeRoot.style.display = "none";
        resultsFoot.hidden = true;
        revealResults();
      }
    } finally {
      scanInFlight = false;
      scanButton.removeAttribute("aria-busy");
      clearPrompt.disabled = false; required<HTMLButtonElement>("#clear-results").disabled = false;
      scanButton.textContent = words().scan;
      syncScanButton();
    }
  };

  scanButton.addEventListener("click", () => { void scan(); });
  prompt.addEventListener("input", () => { updateCharacterCount(); syncScanButton(); syncChipSelection(); });
  prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void scan(); }
  });
  const kbdKey = document.querySelector<HTMLElement>("#kbd-key");
  if (kbdKey && /Mac|iPhone|iPad/.test(navigator.userAgent)) kbdKey.textContent = "⌘";

  sampleChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const sample = samplePrompts[chip.dataset.sample ?? ""];
      if (!sample) return;
      prompt.value = sample;
      updateCharacterCount();
      syncScanButton();
      syncChipSelection();
      prompt.focus();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-preview]').forEach(button => {
    button.addEventListener('click', () => {
      const credential = button.dataset.preview === 'credential';
      document.querySelectorAll('[data-preview]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      required('.compare-original').innerHTML = credential ? 'Connect with API_KEY=<mark>example-key-not-real</mark>.' : 'Hi <mark>Marco Rossi</mark>, send the invoice to <mark>m.rossi@acme.com</mark>.';
      required('.compare-redacted').innerHTML = credential ? 'Connect with API_KEY=<em>[CREDENTIAL]</em>.' : 'Hi <em>[NAME]</em>, send the invoice to <em>[EMAIL]</em>.';
      required<HTMLButtonElement>('#preview-use').dataset.sample = credential ? 'apikey' : 'email';
    });
  });

  void enableDesktopCompanion((clipboardText) => {
    prompt.value = clipboardText;
    updateCharacterCount();
    syncScanButton();
    syncChipSelection();
    void scan();
  });
  const clearPromptResult = (): void => {
    lastResult = null; redacted.textContent = ""; resultSnippet.replaceChildren(); findingsRoot.replaceChildren();
    resLive.hidden = true; resPreview.hidden = true; required<HTMLElement>("#res-empty").hidden = false;
  };
  required("#clear-results").addEventListener("click", clearPromptResult);
  clearPrompt.addEventListener("click", () => {
    clearPromptResult();
    prompt.value = "";
    updateCharacterCount();
    syncScanButton();
    syncChipSelection();
    prompt.focus();
  });
  required("#clear-local-activity").addEventListener("click", () => { clearHistory(); renderHistory(); });
  clearHistoryButton.addEventListener("click", () => {
    clearHistory();
    renderHistory();
  });
  const toggleEntry = (entry: HTMLElement): void => {
    entry.setAttribute("aria-expanded", String(entry.classList.toggle("open")));
  };
  historyRoot.addEventListener("click", (event) => {
    const entry = (event.target as HTMLElement).closest<HTMLElement>(".entry[data-id]");
    if (entry) toggleEntry(entry);
  });
  historyRoot.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const entry = (event.target as HTMLElement).closest<HTMLElement>(".entry[data-id]");
    if (entry) { event.preventDefault(); toggleEntry(entry); }
  });

  required<HTMLButtonElement>("#save-preferences").addEventListener("click", () => {
    preferences.language = ["en", "it", "es", "fr", "de"].includes(languageSelect.value) ? languageSelect.value as Language : "en";
    preferences.scanMode = scanModeSelect.value === "strict" ? "strict" : "standard";
    preferences.includePersonalData = personalToggle.checked;
    preferences.includeCredentials = credentialToggle.checked;
    preferences.includeFinancialData = financialToggle.checked;
    preferences.saveHistory = historyToggle.checked;
    preferences.showRawValues = rawValueToggle.checked;
    preferences.autoClearAfterCopy = clearAfterCopyToggle.checked;
    savePreferences(preferences);
    pushSyncedSettings();
    applyLanguage();
    flash(required<HTMLElement>("#prefs-status"), words().prefsSaved);
  });
  required<HTMLButtonElement>("#save-terms").addEventListener("click", () => {
    preferences.customTerms = customTermsInput.value.split(/\r?\n/).map((term) => term.trim()).filter(Boolean).slice(0, 30);
    customTermsInput.value = preferences.customTerms.join("\n");
    savePreferences(preferences);
    pushSyncedSettings();
    renderTermsCount();
    renderOnboarding();
    flash(required<HTMLElement>("#terms-status"), words().termsSaved);
  });

  required<HTMLButtonElement>("#copy").addEventListener("click", async () => {
    const button = required<HTMLButtonElement>("#copy");
    await navigator.clipboard.writeText(redacted.textContent ?? "");
    button.textContent = words().copied;
    if (preferences.autoClearAfterCopy) {
      prompt.value = "";
      updateCharacterCount();
      syncScanButton();
      syncChipSelection();
    }
    window.setTimeout(() => { button.textContent = words().copySafer; }, 1400);
  });

  if (readHistory().length) document.getElementById("pwa-install")?.classList.add("promoted");
  updateCharacterCount();
  syncScanButton();
  syncChipSelection();
  applyLanguage();
  // Prices and the trial switch arrive after the first paint; the page redraws once they do.
  void loadPrices().then((next) => { if (next) { prices = next; applyLanguage(); } });
  // The server refused a trial the page offered (used elsewhere in the meantime): say so on the plan.
  document.addEventListener("redaxa:trial-unavailable", (event) => {
    const plan = (event as CustomEvent<{ plan?: string }>).detail?.plan === "business" ? "business" : "personal";
    const note = planCard(plan).querySelector<HTMLElement>(".plan-choice-note");
    if (note) { note.textContent = trialWords().trialUsed; note.hidden = false; }
  });
  avoidCornerOverlap();
  if (!showView(location.hash, false)) showView("", false);
}

type ScanRequestOptions = { includePersonalData?: boolean; includeCredentials?: boolean; includeFinancialData?: boolean; customTerms?: string[] };
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
      email(): string | null;
      signOut(): Promise<void>;
    };
  }
}

if (typeof document !== "undefined") mountDashboard();
