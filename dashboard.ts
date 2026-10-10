import type { Finding, FindingSeverity, ScanOptions } from "./scanner.js";
import type { AccountState } from "./auth.js";
import { enableAppShell } from "./pwa.js";
import { track } from "./growth.js";
import { enableDesktopCompanion, openSupportEmail } from "./desktop.js";
import { PROMO_WORDS_EN, euro, mountPromo, promoPriceHtml, type PromoView, type PromoWords } from "./promo.js";

type HistoryEntry = { id: string; createdAt: string; findings: number; preview: string; byKind: Record<string, number> };
type Language = "en" | "it" | "es" | "fr" | "de";
import { themes, restoreTheme, applyTheme, defaultTheme, type ThemeName } from "./themes.js";
type Preferences = ScanOptions & { language: Language; theme: ThemeName; scanMode: "standard" | "strict"; saveHistory: boolean; autoClearAfterCopy: boolean; showRawValues: boolean; customTerms: string[] };
type RiskLevel = "none" | "medium" | "high";

const storageKey = "redaxa.personal-history.v1";
const preferencesKey = "redaxa.personal-preferences.v1";
const maxPromptLength = 10_000;

const defaultPreferences: Preferences = { language: "en", theme: "violet", scanMode: "standard", includePersonalData: true, includeCredentials: true, includeFinancialData: true, saveHistory: true, autoClearAfterCopy: false, showRawValues: true, customTerms: [] };

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
    fine: "I prezzi barrati sono i più bassi dei 30 giorni prima dell'offerta. Solo per nuovi abbonamenti; i rinnovi sono al prezzo normale e i nuovi abbonati idonei iniziano comunque con la prova di 7 giorni. Prezzi IVA esclusa.",
    thenMonth: "Primo mese, poi {price} al mese",
    thenYear: "Primo anno, poi {price} all'anno",
    thenUserMonth: "Primo mese, poi {price} per utente al mese",
    thenUserYear: "Primo anno, poi {price} per utente all'anno",
    perMonth: "/ mese", perYear: "/ anno", perUserMonth: "/ utente / mese", perUserYear: "/ utente / anno",
  },
  es: {
    kicker: "Oferta de Halloween",
    lead: "Al menos un {percent} de descuento en el primer mes o el primer año.",
    ends: "Termina el {date}.",
    endsIn: "Termina en",
    units: ["Días", "Horas", "Minutos", "Segundos"],
    fine: "Los precios tachados son los más bajos de los 30 días previos a la oferta. Solo para nuevas suscripciones; las renovaciones se cobran al precio habitual y los nuevos suscriptores que cumplan los requisitos siguen empezando con la prueba de 7 días. Precios sin IVA.",
    thenMonth: "Primer mes, luego {price} al mes",
    thenYear: "Primer año, luego {price} al año",
    thenUserMonth: "Primer mes, luego {price} por usuario al mes",
    thenUserYear: "Primer año, luego {price} por usuario al año",
    perMonth: "/ mes", perYear: "/ año", perUserMonth: "/ usuario / mes", perUserYear: "/ usuario / año",
  },
  fr: {
    kicker: "Offre d'Halloween",
    lead: "Au moins {percent} de réduction sur le premier mois ou la première année.",
    ends: "Se termine le {date}.",
    endsIn: "Se termine dans",
    units: ["Jours", "Heures", "Minutes", "Secondes"],
    fine: "Les prix barrés sont nos plus bas des 30 jours précédant l'offre. Nouveaux abonnements uniquement ; les renouvellements se font au prix normal et les nouveaux abonnés éligibles commencent toujours par l'essai de 7 jours. Prix hors TVA.",
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
    fine: "Durchgestrichene Preise sind unsere niedrigsten der 30 Tage vor dem Angebot. Nur für neue Abos; Verlängerungen erfolgen zum regulären Preis, und berechtigte neue Abonnenten starten weiterhin mit der 7-tägigen Testphase. Preise ohne MwSt.",
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
    createAccountTrial: "Create an account to choose a plan and keep checking.", startTrialToInspect: "Today's 5 free checks are used up. Choose a plan to keep going; new subscribers get a 7-day trial.",
    usageLabel: "Checks this week", freeTrialBadge: "Go further with Pro", freeTrialDesc: "Prompt checks, protected terms, and local repository reviews on Windows.", seePlans: "Compare plans →",
    zeroRetentionDesc: "Prompts are checked, never stored or logged.", createAccountBtn: "Create account", protectionActive: "Review before sharing",
    onboardCheckTitle: "Run your first check", onboardCheckDesc: "Paste a prompt and check it once.",
    onboardTermsTitle: "Add a custom term", onboardTermsDesc: "Protect a client or project name in Preferences.",
    onboardThemeTitle: "Pick a theme", onboardThemeDesc: "Make the workspace yours in Preferences.",
    activityTitle: "Your activity", activityEmpty: "Your privacy activity will appear here after your first check.", last7: "Last 7 days", byType: "By detection type",
    metricChecked: "Prompts checked", metricItems: "Sensitive items found", metricTop: "Most common detection", metricLast: "Last check",
    plansTitle: "Plans & pricing", plansIntro: "7-day trial for eligible new subscribers. Card required; cancel before the trial ends to avoid a charge. Pro is the new name for Personal, at the same price.",
    personalTag: "Your everyday privacy toolkit", personalName: "Pro", personalDesc: "Review sensitive data in your prompts and repositories, with clear findings and practical next steps.",
    startTrial: "Continue to checkout", yearlyPersonal: "€79.90 yearly",
    businessTag: "For teams · up to 3 users", businessName: "Business", businessDesc: "Everything in Pro, plus shared protected terms, category policies and metadata-only activity for your team.",
    seatsLabel: "Seats", seat1: "1 user", seat2: "2 users", seat3: "3 users", yearlyBusiness: "€149.90 yearly / user",
    manageTag: "Already subscribed?", manageTitle: "Manage billing", manageDesc: "Update your payment method, download invoices, or cancel renewal whenever you need to.", manageBtn: "Manage subscription",
    teamTitle: "Team", teamSeatsUsed: "{used} of {total} seats used.", inviteCreate: "Create invite link", copyLink: "Copy link", noInvites: "No invites yet.", teammateJoined: "Teammate joined", invitePending: "Invite pending", revoke: "Revoke", removeTeammate: "Remove", couldNotRemoveTeammate: "We could not remove this teammate or invite.", couldNotCreateInvite: "We could not create an invite.",
    orgTitle: "Organization", orgIntro: "Shared protection for your whole workspace. Protected terms apply to every member's checks, on every device.", orgMembersLabel: "Members", orgTermsLabel: "Protected terms", orgTermsHint: "Project codenames, client names — flagged in every member's prompts.", orgTermAdd: "Add", orgTermPlaceholder: "e.g. Project Falcon", orgRoleOwner: "Owner", orgRoleAdmin: "Admin", orgRoleMember: "Member", orgYou: "you", orgRenameSave: "Save name", orgNoTerms: "No protected terms yet.", orgRemove: "Remove", acctActivity: "Across your account — all devices", orgActivity: "Organization activity", orgChecks: "Team checks", orgFlagged: "Flagged", orgBlocked: "Blocked", orgTopCat: "Top category", orgByMember: "By member", orgExport: "Export CSV (metadata only)", auditFrom: "From", auditTo: "To", auditRange: "Range", auditShowing: "Showing the most recent {shown} of {total} in this range. The export covers the whole range.", auditComplete: "{total} event(s) in this range.", orgPoliciesLabel: "Policies", orgPoliciesHint: "What happens when a category is found in a member's prompt. Block prevents sending from the extension until fixed.", polDefault: "Default", polWarn: "Warn", polRedact: "Redact", polBlock: "Block", catPersonal: "Personal data", catCredentials: "Credentials", catFinancial: "Financial data", catCustom: "Protected terms", sevAny: "any severity",
    previewBadge: "Preview", previewLabel: "example result — not your prompt", planNone: "Free checks", planNoneNote: "5 checks a day, no card needed. Pro removes the limit; new subscribers get a 7-day trial.", planTrial: "Free trial", planTrialNote: "Unlimited checks during the trial. Choose a plan to keep them after it ends.", planActive: "Active plan", planActiveNote: "Unlimited checks and your protected terms are on.", planDayOf: "Day {day} of {total}", planEndsToday: "Ends today", planDaysLeft: "{n} day left|{n} days left", foundInPrompt: "Found in your prompt"
  },
  it: {
    textMode: "Testo per AI", textModeNote: "Rimuovi i dettagli privati prima di inviare", repoMode: "Repository GitHub", repoModeNote: "Chiavi esposte e dipendenze vulnerabili · gratis", stepInput: "Aggiungi il testo", stepReview: "Rivedi i risultati", stepCopy: "Copia una versione più sicura", previewHeadline: "Scopri cosa resta privato.", previewExplain: "Un esempio del testo da condividere dopo la rimozione dei dati.", compareAction: "Mostra versione oscurata", sampleLead: "Inizia con un esempio",
    workspace: "Spazio di lavoro", privateCheck: "Controlla un prompt", recent: "Controlli recenti", account: "Account", plans: "Piani e prezzi", preferences: "Impostazioni",
    eyebrow: "Spazio personale", title: "Controllo prompt", subtitle: "Rivedi i dati sensibili prima della tua prossima conversazione con l’AI.",
    scan: "Controlla prompt →", clear: "Svuota", history: "Controlli locali recenti", clearHistory: "Cancella cronologia",
    placeholder: "es. Scrivi una risposta a Marco Rossi (m.rossi@acme.com) sulla fattura ACME — il mio numero diretto è +39 02 5555 0180",
    composerTitle: "Controlla il prompt prima di condividerlo con l'AI", composerSub: "Incolla qualsiasi cosa tu stia per inviare a ChatGPT, Claude, Gemini o Copilot.", promptLabel: "Prompt da controllare",
    tryLabel: "Prova un esempio", sampleBrief: "Brief cliente", sampleApiKey: "Chiave API", sampleEmail: "Bozza email", samplePersonal: "Dati personali",
    metaLabel: "Controllo privato — il prompt non viene mai salvato né registrato.", howPrivacyWorks: "Come funziona la privacy", interfaceLanguage: "Lingua dell'interfaccia",
    scanModeStandard: "Standard — controlli bilanciati", scanModeStrict: "Rigorosa — modalità di revisione attenta",
    resultsTitle: "Risultati", previewItems: "3 elementi sensibili in questo prompt",
    redactBeforeSharing: "Rimuovi i dati prima di condividere", previewFoot: "Incolla il tuo prompt per eseguire un controllo reale.", detectsLabel: "Rileva anche",
    riskHigh: "Rischio alto", riskMedium: "Rivedi prima di condividere", riskNone: "Nessun rischio rilevato",
    actionHigh: "{n} elemento sensibile trovato. Sostituiscilo o copia la versione sicura qui sotto.|{n} elementi sensibili trovati. Sostituiscili o copia la versione sicura qui sotto.",
    actionMedium: "{n} elemento da rivedere prima di condividere il prompt.|{n} elementi da rivedere prima di condividere il prompt.",
    actionNone: "Nessun problema evidente. Questo è un segnale utile, non una garanzia.",
    checking: "Controllo in corso…", promptTooLong: "Il prompt è troppo lungo", keepUnder: "Resta entro {max} caratteri per un controllo.",
    checkFailed: "Controllo non riuscito", couldNotRunCheck: "Non è stato possibile eseguire il controllo. Riprova.",
    sensitiveValueHidden: "Valore nascosto", saferVersion: "Versione sicura", copySafer: "Copia il prompt sicuro", copied: "Copiato",
    readyToInspect: "Pronto per il controllo", willCheckFor: "Controlleremo i dati personali e i segreti più comuni.",
    noChecksYet: "Nessun controllo ancora", lastEightWillAppear: "Qui compariranno i riepiloghi degli ultimi otto controlli.", nothingFlagged: "Nulla segnalato in questo controllo.",
    itemsReviewed: "{n} elemento esaminato|{n} elementi esaminati",
    createAccountTrial: "Crea un account per scegliere un piano e controllare i prompt.", startTrialToInspect: "Hai usato i 5 controlli gratuiti di oggi. Scegli un piano per continuare; i nuovi abbonati idonei hanno 7 giorni di prova.",
    usageLabel: "Controlli questa settimana", freeTrialBadge: "Più chiarezza con Pro", freeTrialDesc: "Controlli dei prompt, termini protetti e analisi locali dei repository su Windows.", seePlans: "Confronta i piani →",
    zeroRetentionDesc: "I prompt vengono controllati, mai salvati né registrati.", createAccountBtn: "Crea account", protectionActive: "Rivedi prima di condividere",
    onboardCheckTitle: "Esegui il tuo primo controllo", onboardCheckDesc: "Incolla un prompt e controllalo una volta.",
    onboardTermsTitle: "Aggiungi un termine personalizzato", onboardTermsDesc: "Proteggi il nome di un cliente o progetto nelle Impostazioni.",
    onboardThemeTitle: "Scegli un tema", onboardThemeDesc: "Rendi personale lo spazio di lavoro nelle Impostazioni.",
    activityTitle: "La tua attività", activityEmpty: "La tua attività comparirà qui dopo il primo controllo.", last7: "Ultimi 7 giorni", byType: "Per tipo di rilevamento",
    metricChecked: "Prompt controllati", metricItems: "Elementi sensibili trovati", metricTop: "Rilevamento più frequente", metricLast: "Ultimo controllo",
    plansTitle: "Piani e prezzi", plansIntro: "Prova di 7 giorni per nuovi abbonati idonei. Carta richiesta: annulla prima della fine per evitare addebiti. Pro è il nuovo nome di Personal, allo stesso prezzo.",
    personalTag: "Per privati", personalName: "Pro", personalDesc: "Per professionisti indipendenti che usano l'AI con dati reali di clienti e informazioni personali.",
    startTrial: "Continua al pagamento", yearlyPersonal: "€79,90 all'anno",
    businessTag: "Per team · fino a 3 utenti", businessName: "Business", businessDesc: "Controlli di team e un confine di privacy chiaro per team in crescita. Scegli da uno a tre posti.",
    seatsLabel: "Posti", seat1: "1 utente", seat2: "2 utenti", seat3: "3 utenti", yearlyBusiness: "€149,90 all'anno / utente",
    manageTag: "Già abbonato?", manageTitle: "Gestisci fatturazione", manageDesc: "Aggiorna il metodo di pagamento, scarica le fatture o annulla il rinnovo quando vuoi.", manageBtn: "Gestisci abbonamento",
    teamTitle: "Team", teamSeatsUsed: "{used} di {total} posti utilizzati.", inviteCreate: "Crea link di invito", copyLink: "Copia link", noInvites: "Nessun invito ancora.", teammateJoined: "Collega entrato", invitePending: "Invito in sospeso", revoke: "Revoca", removeTeammate: "Rimuovi", couldNotRemoveTeammate: "Non è stato possibile rimuovere il collega o l’invito.", couldNotCreateInvite: "Non è stato possibile creare un invito.",
    orgTitle: "Organizzazione", orgIntro: "Protezione condivisa per tutto il workspace. I termini protetti valgono per i controlli di ogni membro, su ogni dispositivo.", orgMembersLabel: "Membri", orgTermsLabel: "Termini protetti", orgTermsHint: "Nomi in codice, nomi di clienti — segnalati nei prompt di ogni membro.", orgTermAdd: "Aggiungi", orgTermPlaceholder: "es. Progetto Falco", orgRoleOwner: "Proprietario", orgRoleAdmin: "Admin", orgRoleMember: "Membro", orgYou: "tu", orgRenameSave: "Salva nome", orgNoTerms: "Nessun termine protetto ancora.", orgRemove: "Rimuovi", acctActivity: "Sul tuo account — tutti i dispositivi", orgActivity: "Attività dell'organizzazione", orgChecks: "Controlli del team", orgFlagged: "Segnalati", orgBlocked: "Bloccati", orgTopCat: "Categoria principale", orgByMember: "Per membro", orgExport: "Esporta CSV (solo metadata)", auditFrom: "Dal", auditTo: "Al", auditRange: "Periodo", auditShowing: "Mostrati i {shown} più recenti su {total} nel periodo. L'esportazione copre tutto il periodo.", auditComplete: "{total} eventi nel periodo.", orgPoliciesLabel: "Policy", orgPoliciesHint: "Cosa succede quando una categoria viene trovata nel prompt di un membro. Blocca impedisce l'invio dall'estensione finché non correggi.", polDefault: "Predefinito", polWarn: "Avvisa", polRedact: "Redigi", polBlock: "Blocca", catPersonal: "Dati personali", catCredentials: "Credenziali", catFinancial: "Dati finanziari", catCustom: "Termini protetti", sevAny: "qualsiasi gravità",
    previewBadge: "Anteprima", previewLabel: "risultato di esempio — non il tuo prompt", planNone: "Controlli gratuiti", planNoneNote: "5 controlli al giorno senza carta. Scegli un piano per controlli illimitati; i nuovi abbonati idonei hanno 7 giorni di prova.", planTrial: "Prova gratuita", planTrialNote: "La prova include controlli illimitati. Aggiungi un piano per non interromperli.", planActive: "Piano attivo", planActiveNote: "Controlli illimitati e termini protetti personalizzati sono attivi.", planDayOf: "Giorno {day} di {total}", planEndsToday: "Scade oggi", planDaysLeft: "{n} giorno rimasto|{n} giorni rimasti", foundInPrompt: "Trovato nel tuo prompt"
  },
  es: {
    textMode: "Texto para IA", textModeNote: "Elimina detalles privados antes de enviar", repoMode: "Repositorio GitHub", repoModeNote: "Claves expuestas y dependencias vulnerables · gratis", stepInput: "Añade el texto", stepReview: "Revisa los resultados", stepCopy: "Copia una versión más segura", previewHeadline: "Mira qué se mantiene privado.", previewExplain: "Un ejemplo del texto que podrías compartir sin datos sensibles.", compareAction: "Mostrar versión redactada", sampleLead: "Empieza con un ejemplo",
    workspace: "Espacio de trabajo", privateCheck: "Revisar un prompt", recent: "Revisiones recientes", account: "Cuenta", plans: "Planes y precios", preferences: "Preferencias",
    eyebrow: "Espacio personal", title: "Revisión de prompts", subtitle: "Revisa un prompt antes de enviarlo a una herramienta de IA.",
    scan: "Revisar prompt →", clear: "Limpiar", history: "Revisiones locales recientes", clearHistory: "Borrar historial",
    placeholder: "p. ej. Redacta una respuesta a Marco Rossi (m.rossi@acme.com) sobre la factura de ACME — mi línea directa es +39 02 5555 0180",
    composerTitle: "Revisa tu prompt antes de compartirlo con la IA", composerSub: "Pega lo que estés a punto de enviar a ChatGPT, Claude, Gemini o Copilot.", promptLabel: "Prompt para revisar",
    tryLabel: "Prueba un ejemplo", sampleBrief: "Brief de cliente", sampleApiKey: "Clave API", sampleEmail: "Borrador de correo", samplePersonal: "Datos personales",
    metaLabel: "Revisión privada — tu prompt nunca se guarda ni se registra.", howPrivacyWorks: "Cómo funciona la privacidad", interfaceLanguage: "Idioma de la interfaz",
    scanModeStandard: "Estándar — revisiones equilibradas", scanModeStrict: "Estricto — modo de revisión cuidadosa",
    resultsTitle: "Resultados", previewItems: "3 elementos sensibles en este prompt",
    redactBeforeSharing: "Oculta los datos antes de compartir", previewFoot: "Pega tu propio prompt para hacer una revisión real.", detectsLabel: "También detecta",
    riskHigh: "Riesgo alto", riskMedium: "Revisa antes de compartir", riskNone: "Sin riesgos detectados",
    actionHigh: "{n} elemento sensible encontrado. Sustitúyelo o copia la versión segura de abajo.|{n} elementos sensibles encontrados. Sustitúyelos o copia la versión segura de abajo.",
    actionMedium: "{n} elemento para revisar antes de compartir este prompt.|{n} elementos para revisar antes de compartir este prompt.",
    actionNone: "No se encontró nada evidente. Esto es una señal útil, no una garantía.",
    checking: "Revisando…", promptTooLong: "El prompt es demasiado largo", keepUnder: "Mantenlo bajo {max} caracteres para poder revisarlo.",
    checkFailed: "La revisión falló", couldNotRunCheck: "No se pudo ejecutar esa revisión. Inténtalo de nuevo.",
    sensitiveValueHidden: "Valor oculto", saferVersion: "Versión segura", copySafer: "Copiar prompt seguro", copied: "Copiado",
    readyToInspect: "Listo para revisar", willCheckFor: "Comprobaremos los datos personales y secretos más comunes.",
    noChecksYet: "Aún no hay revisiones", lastEightWillAppear: "Aquí aparecerán los resúmenes de tus últimas ocho revisiones.", nothingFlagged: "Nada señalado en esta revisión.",
    itemsReviewed: "{n} elemento revisado|{n} elementos revisados",
    createAccountTrial: "Crea una cuenta para elegir un plan y revisar prompts.", startTrialToInspect: "Has usado las 5 revisiones gratuitas de hoy. Elige un plan para continuar; los nuevos suscriptores que cumplan los requisitos tienen 7 días de prueba.",
    usageLabel: "Revisiones esta semana", freeTrialBadge: "Qué desbloquea un plan", freeTrialDesc: "Revisiones ilimitadas, términos protegidos propios y hasta 3 puestos de equipo.", seePlans: "Comparar planes →",
    zeroRetentionDesc: "Los prompts se revisan, nunca se guardan ni se registran.", createAccountBtn: "Crear cuenta", protectionActive: "Revisa antes de compartir",
    onboardCheckTitle: "Haz tu primera revisión", onboardCheckDesc: "Pega un prompt y revísalo una vez.",
    onboardTermsTitle: "Añade un término personalizado", onboardTermsDesc: "Protege el nombre de un cliente o proyecto en Preferencias.",
    onboardThemeTitle: "Elige un tema", onboardThemeDesc: "Personaliza tu espacio de trabajo en Preferencias.",
    activityTitle: "Tu actividad", activityEmpty: "Tu actividad de privacidad aparecerá aquí después de tu primera revisión.", last7: "Últimos 7 días", byType: "Por tipo de detección",
    metricChecked: "Prompts revisados", metricItems: "Elementos sensibles encontrados", metricTop: "Detección más frecuente", metricLast: "Última revisión",
    plansTitle: "Planes y precios", plansIntro: "Prueba de 7 días para nuevos suscriptores elegibles. Se requiere tarjeta; cancela antes del final para evitar cargos. Pro es el nuevo nombre de Personal, al mismo precio.",
    personalTag: "Para particulares", personalName: "Pro", personalDesc: "Para profesionales independientes que usan IA con datos reales de clientes e información personal.",
    startTrial: "Continuar al pago", yearlyPersonal: "79,90 € al año",
    businessTag: "Para equipos · hasta 3 usuarios", businessName: "Business", businessDesc: "Controles de equipo y un límite de privacidad claro para equipos en crecimiento. Elige entre uno y tres puestos.",
    seatsLabel: "Puestos", seat1: "1 usuario", seat2: "2 usuarios", seat3: "3 usuarios", yearlyBusiness: "149,90 € al año / usuario",
    manageTag: "¿Ya estás suscrito?", manageTitle: "Gestionar facturación", manageDesc: "Actualiza tu método de pago, descarga facturas o cancela la renovación cuando quieras.", manageBtn: "Gestionar suscripción",
    teamTitle: "Equipo", teamSeatsUsed: "{used} de {total} puestos usados.", inviteCreate: "Crear enlace de invitación", copyLink: "Copiar enlace", noInvites: "Aún no hay invitaciones.", teammateJoined: "Compañero incorporado", invitePending: "Invitación pendiente", revoke: "Revocar", removeTeammate: "Eliminar", couldNotRemoveTeammate: "No se pudo eliminar el compañero o la invitación.", couldNotCreateInvite: "No se pudo crear la invitación.",
    orgTitle: "Organización", orgIntro: "Protección compartida para todo el espacio de trabajo. Los términos protegidos se aplican a los controles de cada miembro, en cada dispositivo.", orgMembersLabel: "Miembros", orgTermsLabel: "Términos protegidos", orgTermsHint: "Nombres en clave, nombres de clientes — señalados en los prompts de cada miembro.", orgTermAdd: "Añadir", orgTermPlaceholder: "p. ej. Proyecto Halcón", orgRoleOwner: "Propietario", orgRoleAdmin: "Admin", orgRoleMember: "Miembro", orgYou: "tú", orgRenameSave: "Guardar nombre", orgNoTerms: "Aún no hay términos protegidos.", orgRemove: "Quitar", acctActivity: "En tu cuenta — todos los dispositivos", orgActivity: "Actividad de la organización", orgChecks: "Controles del equipo", orgFlagged: "Señalados", orgBlocked: "Bloqueados", orgTopCat: "Categoría principal", orgByMember: "Por miembro", orgExport: "Exportar CSV (solo metadatos)", auditFrom: "Desde", auditTo: "Hasta", auditRange: "Periodo", auditShowing: "Mostrando los {shown} más recientes de {total} en este periodo. La exportación cubre todo el periodo.", auditComplete: "{total} evento(s) en este periodo.", orgPoliciesLabel: "Políticas", orgPoliciesHint: "Qué ocurre cuando se encuentra una categoría en el prompt de un miembro. Bloquear impide el envío desde la extensión hasta corregirlo.", polDefault: "Predeterminado", polWarn: "Avisar", polRedact: "Censurar", polBlock: "Bloquear", catPersonal: "Datos personales", catCredentials: "Credenciales", catFinancial: "Datos financieros", catCustom: "Términos protegidos", sevAny: "cualquier gravedad",
    previewBadge: "Vista previa", previewLabel: "resultado de ejemplo — no es tu prompt", planNone: "Revisiones gratuitas", planNoneNote: "5 revisiones al día sin tarjeta. Elige un plan para revisiones ilimitadas; los nuevos suscriptores elegibles tienen 7 días de prueba.", planTrial: "Prueba gratuita", planTrialNote: "Tu prueba incluye revisiones ilimitadas. Añade un plan para no interrumpirlas.", planActive: "Plan activo", planActiveNote: "Revisiones ilimitadas y términos protegidos propios están activos.", planDayOf: "Día {day} de {total}", planEndsToday: "Termina hoy", planDaysLeft: "Queda {n} día|Quedan {n} días", foundInPrompt: "Encontrado en tu prompt"
  },
  fr: {
    textMode: "Texte pour IA", textModeNote: "Retirez les détails privés avant envoi", repoMode: "Dépôt GitHub", repoModeNote: "Clés exposées et dépendances vulnérables · gratuit", stepInput: "Ajoutez votre texte", stepReview: "Examinez les résultats", stepCopy: "Copiez une version plus sûre", previewHeadline: "Voyez ce qui reste privé.", previewExplain: "Un exemple du texte à partager après masquage des données.", compareAction: "Afficher la version masquée", sampleLead: "Commencez par un exemple",
    workspace: "Espace de travail", privateCheck: "Vérifier un prompt", recent: "Vérifications récentes", account: "Compte", plans: "Offres et tarifs", preferences: "Préférences",
    eyebrow: "Espace personnel", title: "Vérification du prompt", subtitle: "Vérifiez un prompt avant de l’envoyer à un outil d’IA.",
    scan: "Vérifier le prompt →", clear: "Effacer", history: "Vérifications locales récentes", clearHistory: "Effacer l’historique",
    placeholder: "ex. Rédige une réponse à Marco Rossi (m.rossi@acme.com) au sujet de la facture ACME — ma ligne directe est le +39 02 5555 0180",
    composerTitle: "Vérifiez votre prompt avant de le partager avec l’IA", composerSub: "Collez ce que vous vous apprêtez à envoyer à ChatGPT, Claude, Gemini ou Copilot.", promptLabel: "Prompt à vérifier",
    tryLabel: "Essayez un exemple", sampleBrief: "Brief client", sampleApiKey: "Clé API", sampleEmail: "Brouillon d’e-mail", samplePersonal: "Données personnelles",
    metaLabel: "Vérification privée — votre prompt n’est jamais stocké ni enregistré.", howPrivacyWorks: "Comment fonctionne la confidentialité", interfaceLanguage: "Langue de l’interface",
    scanModeStandard: "Standard — vérifications équilibrées", scanModeStrict: "Stricte — mode de révision attentive",
    resultsTitle: "Résultats", previewItems: "3 éléments sensibles dans ce prompt",
    redactBeforeSharing: "Masquez les données avant de partager", previewFoot: "Collez votre propre prompt pour lancer une vraie vérification.", detectsLabel: "Détecte aussi",
    riskHigh: "Risque élevé", riskMedium: "Vérifiez avant de partager", riskNone: "Aucun risque détecté",
    actionHigh: "{n} élément sensible trouvé. Remplacez-le ou copiez la version sécurisée ci-dessous.|{n} éléments sensibles trouvés. Remplacez-les ou copiez la version sécurisée ci-dessous.",
    actionMedium: "{n} élément à vérifier avant de partager ce prompt.|{n} éléments à vérifier avant de partager ce prompt.",
    actionNone: "Rien d’évident trouvé. C’est un signal utile, pas une garantie.",
    checking: "Vérification…", promptTooLong: "Le prompt est trop long", keepUnder: "Restez sous {max} caractères pour une vérification.",
    checkFailed: "Échec de la vérification", couldNotRunCheck: "Impossible d’effectuer cette vérification. Réessayez.",
    sensitiveValueHidden: "Valeur masquée", saferVersion: "Version sécurisée", copySafer: "Copier le prompt sécurisé", copied: "Copié",
    readyToInspect: "Prêt à vérifier", willCheckFor: "Nous vérifierons les données personnelles et secrets courants.",
    noChecksYet: "Aucune vérification pour l’instant", lastEightWillAppear: "Le résumé de vos huit dernières vérifications apparaîtra ici.", nothingFlagged: "Rien signalé dans cette vérification.",
    itemsReviewed: "{n} élément examiné|{n} éléments examinés",
    createAccountTrial: "Créez un compte pour choisir une offre et vérifier des prompts.", startTrialToInspect: "Vous avez utilisé les 5 vérifications gratuites du jour. Choisissez une offre pour continuer ; les nouveaux abonnés éligibles bénéficient de 7 jours d’essai.",
    usageLabel: "Vérifications cette semaine", freeTrialBadge: "Ce qu’une offre débloque", freeTrialDesc: "Vérifications illimitées, termes protégés personnalisés et jusqu’à 3 postes d’équipe.", seePlans: "Comparer les offres →",
    zeroRetentionDesc: "Les prompts sont vérifiés, jamais stockés ni enregistrés.", createAccountBtn: "Créer un compte", protectionActive: "Review before sharing",
    onboardCheckTitle: "Effectuez votre première vérification", onboardCheckDesc: "Collez un prompt et vérifiez-le une fois.",
    onboardTermsTitle: "Ajoutez un terme personnalisé", onboardTermsDesc: "Protégez le nom d’un client ou d’un projet dans les Préférences.",
    onboardThemeTitle: "Choisissez un thème", onboardThemeDesc: "Personnalisez votre espace de travail dans les Préférences.",
    activityTitle: "Votre activité", activityEmpty: "Votre activité de confidentialité apparaîtra ici après votre première vérification.", last7: "7 derniers jours", byType: "Par type de détection",
    metricChecked: "Prompts vérifiés", metricItems: "Éléments sensibles trouvés", metricTop: "Détection la plus fréquente", metricLast: "Dernière vérification",
    plansTitle: "Offres et tarifs", plansIntro: "Essai de 7 jours pour les nouveaux abonnés éligibles. Carte requise ; annulez avant la fin pour éviter les frais. Pro est le nouveau nom de Personal, au même prix.",
    personalTag: "Pour les particuliers", personalName: "Pro", personalDesc: "Pour les professionnels indépendants qui utilisent l’IA avec de vraies données clients et personnelles.",
    startTrial: "Continuer vers le paiement", yearlyPersonal: "79,90 € par an",
    businessTag: "Pour les équipes · jusqu’à 3 utilisateurs", businessName: "Business", businessDesc: "Des contrôles d’équipe et une limite de confidentialité claire pour les équipes en croissance. Choisissez de un à trois postes.",
    seatsLabel: "Postes", seat1: "1 utilisateur", seat2: "2 utilisateurs", seat3: "3 utilisateurs", yearlyBusiness: "149,90 € par an / utilisateur",
    manageTag: "Déjà abonné ?", manageTitle: "Gérer la facturation", manageDesc: "Mettez à jour votre moyen de paiement, téléchargez vos factures ou annulez le renouvellement quand vous le souhaitez.", manageBtn: "Gérer l’abonnement",
    teamTitle: "Équipe", teamSeatsUsed: "{used} poste(s) utilisé(s) sur {total}.", inviteCreate: "Créer un lien d’invitation", copyLink: "Copier le lien", noInvites: "Aucune invitation pour l’instant.", teammateJoined: "Coéquipier ajouté", invitePending: "Invitation en attente", revoke: "Révoquer", removeTeammate: "Retirer", couldNotRemoveTeammate: "Impossible de retirer ce coéquipier ou cette invitation.", couldNotCreateInvite: "Impossible de créer une invitation.",
    orgTitle: "Organisation", orgIntro: "Une protection partagée pour tout l'espace de travail. Les termes protégés s'appliquent aux contrôles de chaque membre, sur chaque appareil.", orgMembersLabel: "Membres", orgTermsLabel: "Termes protégés", orgTermsHint: "Noms de code, noms de clients — signalés dans les prompts de chaque membre.", orgTermAdd: "Ajouter", orgTermPlaceholder: "ex. Projet Faucon", orgRoleOwner: "Propriétaire", orgRoleAdmin: "Admin", orgRoleMember: "Membre", orgYou: "vous", orgRenameSave: "Enregistrer le nom", orgNoTerms: "Aucun terme protégé pour l'instant.", orgRemove: "Retirer", acctActivity: "Sur votre compte — tous les appareils", orgActivity: "Activité de l'organisation", orgChecks: "Contrôles de l'équipe", orgFlagged: "Signalés", orgBlocked: "Bloqués", orgTopCat: "Catégorie principale", orgByMember: "Par membre", orgExport: "Exporter CSV (métadonnées uniquement)", auditFrom: "Du", auditTo: "Au", auditRange: "Période", auditShowing: "Affichage des {shown} plus récents sur {total} pour cette période. L'export couvre toute la période.", auditComplete: "{total} événement(s) sur cette période.", orgPoliciesLabel: "Politiques", orgPoliciesHint: "Ce qui se passe quand une catégorie est détectée dans le prompt d'un membre. Bloquer empêche l'envoi depuis l'extension jusqu'à correction.", polDefault: "Par défaut", polWarn: "Avertir", polRedact: "Caviarder", polBlock: "Bloquer", catPersonal: "Données personnelles", catCredentials: "Identifiants", catFinancial: "Données financières", catCustom: "Termes protégés", sevAny: "toute gravité",
    previewBadge: "Aperçu", previewLabel: "résultat d’exemple — pas votre prompt", planNone: "Vérifications gratuites", planNoneNote: "5 vérifications par jour sans carte. Choisissez une offre pour des vérifications illimitées ; les nouveaux abonnés éligibles bénéficient de 7 jours d’essai.", planTrial: "Essai gratuit", planTrialNote: "Votre essai couvre des vérifications illimitées. Ajoutez une offre pour les poursuivre.", planActive: "Offre active", planActiveNote: "Vérifications illimitées et termes protégés personnalisés sont actifs.", planDayOf: "Jour {day} sur {total}", planEndsToday: "Se termine aujourd’hui", planDaysLeft: "{n} jour restant|{n} jours restants", foundInPrompt: "Trouvé dans votre prompt"
  },
  de: {
    textMode: "Text für KI", textModeNote: "Private Angaben vor dem Senden entfernen", repoMode: "GitHub-Repository", repoModeNote: "Offengelegte Schlüssel und anfällige Abhängigkeiten · kostenlos", stepInput: "Text hinzufügen", stepReview: "Ergebnisse prüfen", stepCopy: "Sicherere Version kopieren", previewHeadline: "Sehen Sie, was privat bleibt.", previewExplain: "Ein Beispieltext nach dem Entfernen sensibler Angaben.", compareAction: "Bereinigte Version anzeigen", sampleLead: "Mit einem Beispiel beginnen",
    workspace: "Arbeitsbereich", privateCheck: "Prompt prüfen", recent: "Letzte Prüfungen", account: "Konto", plans: "Tarife & Preise", preferences: "Einstellungen",
    eyebrow: "Persönlicher Bereich", title: "Prompt prüfen", subtitle: "Prüfen Sie einen Prompt, bevor er ein KI-Tool erreicht.",
    scan: "Prompt prüfen →", clear: "Leeren", history: "Letzte lokale Prüfungen", clearHistory: "Verlauf löschen",
    placeholder: "z. B. Entwirf eine Antwort an Marco Rossi (m.rossi@acme.com) zur ACME-Rechnung — meine Durchwahl ist +39 02 5555 0180",
    composerTitle: "Prüfen Sie Ihren Prompt, bevor Sie ihn mit KI teilen", composerSub: "Fügen Sie ein, was Sie gerade an ChatGPT, Claude, Gemini oder Copilot senden wollen.", promptLabel: "Zu prüfender Prompt",
    tryLabel: "Beispiel ausprobieren", sampleBrief: "Kunden-Briefing", sampleApiKey: "API-Schlüssel", sampleEmail: "E-Mail-Entwurf", samplePersonal: "Persönliche Daten",
    metaLabel: "Private Prüfung — Ihr Prompt wird nie gespeichert oder protokolliert.", howPrivacyWorks: "So funktioniert der Datenschutz", interfaceLanguage: "Oberflächensprache",
    scanModeStandard: "Standard — ausgewogene Prüfungen", scanModeStrict: "Streng — sorgfältiger Prüfmodus",
    resultsTitle: "Ergebnisse", previewItems: "3 sensible Elemente in diesem Prompt",
    redactBeforeSharing: "Vor dem Teilen schwärzen", previewFoot: "Fügen Sie Ihren eigenen Prompt ein, um eine echte Prüfung zu starten.", detectsLabel: "Erkennt außerdem",
    riskHigh: "Hohes Risiko", riskMedium: "Vor dem Teilen prüfen", riskNone: "Keine Risiken gefunden",
    actionHigh: "{n} sensibles Element gefunden. Ersetzen Sie es oder kopieren Sie die sichere Version unten.|{n} sensible Elemente gefunden. Ersetzen Sie sie oder kopieren Sie die sichere Version unten.",
    actionMedium: "{n} Element vor dem Teilen dieses Prompts prüfen.|{n} Elemente vor dem Teilen dieses Prompts prüfen.",
    actionNone: "Nichts Auffälliges gefunden. Das ist ein hilfreicher Hinweis, keine Garantie.",
    checking: "Wird geprüft…", promptTooLong: "Der Prompt ist zu lang", keepUnder: "Bleiben Sie unter {max} Zeichen für eine Prüfung.",
    checkFailed: "Prüfung fehlgeschlagen", couldNotRunCheck: "Die Prüfung konnte nicht ausgeführt werden. Bitte versuchen Sie es erneut.",
    sensitiveValueHidden: "Wert ausgeblendet", saferVersion: "Sichere Version", copySafer: "Sicheren Prompt kopieren", copied: "Kopiert",
    readyToInspect: "Bereit zur Prüfung", willCheckFor: "Wir prüfen auf gängige persönliche Daten und Geheimnisse.",
    noChecksYet: "Noch keine Prüfungen", lastEightWillAppear: "Hier erscheinen die Zusammenfassungen Ihrer letzten acht Prüfungen.", nothingFlagged: "In dieser Prüfung wurde nichts markiert.",
    itemsReviewed: "{n} geprüftes Element|{n} geprüfte Elemente",
    createAccountTrial: "Erstellen Sie ein Konto, um einen Tarif zu wählen und Prompts zu prüfen.", startTrialToInspect: "Sie haben die 5 kostenlosen Prüfungen für heute genutzt. Wählen Sie einen Tarif, um weiterzumachen; berechtigte Neukunden erhalten 7 Tage Testzeitraum.",
    usageLabel: "Prüfungen diese Woche", freeTrialBadge: "Was ein Tarif freischaltet", freeTrialDesc: "Unbegrenzte Prüfungen, eigene geschützte Begriffe und bis zu 3 Teamplätze.", seePlans: "Tarife vergleichen →",
    zeroRetentionDesc: "Prompts werden geprüft, nie gespeichert oder protokolliert.", createAccountBtn: "Konto erstellen", protectionActive: "Vor dem Teilen prüfen",
    onboardCheckTitle: "Erste Prüfung durchführen", onboardCheckDesc: "Fügen Sie einen Prompt ein und prüfen Sie ihn einmal.",
    onboardTermsTitle: "Eigenen Begriff hinzufügen", onboardTermsDesc: "Schützen Sie einen Kunden- oder Projektnamen in den Einstellungen.",
    onboardThemeTitle: "Ein Thema wählen", onboardThemeDesc: "Gestalten Sie den Arbeitsbereich in den Einstellungen nach Ihrem Geschmack.",
    activityTitle: "Ihre Aktivität", activityEmpty: "Ihre Datenschutz-Aktivität erscheint hier nach Ihrer ersten Prüfung.", last7: "Letzte 7 Tage", byType: "Nach Erkennungstyp",
    metricChecked: "Geprüfte Prompts", metricItems: "Gefundene sensible Elemente", metricTop: "Häufigste Erkennung", metricLast: "Letzte Prüfung",
    plansTitle: "Tarife & Preise", plansIntro: "7 Tage Testphase für berechtigte neue Abonnenten. Karte erforderlich; vor Ablauf kündigen, um Kosten zu vermeiden. Pro ist der neue Name von Personal, zum gleichen Preis.",
    personalTag: "Für Einzelpersonen", personalName: "Pro", personalDesc: "Für selbstständige Fachleute, die KI mit echten Kunden- und Personendaten nutzen.",
    startTrial: "Weiter zur Kasse", yearlyPersonal: "79,90 € jährlich",
    businessTag: "Für Teams · bis zu 3 Nutzer", businessName: "Business", businessDesc: "Teamkontrollen und eine klare Datenschutzgrenze für wachsende Teams. Wählen Sie ein bis drei Plätze.",
    seatsLabel: "Plätze", seat1: "1 Nutzer", seat2: "2 Nutzer", seat3: "3 Nutzer", yearlyBusiness: "149,90 € jährlich / Nutzer",
    manageTag: "Bereits abonniert?", manageTitle: "Abrechnung verwalten", manageDesc: "Aktualisieren Sie Ihre Zahlungsmethode, laden Sie Rechnungen herunter oder kündigen Sie die Verlängerung jederzeit.", manageBtn: "Abonnement verwalten",
    teamTitle: "Team", teamSeatsUsed: "{used} von {total} Plätzen belegt.", inviteCreate: "Einladungslink erstellen", copyLink: "Link kopieren", noInvites: "Noch keine Einladungen.", teammateJoined: "Teammitglied beigetreten", invitePending: "Einladung ausstehend", revoke: "Widerrufen", removeTeammate: "Entfernen", couldNotRemoveTeammate: "Das Teammitglied oder die Einladung konnte nicht entfernt werden.", couldNotCreateInvite: "Die Einladung konnte nicht erstellt werden.",
    orgTitle: "Organisation", orgIntro: "Gemeinsamer Schutz für den ganzen Workspace. Geschützte Begriffe gelten für die Prüfungen jedes Mitglieds, auf jedem Gerät.", orgMembersLabel: "Mitglieder", orgTermsLabel: "Geschützte Begriffe", orgTermsHint: "Codenamen, Kundennamen — werden in den Prompts jedes Mitglieds markiert.", orgTermAdd: "Hinzufügen", orgTermPlaceholder: "z. B. Projekt Falke", orgRoleOwner: "Inhaber", orgRoleAdmin: "Admin", orgRoleMember: "Mitglied", orgYou: "Sie", orgRenameSave: "Namen speichern", orgNoTerms: "Noch keine geschützten Begriffe.", orgRemove: "Entfernen", acctActivity: "In Ihrem Konto — alle Geräte", orgActivity: "Organisationsaktivität", orgChecks: "Team-Prüfungen", orgFlagged: "Markiert", orgBlocked: "Blockiert", orgTopCat: "Top-Kategorie", orgByMember: "Nach Mitglied", orgExport: "CSV exportieren (nur Metadaten)", auditFrom: "Von", auditTo: "Bis", auditRange: "Zeitraum", auditShowing: "Zeigt die {shown} neuesten von {total} in diesem Zeitraum. Der Export umfasst den gesamten Zeitraum.", auditComplete: "{total} Ereignis(se) in diesem Zeitraum.", orgPoliciesLabel: "Richtlinien", orgPoliciesHint: "Was passiert, wenn eine Kategorie im Prompt eines Mitglieds gefunden wird. Blockieren verhindert das Senden aus der Erweiterung, bis es behoben ist.", polDefault: "Standard", polWarn: "Warnen", polRedact: "Schwärzen", polBlock: "Blockieren", catPersonal: "Persönliche Daten", catCredentials: "Zugangsdaten", catFinancial: "Finanzdaten", catCustom: "Geschützte Begriffe", sevAny: "jede Schwere",
    previewBadge: "Vorschau", previewLabel: "Beispielergebnis — nicht Ihr Prompt", planNone: "Kostenlose Prüfungen", planNoneNote: "5 Prüfungen pro Tag ohne Karte. Wählen Sie einen Tarif für unbegrenzte Prüfungen; berechtigte neue Abonnenten erhalten 7 Tage Testzeitraum.", planTrial: "Kostenlose Testphase", planTrialNote: "Ihre Testphase umfasst unbegrenzte Prüfungen. Wählen Sie einen Tarif, um sie fortzusetzen.", planActive: "Aktiver Tarif", planActiveNote: "Unbegrenzte Prüfungen und eigene geschützte Begriffe sind aktiv.", planDayOf: "Tag {day} von {total}", planEndsToday: "Endet heute", planDaysLeft: "noch {n} Tag|noch {n} Tage", foundInPrompt: "In Ihrem Prompt gefunden"
  }
};
// Copy for the workspace shell, its views and the Plans & pricing page.
// Merged into copyByLanguage below, so data-i18n and words() reach it too.
// Benefit lines carry <strong> markup and are only ever set as trusted HTML.
const viewCopyByLanguage: Record<Language, Record<string, string>> = {
  en: {
    brandTag: "Check before you send", groupProtect: "Protect", groupConfigure: "Configure",
    navCheck: "Check text", navRepository: "Repository check", navActivity: "Activity", navTerms: "Protected terms", navSettings: "Settings", navAccount: "Account & team", navHelp: "Help & support",
    clearResults: "Clear results", resultsCleared: "Results cleared. Run a new check when you are ready.", previewPersonal: "Personal data", previewCredential: "Credentials", previewUse: "Try this type of check →",
    onboardTitle: "Get set up", onboardDismiss: "Dismiss checklist", onboardTermsDesc: "Protect a client or project name.", onboardThemeDesc: "Make the workspace yours.",
    activityPageTitle: "Activity", activityPageSub: "What your recent checks found. Local summaries stay on this device; account activity never includes your text.", clearLocalActivity: "Clear local activity",
    termsTitle: "Protected terms", termsSub: "Names Redaxa should always flag, such as clients, projects and codenames.", ownTermsTitle: "Your protected terms", ownTermsHint: "One term per line, up to 30. Every check you run looks for them.", ownTermsPlaceholder: "Acme Client\nProject Falcon", saveTerms: "Save terms", termsSaved: "Saved.", termsCount: "{n} term|{n} terms",
    settingsTitle: "Settings", settingsAppearance: "Appearance and language", settingsDetection: "Detection", settingsDevice: "On this device", themeLabel: "Theme", prefsSaved: "Preferences saved.",
    apiTitle: "Developer API keys", apiHint: "For scripts and pipelines.", apiDocs: "API documentation", apiSignIn: "Sign in to manage API keys.", apiNone: "No API keys yet.", apiCreate: "Create API key", apiCopy: "Copy", apiOnce: "This key is shown once. Store it now — it cannot be recovered.",
    accountTitle: "Account & team", accountSub: "Manage your subscription, members and shared protection.", accountEmpty: "Sign in to manage your workspace. Team controls are available with Business.",
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
    trustTitle: "What leaves your device", trustExtT: "Free checks in Chrome", trustExt: "Run in your browser. The text you check does not leave your device.", trustServerT: "Checks on the web, in Windows and with a plan", trustServer: "Sent over an encrypted connection, analyzed and discarded. Never stored and never forwarded to an AI provider.", trustMetaT: "Activity record", trustMeta: "Metadata only: time, application, finding categories and counts. Never your text.", trustRepoT: "Repository reviews", trustRepo: "Public repositories only; reviews in the Windows app run locally. Private repositories are not supported.", trustLimit: "Detection can miss sensitive information or flag harmless text. Review every result before sharing.", privacyPolicy: "Read the privacy policy",
    faqTitle: "Questions", faqTrialQ: "How does the 7-day trial work?", faqTrialA: "Eligible new subscribers start with a 7-day trial. A card is required; cancel before the trial ends to avoid a charge.", faqCancelQ: "Can I cancel or change my plan?", faqCancelA: "Yes. Manage subscription opens the billing portal, where you can update your payment method, download invoices or cancel renewal whenever you need to.", faqBizQ: "What does Business add?", faqBizA: "Everything in Pro, plus shared protected terms, category policies and metadata-only activity for your team. Choose one to three users.", faqStoredQ: "Is the text I check stored?", faqStoredA: "No. Checks on the web, in the Windows app and with a plan are analyzed and discarded, and Redaxa keeps metadata only. Free checks in the Chrome extension never leave your device.", faqMissQ: "Will Redaxa find everything?", faqMissA: "No tool can promise that. Detection can miss sensitive information or flag harmless text, so review every result before you share it.",
    sevCritical: "Critical", sevHigh: "High", sevMedium: "Medium", sevLow: "Low", sevCriticalHint: "Could give someone access to an account or system", sevHighHint: "Direct financial exposure or a strong identifier", sevMediumHint: "Personal details with indirect harm", sevLowHint: "Weak identifiers that depend on context"
  },
  it: {
    brandTag: "Controlla prima di inviare", groupProtect: "Proteggi", groupConfigure: "Configura",
    navCheck: "Controlla testo", navRepository: "Controllo repository", navActivity: "Attività", navTerms: "Termini protetti", navSettings: "Impostazioni", navAccount: "Account e team", navHelp: "Aiuto e supporto",
    clearResults: "Cancella risultati", resultsCleared: "Risultati cancellati. Avvia un nuovo controllo quando vuoi.", previewPersonal: "Dati personali", previewCredential: "Credenziali", previewUse: "Prova questo tipo di controllo →",
    onboardTitle: "Primi passi", onboardDismiss: "Chiudi l'elenco", onboardTermsDesc: "Proteggi il nome di un cliente o di un progetto.", onboardThemeDesc: "Personalizza lo spazio di lavoro.",
    activityPageTitle: "Attività", activityPageSub: "Cosa hanno trovato i controlli recenti. I riepiloghi locali restano su questo dispositivo; l'attività dell'account non include mai il tuo testo.", clearLocalActivity: "Cancella attività locale",
    termsTitle: "Termini protetti", termsSub: "Nomi che Redaxa deve sempre segnalare, come clienti, progetti e nomi in codice.", ownTermsTitle: "I tuoi termini protetti", ownTermsHint: "Un termine per riga, fino a 30. Ogni controllo che avvii li cerca.", ownTermsPlaceholder: "Cliente Acme\nProgetto Falco", saveTerms: "Salva termini", termsSaved: "Salvato.", termsCount: "{n} termine|{n} termini",
    settingsTitle: "Impostazioni", settingsAppearance: "Aspetto e lingua", settingsDetection: "Rilevamento", settingsDevice: "Su questo dispositivo", themeLabel: "Tema", prefsSaved: "Impostazioni salvate.",
    apiTitle: "Chiavi API per sviluppatori", apiHint: "Per script e pipeline.", apiDocs: "Documentazione API", apiSignIn: "Accedi per gestire le chiavi API.", apiNone: "Nessuna chiave API.", apiCreate: "Crea chiave API", apiCopy: "Copia", apiOnce: "La chiave viene mostrata una sola volta. Salvala ora: non si può recuperare.",
    accountTitle: "Account e team", accountSub: "Gestisci abbonamento, membri e protezione condivisa.", accountEmpty: "Accedi per gestire il tuo spazio di lavoro. I controlli per i team sono inclusi in Business.",
    plansHeadline: "Scegli quanto deve controllare Redaxa per te.", billingPeriod: "Periodo di fatturazione", billingMonthly: "Mensile", billingYearly: "Annuale · 2 mesi gratis",
    recommended: "Consigliato", currentPlan: "Piano attuale", equivYearly: "{price} al mese, fatturati annualmente",
    freeName: "Gratis", freeDesc: "Controlla cosa condividi, senza bisogno di un account.", freeNote: "Nessuna carta richiesta", freeCta: "Inizia a controllare",
    freeB1: "<strong>5 controlli di prompt al giorno</strong> sul web e nell'app per Windows", freeB2: "<strong>Nessun limite nell'estensione per Chrome:</strong> i controlli gratuiti avvengono sul tuo dispositivo", freeB3: "<strong>Controlli di repository pubblici</strong> sul web, 3 al giorno", freeB4: "<strong>Risultati raggruppati</strong> e una copia oscurata da condividere",
    proB1: "<strong>Controlli di prompt senza limite giornaliero</strong> sul web, su Windows e in Chrome", proB2: "<strong>I tuoi termini protetti</strong> per nomi di clienti e progetti, su ogni dispositivo", proB3: "<strong>Controlli di repository:</strong> 60 al giorno sul web, più le revisioni nell'app per Windows con cronologia e un riepilogo per priorità", proB4: "<strong>Report testuali oscurati</strong> per le revisioni dei repository",
    bizB1: "<strong>Tutto ciò che include Pro</strong>", bizB2: "<strong>Termini protetti condivisi</strong> per ogni membro", bizB3: "<strong>Avvisa, oscura o blocca</strong> con le policy del team", bizB4: "<strong>Attività ed esportazione CSV</strong> senza il contenuto dei prompt",
    statusFree: "Stai usando il piano gratuito: 5 controlli di prompt al giorno sul web e nell'app per Windows.", statusTrial: "La prova gratuita è in corso: {left}.", statusActive: "Il tuo piano {plan} è attivo.",
    checkoutNote: "I pagamenti sono gestiti da Stripe. Gestisci abbonamento apre il portale di fatturazione, dove puoi aggiornare la carta, scaricare le fatture o annullare il rinnovo.",
    compareTitle: "Confronta i piani", compareFeature: "Funzione", included: "Incluso", notIncluded: "Non incluso",
    cmpPrompt: "Controlli di prompt sul web e nell'app per Windows", cmpExtension: "Controlli nell'estensione per Chrome", cmpTerms: "I tuoi termini protetti", cmpRepoWeb: "Controlli di repository pubblici sul web", cmpRepoLocal: "Revisioni di repository nell'app per Windows, con cronologia e archivi", cmpReports: "Report oscurati dei repository", cmpPolicies: "Policy del team: avvisa, oscura o blocca", cmpActivity: "Attività del team ed esportazione CSV, solo metadati", cmpSeats: "Utenti",
    cellFiveDaily: "5 al giorno", cellNoLimit: "Senza limite giornaliero", cellExtFree: "Senza limiti, sul tuo dispositivo", cellExtPlan: "Senza limiti, sul server di Redaxa", cellTermsFree: "Web e app per Windows", cellTermsPro: "Web, Windows e Chrome", cellTermsBiz: "Più i termini condivisi", cellThreeDaily: "3 al giorno", cellSixtyDaily: "60 al giorno", cellOneUser: "1", cellSeats: "1–3",
    trustTitle: "Cosa lascia il tuo dispositivo", trustExtT: "Controlli gratuiti in Chrome", trustExt: "Avvengono nel browser. Il testo che controlli non lascia il tuo dispositivo.", trustServerT: "Controlli sul web, su Windows e con un piano", trustServer: "Inviati con una connessione cifrata, analizzati ed eliminati. Mai conservati e mai inoltrati a un fornitore di AI.", trustMetaT: "Registro attività", trustMeta: "Solo metadati: ora, applicazione, categorie e numero di rilevamenti. Mai il tuo testo.", trustRepoT: "Revisioni dei repository", trustRepo: "Solo repository pubblici; le revisioni nell'app per Windows avvengono in locale. I repository privati non sono supportati.", trustLimit: "Il rilevamento può non trovare alcune informazioni sensibili o segnalare testo innocuo. Rivedi ogni risultato prima di condividere.", privacyPolicy: "Leggi l'informativa sulla privacy",
    faqTitle: "Domande", faqTrialQ: "Come funziona la prova di 7 giorni?", faqTrialA: "I nuovi abbonati idonei iniziano con una prova di 7 giorni. Serve una carta; annulla prima della fine della prova per evitare l'addebito.", faqCancelQ: "Posso annullare o cambiare piano?", faqCancelA: "Sì. Gestisci abbonamento apre il portale di fatturazione, dove puoi aggiornare il metodo di pagamento, scaricare le fatture o annullare il rinnovo quando vuoi.", faqBizQ: "Cosa aggiunge Business?", faqBizA: "Tutto ciò che include Pro, più termini protetti condivisi, policy per categoria e attività del team con soli metadati. Scegli da uno a tre utenti.", faqStoredQ: "Il testo che controllo viene conservato?", faqStoredA: "No. I controlli sul web, nell'app per Windows e con un piano vengono analizzati ed eliminati, e Redaxa conserva solo i metadati. I controlli gratuiti nell'estensione per Chrome non lasciano mai il tuo dispositivo.", faqMissQ: "Redaxa trova proprio tutto?", faqMissA: "Nessuno strumento può garantirlo. Il rilevamento può non trovare alcune informazioni sensibili o segnalare testo innocuo: rivedi ogni risultato prima di condividerlo.",
    sevCritical: "Critico", sevHigh: "Alto", sevMedium: "Medio", sevLow: "Basso", sevCriticalHint: "Può dare accesso a un account o a un sistema", sevHighHint: "Esposizione finanziaria diretta o identificativo forte", sevMediumHint: "Dati personali con danno indiretto", sevLowHint: "Identificativi deboli, dipendono dal contesto"
  },
  es: {
    brandTag: "Revisa antes de enviar", groupProtect: "Proteger", groupConfigure: "Configurar",
    navCheck: "Revisar texto", navRepository: "Revisión de repositorios", navActivity: "Actividad", navTerms: "Términos protegidos", navSettings: "Ajustes", navAccount: "Cuenta y equipo", navHelp: "Ayuda y soporte",
    clearResults: "Borrar resultados", resultsCleared: "Resultados borrados. Haz una nueva revisión cuando quieras.", previewPersonal: "Datos personales", previewCredential: "Credenciales", previewUse: "Prueba este tipo de revisión →",
    onboardTitle: "Primeros pasos", onboardDismiss: "Cerrar la lista", onboardTermsDesc: "Protege el nombre de un cliente o proyecto.", onboardThemeDesc: "Personaliza tu espacio de trabajo.",
    activityPageTitle: "Actividad", activityPageSub: "Lo que encontraron tus revisiones recientes. Los resúmenes locales se quedan en este dispositivo; la actividad de la cuenta nunca incluye tu texto.", clearLocalActivity: "Borrar actividad local",
    termsTitle: "Términos protegidos", termsSub: "Nombres que Redaxa debe señalar siempre, como clientes, proyectos y nombres en clave.", ownTermsTitle: "Tus términos protegidos", ownTermsHint: "Un término por línea, hasta 30. Cada revisión que haces los busca.", ownTermsPlaceholder: "Cliente Acme\nProyecto Halcón", saveTerms: "Guardar términos", termsSaved: "Guardado.", termsCount: "{n} término|{n} términos",
    settingsTitle: "Ajustes", settingsAppearance: "Apariencia e idioma", settingsDetection: "Detección", settingsDevice: "En este dispositivo", themeLabel: "Tema", prefsSaved: "Preferencias guardadas.",
    apiTitle: "Claves API para desarrolladores", apiHint: "Para scripts y pipelines.", apiDocs: "Documentación de la API", apiSignIn: "Inicia sesión para gestionar las claves API.", apiNone: "Aún no hay claves API.", apiCreate: "Crear clave API", apiCopy: "Copiar", apiOnce: "Esta clave se muestra una sola vez. Guárdala ahora: no se puede recuperar.",
    accountTitle: "Cuenta y equipo", accountSub: "Gestiona tu suscripción, los miembros y la protección compartida.", accountEmpty: "Inicia sesión para gestionar tu espacio de trabajo. Los controles de equipo están incluidos en Business.",
    plansHeadline: "Elige cuánto revisa Redaxa por ti.", billingPeriod: "Periodo de facturación", billingMonthly: "Mensual", billingYearly: "Anual · 2 meses gratis",
    recommended: "Recomendado", currentPlan: "Plan actual", equivYearly: "{price} al mes, facturado anualmente",
    freeName: "Gratis", freeDesc: "Revisa lo que compartes, sin necesidad de cuenta.", freeNote: "Sin tarjeta", freeCta: "Empezar a revisar",
    freeB1: "<strong>5 revisiones de prompts al día</strong> en la web y en la app para Windows", freeB2: "<strong>Sin límite en la extensión para Chrome:</strong> las revisiones gratuitas se hacen en tu dispositivo", freeB3: "<strong>Revisiones de repositorios públicos</strong> en la web, 3 al día", freeB4: "<strong>Resultados agrupados</strong> y una copia redactada para compartir",
    proB1: "<strong>Revisiones de prompts sin límite diario</strong> en la web, en Windows y en Chrome", proB2: "<strong>Tus términos protegidos</strong> para nombres de clientes y proyectos, en todos tus dispositivos", proB3: "<strong>Revisiones de repositorios:</strong> 60 al día en la web, más revisiones en la app para Windows con historial y un resumen por prioridad", proB4: "<strong>Informes de texto redactados</strong> para las revisiones de repositorios",
    bizB1: "<strong>Todo lo incluido en Pro</strong>", bizB2: "<strong>Términos protegidos compartidos</strong> para cada miembro", bizB3: "<strong>Avisar, redactar o bloquear</strong> con políticas de equipo", bizB4: "<strong>Actividad y exportación CSV</strong> sin el contenido de los prompts",
    statusFree: "Estás en el plan gratuito: 5 revisiones de prompts al día en la web y en la app para Windows.", statusTrial: "Tu prueba gratuita está en curso: {left}.", statusActive: "Tu plan {plan} está activo.",
    checkoutNote: "Los pagos los procesa Stripe. Gestionar suscripción abre el portal de facturación, donde puedes actualizar la tarjeta, descargar facturas o cancelar la renovación.",
    compareTitle: "Compara los planes", compareFeature: "Función", included: "Incluido", notIncluded: "No incluido",
    cmpPrompt: "Revisiones de prompts en la web y en la app para Windows", cmpExtension: "Revisiones en la extensión para Chrome", cmpTerms: "Tus términos protegidos", cmpRepoWeb: "Revisiones de repositorios públicos en la web", cmpRepoLocal: "Revisiones de repositorios en la app para Windows, con historial y archivos comprimidos", cmpReports: "Informes redactados de repositorios", cmpPolicies: "Políticas de equipo: avisar, redactar o bloquear", cmpActivity: "Actividad del equipo y exportación CSV, solo metadatos", cmpSeats: "Usuarios",
    cellFiveDaily: "5 al día", cellNoLimit: "Sin límite diario", cellExtFree: "Sin límite, en tu dispositivo", cellExtPlan: "Sin límite, en el servidor de Redaxa", cellTermsFree: "Web y app para Windows", cellTermsPro: "Web, Windows y Chrome", cellTermsBiz: "Más términos compartidos", cellThreeDaily: "3 al día", cellSixtyDaily: "60 al día", cellOneUser: "1", cellSeats: "1–3",
    trustTitle: "Qué sale de tu dispositivo", trustExtT: "Revisiones gratuitas en Chrome", trustExt: "Se hacen en tu navegador. El texto que revisas no sale de tu dispositivo.", trustServerT: "Revisiones en la web, en Windows y con un plan", trustServer: "Se envían por una conexión cifrada, se analizan y se descartan. Nunca se guardan ni se reenvían a un proveedor de IA.", trustMetaT: "Registro de actividad", trustMeta: "Solo metadatos: hora, aplicación, categorías y número de detecciones. Nunca tu texto.", trustRepoT: "Revisiones de repositorios", trustRepo: "Solo repositorios públicos; las revisiones en la app para Windows se hacen en local. Los repositorios privados no son compatibles.", trustLimit: "La detección puede pasar por alto información sensible o marcar texto inofensivo. Revisa cada resultado antes de compartir.", privacyPolicy: "Leer la política de privacidad",
    faqTitle: "Preguntas", faqTrialQ: "¿Cómo funciona la prueba de 7 días?", faqTrialA: "Los nuevos suscriptores que cumplan los requisitos empiezan con una prueba de 7 días. Se necesita una tarjeta; cancela antes de que termine la prueba para evitar el cargo.", faqCancelQ: "¿Puedo cancelar o cambiar de plan?", faqCancelA: "Sí. Gestionar suscripción abre el portal de facturación, donde puedes actualizar el método de pago, descargar facturas o cancelar la renovación cuando quieras.", faqBizQ: "¿Qué añade Business?", faqBizA: "Todo lo incluido en Pro, más términos protegidos compartidos, políticas por categoría y actividad del equipo solo con metadatos. Elige de uno a tres usuarios.", faqStoredQ: "¿Se guarda el texto que reviso?", faqStoredA: "No. Las revisiones en la web, en la app para Windows y con un plan se analizan y se descartan, y Redaxa solo guarda metadatos. Las revisiones gratuitas en la extensión para Chrome nunca salen de tu dispositivo.", faqMissQ: "¿Redaxa lo encuentra todo?", faqMissA: "Ninguna herramienta puede prometerlo. La detección puede pasar por alto información sensible o marcar texto inofensivo, así que revisa cada resultado antes de compartirlo.",
    sevCritical: "Crítico", sevHigh: "Alto", sevMedium: "Medio", sevLow: "Bajo", sevCriticalHint: "Puede dar acceso a una cuenta o a un sistema", sevHighHint: "Exposición financiera directa o identificador fuerte", sevMediumHint: "Datos personales con daño indirecto", sevLowHint: "Identificadores débiles que dependen del contexto"
  },
  fr: {
    brandTag: "Vérifiez avant d’envoyer", groupProtect: "Protéger", groupConfigure: "Configurer",
    navCheck: "Vérifier un texte", navRepository: "Analyse de dépôt", navActivity: "Activité", navTerms: "Termes protégés", navSettings: "Réglages", navAccount: "Compte et équipe", navHelp: "Aide et support",
    clearResults: "Effacer les résultats", resultsCleared: "Résultats effacés. Lancez une nouvelle vérification quand vous voulez.", previewPersonal: "Données personnelles", previewCredential: "Identifiants", previewUse: "Essayer ce type de vérification →",
    onboardTitle: "Pour bien démarrer", onboardDismiss: "Fermer la liste", onboardTermsDesc: "Protégez le nom d’un client ou d’un projet.", onboardThemeDesc: "Personnalisez votre espace de travail.",
    activityPageTitle: "Activité", activityPageSub: "Ce que vos vérifications récentes ont trouvé. Les résumés locaux restent sur cet appareil ; l’activité du compte n’inclut jamais votre texte.", clearLocalActivity: "Effacer l’activité locale",
    termsTitle: "Termes protégés", termsSub: "Les noms que Redaxa doit toujours signaler : clients, projets, noms de code.", ownTermsTitle: "Vos termes protégés", ownTermsHint: "Un terme par ligne, jusqu’à 30. Chaque vérification les recherche.", ownTermsPlaceholder: "Client Acme\nProjet Faucon", saveTerms: "Enregistrer les termes", termsSaved: "Enregistré.", termsCount: "{n} terme|{n} termes",
    settingsTitle: "Réglages", settingsAppearance: "Apparence et langue", settingsDetection: "Détection", settingsDevice: "Sur cet appareil", themeLabel: "Thème", prefsSaved: "Préférences enregistrées.",
    apiTitle: "Clés API pour développeurs", apiHint: "Pour les scripts et les pipelines.", apiDocs: "Documentation de l’API", apiSignIn: "Connectez-vous pour gérer les clés API.", apiNone: "Aucune clé API pour l’instant.", apiCreate: "Créer une clé API", apiCopy: "Copier", apiOnce: "Cette clé ne s’affiche qu’une fois. Conservez-la maintenant : elle ne peut pas être récupérée.",
    accountTitle: "Compte et équipe", accountSub: "Gérez votre abonnement, les membres et la protection partagée.", accountEmpty: "Connectez-vous pour gérer votre espace de travail. Les contrôles d’équipe sont inclus dans Business.",
    plansHeadline: "Choisissez ce que Redaxa vérifie pour vous.", billingPeriod: "Période de facturation", billingMonthly: "Mensuel", billingYearly: "Annuel · 2 mois offerts",
    recommended: "Recommandé", currentPlan: "Offre actuelle", equivYearly: "{price} par mois, facturé annuellement",
    freeName: "Gratuit", freeDesc: "Vérifiez ce que vous partagez, sans compte.", freeNote: "Sans carte bancaire", freeCta: "Commencer",
    freeB1: "<strong>5 vérifications de prompts par jour</strong> sur le web et dans l’application Windows", freeB2: "<strong>Aucune limite dans l’extension Chrome :</strong> les vérifications gratuites ont lieu sur votre appareil", freeB3: "<strong>Analyses de dépôts publics</strong> sur le web, 3 par jour", freeB4: "<strong>Résultats regroupés</strong> et une copie caviardée à partager",
    proB1: "<strong>Vérifications de prompts sans limite quotidienne</strong> sur le web, sous Windows et dans Chrome", proB2: "<strong>Vos termes protégés</strong> pour les noms de clients et de projets, sur tous vos appareils", proB3: "<strong>Analyses de dépôts :</strong> 60 par jour sur le web, plus les analyses dans l’application Windows avec historique et récapitulatif par priorité", proB4: "<strong>Rapports texte caviardés</strong> pour les analyses de dépôts",
    bizB1: "<strong>Tout ce qu’inclut Pro</strong>", bizB2: "<strong>Termes protégés partagés</strong> pour chaque membre", bizB3: "<strong>Avertir, caviarder ou bloquer</strong> avec des règles d’équipe", bizB4: "<strong>Activité et export CSV</strong> sans le contenu des prompts",
    statusFree: "Vous utilisez l’offre gratuite : 5 vérifications de prompts par jour sur le web et dans l’application Windows.", statusTrial: "Votre essai gratuit est en cours : {left}.", statusActive: "Votre offre {plan} est active.",
    checkoutNote: "Les paiements sont traités par Stripe. Gérer l’abonnement ouvre le portail de facturation, où vous pouvez mettre à jour votre carte, télécharger vos factures ou annuler le renouvellement.",
    compareTitle: "Comparer les offres", compareFeature: "Fonction", included: "Inclus", notIncluded: "Non inclus",
    cmpPrompt: "Vérifications de prompts sur le web et dans l’application Windows", cmpExtension: "Vérifications dans l’extension Chrome", cmpTerms: "Vos termes protégés", cmpRepoWeb: "Analyses de dépôts publics sur le web", cmpRepoLocal: "Analyses de dépôts dans l’application Windows, avec historique et archives", cmpReports: "Rapports de dépôts caviardés", cmpPolicies: "Règles d’équipe : avertir, caviarder ou bloquer", cmpActivity: "Activité de l’équipe et export CSV, métadonnées uniquement", cmpSeats: "Utilisateurs",
    cellFiveDaily: "5 par jour", cellNoLimit: "Sans limite quotidienne", cellExtFree: "Sans limite, sur votre appareil", cellExtPlan: "Sans limite, sur le serveur de Redaxa", cellTermsFree: "Web et application Windows", cellTermsPro: "Web, Windows et Chrome", cellTermsBiz: "Plus les termes partagés", cellThreeDaily: "3 par jour", cellSixtyDaily: "60 par jour", cellOneUser: "1", cellSeats: "1–3",
    trustTitle: "Ce qui quitte votre appareil", trustExtT: "Vérifications gratuites dans Chrome", trustExt: "Elles ont lieu dans votre navigateur. Le texte vérifié ne quitte pas votre appareil.", trustServerT: "Vérifications sur le web, sous Windows et avec une offre", trustServer: "Envoyées via une connexion chiffrée, analysées puis supprimées. Jamais conservées ni transmises à un fournisseur d’IA.", trustMetaT: "Journal d’activité", trustMeta: "Métadonnées uniquement : heure, application, catégories et nombre de détections. Jamais votre texte.", trustRepoT: "Analyses de dépôts", trustRepo: "Dépôts publics uniquement ; les analyses dans l’application Windows ont lieu en local. Les dépôts privés ne sont pas pris en charge.", trustLimit: "La détection peut manquer des informations sensibles ou signaler un texte anodin. Relisez chaque résultat avant de partager.", privacyPolicy: "Lire la politique de confidentialité",
    faqTitle: "Questions", faqTrialQ: "Comment fonctionne l’essai de 7 jours ?", faqTrialA: "Les nouveaux abonnés éligibles commencent par un essai de 7 jours. Une carte est requise ; annulez avant la fin de l’essai pour éviter d’être débité.", faqCancelQ: "Puis-je annuler ou changer d’offre ?", faqCancelA: "Oui. Gérer l’abonnement ouvre le portail de facturation, où vous pouvez mettre à jour votre moyen de paiement, télécharger vos factures ou annuler le renouvellement à tout moment.", faqBizQ: "Qu’apporte Business ?", faqBizA: "Tout ce qu’inclut Pro, plus des termes protégés partagés, des règles par catégorie et une activité d’équipe limitée aux métadonnées. De un à trois utilisateurs.", faqStoredQ: "Le texte vérifié est-il conservé ?", faqStoredA: "Non. Les vérifications sur le web, dans l’application Windows et avec une offre sont analysées puis supprimées, et Redaxa ne conserve que des métadonnées. Les vérifications gratuites dans l’extension Chrome ne quittent jamais votre appareil.", faqMissQ: "Redaxa trouve-t-il tout ?", faqMissA: "Aucun outil ne peut le promettre. La détection peut manquer des informations sensibles ou signaler un texte anodin : relisez chaque résultat avant de le partager.",
    sevCritical: "Critique", sevHigh: "Élevée", sevMedium: "Moyenne", sevLow: "Faible", sevCriticalHint: "Peut donner accès à un compte ou à un système", sevHighHint: "Exposition financière directe ou identifiant fort", sevMediumHint: "Données personnelles au préjudice indirect", sevLowHint: "Identifiants faibles, selon le contexte"
  },
  de: {
    brandTag: "Erst prüfen, dann senden", groupProtect: "Schützen", groupConfigure: "Einrichten",
    navCheck: "Text prüfen", navRepository: "Repository-Prüfung", navActivity: "Aktivität", navTerms: "Geschützte Begriffe", navSettings: "Einstellungen", navAccount: "Konto und Team", navHelp: "Hilfe und Support",
    clearResults: "Ergebnisse löschen", resultsCleared: "Ergebnisse gelöscht. Starten Sie eine neue Prüfung, wann immer Sie möchten.", previewPersonal: "Personenbezogene Daten", previewCredential: "Zugangsdaten", previewUse: "Diese Art von Prüfung testen →",
    onboardTitle: "Erste Schritte", onboardDismiss: "Liste schließen", onboardTermsDesc: "Schützen Sie den Namen eines Kunden oder Projekts.", onboardThemeDesc: "Gestalten Sie den Arbeitsbereich nach Ihrem Geschmack.",
    activityPageTitle: "Aktivität", activityPageSub: "Was Ihre letzten Prüfungen gefunden haben. Lokale Zusammenfassungen bleiben auf diesem Gerät; die Kontoaktivität enthält nie Ihren Text.", clearLocalActivity: "Lokale Aktivität löschen",
    termsTitle: "Geschützte Begriffe", termsSub: "Namen, die Redaxa immer markieren soll, etwa Kunden, Projekte und Codenamen.", ownTermsTitle: "Ihre geschützten Begriffe", ownTermsHint: "Ein Begriff pro Zeile, bis zu 30. Jede Prüfung sucht danach.", ownTermsPlaceholder: "Kunde Acme\nProjekt Falke", saveTerms: "Begriffe speichern", termsSaved: "Gespeichert.", termsCount: "{n} Begriff|{n} Begriffe",
    settingsTitle: "Einstellungen", settingsAppearance: "Darstellung und Sprache", settingsDetection: "Erkennung", settingsDevice: "Auf diesem Gerät", themeLabel: "Design", prefsSaved: "Einstellungen gespeichert.",
    apiTitle: "API-Schlüssel für Entwickler", apiHint: "Für Skripte und Pipelines.", apiDocs: "API-Dokumentation", apiSignIn: "Melden Sie sich an, um API-Schlüssel zu verwalten.", apiNone: "Noch keine API-Schlüssel.", apiCreate: "API-Schlüssel erstellen", apiCopy: "Kopieren", apiOnce: "Dieser Schlüssel wird nur einmal angezeigt. Speichern Sie ihn jetzt – er kann nicht wiederhergestellt werden.",
    accountTitle: "Konto und Team", accountSub: "Verwalten Sie Ihr Abo, die Mitglieder und den gemeinsamen Schutz.", accountEmpty: "Melden Sie sich an, um Ihren Arbeitsbereich zu verwalten. Team-Funktionen sind in Business enthalten.",
    plansHeadline: "Wählen Sie, wie viel Redaxa für Sie prüft.", billingPeriod: "Abrechnungszeitraum", billingMonthly: "Monatlich", billingYearly: "Jährlich · 2 Monate gratis",
    recommended: "Empfohlen", currentPlan: "Aktueller Tarif", equivYearly: "{price} pro Monat, jährlich abgerechnet",
    freeName: "Kostenlos", freeDesc: "Prüfen Sie, was Sie teilen – ganz ohne Konto.", freeNote: "Keine Karte nötig", freeCta: "Jetzt prüfen",
    freeB1: "<strong>5 Prompt-Prüfungen pro Tag</strong> im Web und in der Windows-App", freeB2: "<strong>Kein Limit in der Chrome-Erweiterung:</strong> kostenlose Prüfungen laufen auf Ihrem Gerät", freeB3: "<strong>Prüfungen öffentlicher Repositorys</strong> im Web, 3 pro Tag", freeB4: "<strong>Gruppierte Ergebnisse</strong> und eine geschwärzte Kopie zum Teilen",
    proB1: "<strong>Prompt-Prüfungen ohne Tageslimit</strong> im Web, unter Windows und in Chrome", proB2: "<strong>Ihre geschützten Begriffe</strong> für Kunden- und Projektnamen, auf jedem Gerät", proB3: "<strong>Repository-Prüfungen:</strong> 60 pro Tag im Web, dazu Prüfungen in der Windows-App mit Verlauf und priorisierter Zusammenfassung", proB4: "<strong>Geschwärzte Textberichte</strong> für Repository-Prüfungen",
    bizB1: "<strong>Alles aus Pro</strong>", bizB2: "<strong>Gemeinsame geschützte Begriffe</strong> für jedes Mitglied", bizB3: "<strong>Warnen, schwärzen oder blockieren</strong> mit Team-Richtlinien", bizB4: "<strong>Aktivität und CSV-Export</strong> ohne Prompt-Inhalte",
    statusFree: "Sie nutzen den kostenlosen Tarif: 5 Prompt-Prüfungen pro Tag im Web und in der Windows-App.", statusTrial: "Ihre kostenlose Testphase läuft: {left}.", statusActive: "Ihr Tarif {plan} ist aktiv.",
    checkoutNote: "Zahlungen werden von Stripe abgewickelt. „Abonnement verwalten“ öffnet das Abrechnungsportal, in dem Sie Ihre Karte aktualisieren, Rechnungen herunterladen oder die Verlängerung kündigen können.",
    compareTitle: "Tarife vergleichen", compareFeature: "Funktion", included: "Enthalten", notIncluded: "Nicht enthalten",
    cmpPrompt: "Prompt-Prüfungen im Web und in der Windows-App", cmpExtension: "Prüfungen in der Chrome-Erweiterung", cmpTerms: "Ihre geschützten Begriffe", cmpRepoWeb: "Prüfungen öffentlicher Repositorys im Web", cmpRepoLocal: "Repository-Prüfungen in der Windows-App, mit Verlauf und Archiven", cmpReports: "Geschwärzte Repository-Berichte", cmpPolicies: "Team-Richtlinien: warnen, schwärzen oder blockieren", cmpActivity: "Team-Aktivität und CSV-Export, nur Metadaten", cmpSeats: "Nutzer",
    cellFiveDaily: "5 pro Tag", cellNoLimit: "Ohne Tageslimit", cellExtFree: "Ohne Limit, auf Ihrem Gerät", cellExtPlan: "Ohne Limit, auf dem Redaxa-Server", cellTermsFree: "Web und Windows-App", cellTermsPro: "Web, Windows und Chrome", cellTermsBiz: "Plus gemeinsame Begriffe", cellThreeDaily: "3 pro Tag", cellSixtyDaily: "60 pro Tag", cellOneUser: "1", cellSeats: "1–3",
    trustTitle: "Was Ihr Gerät verlässt", trustExtT: "Kostenlose Prüfungen in Chrome", trustExt: "Laufen in Ihrem Browser. Der geprüfte Text verlässt Ihr Gerät nicht.", trustServerT: "Prüfungen im Web, unter Windows und mit einem Tarif", trustServer: "Werden verschlüsselt übertragen, analysiert und verworfen. Nie gespeichert und nie an einen KI-Anbieter weitergegeben.", trustMetaT: "Aktivitätsprotokoll", trustMeta: "Nur Metadaten: Zeit, Anwendung, Kategorien und Anzahl der Funde. Nie Ihr Text.", trustRepoT: "Repository-Prüfungen", trustRepo: "Nur öffentliche Repositorys; Prüfungen in der Windows-App laufen lokal. Private Repositorys werden nicht unterstützt.", trustLimit: "Die Erkennung kann sensible Informationen übersehen oder harmlosen Text markieren. Prüfen Sie jedes Ergebnis, bevor Sie etwas teilen.", privacyPolicy: "Datenschutzerklärung lesen",
    faqTitle: "Fragen", faqTrialQ: "Wie funktioniert die 7-tägige Testphase?", faqTrialA: "Berechtigte neue Abonnenten starten mit einer 7-tägigen Testphase. Eine Karte ist erforderlich; kündigen Sie vor Ende der Testphase, um eine Abbuchung zu vermeiden.", faqCancelQ: "Kann ich kündigen oder den Tarif wechseln?", faqCancelA: "Ja. „Abonnement verwalten“ öffnet das Abrechnungsportal, in dem Sie jederzeit Ihre Zahlungsmethode aktualisieren, Rechnungen herunterladen oder die Verlängerung kündigen können.", faqBizQ: "Was bietet Business zusätzlich?", faqBizA: "Alles aus Pro, dazu gemeinsame geschützte Begriffe, Richtlinien pro Kategorie und Team-Aktivität nur mit Metadaten. Wählen Sie ein bis drei Nutzer.", faqStoredQ: "Wird der geprüfte Text gespeichert?", faqStoredA: "Nein. Prüfungen im Web, in der Windows-App und mit einem Tarif werden analysiert und verworfen; Redaxa speichert nur Metadaten. Kostenlose Prüfungen in der Chrome-Erweiterung verlassen Ihr Gerät nie.", faqMissQ: "Findet Redaxa wirklich alles?", faqMissA: "Das kann kein Werkzeug versprechen. Die Erkennung kann sensible Informationen übersehen oder harmlosen Text markieren – prüfen Sie daher jedes Ergebnis, bevor Sie es teilen.",
    sevCritical: "Kritisch", sevHigh: "Hoch", sevMedium: "Mittel", sevLow: "Niedrig", sevCriticalHint: "Kann Zugriff auf ein Konto oder System geben", sevHighHint: "Direktes finanzielles Risiko oder starkes Identifikationsmerkmal", sevMediumHint: "Persönliche Angaben mit indirektem Schaden", sevLowHint: "Schwache Merkmale, je nach Kontext"
  }
};
for (const language of Object.keys(viewCopyByLanguage) as Language[]) Object.assign(copyByLanguage[language], viewCopyByLanguage[language]);

