import type { Finding, ScanOptions } from "./scanner.js";
import type { AccountState } from "./auth.js";
import { enableAppShell } from "./pwa.js";
import { enableDesktopCompanion } from "./desktop.js";

type HistoryEntry = { id: string; createdAt: string; findings: number; preview: string; byKind: Record<string, number> };
type Language = "en" | "it" | "es" | "fr" | "de";
type ThemeName = "lime" | "violet" | "teal" | "amber" | "crimson" | "ocean" | "emerald" | "gold" | "slate" | "indigo" | "coral";
type Preferences = ScanOptions & { language: Language; theme: ThemeName; scanMode: "standard" | "strict"; saveHistory: boolean; autoClearAfterCopy: boolean; showRawValues: boolean; customTerms: string[] };
type RiskLevel = "none" | "medium" | "high";

const storageKey = "redaxa.personal-history.v1";
const preferencesKey = "redaxa.personal-preferences.v1";
const maxPromptLength = 10_000;

const defaultPreferences: Preferences = { language: "en", theme: "violet", scanMode: "standard", includePersonalData: true, includeCredentials: true, includeFinancialData: true, saveHistory: true, autoClearAfterCopy: false, showRawValues: true, customTerms: [] };

const themes: { code: ThemeName; label: string; accent: string; accentInk: string; swatch: [string, string] }[] = [
  { code: "lime", label: "Lime", accent: "#b9ff00", accentInk: "#080a07", swatch: ["#b9ff00", "#6dd400"] },
  { code: "violet", label: "Violet", accent: "#7c5cfc", accentInk: "#14092e", swatch: ["#7c5cfc", "#5b3de0"] },
  { code: "teal", label: "Teal Depths", accent: "#35e0c0", accentInk: "#062019", swatch: ["#35e0c0", "#ff5c8a"] },
  { code: "amber", label: "Amber Dusk", accent: "#ffb84d", accentInk: "#241202", swatch: ["#ffb84d", "#5bd1ff"] },
  { code: "crimson", label: "Crimson Steel", accent: "#ff4d6d", accentInk: "#1c0509", swatch: ["#ff4d6d", "#4ce0b3"] },
  { code: "ocean", label: "Ocean Blue", accent: "#3d8bff", accentInk: "#04101f", swatch: ["#3d8bff", "#ffb74d"] },
  { code: "emerald", label: "Forest Emerald", accent: "#2ecc71", accentInk: "#052012", swatch: ["#2ecc71", "#ff6f91"] },
  { code: "gold", label: "Royal Gold", accent: "#e8b923", accentInk: "#201802", swatch: ["#e8b923", "#6f5bff"] },
  { code: "slate", label: "Slate Mono", accent: "#9aa5b1", accentInk: "#14171a", swatch: ["#9aa5b1", "#6ee7b7"] },
  { code: "indigo", label: "Indigo Night", accent: "#6c63ff", accentInk: "#0d0a1f", swatch: ["#6c63ff", "#ffc155"] },
  { code: "coral", label: "Coral Sunset", accent: "#ff7a45", accentInk: "#200902", swatch: ["#ff7a45", "#4dd9e8"] }
];

function applyTheme(theme: ThemeName): void {
  const match = themes.find((candidate) => candidate.code === theme) ?? themes[0];
  document.documentElement.style.setProperty("--accent", match.accent);
  document.documentElement.style.setProperty("--accent-ink", match.accentInk);
}