const settingsByLanguage: Record<Language, string[]> = {
  en: ["Preferences", "Saved in this browser only. Nothing here creates an account or uploads your text.", "Interface language", "Check mode", "Detect personal data (email, phone, IP, fiscal code)", "Detect API keys and credentials", "Detect cards and IBANs", "Keep local check summaries", "Show the detected value on screen", "Clear the prompt after copying its safer version", "Close", "Save preferences", "Custom protected terms"],
  it: ["Impostazioni personali", "Queste impostazioni restano in questo browser. Non creano un account online e non caricano il contenuto dei prompt.", "Lingua dell'interfaccia", "Modalità di controllo", "Rileva dati personali (email, telefono, IP, codice fiscale)", "Rileva API key e credenziali", "Rileva carte e IBAN", "Mantieni i riepiloghi locali", "Mostra il valore rilevato sullo schermo", "Svuota il prompt dopo aver copiato la versione sicura", "Chiudi", "Salva impostazioni", "Termini personali protetti"],
  es: ["Preferencias personales", "Estos ajustes permanecen en este navegador. No crean una cuenta ni suben el contenido de los prompts.", "Idioma de la interfaz", "Modo de revisión", "Detectar datos personales (correo, teléfono, IP, código fiscal)", "Detectar claves API y credenciales", "Detectar tarjetas e IBAN", "Guardar resúmenes locales", "Mostrar el valor detectado", "Limpiar el prompt después de copiar la versión segura", "Cerrar", "Guardar preferencias", "Términos protegidos personalizados"],
  fr: ["Préférences personnelles", "Ces réglages restent dans ce navigateur. Ils ne créent pas de compte et n’envoient pas le contenu des prompts.", "Langue de l’interface", "Mode de vérification", "Détecter les données personnelles (e-mail, téléphone, IP, code fiscal)", "Détecter les clés API et identifiants", "Détecter les cartes et IBAN", "Conserver les résumés locaux", "Afficher la valeur détectée", "Effacer le prompt après la copie", "Fermer", "Enregistrer", "Termes protégés personnalisés"],
  de: ["Persönliche Einstellungen", "Diese Einstellungen bleiben in diesem Browser. Sie erstellen kein Konto und laden keine Prompts hoch.", "Oberflächensprache", "Prüfmodus", "Personenbezogene Daten erkennen (E-Mail, Telefon, IP, Steuernummer)", "API-Schlüssel und Zugangsdaten erkennen", "Karten und IBAN erkennen", "Lokale Prüfzusammenfassungen speichern", "Erkannten Wert anzeigen", "Prompt nach dem Kopieren leeren", "Schließen", "Einstellungen speichern", "Eigene geschützte Begriffe"]
};
const findingLabelsByLanguage: Record<Language, Record<string, string>> = {
  en: { email: "Email", phone: "Phone", secret: "API key", card: "Card", ip: "IP address", iban: "IBAN", fiscalCode: "Fiscal code", credential: "Credential", ssn: "SSN", crypto: "Wallet address", privateKey: "Private key", name: "Personal name", address: "Street address", custom: "Custom term" },
  it: { email: "Email", phone: "Telefono", secret: "Chiave API", card: "Carta", ip: "Indirizzo IP", iban: "IBAN", fiscalCode: "Codice fiscale", credential: "Credenziale", ssn: "SSN", crypto: "Indirizzo wallet", privateKey: "Chiave privata", name: "Nome personale", address: "Indirizzo", custom: "Termine personalizzato" },
  es: { email: "Correo electrónico", phone: "Teléfono", secret: "Clave API", card: "Tarjeta", ip: "Dirección IP", iban: "IBAN", fiscalCode: "Código fiscal", credential: "Credencial", ssn: "SSN", crypto: "Dirección de wallet", privateKey: "Clave privada", name: "Nombre personal", address: "Dirección postal", custom: "Término personalizado" },
  fr: { email: "E-mail", phone: "Téléphone", secret: "Clé API", card: "Carte", ip: "Adresse IP", iban: "IBAN", fiscalCode: "Code fiscal", credential: "Identifiant", ssn: "SSN", crypto: "Adresse de portefeuille", privateKey: "Clé privée", name: "Nom personnel", address: "Adresse postale", custom: "Terme personnalisé" },
  de: { email: "E-Mail", phone: "Telefon", secret: "API-Schlüssel", card: "Karte", ip: "IP-Adresse", iban: "IBAN", fiscalCode: "Steuernummer", credential: "Zugangsdaten", ssn: "SSN", crypto: "Wallet-Adresse", privateKey: "Privater Schlüssel", name: "Persönlicher Name", address: "Straßenadresse", custom: "Eigener Begriff" }
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
const highRiskKinds = new Set(["secret", "privateKey", "credential", "card", "iban", "ssn", "crypto"]);

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
        theme: themes.some((t) => t.code === candidate.theme) ? candidate.theme as ThemeName : defaultTheme,
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
const fallbackSeverity: Record<string, FindingSeverity> = { secret: "critical", privateKey: "critical", credential: "critical", card: "high", iban: "high", ssn: "high", crypto: "high", fiscalCode: "high", email: "medium", phone: "medium", address: "medium", custom: "medium", name: "low", ip: "low" };
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
  const words = (): Record<string, string> => copyByLanguage[preferences.language];
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
        <input type="text" id="api-key-value" readonly aria-label="New API key">
        <button type="button" class="secondary" id="api-key-copy" data-i18n="apiCopy">Copy</button>
        <p class="pref-note" data-i18n="apiOnce">This key is shown once. Store it now — it cannot be recovered.</p>
      </div>
      <button type="button" class="secondary" id="api-key-create" data-i18n="apiCreate">Create API key</button>
    </section>`;
  // Static palette classes work under desktop CSP and repaint every surface.
  const themeRow = required<HTMLElement>("#theme-row");
  themeRow.innerHTML = themes.map((theme) => `<button type="button" class="theme-swatch theme-swatch-${theme.code}${theme.code === preferences.theme ? " active" : ""}" data-theme="${theme.code}" title="${theme.label}" aria-label="${theme.label} theme" aria-pressed="${theme.code === preferences.theme}"><span class="theme-dot" aria-hidden="true"></span><span>${theme.label}</span></button>`).join("");
  themeRow.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".theme-swatch");
    const code = button?.dataset.theme as ThemeName | undefined;
    if (!code) return;
    preferences.theme = code;
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
    <div class="billing-switch" role="group" aria-label="${w0.billingPeriod}" data-i18n-label="billingPeriod"><button type="button" data-billing="monthly" aria-pressed="false" data-i18n="billingMonthly">${w0.billingMonthly}</button><button type="button" data-billing="yearly" aria-pressed="true" data-i18n="billingYearly">${w0.billingYearly}</button></div>
    <div class="plan-grid">
      <article class="plan-card plan-free" data-plan-card="free" aria-labelledby="plan-free-name">
        <div class="plan-top"><h2 id="plan-free-name" data-i18n="freeName">${w0.freeName}</h2><span class="rx-badge rx-badge-current" data-current hidden data-i18n="currentPlan">${w0.currentPlan}</span></div>
        <p class="plan-desc" data-i18n="freeDesc">${w0.freeDesc}</p>
        <div class="plan-price" id="free-plan-price"></div>
        <p class="plan-note" data-i18n="freeNote">${w0.freeNote}</p>
        <div class="plan-actions"><a class="ghost-btn" href="#check" data-i18n="freeCta">${w0.freeCta}</a></div>
        ${benefits(["freeB1", "freeB2", "freeB3", "freeB4"])}
      </article>
      <article class="plan-card featured" data-plan-card="personal" aria-labelledby="plan-pro-name">
        <div class="plan-top"><h2 id="plan-pro-name" data-i18n="personalName">${w0.personalName}</h2><span class="rx-badge rx-badge-accent" data-i18n="recommended">${w0.recommended}</span><span class="rx-badge rx-badge-current" data-current hidden data-i18n="currentPlan">${w0.currentPlan}</span></div>
        <p class="plan-desc" data-i18n="personalDesc">${w0.personalDesc}</p>
        <div class="plan-price"></div>
        <p class="plan-note"></p>
        <div class="plan-actions">
          <button type="button" class="primary" data-plan="personal" data-interval="monthly">${w0.startTrial}</button>
          <button type="button" class="primary" data-plan="personal" data-interval="yearly">${w0.startTrial}</button>
          <button type="button" class="secondary plan-manage" hidden data-i18n="manageBtn">${w0.manageBtn}</button>
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
          <button type="button" class="primary" data-plan="business" data-interval="monthly">${w0.startTrial}</button>
          <button type="button" class="primary" data-plan="business" data-interval="yearly">${w0.startTrial}</button>
          <button type="button" class="secondary plan-manage" hidden data-i18n="manageBtn">${w0.manageBtn}</button>
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
        ${["Ext", "Server", "Meta", "Repo"].map((key) => `<article class="trust-item"><h3 data-i18n="trust${key}T">${w0[`trust${key}T`]}</h3><p data-i18n="trust${key}">${w0[`trust${key}`]}</p></article>`).join("")}
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
      <h3 data-i18n="orgPoliciesLabel">${w0.orgPoliciesLabel}</h3>
      <p class="card-note" data-i18n="orgPoliciesHint">${w0.orgPoliciesHint}</p>
      <ul id="org-policy-list"></ul>
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
  const promo = mountPromo(banner => required("#plans-status").after(banner), () => promoWordsByLanguage[preferences.language], () => preferences.language, view => {
    promoView = view;
    renderBilling();
  });
  const planCard = (plan: string): HTMLElement => required<HTMLElement>(`[data-plan-card="${plan}"]`);
  // Regular prices in euro cents, unchanged; only their formatting follows the language.
  const regularPrice = (cents: number, unit: string, monthlyEquivalent?: number): string =>
    `${euro(cents, preferences.language)} <small>${unit}</small>${monthlyEquivalent ? `<small class="price-equiv">${format(words().equivYearly, { price: euro(monthlyEquivalent, preferences.language) })}</small>` : ""}`;
  const renderBilling = (): void => {
    const promoWords = promoWordsByLanguage[preferences.language];
    plansView.querySelectorAll<HTMLElement>("[data-billing]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.billing === billingInterval)));
    plansView.querySelectorAll<HTMLElement>("[data-plan]").forEach(button => { button.hidden = button.dataset.interval !== billingInterval; button.textContent = words().startTrial; });
    const yearly = billingInterval === "yearly";
    const pro = promoView?.offer("personal", billingInterval) ?? null;
    const business = promoView?.offer("business", billingInterval) ?? null;
    promo.relabel();
    required<HTMLElement>("#free-plan-price").textContent = euro(0, preferences.language);
    planCard("personal").querySelector(".plan-price")!.innerHTML = pro ? promoPriceHtml(pro, promoWords, preferences.language) : yearly ? regularPrice(7990, promoWords.perYear, 666) : regularPrice(799, promoWords.perMonth);
    planCard("business").querySelector(".plan-price")!.innerHTML = business ? promoPriceHtml(business, promoWords, preferences.language) : yearly ? regularPrice(14990, promoWords.perUserYear, 1249) : regularPrice(1499, promoWords.perUserMonth);
    renderPlanChoice();
  };
  plansView.querySelectorAll<HTMLElement>("[data-billing]").forEach(button => button.addEventListener("click", () => { billingInterval = button.dataset.billing === "monthly" ? "monthly" : "yearly"; renderBilling(); }));
  // Every "Manage subscription" control reaches the one button auth.ts binds to the billing portal.
  [required<HTMLButtonElement>("#plans-manage"), ...plansView.querySelectorAll<HTMLButtonElement>(".plan-manage")]
    .forEach(button => button.addEventListener("click", () => required<HTMLButtonElement>("#manage-billing").click()));

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
          const sevLabel = severity ? ` (≥ ${severity})` : "";
          return `<li><span>${categoryLabel(category)}</span><span>${label}${sevLabel}</span></li>`;
        }
        const option = (value: string, label: string, selected: string): string => `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`;
        const actions = `<select data-policy-category="${category}">${option("default", words().polDefault, current)}${option("warn", words().polWarn, current)}${option("redact", words().polRedact, current)}${option("block", words().polBlock, current)}</select>`;
        // Severity floor only makes sense once an override exists.
        const severities = `<select data-policy-severity="${category}"${current === "default" ? " disabled" : ""}>${option("", words().sevAny, severity)}${option("medium", "≥ medium", severity)}${option("high", "≥ high", severity)}${option("critical", "≥ critical", severity)}</select>`;
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
  const viewLabelKey: Record<ViewName, string> = { check: "navCheck", activity: "navActivity", terms: "navTerms", settings: "navSettings", plans: "plans", account: "navAccount" };
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
  window.addEventListener("hashchange", () => { showView(location.hash, true); });
  // A rail or menu link to the page already on screen still moves focus there.
  document.addEventListener("click", (event) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"], .ps-menu-link[href]');
    if (!link) return;
    const url = new URL(link.href);
    if (url.pathname === location.pathname && url.hash === location.hash && viewForHash[url.hash]) { event.preventDefault(); showView(url.hash, true); }
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
      theme: preferences.theme !== defaultPreferences.theme
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
    const paid = Boolean(accountState?.active);
    required<HTMLElement>("#side-fill").hidden = paid;
    if (accountState?.status === "trialing" && accountState.currentPeriodEnd) {
      const daysLeft = Math.max(0, Math.ceil((new Date(accountState.currentPeriodEnd).getTime() - Date.now()) / 86_400_000));
      const dayNumber = Math.min(trialLengthDays, Math.max(1, trialLengthDays - daysLeft + 1));
      planLabel.textContent = w.planTrial;
      planValue.textContent = daysLeft <= 0 ? w.planEndsToday : plural(w.planDaysLeft, daysLeft);
      planTrack.hidden = false;
      planFill.style.width = `${Math.round((dayNumber / trialLengthDays) * 100)}%`;
      planTrack.setAttribute("aria-label", format(w.planDayOf, { day: dayNumber, total: trialLengthDays }));
      planNote.textContent = w.planTrialNote;
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
    const held = accountState?.active ? (accountState.plan === "business" ? "business" : "personal") : "free";
    plansView.querySelectorAll<HTMLElement>("[data-plan-card]").forEach((card) => {
      const mine = card.dataset.planCard === held;
      card.classList.toggle("is-current", mine);
      card.querySelector<HTMLElement>("[data-current]")!.hidden = !mine;
      const manage = card.querySelector<HTMLElement>(".plan-manage");
      if (!manage) return;
      manage.hidden = !mine;
      if (mine) card.querySelectorAll<HTMLElement>("[data-plan]").forEach((button) => { button.hidden = true; });
    });
    const trialing = accountState?.status === "trialing" && accountState.currentPeriodEnd;
    const left = trialing ? Math.max(0, Math.ceil((new Date(accountState!.currentPeriodEnd!).getTime() - Date.now()) / 86_400_000)) : 0;
    const label = held === "free" ? w.freeName : planName(accountState?.plan);
    required<HTMLElement>("#plans-status-badge").textContent = trialing ? w.planTrial : label;
    required<HTMLElement>("#plans-status-text").textContent = trialing
      ? format(w.statusTrial, { left: left <= 0 ? w.planEndsToday : plural(w.planDaysLeft, left) })
      : held === "free" ? w.statusFree : format(w.statusActive, { plan: label });
    required<HTMLElement>("#plans-manage").hidden = held === "free";
    // Without a subscription there is nothing to manage yet: plans come first.
    required<HTMLElement>("#manage-billing").hidden = held === "free";
    required<HTMLElement>("#account-compare").classList.toggle("primary", held === "free");
    required<HTMLElement>("#account-compare").classList.toggle("ghost-btn", held !== "free");
    required<HTMLElement>("#plans-status").classList.toggle("is-paid", held !== "free");
    required<HTMLElement>("#account-plan-badge").textContent = trialing ? w.planTrial : label;
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
    renderPlanStatus();
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
    };
  }
}

if (typeof document !== "undefined") mountDashboard();