const languageNames: Record<Language, string> = { en: "English", it: "Italiano", es: "Español", fr: "Français", de: "Deutsch" };
const copyByLanguage: Record<Language, Record<string, string>> = {
  en: {
    workspace: "Workspace", privateCheck: "Check a prompt", recent: "Recent checks", account: "Account", plans: "Plans & pricing", preferences: "Preferences",
    eyebrow: "Personal workspace", title: "Your private AI checkpoint.", subtitle: "Review a prompt before it reaches any AI tool.",
    scan: "Inspect prompt →", clear: "Clear", history: "Recent local checks", clearHistory: "Clear history",
    placeholder: "e.g. Draft a reply to Marco Rossi (m.rossi@acme.com) about the ACME invoice — my direct line is +39 02 5555 0180",
    composerTitle: "Check your prompt before sharing it with AI", composerSub: "Paste anything you are about to send to ChatGPT, Claude, Gemini or Copilot.", promptLabel: "Prompt to check",
    tryLabel: "Try an example", sampleBrief: "Client brief", sampleApiKey: "API key", sampleEmail: "Email draft", samplePersonal: "Personal details",
    metaLabel: "Private scan — your prompt is never stored or logged.", howPrivacyWorks: "How privacy works", interfaceLanguage: "Interface language",
    scanModeStandard: "Standard — balanced checks", scanModeStrict: "Strict — careful review mode",
    resultsTitle: "Results", previewItems: "3 sensitive items in this prompt",
    redactBeforeSharing: "Redact before sharing", previewFoot: "Paste your own prompt on the left to run a real check.", detectsLabel: "Also detects",
    riskHigh: "High risk", riskMedium: "Review before sharing", riskNone: "No risks found",
    actionHigh: "{n} sensitive item found. Replace it, or copy the redacted version below.|{n} sensitive items found. Replace them, or copy the redacted version below.",
    actionMedium: "{n} item to review before sharing this prompt.|{n} items to review before sharing this prompt.",
    actionNone: "Nothing obvious found. This is a helpful signal, not a guarantee.",
    checking: "Checking…", promptTooLong: "Prompt is too long", keepUnder: "Keep it under {max} characters for a check.",
    checkFailed: "Check failed", couldNotRunCheck: "We could not run that check. Please try again.",
    sensitiveValueHidden: "Value hidden", saferVersion: "Safer version", copySafer: "Copy redacted prompt", copied: "Copied",
    readyToInspect: "Ready to inspect", willCheckFor: "We will check for common personal data and secrets.",
    noChecksYet: "No checks yet", lastEightWillAppear: "Your last eight check summaries will appear here.", nothingFlagged: "Nothing flagged in this check.",
    itemsReviewed: "{n} item reviewed|{n} items reviewed",
    createAccountTrial: "Create your account and start your 7-day free trial to inspect prompts.", startTrialToInspect: "Start your 7-day free trial to inspect prompts.",
    usageLabel: "Checks this week", freeTrialBadge: "What a plan unlocks", freeTrialDesc: "Unlimited checks, custom protected terms, and up to 3 team seats.", seePlans: "Compare plans →",
    zeroRetentionDesc: "Prompts are checked, never stored or logged.", createAccountBtn: "Create account", protectionActive: "Protection active",
    onboardCheckTitle: "Run your first check", onboardCheckDesc: "Paste a prompt and inspect it once.",
    onboardTermsTitle: "Add a custom term", onboardTermsDesc: "Protect a client or project name in Preferences.",
    onboardThemeTitle: "Pick a theme", onboardThemeDesc: "Make the workspace yours in Preferences.",
    activityTitle: "Your activity", activityEmpty: "Your privacy activity will appear here after your first check.", last7: "Last 7 days", byType: "By detection type",
    metricChecked: "Prompts checked", metricItems: "Sensitive items found", metricTop: "Most common detection", metricLast: "Last check",
    plansTitle: "Plans & pricing", plansIntro: "Every plan starts with a 7-day trial. Use code {code} for 20% off your first monthly payment.",
    personalTag: "For individuals", personalName: "Personal", personalDesc: "For independent professionals who use AI with real client and personal information.",
    startTrial: "Start 7-day trial", yearlyPersonal: "€79.90 yearly",
    businessTag: "For teams · up to 3 users", businessName: "Business", businessDesc: "Team controls and a clear privacy boundary for growing teams. Choose one to three seats.",
    seatsLabel: "Seats", seat1: "1 user", seat2: "2 users", seat3: "3 users", yearlyBusiness: "€149.90 yearly / user",
    manageTag: "Already subscribed?", manageTitle: "Manage billing", manageDesc: "Update your payment method, download invoices, or cancel renewal whenever you need to.", manageBtn: "Manage subscription",
    teamTitle: "Team", teamSeatsUsed: "{used} of {total} seats used.", inviteCreate: "Create invite link", copyLink: "Copy link", noInvites: "No invites yet.", teammateJoined: "Teammate joined", invitePending: "Invite pending", revoke: "Revoke", couldNotCreateInvite: "We could not create an invite.",
    orgTitle: "Organization", orgIntro: "Shared protection for your whole workspace. Protected terms apply to every member's checks, on every device.", orgMembersLabel: "Members", orgTermsLabel: "Protected terms", orgTermsHint: "Project codenames, client names — flagged in every member's prompts.", orgTermAdd: "Add", orgTermPlaceholder: "e.g. Project Falcon", orgRoleOwner: "Owner", orgRoleAdmin: "Admin", orgRoleMember: "Member", orgYou: "you", orgRenameSave: "Save name", orgNoTerms: "No protected terms yet.", orgRemove: "Remove", acctActivity: "Across your account — all devices", orgActivity: "Organization activity", orgChecks: "Team checks", orgFlagged: "Flagged", orgBlocked: "Blocked", orgTopCat: "Top category", orgByMember: "By member", orgExport: "Export CSV (metadata only)", orgPoliciesLabel: "Policies", orgPoliciesHint: "What happens when a category is found in a member's prompt. Block prevents sending from the extension until fixed.", polDefault: "Default", polWarn: "Warn", polRedact: "Redact", polBlock: "Block", catPersonal: "Personal data", catCredentials: "Credentials", catFinancial: "Financial data", catCustom: "Protected terms", sevAny: "any severity",
    previewBadge: "Preview", previewLabel: "example result — not your prompt", planNone: "No active plan", planNoneNote: "Start a 7-day free trial to run checks.", planTrial: "Free trial", planTrialNote: "Your trial covers unlimited checks. Add a plan to keep them running.", planActive: "Active plan", planActiveNote: "Unlimited checks and custom protected terms are on.", planDayOf: "Day {day} of {total}", planEndsToday: "Ends today", planDaysLeft: "{n} day left|{n} days left", foundInPrompt: "Found in your prompt"
  },
  it: {
    workspace: "Spazio di lavoro", privateCheck: "Controlla un prompt", recent: "Controlli recenti", account: "Account", plans: "Piani e prezzi", preferences: "Impostazioni",
    eyebrow: "Spazio personale", title: "Il tuo controllo AI privato.", subtitle: "Rivedi un prompt prima di inviarlo a uno strumento AI.",
    scan: "Controlla prompt →", clear: "Svuota", history: "Controlli locali recenti", clearHistory: "Cancella cronologia",
    placeholder: "es. Scrivi una risposta a Marco Rossi (m.rossi@acme.com) sulla fattura ACME — il mio numero diretto è +39 02 5555 0180",
    composerTitle: "Controlla il prompt prima di condividerlo con l'AI", composerSub: "Incolla qualsiasi cosa tu stia per inviare a ChatGPT, Claude, Gemini o Copilot.", promptLabel: "Prompt da controllare",
    tryLabel: "Prova un esempio", sampleBrief: "Brief cliente", sampleApiKey: "Chiave API", sampleEmail: "Bozza email", samplePersonal: "Dati personali",
    metaLabel: "Controllo privato — il prompt non viene mai salvato né registrato.", howPrivacyWorks: "Come funziona la privacy", interfaceLanguage: "Lingua dell'interfaccia",
    scanModeStandard: "Standard — controlli bilanciati", scanModeStrict: "Rigorosa — modalità di revisione attenta",
    resultsTitle: "Risultati", previewItems: "3 elementi sensibili in questo prompt",
    redactBeforeSharing: "Rimuovi i dati prima di condividere", previewFoot: "Incolla il tuo prompt a sinistra per eseguire un controllo reale.", detectsLabel: "Rileva anche",
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
    createAccountTrial: "Crea il tuo account e avvia la prova gratuita di 7 giorni per controllare i prompt.", startTrialToInspect: "Avvia la prova gratuita di 7 giorni per controllare i prompt.",
    usageLabel: "Controlli questa settimana", freeTrialBadge: "Cosa sblocca un piano", freeTrialDesc: "Controlli illimitati, termini protetti personalizzati e fino a 3 posti per il team.", seePlans: "Confronta i piani →",
    zeroRetentionDesc: "I prompt vengono controllati, mai salvati né registrati.", createAccountBtn: "Crea account", protectionActive: "Protezione attiva",
    onboardCheckTitle: "Esegui il tuo primo controllo", onboardCheckDesc: "Incolla un prompt e controllalo una volta.",
    onboardTermsTitle: "Aggiungi un termine personalizzato", onboardTermsDesc: "Proteggi il nome di un cliente o progetto nelle Impostazioni.",
    onboardThemeTitle: "Scegli un tema", onboardThemeDesc: "Rendi personale lo spazio di lavoro nelle Impostazioni.",
    activityTitle: "La tua attività", activityEmpty: "La tua attività comparirà qui dopo il primo controllo.", last7: "Ultimi 7 giorni", byType: "Per tipo di rilevamento",
    metricChecked: "Prompt controllati", metricItems: "Elementi sensibili trovati", metricTop: "Rilevamento più frequente", metricLast: "Ultimo controllo",
    plansTitle: "Piani e prezzi", plansIntro: "Ogni piano inizia con una prova gratuita di 7 giorni. Usa il codice {code} per il 20% di sconto sul primo pagamento mensile.",
    personalTag: "Per privati", personalName: "Personal", personalDesc: "Per professionisti indipendenti che usano l'AI con dati reali di clienti e informazioni personali.",
    startTrial: "Avvia prova di 7 giorni", yearlyPersonal: "€79,90 all'anno",
    businessTag: "Per team · fino a 3 utenti", businessName: "Business", businessDesc: "Controlli di team e un confine di privacy chiaro per team in crescita. Scegli da uno a tre posti.",
    seatsLabel: "Posti", seat1: "1 utente", seat2: "2 utenti", seat3: "3 utenti", yearlyBusiness: "€149,90 all'anno / utente",
    manageTag: "Già abbonato?", manageTitle: "Gestisci fatturazione", manageDesc: "Aggiorna il metodo di pagamento, scarica le fatture o annulla il rinnovo quando vuoi.", manageBtn: "Gestisci abbonamento",
    teamTitle: "Team", teamSeatsUsed: "{used} di {total} posti utilizzati.", inviteCreate: "Crea link di invito", copyLink: "Copia link", noInvites: "Nessun invito ancora.", teammateJoined: "Collega entrato", invitePending: "Invito in sospeso", revoke: "Revoca", couldNotCreateInvite: "Non è stato possibile creare un invito.",
    orgTitle: "Organizzazione", orgIntro: "Protezione condivisa per tutto il workspace. I termini protetti valgono per i controlli di ogni membro, su ogni dispositivo.", orgMembersLabel: "Membri", orgTermsLabel: "Termini protetti", orgTermsHint: "Nomi in codice, nomi di clienti — segnalati nei prompt di ogni membro.", orgTermAdd: "Aggiungi", orgTermPlaceholder: "es. Progetto Falco", orgRoleOwner: "Proprietario", orgRoleAdmin: "Admin", orgRoleMember: "Membro", orgYou: "tu", orgRenameSave: "Salva nome", orgNoTerms: "Nessun termine protetto ancora.", orgRemove: "Rimuovi", acctActivity: "Sul tuo account — tutti i dispositivi", orgActivity: "Attività dell'organizzazione", orgChecks: "Controlli del team", orgFlagged: "Segnalati", orgBlocked: "Bloccati", orgTopCat: "Categoria principale", orgByMember: "Per membro", orgExport: "Esporta CSV (solo metadata)", orgPoliciesLabel: "Policy", orgPoliciesHint: "Cosa succede quando una categoria viene trovata nel prompt di un membro. Blocca impedisce l'invio dall'estensione finché non correggi.", polDefault: "Predefinito", polWarn: "Avvisa", polRedact: "Redigi", polBlock: "Blocca", catPersonal: "Dati personali", catCredentials: "Credenziali", catFinancial: "Dati finanziari", catCustom: "Termini protetti", sevAny: "qualsiasi gravità",
    previewBadge: "Anteprima", previewLabel: "risultato di esempio — non il tuo prompt", planNone: "Nessun piano attivo", planNoneNote: "Avvia la prova gratuita di 7 giorni per eseguire controlli.", planTrial: "Prova gratuita", planTrialNote: "La prova include controlli illimitati. Aggiungi un piano per non interromperli.", planActive: "Piano attivo", planActiveNote: "Controlli illimitati e termini protetti personalizzati sono attivi.", planDayOf: "Giorno {day} di {total}", planEndsToday: "Scade oggi", planDaysLeft: "{n} giorno rimasto|{n} giorni rimasti", foundInPrompt: "Trovato nel tuo prompt"
  },
  es: {
    workspace: "Espacio de trabajo", privateCheck: "Revisar un prompt", recent: "Revisiones recientes", account: "Cuenta", plans: "Planes y precios", preferences: "Preferencias",
    eyebrow: "Espacio personal", title: "Tu punto de control privado para IA.", subtitle: "Revisa un prompt antes de enviarlo a una herramienta de IA.",
    scan: "Revisar prompt →", clear: "Limpiar", history: "Revisiones locales recientes", clearHistory: "Borrar historial",
    placeholder: "p. ej. Redacta una respuesta a Marco Rossi (m.rossi@acme.com) sobre la factura de ACME — mi línea directa es +39 02 5555 0180",
    composerTitle: "Revisa tu prompt antes de compartirlo con la IA", composerSub: "Pega lo que estés a punto de enviar a ChatGPT, Claude, Gemini o Copilot.", promptLabel: "Prompt para revisar",
    tryLabel: "Prueba un ejemplo", sampleBrief: "Brief de cliente", sampleApiKey: "Clave API", sampleEmail: "Borrador de correo", samplePersonal: "Datos personales",
    metaLabel: "Revisión privada — tu prompt nunca se guarda ni se registra.", howPrivacyWorks: "Cómo funciona la privacidad", interfaceLanguage: "Idioma de la interfaz",
    scanModeStandard: "Estándar — revisiones equilibradas", scanModeStrict: "Estricto — modo de revisión cuidadosa",
    resultsTitle: "Resultados", previewItems: "3 elementos sensibles en este prompt",
    redactBeforeSharing: "Oculta los datos antes de compartir", previewFoot: "Pega tu propio prompt a la izquierda para hacer una revisión real.", detectsLabel: "También detecta",
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
    createAccountTrial: "Crea tu cuenta y comienza tu prueba gratuita de 7 días para revisar prompts.", startTrialToInspect: "Comienza tu prueba gratuita de 7 días para revisar prompts.",
    usageLabel: "Revisiones esta semana", freeTrialBadge: "Qué desbloquea un plan", freeTrialDesc: "Revisiones ilimitadas, términos protegidos propios y hasta 3 puestos de equipo.", seePlans: "Comparar planes →",
    zeroRetentionDesc: "Los prompts se revisan, nunca se guardan ni se registran.", createAccountBtn: "Crear cuenta", protectionActive: "Protección activa",
    onboardCheckTitle: "Haz tu primera revisión", onboardCheckDesc: "Pega un prompt y revísalo una vez.",
    onboardTermsTitle: "Añade un término personalizado", onboardTermsDesc: "Protege el nombre de un cliente o proyecto en Preferencias.",
    onboardThemeTitle: "Elige un tema", onboardThemeDesc: "Personaliza tu espacio de trabajo en Preferencias.",
    activityTitle: "Tu actividad", activityEmpty: "Tu actividad de privacidad aparecerá aquí después de tu primera revisión.", last7: "Últimos 7 días", byType: "Por tipo de detección",
    metricChecked: "Prompts revisados", metricItems: "Elementos sensibles encontrados", metricTop: "Detección más frecuente", metricLast: "Última revisión",
    plansTitle: "Planes y precios", plansIntro: "Todos los planes comienzan con una prueba gratuita de 7 días. Usa el código {code} para un 20% de descuento en tu primer pago mensual.",
    personalTag: "Para particulares", personalName: "Personal", personalDesc: "Para profesionales independientes que usan IA con datos reales de clientes e información personal.",
    startTrial: "Comenzar prueba de 7 días", yearlyPersonal: "79,90 € al año",
    businessTag: "Para equipos · hasta 3 usuarios", businessName: "Business", businessDesc: "Controles de equipo y un límite de privacidad claro para equipos en crecimiento. Elige entre uno y tres puestos.",
    seatsLabel: "Puestos", seat1: "1 usuario", seat2: "2 usuarios", seat3: "3 usuarios", yearlyBusiness: "149,90 € al año / usuario",
    manageTag: "¿Ya estás suscrito?", manageTitle: "Gestionar facturación", manageDesc: "Actualiza tu método de pago, descarga facturas o cancela la renovación cuando quieras.", manageBtn: "Gestionar suscripción",
    teamTitle: "Equipo", teamSeatsUsed: "{used} de {total} puestos usados.", inviteCreate: "Crear enlace de invitación", copyLink: "Copiar enlace", noInvites: "Aún no hay invitaciones.", teammateJoined: "Compañero incorporado", invitePending: "Invitación pendiente", revoke: "Revocar", couldNotCreateInvite: "No se pudo crear la invitación.",
    orgTitle: "Organización", orgIntro: "Protección compartida para todo el espacio de trabajo. Los términos protegidos se aplican a los controles de cada miembro, en cada dispositivo.", orgMembersLabel: "Miembros", orgTermsLabel: "Términos protegidos", orgTermsHint: "Nombres en clave, nombres de clientes — señalados en los prompts de cada miembro.", orgTermAdd: "Añadir", orgTermPlaceholder: "p. ej. Proyecto Halcón", orgRoleOwner: "Propietario", orgRoleAdmin: "Admin", orgRoleMember: "Miembro", orgYou: "tú", orgRenameSave: "Guardar nombre", orgNoTerms: "Aún no hay términos protegidos.", orgRemove: "Quitar", acctActivity: "En tu cuenta — todos los dispositivos", orgActivity: "Actividad de la organización", orgChecks: "Controles del equipo", orgFlagged: "Señalados", orgBlocked: "Bloqueados", orgTopCat: "Categoría principal", orgByMember: "Por miembro", orgExport: "Exportar CSV (solo metadatos)", orgPoliciesLabel: "Políticas", orgPoliciesHint: "Qué ocurre cuando se encuentra una categoría en el prompt de un miembro. Bloquear impide el envío desde la extensión hasta corregirlo.", polDefault: "Predeterminado", polWarn: "Avisar", polRedact: "Censurar", polBlock: "Bloquear", catPersonal: "Datos personales", catCredentials: "Credenciales", catFinancial: "Datos financieros", catCustom: "Términos protegidos", sevAny: "cualquier gravedad",
    previewBadge: "Vista previa", previewLabel: "resultado de ejemplo — no es tu prompt", planNone: "Sin plan activo", planNoneNote: "Comienza la prueba gratuita de 7 días para hacer revisiones.", planTrial: "Prueba gratuita", planTrialNote: "Tu prueba incluye revisiones ilimitadas. Añade un plan para no interrumpirlas.", planActive: "Plan activo", planActiveNote: "Revisiones ilimitadas y términos protegidos propios están activos.", planDayOf: "Día {day} de {total}", planEndsToday: "Termina hoy", planDaysLeft: "Queda {n} día|Quedan {n} días", foundInPrompt: "Encontrado en tu prompt"
  },
  fr: {
    workspace: "Espace de travail", privateCheck: "Vérifier un prompt", recent: "Vérifications récentes", account: "Compte", plans: "Offres et tarifs", preferences: "Préférences",
    eyebrow: "Espace personnel", title: "Votre contrôle IA privé.", subtitle: "Vérifiez un prompt avant de l’envoyer à un outil d’IA.",
    scan: "Vérifier le prompt →", clear: "Effacer", history: "Vérifications locales récentes", clearHistory: "Effacer l’historique",
    placeholder: "ex. Rédige une réponse à Marco Rossi (m.rossi@acme.com) au sujet de la facture ACME — ma ligne directe est le +39 02 5555 0180",
    composerTitle: "Vérifiez votre prompt avant de le partager avec l’IA", composerSub: "Collez ce que vous vous apprêtez à envoyer à ChatGPT, Claude, Gemini ou Copilot.", promptLabel: "Prompt à vérifier",
    tryLabel: "Essayez un exemple", sampleBrief: "Brief client", sampleApiKey: "Clé API", sampleEmail: "Brouillon d’e-mail", samplePersonal: "Données personnelles",
    metaLabel: "Vérification privée — votre prompt n’est jamais stocké ni enregistré.", howPrivacyWorks: "Comment fonctionne la confidentialité", interfaceLanguage: "Langue de l’interface",
    scanModeStandard: "Standard — vérifications équilibrées", scanModeStrict: "Stricte — mode de révision attentive",
    resultsTitle: "Résultats", previewItems: "3 éléments sensibles dans ce prompt",
    redactBeforeSharing: "Masquez les données avant de partager", previewFoot: "Collez votre propre prompt à gauche pour lancer une vraie vérification.", detectsLabel: "Détecte aussi",
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
    createAccountTrial: "Créez votre compte et démarrez votre essai gratuit de 7 jours pour vérifier des prompts.", startTrialToInspect: "Démarrez votre essai gratuit de 7 jours pour vérifier des prompts.",
    usageLabel: "Vérifications cette semaine", freeTrialBadge: "Ce qu’une offre débloque", freeTrialDesc: "Vérifications illimitées, termes protégés personnalisés et jusqu’à 3 postes d’équipe.", seePlans: "Comparer les offres →",
    zeroRetentionDesc: "Les prompts sont vérifiés, jamais stockés ni enregistrés.", createAccountBtn: "Créer un compte", protectionActive: "Protection active",
    onboardCheckTitle: "Effectuez votre première vérification", onboardCheckDesc: "Collez un prompt et vérifiez-le une fois.",
    onboardTermsTitle: "Ajoutez un terme personnalisé", onboardTermsDesc: "Protégez le nom d’un client ou d’un projet dans les Préférences.",
    onboardThemeTitle: "Choisissez un thème", onboardThemeDesc: "Personnalisez votre espace de travail dans les Préférences.",
    activityTitle: "Votre activité", activityEmpty: "Votre activité de confidentialité apparaîtra ici après votre première vérification.", last7: "7 derniers jours", byType: "Par type de détection",
    metricChecked: "Prompts vérifiés", metricItems: "Éléments sensibles trouvés", metricTop: "Détection la plus fréquente", metricLast: "Dernière vérification",
    plansTitle: "Offres et tarifs", plansIntro: "Chaque offre commence par un essai gratuit de 7 jours. Utilisez le code {code} pour 20 % de réduction sur votre premier paiement mensuel.",
    personalTag: "Pour les particuliers", personalName: "Personal", personalDesc: "Pour les professionnels indépendants qui utilisent l’IA avec de vraies données clients et personnelles.",
    startTrial: "Démarrer l’essai de 7 jours", yearlyPersonal: "79,90 € par an",
    businessTag: "Pour les équipes · jusqu’à 3 utilisateurs", businessName: "Business", businessDesc: "Des contrôles d’équipe et une limite de confidentialité claire pour les équipes en croissance. Choisissez de un à trois postes.",
    seatsLabel: "Postes", seat1: "1 utilisateur", seat2: "2 utilisateurs", seat3: "3 utilisateurs", yearlyBusiness: "149,90 € par an / utilisateur",
    manageTag: "Déjà abonné ?", manageTitle: "Gérer la facturation", manageDesc: "Mettez à jour votre moyen de paiement, téléchargez vos factures ou annulez le renouvellement quand vous le souhaitez.", manageBtn: "Gérer l’abonnement",
    teamTitle: "Équipe", teamSeatsUsed: "{used} poste(s) utilisé(s) sur {total}.", inviteCreate: "Créer un lien d’invitation", copyLink: "Copier le lien", noInvites: "Aucune invitation pour l’instant.", teammateJoined: "Coéquipier ajouté", invitePending: "Invitation en attente", revoke: "Révoquer", couldNotCreateInvite: "Impossible de créer une invitation.",
    orgTitle: "Organisation", orgIntro: "Une protection partagée pour tout l'espace de travail. Les termes protégés s'appliquent aux contrôles de chaque membre, sur chaque appareil.", orgMembersLabel: "Membres", orgTermsLabel: "Termes protégés", orgTermsHint: "Noms de code, noms de clients — signalés dans les prompts de chaque membre.", orgTermAdd: "Ajouter", orgTermPlaceholder: "ex. Projet Faucon", orgRoleOwner: "Propriétaire", orgRoleAdmin: "Admin", orgRoleMember: "Membre", orgYou: "vous", orgRenameSave: "Enregistrer le nom", orgNoTerms: "Aucun terme protégé pour l'instant.", orgRemove: "Retirer", acctActivity: "Sur votre compte — tous les appareils", orgActivity: "Activité de l'organisation", orgChecks: "Contrôles de l'équipe", orgFlagged: "Signalés", orgBlocked: "Bloqués", orgTopCat: "Catégorie principale", orgByMember: "Par membre", orgExport: "Exporter CSV (métadonnées uniquement)", orgPoliciesLabel: "Politiques", orgPoliciesHint: "Ce qui se passe quand une catégorie est détectée dans le prompt d'un membre. Bloquer empêche l'envoi depuis l'extension jusqu'à correction.", polDefault: "Par défaut", polWarn: "Avertir", polRedact: "Caviarder", polBlock: "Bloquer", catPersonal: "Données personnelles", catCredentials: "Identifiants", catFinancial: "Données financières", catCustom: "Termes protégés", sevAny: "toute gravité",
    previewBadge: "Aperçu", previewLabel: "résultat d’exemple — pas votre prompt", planNone: "Aucune offre active", planNoneNote: "Démarrez l’essai gratuit de 7 jours pour lancer des vérifications.", planTrial: "Essai gratuit", planTrialNote: "Votre essai couvre des vérifications illimitées. Ajoutez une offre pour les poursuivre.", planActive: "Offre active", planActiveNote: "Vérifications illimitées et termes protégés personnalisés sont actifs.", planDayOf: "Jour {day} sur {total}", planEndsToday: "Se termine aujourd’hui", planDaysLeft: "{n} jour restant|{n} jours restants", foundInPrompt: "Trouvé dans votre prompt"
  },
  de: {
    workspace: "Arbeitsbereich", privateCheck: "Prompt prüfen", recent: "Letzte Prüfungen", account: "Konto", plans: "Tarife & Preise", preferences: "Einstellungen",
    eyebrow: "Persönlicher Bereich", title: "Ihr privater KI-Prüfpunkt.", subtitle: "Prüfen Sie einen Prompt, bevor er ein KI-Tool erreicht.",
    scan: "Prompt prüfen →", clear: "Leeren", history: "Letzte lokale Prüfungen", clearHistory: "Verlauf löschen",
    placeholder: "z. B. Entwirf eine Antwort an Marco Rossi (m.rossi@acme.com) zur ACME-Rechnung — meine Durchwahl ist +39 02 5555 0180",
    composerTitle: "Prüfen Sie Ihren Prompt, bevor Sie ihn mit KI teilen", composerSub: "Fügen Sie ein, was Sie gerade an ChatGPT, Claude, Gemini oder Copilot senden wollen.", promptLabel: "Zu prüfender Prompt",
    tryLabel: "Beispiel ausprobieren", sampleBrief: "Kunden-Briefing", sampleApiKey: "API-Schlüssel", sampleEmail: "E-Mail-Entwurf", samplePersonal: "Persönliche Daten",
    metaLabel: "Private Prüfung — Ihr Prompt wird nie gespeichert oder protokolliert.", howPrivacyWorks: "So funktioniert der Datenschutz", interfaceLanguage: "Oberflächensprache",
    scanModeStandard: "Standard — ausgewogene Prüfungen", scanModeStrict: "Streng — sorgfältiger Prüfmodus",
    resultsTitle: "Ergebnisse", previewItems: "3 sensible Elemente in diesem Prompt",
    redactBeforeSharing: "Vor dem Teilen schwärzen", previewFoot: "Fügen Sie links Ihren eigenen Prompt ein, um eine echte Prüfung zu starten.", detectsLabel: "Erkennt außerdem",
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
    createAccountTrial: "Erstellen Sie Ihr Konto und starten Sie die 7-tägige kostenlose Testphase, um Prompts zu prüfen.", startTrialToInspect: "Starten Sie die 7-tägige kostenlose Testphase, um Prompts zu prüfen.",
    usageLabel: "Prüfungen diese Woche", freeTrialBadge: "Was ein Tarif freischaltet", freeTrialDesc: "Unbegrenzte Prüfungen, eigene geschützte Begriffe und bis zu 3 Teamplätze.", seePlans: "Tarife vergleichen →",
    zeroRetentionDesc: "Prompts werden geprüft, nie gespeichert oder protokolliert.", createAccountBtn: "Konto erstellen", protectionActive: "Schutz aktiv",
    onboardCheckTitle: "Erste Prüfung durchführen", onboardCheckDesc: "Fügen Sie einen Prompt ein und prüfen Sie ihn einmal.",
    onboardTermsTitle: "Eigenen Begriff hinzufügen", onboardTermsDesc: "Schützen Sie einen Kunden- oder Projektnamen in den Einstellungen.",
    onboardThemeTitle: "Ein Thema wählen", onboardThemeDesc: "Gestalten Sie den Arbeitsbereich in den Einstellungen nach Ihrem Geschmack.",
    activityTitle: "Ihre Aktivität", activityEmpty: "Ihre Datenschutz-Aktivität erscheint hier nach Ihrer ersten Prüfung.", last7: "Letzte 7 Tage", byType: "Nach Erkennungstyp",
    metricChecked: "Geprüfte Prompts", metricItems: "Gefundene sensible Elemente", metricTop: "Häufigste Erkennung", metricLast: "Letzte Prüfung",
    plansTitle: "Tarife & Preise", plansIntro: "Jeder Tarif beginnt mit einer 7-tägigen Testphase. Verwenden Sie den Code {code} für 20 % Rabatt auf Ihre erste monatliche Zahlung.",
    personalTag: "Für Einzelpersonen", personalName: "Personal", personalDesc: "Für selbstständige Fachleute, die KI mit echten Kunden- und Personendaten nutzen.",
    startTrial: "7-tägige Testphase starten", yearlyPersonal: "79,90 € jährlich",
    businessTag: "Für Teams · bis zu 3 Nutzer", businessName: "Business", businessDesc: "Teamkontrollen und eine klare Datenschutzgrenze für wachsende Teams. Wählen Sie ein bis drei Plätze.",
    seatsLabel: "Plätze", seat1: "1 Nutzer", seat2: "2 Nutzer", seat3: "3 Nutzer", yearlyBusiness: "149,90 € jährlich / Nutzer",
    manageTag: "Bereits abonniert?", manageTitle: "Abrechnung verwalten", manageDesc: "Aktualisieren Sie Ihre Zahlungsmethode, laden Sie Rechnungen herunter oder kündigen Sie die Verlängerung jederzeit.", manageBtn: "Abonnement verwalten",
    teamTitle: "Team", teamSeatsUsed: "{used} von {total} Plätzen belegt.", inviteCreate: "Einladungslink erstellen", copyLink: "Link kopieren", noInvites: "Noch keine Einladungen.", teammateJoined: "Teammitglied beigetreten", invitePending: "Einladung ausstehend", revoke: "Widerrufen", couldNotCreateInvite: "Die Einladung konnte nicht erstellt werden.",
    orgTitle: "Organisation", orgIntro: "Gemeinsamer Schutz für den ganzen Workspace. Geschützte Begriffe gelten für die Prüfungen jedes Mitglieds, auf jedem Gerät.", orgMembersLabel: "Mitglieder", orgTermsLabel: "Geschützte Begriffe", orgTermsHint: "Codenamen, Kundennamen — werden in den Prompts jedes Mitglieds markiert.", orgTermAdd: "Hinzufügen", orgTermPlaceholder: "z. B. Projekt Falke", orgRoleOwner: "Inhaber", orgRoleAdmin: "Admin", orgRoleMember: "Mitglied", orgYou: "Sie", orgRenameSave: "Namen speichern", orgNoTerms: "Noch keine geschützten Begriffe.", orgRemove: "Entfernen", acctActivity: "In Ihrem Konto — alle Geräte", orgActivity: "Organisationsaktivität", orgChecks: "Team-Prüfungen", orgFlagged: "Markiert", orgBlocked: "Blockiert", orgTopCat: "Top-Kategorie", orgByMember: "Nach Mitglied", orgExport: "CSV exportieren (nur Metadaten)", orgPoliciesLabel: "Richtlinien", orgPoliciesHint: "Was passiert, wenn eine Kategorie im Prompt eines Mitglieds gefunden wird. Blockieren verhindert das Senden aus der Erweiterung, bis es behoben ist.", polDefault: "Standard", polWarn: "Warnen", polRedact: "Schwärzen", polBlock: "Blockieren", catPersonal: "Persönliche Daten", catCredentials: "Zugangsdaten", catFinancial: "Finanzdaten", catCustom: "Geschützte Begriffe", sevAny: "jede Schwere",
    previewBadge: "Vorschau", previewLabel: "Beispielergebnis — nicht Ihr Prompt", planNone: "Kein aktiver Tarif", planNoneNote: "Starten Sie die 7-tägige Testphase, um Prüfungen auszuführen.", planTrial: "Kostenlose Testphase", planTrialNote: "Ihre Testphase umfasst unbegrenzte Prüfungen. Wählen Sie einen Tarif, um sie fortzusetzen.", planActive: "Aktiver Tarif", planActiveNote: "Unbegrenzte Prüfungen und eigene geschützte Begriffe sind aktiv.", planDayOf: "Tag {day} von {total}", planEndsToday: "Endet heute", planDaysLeft: "noch {n} Tag|noch {n} Tage", foundInPrompt: "In Ihrem Prompt gefunden"
  }
};
const settingsByLanguage: Record<Language, string[]> = {
  en: ["Personal preferences", "These settings stay in this browser. They do not create an online account or upload prompt content.", "Interface language", "Inspection mode", "Detect personal data (email, phone, IP, fiscal code)", "Detect API keys and credentials", "Detect cards and IBANs", "Keep local check summaries", "Show the detected value on screen", "Clear the prompt after copying its safer version", "Close", "Save preferences", "Custom protected terms"],
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
    preview: text.replace(/\s+/g, " ").trim().slice(0, 76),
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
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value) ? value as HistoryEntry[] : [];
  } catch { return []; }
}

export function clearHistory(): void {
  localStorage.removeItem(storageKey);
}

function readPreferences(): Preferences {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(preferencesKey) ?? "{}");
    if (typeof stored === "object" && stored !== null) {
      const candidate = stored as Partial<Preferences>;
      return {
        ...defaultPreferences,
        language: ["en", "it", "es", "fr", "de"].includes(String(candidate.language)) ? candidate.language as Language : "en",
        theme: themes.some((t) => t.code === candidate.theme) ? candidate.theme as ThemeName : "violet",
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

  navItems.forEach((item) => item.setAttribute("type", "button"));

  const preferenceDialog = document.createElement("div");
  preferenceDialog.className = "drawer-backdrop";
  preferenceDialog.innerHTML = `
    <section class="drawer" role="dialog" aria-modal="true" aria-labelledby="preferences-title">
      <h2 id="preferences-title">Personal preferences</h2>
      <p>These settings stay in this browser. They do not create an online account or upload prompt content.</p>
      <label class="pref-row">Interface language<select id="language"><option value="en">English</option><option value="it">Italiano</option><option value="es">Español</option><option value="fr">Français</option><option value="de">Deutsch</option></select></label>
      <div class="pref-row theme-pref-row">Theme<div class="theme-row" id="theme-row"></div></div>
      <label class="pref-row">Inspection mode<select id="scan-mode"><option value="standard">Standard</option><option value="strict">Strict</option></select></label>
      <label class="switch"><input id="detect-personal" type="checkbox" checked> Detect personal data</label>
      <label class="switch"><input id="detect-credentials" type="checkbox" checked> Detect API keys and credentials</label>
      <label class="switch"><input id="detect-financial" type="checkbox" checked> Detect cards and IBANs</label>
      <label class="switch"><input id="save-history" type="checkbox" checked> Keep local check summaries</label>
      <label class="switch"><input id="show-raw" type="checkbox" checked> Show the detected value on screen</label>
      <label class="switch"><input id="clear-after-copy" type="checkbox"> Clear the prompt after copying its safer version</label>
      <label class="pref-row">Custom protected terms<textarea class="term-editor" id="custom-terms" maxlength="1500" placeholder="One term per line, for example: Acme Client"></textarea></label>
      <div class="pref-row" id="api-keys-block">
        <span>API keys <small style="color:var(--text-3);font-weight:500">— for scripts and pipelines (<a href="/api-docs.html" target="_blank" rel="noopener">docs</a>)</span></small>
        <ul id="api-key-list"></ul>
        <div id="api-key-new" hidden>
          <input type="text" id="api-key-value" readonly>
          <button type="button" class="secondary" id="api-key-copy">Copy</button>
          <p class="pref-note">This key is shown once. Store it now — it cannot be recovered.</p>
        </div>
        <button type="button" class="secondary" id="api-key-create">Create API key</button>
      </div>
      <div class="drawer-actions"><button class="secondary" id="close-preferences" type="button">Close</button><button class="primary" id="save-preferences" type="button">Save preferences</button></div>
    </section>`;
  document.body.append(preferenceDialog);
  // Same swatch-picker pattern as PC Tweaker, but the per-theme color comes from a
  // static CSS class (theme-swatch-lime, etc., defined in dashboard.html) instead
  // of an inline style="" attribute: Tauri computes CSP hashes only for inline
  // style/script present at build time, so runtime-injected style attributes are
  // silently dropped in the desktop build.
  const themeRow = required<HTMLElement>("#theme-row");
  themeRow.innerHTML = themes.map((theme) => `<button type="button" class="theme-swatch theme-swatch-${theme.code}${theme.code === preferences.theme ? " active" : ""}" data-theme="${theme.code}" title="${theme.label}" aria-label="${theme.label} theme"></button>`).join("");
  themeRow.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".theme-swatch");
    const code = button?.dataset.theme as ThemeName | undefined;
    if (!code) return;
    preferences.theme = code;
    applyTheme(code);
    savePreferences(preferences);
    themeRow.querySelectorAll(".theme-swatch").forEach((swatch) => swatch.classList.toggle("active", swatch === button));
    renderOnboarding();
  });

  // API keys: metadata list + one-time plaintext display on create.
  const apiKeyList = required<HTMLUListElement>("#api-key-list");
  const apiKeyNew = required<HTMLElement>("#api-key-new");
  const apiKeyValue = required<HTMLInputElement>("#api-key-value");
  const loadApiKeys = async (): Promise<void> => {
    if (!window.promptShieldAuth?.hasAccess()) { apiKeyList.innerHTML = `<li class="empty">Sign in to manage API keys.</li>`; return; }
    try {
      const data = await window.promptShieldAuth.request("/api/account?action=keys", undefined, "GET") as { keys?: { id: string; name: string; prefix: string; createdAt: string; revoked: boolean }[] };
      const keys = (data.keys ?? []).filter((key) => !key.revoked);
      apiKeyList.innerHTML = keys.map((key) =>
        `<li><span><code>${escapeHtml(key.prefix)}…</code> ${escapeHtml(key.name)}</span><button type="button" class="secondary" data-key-revoke="${key.id}">Revoke</button></li>`
      ).join("") || `<li class="empty">No API keys yet.</li>`;
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

  const plansDialog = document.createElement("div");
  plansDialog.className = "drawer-backdrop";
  plansDialog.innerHTML = `
    <section class="drawer plans-drawer" role="dialog" aria-modal="true" aria-labelledby="plans-title">
      <h2 id="plans-title">${words().plansTitle}</h2>
      <p>${format(words().plansIntro, { code: "<b>SHIELD</b>" })}</p>
      <div class="plan-grid">
        <article class="plan-card">
          <div class="plan-tag">${words().personalTag}</div>
          <h3>${words().personalName}</h3>
          <div class="plan-price">€7.99 <small>/ month</small></div>
          <p>${words().personalDesc}</p>
          <div class="plan-actions">
            <button type="button" class="primary" data-plan="personal" data-interval="monthly">${words().startTrial}</button>
            <button type="button" class="secondary" data-plan="personal" data-interval="yearly">${words().yearlyPersonal}</button>
          </div>
        </article>
        <article class="plan-card featured">
          <div class="plan-tag">${words().businessTag}</div>
          <h3>${words().businessName}</h3>
          <div class="plan-price">€14.99 <small>/ user / month</small></div>
          <p>${words().businessDesc}</p>
          <label class="pref-row">${words().seatsLabel}<select id="business-seats"><option value="1">${words().seat1}</option><option value="2">${words().seat2}</option><option value="3">${words().seat3}</option></select></label>
          <div class="plan-actions">
            <button type="button" class="primary" data-plan="business" data-interval="monthly">${words().startTrial}</button>
            <button type="button" class="secondary" data-plan="business" data-interval="yearly">${words().yearlyBusiness}</button>
          </div>
        </article>
        <article class="plan-card">
          <div class="plan-tag">${words().manageTag}</div>
          <h3>${words().manageTitle}</h3>
          <div class="plan-price">&nbsp;</div>
          <p>${words().manageDesc}</p>
          <div class="plan-actions"><button type="button" class="secondary" id="manage-billing">${words().manageBtn}</button></div>
        </article>
      </div>
      <section id="team-section" class="team-section" hidden>
        <h3>${words().teamTitle}</h3>
        <p id="team-seats"></p>
        <ul id="team-invite-list"></ul>
        <button type="button" class="secondary" id="team-invite-btn">${words().inviteCreate}</button>
        <div id="team-invite-result"></div>
      </section>
      <section id="org-section" class="team-section" hidden>
        <h3 id="org-title">${words().orgTitle}</h3>
        <p>${words().orgIntro}</p>
        <div class="pref-row" id="org-name-row" hidden>
          <input type="text" id="org-name-input" maxlength="80">
          <button type="button" class="secondary" id="org-name-save">${words().orgRenameSave}</button>
        </div>
        <h3>${words().orgMembersLabel}</h3>
        <ul id="org-member-list"></ul>
        <h3>${words().orgPoliciesLabel}</h3>
        <p>${words().orgPoliciesHint}</p>
        <ul id="org-policy-list"></ul>
        <h3>${words().orgTermsLabel}</h3>
        <p>${words().orgTermsHint}</p>
        <ul id="org-term-list"></ul>
        <div class="pref-row" id="org-term-row" hidden>
          <input type="text" id="org-term-input" maxlength="64" placeholder="${words().orgTermPlaceholder}">
          <button type="button" class="secondary" id="org-term-add">${words().orgTermAdd}</button>
        </div>
      </section>
      <div class="drawer-actions"><button class="secondary" id="close-plans" type="button">${settingsByLanguage[preferences.language][10]}</button></div>
    </section>`;
  document.body.append(plansDialog);
  const closePlans = (): void => {
    plansDialog.classList.remove("open");
    document.documentElement.classList.remove("preferences-open");
  };
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
      teamInviteList.innerHTML = data.invites.map((invite) => `<li data-id="${invite.id}"><span>${invite.status === "accepted" ? words().teammateJoined : words().invitePending} · ${dateOnly(invite.createdAt)}</span>${invite.status === "pending" ? `<button type="button" class="secondary" data-revoke="${invite.id}">${words().revoke}</button>` : ""}</li>`).join("") || `<li class="empty">${words().noInvites}</li>`;
    } catch { teamSection.hidden = true; }
  };
  teamInviteBtn.addEventListener("click", async () => {
    teamInviteBtn.disabled = true;
    try {
      const payload = await window.promptShieldAuth!.request("/api/team", {}, "POST") as { url?: string; error?: string };
      if (payload.url) {
        teamInviteResult.innerHTML = `<input type="text" readonly value="${payload.url}"><button type="button" class="secondary" id="team-copy-link">${words().copyLink}</button>`;
        document.querySelector("#team-copy-link")?.addEventListener("click", () => { void navigator.clipboard.writeText(payload.url ?? ""); });
        await loadTeam();
      }
    } catch (error) {
      teamInviteResult.textContent = error instanceof Error ? error.message : words().couldNotCreateInvite;
    } finally { teamInviteBtn.disabled = false; }
  });
  teamInviteList.addEventListener("click", async (event) => {
    const inviteId = (event.target as HTMLElement).dataset.revoke;
    if (!inviteId) return;
    await window.promptShieldAuth?.request("/api/team?action=revoke", { inviteId }, "POST").catch(() => undefined);
    await loadTeam();
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
        `<li><span>${escapeHtml(term.term)}</span>${canManage ? `<button type="button" class="secondary" data-term-remove="${term.id}">${words().orgRemove}</button>` : ""}</li>`
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
    if (!window.promptShieldAuth?.hasAccess()) { orgSection.hidden = true; return; }
    if (orgCache) renderOrganization(orgCache);
    try {
      const data = await window.promptShieldAuth.request("/api/team?action=org", undefined, "GET") as OrgPayload;
      orgCache = data;
      renderOrganization(data);
    } catch { if (!orgCache) orgSection.hidden = true; }
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

  const openPlans = (): void => {
    plansDialog.classList.add("open");
    document.documentElement.classList.add("preferences-open");
    void loadTeam();
    void loadOrganization();
  };
  required<HTMLButtonElement>("#close-plans").addEventListener("click", closePlans);
  document.querySelector("#side-fill-cta")?.addEventListener("click", (event) => { event.preventDefault(); openPlans(); });
  plansDialog.addEventListener("click", (event) => { if (event.target === plansDialog) closePlans(); });
  document.addEventListener("redaxa:need-upgrade", () => openPlans());

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

  const closePreferences = (): void => {
    preferenceDialog.classList.remove("open");
    document.documentElement.classList.remove("preferences-open");
  };
  const openPreferences = (): void => {
    void loadApiKeys();
    preferenceDialog.classList.add("open");
    document.documentElement.classList.add("preferences-open");
    languageSelect.focus();
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
    document.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((element) => {
      const value = w[element.dataset.i18nPlaceholder ?? ""];
      if (value !== undefined) element.setAttribute("placeholder", value);
    });
    document.querySelectorAll<HTMLElement>("[data-kind]").forEach((element) => {
      const value = labels()[element.dataset.kind ?? ""];
      if (value !== undefined) element.textContent = value;
    });
    languageSelect.setAttribute("aria-label", `${w.interfaceLanguage}: ${languageNames[preferences.language]}`);

    required<HTMLElement>("#preferences-title").textContent = settings[0];
    required<HTMLElement>(".drawer p").textContent = settings[1];
    const prefRows = Array.from(preferenceDialog.querySelectorAll<HTMLElement>(".pref-row:not(.theme-pref-row)"));
    prefRows.slice(0, 2).forEach((row, index) => { if (row.firstChild) row.firstChild.textContent = settings[index + 2]; });
    if (prefRows[2]?.firstChild) prefRows[2].firstChild.textContent = settings[12];
    const switches = Array.from(preferenceDialog.querySelectorAll<HTMLElement>(".switch"));
    switches.forEach((row, index) => { if (row.lastChild) row.lastChild.textContent = settings[index + 4]; });
    required<HTMLButtonElement>("#close-preferences").textContent = settings[10];
    required<HTMLButtonElement>("#save-preferences").textContent = settings[11];
    scanModeSelect.options[0].textContent = w.scanModeStandard;
    scanModeSelect.options[1].textContent = w.scanModeStrict;

    // The plans drawer is patched in place rather than rebuilt via innerHTML:
    // rebuilding would detach the click handlers auth.ts bound to these exact
    // button elements at boot.
    required<HTMLElement>("#plans-title").textContent = w.plansTitle;
    required<HTMLElement>(".plans-drawer > p").innerHTML = format(w.plansIntro, { code: "<b>SHIELD</b>" });
    const [personalCard, businessCard, manageCard] = Array.from(plansDialog.querySelectorAll<HTMLElement>(".plan-card"));
    personalCard.querySelector(".plan-tag")!.textContent = w.personalTag;
    personalCard.querySelector("h3")!.textContent = w.personalName;
    personalCard.querySelector("p")!.textContent = w.personalDesc;
    personalCard.querySelector<HTMLElement>('[data-interval="monthly"]')!.textContent = w.startTrial;
    personalCard.querySelector<HTMLElement>('[data-interval="yearly"]')!.textContent = w.yearlyPersonal;
    businessCard.querySelector(".plan-tag")!.textContent = w.businessTag;
    businessCard.querySelector("h3")!.textContent = w.businessName;
    businessCard.querySelector("p")!.textContent = w.businessDesc;
    const seatRow = businessCard.querySelector<HTMLElement>(".pref-row");
    if (seatRow?.firstChild) seatRow.firstChild.textContent = w.seatsLabel;
    const seatOptions = businessCard.querySelectorAll<HTMLOptionElement>("#business-seats option");
    [w.seat1, w.seat2, w.seat3].forEach((label, index) => { if (seatOptions[index]) seatOptions[index].textContent = label; });
    businessCard.querySelector<HTMLElement>('[data-interval="monthly"]')!.textContent = w.startTrial;
    businessCard.querySelector<HTMLElement>('[data-interval="yearly"]')!.textContent = w.yearlyBusiness;
    manageCard.querySelector(".plan-tag")!.textContent = w.manageTag;
    manageCard.querySelector("h3")!.textContent = w.manageTitle;
    manageCard.querySelector("p")!.textContent = w.manageDesc;
    required<HTMLElement>("#manage-billing").textContent = w.manageBtn;
    required<HTMLElement>("#team-section h3").textContent = w.teamTitle;
    required<HTMLElement>("#team-invite-btn").textContent = w.inviteCreate;
    required<HTMLElement>("#close-plans").textContent = settings[10];

    updateCharacterCount();
    renderPlanStatus();
    renderHistory();
    if (!resLive.hidden) renderRiskCopy();
  };

  const setActiveNav = (active: HTMLElement): void => {
    navItems.forEach((item) => {
      const isActive = item === active;
      item.classList.toggle("active", isActive);
      if (isActive) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current");
    });
  };
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      switch (item.dataset.nav) {
        case "check": setActiveNav(item); prompt.focus(); break;
        case "recent": setActiveNav(item); historyCard.scrollIntoView({ behavior: "smooth", block: "start" }); break;
        case "plans": openPlans(); break;
        case "prefs": openPreferences(); break;
      }
    });
  });

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
  // quota: there is no free monthly allowance in the billing code (api/scan.ts
  // returns 402 without an active trial or subscription), so a "N / 10 free
  // checks" meter would promise a tier that does not exist.
  const trialLengthDays = 7;
  let accountState: AccountState | null = null;
  const renderPlanStatus = (): void => {
    const w = words();
    if (accountState?.status === "trialing" && accountState.currentPeriodEnd) {
      const daysLeft = Math.max(0, Math.ceil((new Date(accountState.currentPeriodEnd).getTime() - Date.now()) / 86_400_000));
      const dayNumber = Math.min(trialLengthDays, Math.max(1, trialLengthDays - daysLeft + 1));
      planLabel.textContent = w.planTrial;
      planValue.textContent = daysLeft <= 0 ? w.planEndsToday : plural(w.planDaysLeft, daysLeft);
      planTrack.hidden = false;
      planFill.style.width = `${Math.round((dayNumber / trialLengthDays) * 100)}%`;
      planTrack.setAttribute("aria-label", format(w.planDayOf, { day: dayNumber, total: trialLengthDays }));
      planNote.textContent = w.planTrialNote;
      return;
    }
    planTrack.hidden = true;
    if (accountState?.active) {
      planLabel.textContent = w.planActive;
      planValue.textContent = accountState.plan ? accountState.plan.charAt(0).toUpperCase() + accountState.plan.slice(1) : "";
      planNote.textContent = w.planActiveNote;
    } else {
      planLabel.textContent = w.planNone;
      planValue.textContent = "";
      planNote.textContent = w.planNoneNote;
    }
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
  let orgActivityLoaded = false;
  const loadOrgActivity = async (): Promise<void> => {
    if (orgActivityLoaded || !window.promptShieldAuth?.hasAccess()) return;
    orgActivityLoaded = true;
    try {
      const data = await window.promptShieldAuth.request("/api/scan?scope=org", undefined, "GET") as { events?: (ScanEvent & { member?: string | null })[]; error?: string };
      const allEvents = data.events ?? [];
      if (allEvents.length === 0) return;
      required<HTMLElement>("#org-activity-label").textContent = words().orgActivity;

      // Admin snapshot computed from the (metadata-only) event stream: how
      // much the team checks, how much gets flagged/blocked, who checks.
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
      const metricsHtml = `<div class="metrics">
        <div class="metric"><span>${words().orgChecks}</span><b>${num(allEvents.length)}</b></div>
        <div class="metric"><span>${words().orgFlagged}</span><b>${num(flagged)}</b></div>
        <div class="metric"><span>${words().orgBlocked}</span><b>${num(blocked)}</b></div>
        <div class="metric is-text"><span>${words().orgTopCat}</span><b>${topCategory ? escapeHtml(categoryLabel(topCategory)) : "—"}</b></div>
      </div>
      <span class="bars-label">${words().orgByMember}</span>
      ${[...memberCounts.entries()].sort((a, b) => b[1].checks - a[1].checks).map(([who, counts]) =>
        `<div class="analytics-row"><span class="analytics-label">${escapeHtml(who)}</span><div class="analytics-track"><div class="analytics-fill" style="width:${Math.max(6, Math.round((counts.checks / allEvents.length) * 100))}%"></div></div><span class="analytics-value">${num(counts.checks)}</span></div>`
      ).join("")}`;

      const listHtml = allEvents.slice(0, 8).map((event) => {
        const kinds = [...new Set(event.finding_kinds)].map((kind) => labels()[kind] ?? kind).join(", ");
        return `<article class="entry"><strong>${escapeHtml(event.member ?? "—")} · ${escapeHtml(event.application)} · ${escapeHtml(event.action)}</strong><span>${event.finding_count > 0 ? escapeHtml(kinds) : words().nothingFlagged}</span><em>${dateTime(event.created_at)}</em></article>`;
      }).join("");
      orgActivityList.innerHTML = `${metricsHtml}${listHtml}<button type="button" class="secondary" id="org-export-csv">${words().orgExport}</button>`;

      // CSV export: exactly the metadata rows the admin already sees — the
      // export cannot contain prompt content because the data never has any.
      orgActivityList.querySelector("#org-export-csv")?.addEventListener("click", () => {
        const header = "created_at,member,application,action,finding_count,finding_kinds,finding_categories";
        const csvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;
        const rows = allEvents.map((event) => [
          event.created_at, event.member ?? "", event.application, event.action, String(event.finding_count),
          (event.finding_kinds ?? []).join("|"), (event.finding_categories ?? []).join("|")
        ].map(csvCell).join(","));
        const blob = new Blob([`${header}\n${rows.join("\n")}\n`], { type: "text/csv" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `redaxa-org-activity-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
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
    historyRoot.innerHTML = visible.length ? visible.map((entry) => {
      const breakdown = Object.entries(entry.byKind).map(([kind, n]) => `${labels()[kind] ?? kind} × ${n}`).join(", ");
      return `<article class="entry" data-id="${entry.id}" tabindex="0" role="button" aria-expanded="false"><strong>${plural(words().itemsReviewed, entry.findings)}</strong><span>${escapeHtml(entry.preview)}</span><em>${dateTime(entry.createdAt)}</em><div class="entry-detail">${breakdown ? escapeHtml(breakdown) : words().nothingFlagged}</div></article>`;
    }).join("") : `<div class="entry"><strong>${words().noChecksYet}</strong><span>${words().lastEightWillAppear}</span></div>`;

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
    analyticsRoot.innerHTML = rows.map(([kind, n]) => `<div class="analytics-row"><span class="analytics-label">${labels()[kind] ?? kind}</span><div class="analytics-track"><div class="analytics-fill" style="width:${Math.max(6, Math.round((n / max) * 100))}%"></div></div><span class="analytics-value">${n}</span></div>`).join("");

    if (metricChecked) metricChecked.textContent = String(weekly.length);
    if (metricItems) metricItems.textContent = String(weekly.reduce((sum, entry) => sum + entry.findings, 0));
    if (metricTop) metricTop.textContent = rows.length ? (labels()[rows[0][0]] ?? rows[0][0]) : "—";
    if (metricLast) metricLast.textContent = history[0] ? relativeTime(history[0].createdAt) : "—";
    renderOnboarding();
  };

  const updateCharacterCount = (): void => {
    characterCount.innerHTML = `<strong>${num(prompt.value.length)}</strong> / ${num(maxPromptLength)}`;
  };
  const syncScanButton = (): void => { scanButton.disabled = !prompt.value.trim(); };
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
    const ranges: { start: number; end: number }[] = [];
    for (const finding of findings) {
      if (!finding.value) continue;
      let from = 0;
      for (;;) {
        const at = source.indexOf(finding.value, from);
        if (at === -1) break;
        if (!ranges.some((range) => at < range.end && at + finding.value.length > range.start)) {
          ranges.push({ start: at, end: at + finding.value.length });
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
      .map((range) => ({ start: range.start - offset, end: range.end - offset }))
      .filter((range) => range.start >= 0 && range.end <= text.length);

    let html = offset > 0 ? "… " : "";
    let cursor = 0;
    for (const range of visible) {
      html += escapeHtml(text.slice(cursor, range.start));
      const raw = text.slice(range.start, range.end);
      html += `<mark>${escapeHtml(preferences.showRawValues ? raw : "•".repeat(Math.min(10, raw.length)))}</mark>`;
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

    const groups = new Map<string, Finding[]>();
    for (const finding of lastResult.findings) {
      const bucket = groups.get(finding.kind) ?? [];
      bucket.push(finding);
      groups.set(finding.kind, bucket);
    }
    const shorten = (value: string): string => value.length > 42 ? `${value.slice(0, 20)}…${value.slice(-14)}` : value;
    findingsRoot.innerHTML = [...groups.entries()].map(([kind, items]) => {
      const rows = items.map((finding) => {
        const shown = preferences.showRawValues ? escapeHtml(shorten(finding.value)) : `<em>${escapeHtml(words().sensitiveValueHidden)}</em>`;
        return `<div class="fitem"><code>${shown}</code><span class="arrow" aria-hidden="true">→</span><span class="repl">${escapeHtml(finding.replacement.replace("$1$2", ""))}</span></div>`;
      }).join("");
      return `<div class="fgroup"><div class="fgroup-head"><b>${escapeHtml(labels()[kind] ?? kind)}</b><span class="fgroup-count">${items.length}</span></div>${rows}</div>`;
    }).join("");
    safeRoot.style.display = n ? "block" : "none";
    resultsFoot.hidden = !n;
  };

  const showResults = (): void => {
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
    const singleColumn = window.matchMedia("(max-width: 1180px)").matches;
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
    if (!prompt.value.trim()) { prompt.focus(); return; }
    if (!window.promptShieldAuth?.hasAccess()) {
      window.promptShieldAuth?.requestAccess(words().createAccountTrial);
      return;
    }
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
    scanButton.disabled = true;
    scanButton.textContent = words().checking;
    try {
      const scanned = await window.promptShieldAuth!.scanPrompt(prompt.value, preferences);
      const result = storeResult(prompt.value, scanned.findings, scanned.redactedText, preferences);
      lastResult = { findings: result.findings, redactedText: result.redactedText, sourceText: prompt.value, decision: scanned.decision };
      showResults();
      renderRiskCopy();
      redacted.textContent = result.redactedText;
      renderHistory();
      revealResults();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "TRIAL_REQUIRED") {
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

  void enableDesktopCompanion((clipboardText) => {
    prompt.value = clipboardText;
    updateCharacterCount();
    syncScanButton();
    syncChipSelection();
    void scan();
  });
  clearPrompt.addEventListener("click", () => {
    prompt.value = "";
    updateCharacterCount();
    syncScanButton();
    syncChipSelection();
    prompt.focus();
  });
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

  required<HTMLButtonElement>("#close-preferences").addEventListener("click", closePreferences);
  required<HTMLButtonElement>("#save-preferences").addEventListener("click", () => {
    preferences.language = ["en", "it", "es", "fr", "de"].includes(languageSelect.value) ? languageSelect.value as Language : "en";
    preferences.scanMode = scanModeSelect.value === "strict" ? "strict" : "standard";
    preferences.includePersonalData = personalToggle.checked;
    preferences.includeCredentials = credentialToggle.checked;
    preferences.includeFinancialData = financialToggle.checked;
    preferences.saveHistory = historyToggle.checked;
    preferences.showRawValues = rawValueToggle.checked;
    preferences.autoClearAfterCopy = clearAfterCopyToggle.checked;
    preferences.customTerms = customTermsInput.value.split(/\r?\n/).map((term) => term.trim()).filter(Boolean).slice(0, 30);
    savePreferences(preferences);
    pushSyncedSettings();
    applyLanguage();
    closePreferences();
  });
  preferenceDialog.addEventListener("click", (event) => { if (event.target === preferenceDialog) closePreferences(); });

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
}

type ScanRequestOptions = { includePersonalData?: boolean; includeCredentials?: boolean; includeFinancialData?: boolean; customTerms?: string[] };
type ScanDecision = { action: "allow" | "warn" | "redact" | "block"; decidedBy: { ruleId: string; ruleName: string; reason: string; findingIndexes: number[] } | null };

declare global {
  interface Window {
    promptShieldAuth?: {
      hasAccess(): boolean;
      requestAccess(message?: string): void;
      scanPrompt(text: string, options?: ScanRequestOptions): Promise<{ findings: Finding[]; redactedText: string; decision?: ScanDecision }>;
      request(path: string, body?: Record<string, unknown>, method?: "GET" | "POST"): Promise<Record<string, unknown>>;
    };
  }
}

if (typeof document !== "undefined") mountDashboard();
