import type { Finding, ScanOptions } from "./scanner.js";
import { enableAppShell } from "./pwa.js";
import { enableDesktopCompanion } from "./desktop.js";

type HistoryEntry = { id: string; createdAt: string; findings: number; preview: string; byKind: Record<string, number> };
type Language = "en" | "it" | "es" | "fr" | "de";
type ThemeName = "lime" | "violet" | "teal" | "amber" | "crimson" | "ocean" | "emerald" | "gold" | "slate" | "indigo" | "coral";
type Preferences = ScanOptions & { language: Language; theme: ThemeName; scanMode: "standard" | "strict"; saveHistory: boolean; autoClearAfterCopy: boolean; showRawValues: boolean; customTerms: string[] };

const storageKey = "promptshield.personal-history.v1";
const preferencesKey = "promptshield.personal-preferences.v1";
const maxPromptLength = 10_000;

const defaultPreferences: Preferences = { language: "en", theme: "lime", scanMode: "standard", includePersonalData: true, includeCredentials: true, includeFinancialData: true, saveHistory: true, autoClearAfterCopy: false, showRawValues: true, customTerms: [] };

const themes: { code: ThemeName; label: string; accent: string; accentInk: string; swatch: [string, string] }[] = [
  { code: "lime", label: "Lime", accent: "#b9ff00", accentInk: "#080a07", swatch: ["#b9ff00", "#6dd400"] },
  { code: "violet", label: "Violet", accent: "#ff5c8a", accentInk: "#1a0710", swatch: ["#ff5c8a", "#35e0c0"] },
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
    workspace: "Workspace", privateCheck: "Private check", recent: "Recent checks", account: "Account", plans: "Plans & pricing", preferences: "Preferences", eyebrow: "Personal workspace", title: "Your private AI checkpoint.", subtitle: "Review a prompt before it reaches any AI tool.", scan: "Inspect prompt →", sample: "Use sample", clear: "Clear", history: "Recent local checks", clearHistory: "Clear history", placeholder: "Paste your prompt here…",
    metaLabel: "Private scan · never stored or logged", interfaceLanguage: "Interface language",
    scanModeStandard: "Standard — balanced local checks", scanModeStrict: "Strict — careful review mode",
    checking: "Checking…", promptTooLong: "Prompt is too long", keepUnder: "Keep it under {max} characters for a check.",
    nothingFound: "Nothing obvious found", itemsToReview: "{n} item to review|{n} items to review", reviewBeforeSharing: "Review these before sharing your prompt.", strictReviewPrefix: "Strict review: ", helpfulSignal: "This is a helpful signal, not a guarantee.",
    checkFailed: "Check failed", couldNotRunCheck: "We could not run that check. Please try again.",
    willBeReplacedWith: "Will be replaced with ", sensitiveValueHidden: "Sensitive value hidden",
    noCommonSecrets: "No common secrets or personal details were detected. This is a helpful signal, not a guarantee.",
    copySafer: "Copy safer prompt", copied: "Copied",
    noChecksYet: "No checks yet", lastEightWillAppear: "Your last eight check summaries will appear here.", nothingFlagged: "Nothing flagged in this check.", itemsReviewed: "{n} item reviewed|{n} items reviewed",
    createAccountTrial: "Create your account and start your 7-day free trial to inspect prompts.", startTrialToInspect: "Start your 7-day free trial to inspect prompts.",
    plansTitle: "Plans & pricing", plansIntro: "Every plan starts with a 7-day trial. Use code {code} for 20% off your first monthly payment.",
    personalTag: "For individuals", personalName: "Personal", personalDesc: "For independent professionals who use AI with real client and personal information.",
    startTrial: "Start 7-day trial", yearlyPersonal: "€79.90 yearly",
    businessTag: "For teams · up to 3 users", businessName: "Business", businessDesc: "Team controls and a clear privacy boundary for growing teams. Choose one to three seats.",
    seatsLabel: "Seats", seat1: "1 user", seat2: "2 users", seat3: "3 users", yearlyBusiness: "€149.90 yearly / user",
    manageTag: "Already subscribed?", manageTitle: "Manage billing", manageDesc: "Update your payment method, download invoices, or cancel renewal whenever you need to.", manageBtn: "Manage subscription",
    teamTitle: "Team", teamSeatsUsed: "{used} of {total} seats used.", inviteCreate: "Create invite link", copyLink: "Copy link", noInvites: "No invites yet.", teammateJoined: "Teammate joined", invitePending: "Invite pending", revoke: "Revoke", couldNotCreateInvite: "We could not create an invite.",
    checksThisWeek: "checks this week", freeTrialBadge: "Free trial", freeTrialDesc: "Personal & Business plans start with 7 days free.", seePlans: "See plans →",
    zeroRetentionTitle: "● Zero-retention mode", zeroRetentionDesc: "Your prompt is checked, never stored or logged.",
    createAccountBtn: "Create account", protectionActive: "Protection active",
    getSetUp: "Get set up", onboardCheckTitle: "Run your first check", onboardCheckDesc: "Paste a prompt and inspect it once.", onboardTermsTitle: "Add a custom term", onboardTermsDesc: "Protect a client or project name in Preferences.", onboardThemeTitle: "Pick a theme", onboardThemeDesc: "Make the workspace yours in Preferences.",
    readyToInspect: "Ready to inspect", willCheckFor: "We will check for common personal data and secrets.", detectsLabel: "Detects:", saferVersion: "Safer version", runFewChecks: "Run a few checks to see a breakdown here."
  },
  it: {
    workspace: "Spazio di lavoro", privateCheck: "Controllo privato", recent: "Controlli recenti", account: "Account", plans: "Piani e prezzi", preferences: "Impostazioni", eyebrow: "Spazio personale", title: "Il tuo controllo AI privato.", subtitle: "Rivedi un prompt prima di inviarlo a uno strumento AI.", scan: "Controlla prompt →", sample: "Usa esempio", clear: "Svuota", history: "Controlli locali recenti", clearHistory: "Cancella cronologia", placeholder: "Incolla qui il tuo prompt…",
    metaLabel: "Controllo privato · mai salvato né registrato", interfaceLanguage: "Lingua dell'interfaccia",
    scanModeStandard: "Standard — controlli locali bilanciati", scanModeStrict: "Rigorosa — modalità di revisione attenta",
    checking: "Controllo in corso…", promptTooLong: "Il prompt è troppo lungo", keepUnder: "Resta entro {max} caratteri per un controllo.",
    nothingFound: "Nessun problema evidente", itemsToReview: "{n} elemento da rivedere|{n} elementi da rivedere", reviewBeforeSharing: "Rivedili prima di condividere il prompt.", strictReviewPrefix: "Revisione rigorosa: ", helpfulSignal: "Questo è un segnale utile, non una garanzia.",
    checkFailed: "Controllo non riuscito", couldNotRunCheck: "Non è stato possibile eseguire il controllo. Riprova.",
    willBeReplacedWith: "Verrà sostituito con ", sensitiveValueHidden: "Valore sensibile nascosto",
    noCommonSecrets: "Non sono stati rilevati segreti o dati personali comuni. Questo è un segnale utile, non una garanzia.",
    copySafer: "Copia il prompt sicuro", copied: "Copiato",
    noChecksYet: "Nessun controllo ancora", lastEightWillAppear: "Qui compariranno i riepiloghi degli ultimi otto controlli.", nothingFlagged: "Nulla segnalato in questo controllo.", itemsReviewed: "{n} elemento esaminato|{n} elementi esaminati",
    createAccountTrial: "Crea il tuo account e avvia la prova gratuita di 7 giorni per controllare i prompt.", startTrialToInspect: "Avvia la prova gratuita di 7 giorni per controllare i prompt.",
    plansTitle: "Piani e prezzi", plansIntro: "Ogni piano inizia con una prova gratuita di 7 giorni. Usa il codice {code} per il 20% di sconto sul primo pagamento mensile.",
    personalTag: "Per privati", personalName: "Personal", personalDesc: "Per professionisti indipendenti che usano l'AI con dati reali di clienti e informazioni personali.",
    startTrial: "Avvia prova di 7 giorni", yearlyPersonal: "€79,90 all'anno",
    businessTag: "Per team · fino a 3 utenti", businessName: "Business", businessDesc: "Controlli di team e un confine di privacy chiaro per team in crescita. Scegli da uno a tre posti.",
    seatsLabel: "Posti", seat1: "1 utente", seat2: "2 utenti", seat3: "3 utenti", yearlyBusiness: "€149,90 all'anno / utente",
    manageTag: "Già abbonato?", manageTitle: "Gestisci fatturazione", manageDesc: "Aggiorna il metodo di pagamento, scarica le fatture o annulla il rinnovo quando vuoi.", manageBtn: "Gestisci abbonamento",
    teamTitle: "Team", teamSeatsUsed: "{used} di {total} posti utilizzati.", inviteCreate: "Crea link di invito", copyLink: "Copia link", noInvites: "Nessun invito ancora.", teammateJoined: "Collega entrato", invitePending: "Invito in sospeso", revoke: "Revoca", couldNotCreateInvite: "Non è stato possibile creare un invito.",
    checksThisWeek: "controlli questa settimana", freeTrialBadge: "Prova gratuita", freeTrialDesc: "I piani Personal e Business iniziano con 7 giorni gratuiti.", seePlans: "Vedi i piani →",
    zeroRetentionTitle: "● Modalità zero-conservazione", zeroRetentionDesc: "Il tuo prompt viene controllato, mai salvato né registrato.",
    createAccountBtn: "Crea account", protectionActive: "Protezione attiva",
    getSetUp: "Inizia la configurazione", onboardCheckTitle: "Esegui il tuo primo controllo", onboardCheckDesc: "Incolla un prompt e controllalo una volta.", onboardTermsTitle: "Aggiungi un termine personalizzato", onboardTermsDesc: "Proteggi il nome di un cliente o progetto nelle Impostazioni.", onboardThemeTitle: "Scegli un tema", onboardThemeDesc: "Rendi personale lo spazio di lavoro nelle Impostazioni.",
    readyToInspect: "Pronto per il controllo", willCheckFor: "Controlleremo i dati personali e i segreti più comuni.", detectsLabel: "Rileva:", saferVersion: "Versione sicura", runFewChecks: "Esegui qualche controllo per vedere qui un riepilogo."
  },
  es: {
    workspace: "Espacio de trabajo", privateCheck: "Revisión privada", recent: "Revisiones recientes", account: "Cuenta", plans: "Planes y precios", preferences: "Preferencias", eyebrow: "Espacio personal", title: "Tu punto de control privado para IA.", subtitle: "Revisa un prompt antes de enviarlo a una herramienta de IA.", scan: "Revisar prompt →", sample: "Usar ejemplo", clear: "Limpiar", history: "Revisiones locales recientes", clearHistory: "Borrar historial", placeholder: "Pega tu prompt aquí…",
    metaLabel: "Revisión privada · nunca se guarda ni se registra", interfaceLanguage: "Idioma de la interfaz",
    scanModeStandard: "Estándar — revisiones locales equilibradas", scanModeStrict: "Estricto — modo de revisión cuidadosa",
    checking: "Revisando…", promptTooLong: "El prompt es demasiado largo", keepUnder: "Mantenlo bajo {max} caracteres para poder revisarlo.",
    nothingFound: "No se encontró nada evidente", itemsToReview: "{n} elemento para revisar|{n} elementos para revisar", reviewBeforeSharing: "Revísalos antes de compartir tu prompt.", strictReviewPrefix: "Revisión estricta: ", helpfulSignal: "Esto es una señal útil, no una garantía.",
    checkFailed: "La revisión falló", couldNotRunCheck: "No se pudo ejecutar esa revisión. Inténtalo de nuevo.",
    willBeReplacedWith: "Se sustituirá por ", sensitiveValueHidden: "Valor sensible oculto",
    noCommonSecrets: "No se detectaron secretos ni datos personales comunes. Esto es una señal útil, no una garantía.",
    copySafer: "Copiar prompt seguro", copied: "Copiado",
    noChecksYet: "Aún no hay revisiones", lastEightWillAppear: "Aquí aparecerán los resúmenes de tus últimas ocho revisiones.", nothingFlagged: "Nada señalado en esta revisión.", itemsReviewed: "{n} elemento revisado|{n} elementos revisados",
    createAccountTrial: "Crea tu cuenta y comienza tu prueba gratuita de 7 días para revisar prompts.", startTrialToInspect: "Comienza tu prueba gratuita de 7 días para revisar prompts.",
    plansTitle: "Planes y precios", plansIntro: "Todos los planes comienzan con una prueba gratuita de 7 días. Usa el código {code} para un 20% de descuento en tu primer pago mensual.",
    personalTag: "Para particulares", personalName: "Personal", personalDesc: "Para profesionales independientes que usan IA con datos reales de clientes e información personal.",
    startTrial: "Comenzar prueba de 7 días", yearlyPersonal: "79,90 € al año",
    businessTag: "Para equipos · hasta 3 usuarios", businessName: "Business", businessDesc: "Controles de equipo y un límite de privacidad claro para equipos en crecimiento. Elige entre uno y tres puestos.",
    seatsLabel: "Puestos", seat1: "1 usuario", seat2: "2 usuarios", seat3: "3 usuarios", yearlyBusiness: "149,90 € al año / usuario",
    manageTag: "¿Ya estás suscrito?", manageTitle: "Gestionar facturación", manageDesc: "Actualiza tu método de pago, descarga facturas o cancela la renovación cuando quieras.", manageBtn: "Gestionar suscripción",
    teamTitle: "Equipo", teamSeatsUsed: "{used} de {total} puestos usados.", inviteCreate: "Crear enlace de invitación", copyLink: "Copiar enlace", noInvites: "Aún no hay invitaciones.", teammateJoined: "Compañero incorporado", invitePending: "Invitación pendiente", revoke: "Revocar", couldNotCreateInvite: "No se pudo crear la invitación.",
    checksThisWeek: "revisiones esta semana", freeTrialBadge: "Prueba gratuita", freeTrialDesc: "Los planes Personal y Business comienzan con 7 días gratis.", seePlans: "Ver planes →",
    zeroRetentionTitle: "● Modo de retención cero", zeroRetentionDesc: "Tu prompt se revisa, nunca se guarda ni se registra.",
    createAccountBtn: "Crear cuenta", protectionActive: "Protección activa",
    getSetUp: "Comienza la configuración", onboardCheckTitle: "Haz tu primera revisión", onboardCheckDesc: "Pega un prompt y revísalo una vez.", onboardTermsTitle: "Añade un término personalizado", onboardTermsDesc: "Protege el nombre de un cliente o proyecto en Preferencias.", onboardThemeTitle: "Elige un tema", onboardThemeDesc: "Personaliza tu espacio de trabajo en Preferencias.",
    readyToInspect: "Listo para revisar", willCheckFor: "Comprobaremos los datos personales y secretos más comunes.", detectsLabel: "Detecta:", saferVersion: "Versión segura", runFewChecks: "Haz algunas revisiones para ver aquí un resumen."
  },
  fr: {
    workspace: "Espace de travail", privateCheck: "Vérification privée", recent: "Vérifications récentes", account: "Compte", plans: "Offres et tarifs", preferences: "Préférences", eyebrow: "Espace personnel", title: "Votre contrôle IA privé.", subtitle: "Vérifiez un prompt avant de l’envoyer à un outil d’IA.", scan: "Vérifier le prompt →", sample: "Utiliser l’exemple", clear: "Effacer", history: "Vérifications locales récentes", clearHistory: "Effacer l’historique", placeholder: "Collez votre prompt ici…",
    metaLabel: "Vérification privée · jamais stockée ni enregistrée", interfaceLanguage: "Langue de l’interface",
    scanModeStandard: "Standard — vérifications locales équilibrées", scanModeStrict: "Stricte — mode de révision attentive",
    checking: "Vérification…", promptTooLong: "Le prompt est trop long", keepUnder: "Restez sous {max} caractères pour une vérification.",
    nothingFound: "Rien d’évident trouvé", itemsToReview: "{n} élément à vérifier|{n} éléments à vérifier", reviewBeforeSharing: "Vérifiez-les avant de partager votre prompt.", strictReviewPrefix: "Révision stricte : ", helpfulSignal: "C’est un signal utile, pas une garantie.",
    checkFailed: "Échec de la vérification", couldNotRunCheck: "Impossible d’effectuer cette vérification. Réessayez.",
    willBeReplacedWith: "Sera remplacé par ", sensitiveValueHidden: "Valeur sensible masquée",
    noCommonSecrets: "Aucun secret ni donnée personnelle courante détecté. C’est un signal utile, pas une garantie.",
    copySafer: "Copier le prompt sécurisé", copied: "Copié",
    noChecksYet: "Aucune vérification pour l’instant", lastEightWillAppear: "Le résumé de vos huit dernières vérifications apparaîtra ici.", nothingFlagged: "Rien signalé dans cette vérification.", itemsReviewed: "{n} élément examiné|{n} éléments examinés",
    createAccountTrial: "Créez votre compte et démarrez votre essai gratuit de 7 jours pour vérifier des prompts.", startTrialToInspect: "Démarrez votre essai gratuit de 7 jours pour vérifier des prompts.",
    plansTitle: "Offres et tarifs", plansIntro: "Chaque offre commence par un essai gratuit de 7 jours. Utilisez le code {code} pour 20 % de réduction sur votre premier paiement mensuel.",
    personalTag: "Pour les particuliers", personalName: "Personal", personalDesc: "Pour les professionnels indépendants qui utilisent l’IA avec de vraies données clients et personnelles.",
    startTrial: "Démarrer l’essai de 7 jours", yearlyPersonal: "79,90 € par an",
    businessTag: "Pour les équipes · jusqu’à 3 utilisateurs", businessName: "Business", businessDesc: "Des contrôles d’équipe et une limite de confidentialité claire pour les équipes en croissance. Choisissez de un à trois postes.",
    seatsLabel: "Postes", seat1: "1 utilisateur", seat2: "2 utilisateurs", seat3: "3 utilisateurs", yearlyBusiness: "149,90 € par an / utilisateur",
    manageTag: "Déjà abonné ?", manageTitle: "Gérer la facturation", manageDesc: "Mettez à jour votre moyen de paiement, téléchargez vos factures ou annulez le renouvellement quand vous le souhaitez.", manageBtn: "Gérer l’abonnement",
    teamTitle: "Équipe", teamSeatsUsed: "{used} poste(s) utilisé(s) sur {total}.", inviteCreate: "Créer un lien d’invitation", copyLink: "Copier le lien", noInvites: "Aucune invitation pour l’instant.", teammateJoined: "Coéquipier ajouté", invitePending: "Invitation en attente", revoke: "Révoquer", couldNotCreateInvite: "Impossible de créer une invitation.",
    checksThisWeek: "vérifications cette semaine", freeTrialBadge: "Essai gratuit", freeTrialDesc: "Les offres Personal et Business commencent par 7 jours gratuits.", seePlans: "Voir les offres →",
    zeroRetentionTitle: "● Mode zéro rétention", zeroRetentionDesc: "Votre prompt est vérifié, jamais stocké ni enregistré.",
    createAccountBtn: "Créer un compte", protectionActive: "Protection active",
    getSetUp: "Configuration initiale", onboardCheckTitle: "Effectuez votre première vérification", onboardCheckDesc: "Collez un prompt et vérifiez-le une fois.", onboardTermsTitle: "Ajoutez un terme personnalisé", onboardTermsDesc: "Protégez le nom d’un client ou d’un projet dans les Préférences.", onboardThemeTitle: "Choisissez un thème", onboardThemeDesc: "Personnalisez votre espace de travail dans les Préférences.",
    readyToInspect: "Prêt à vérifier", willCheckFor: "Nous vérifierons les données personnelles et secrets courants.", detectsLabel: "Détecte :", saferVersion: "Version sécurisée", runFewChecks: "Effectuez quelques vérifications pour voir un récapitulatif ici."
  },
  de: {
    workspace: "Arbeitsbereich", privateCheck: "Private Prüfung", recent: "Letzte Prüfungen", account: "Konto", plans: "Tarife & Preise", preferences: "Einstellungen", eyebrow: "Persönlicher Bereich", title: "Ihr privater KI-Prüfpunkt.", subtitle: "Prüfen Sie einen Prompt, bevor er ein KI-Tool erreicht.", scan: "Prompt prüfen →", sample: "Beispiel verwenden", clear: "Leeren", history: "Letzte lokale Prüfungen", clearHistory: "Verlauf löschen", placeholder: "Prompt hier einfügen…",
    metaLabel: "Private Prüfung · wird nie gespeichert oder protokolliert", interfaceLanguage: "Oberflächensprache",
    scanModeStandard: "Standard — ausgewogene lokale Prüfungen", scanModeStrict: "Streng — sorgfältiger Prüfmodus",
    checking: "Wird geprüft…", promptTooLong: "Der Prompt ist zu lang", keepUnder: "Bleiben Sie unter {max} Zeichen für eine Prüfung.",
    nothingFound: "Nichts Auffälliges gefunden", itemsToReview: "{n} zu prüfendes Element|{n} zu prüfende Elemente", reviewBeforeSharing: "Prüfen Sie diese, bevor Sie Ihren Prompt teilen.", strictReviewPrefix: "Strenge Prüfung: ", helpfulSignal: "Das ist ein hilfreicher Hinweis, keine Garantie.",
    checkFailed: "Prüfung fehlgeschlagen", couldNotRunCheck: "Die Prüfung konnte nicht ausgeführt werden. Bitte versuchen Sie es erneut.",
    willBeReplacedWith: "Wird ersetzt durch ", sensitiveValueHidden: "Sensibler Wert ausgeblendet",
    noCommonSecrets: "Keine gängigen Geheimnisse oder persönlichen Daten gefunden. Das ist ein hilfreicher Hinweis, keine Garantie.",
    copySafer: "Sicheren Prompt kopieren", copied: "Kopiert",
    noChecksYet: "Noch keine Prüfungen", lastEightWillAppear: "Hier erscheinen die Zusammenfassungen Ihrer letzten acht Prüfungen.", nothingFlagged: "In dieser Prüfung wurde nichts markiert.", itemsReviewed: "{n} geprüftes Element|{n} geprüfte Elemente",
    createAccountTrial: "Erstellen Sie Ihr Konto und starten Sie die 7-tägige kostenlose Testphase, um Prompts zu prüfen.", startTrialToInspect: "Starten Sie die 7-tägige kostenlose Testphase, um Prompts zu prüfen.",
    plansTitle: "Tarife & Preise", plansIntro: "Jeder Tarif beginnt mit einer 7-tägigen Testphase. Verwenden Sie den Code {code} für 20 % Rabatt auf Ihre erste monatliche Zahlung.",
    personalTag: "Für Einzelpersonen", personalName: "Personal", personalDesc: "Für selbstständige Fachleute, die KI mit echten Kunden- und Personendaten nutzen.",
    startTrial: "7-tägige Testphase starten", yearlyPersonal: "79,90 € jährlich",
    businessTag: "Für Teams · bis zu 3 Nutzer", businessName: "Business", businessDesc: "Teamkontrollen und eine klare Datenschutzgrenze für wachsende Teams. Wählen Sie ein bis drei Plätze.",
    seatsLabel: "Plätze", seat1: "1 Nutzer", seat2: "2 Nutzer", seat3: "3 Nutzer", yearlyBusiness: "149,90 € jährlich / Nutzer",
    manageTag: "Bereits abonniert?", manageTitle: "Abrechnung verwalten", manageDesc: "Aktualisieren Sie Ihre Zahlungsmethode, laden Sie Rechnungen herunter oder kündigen Sie die Verlängerung jederzeit.", manageBtn: "Abonnement verwalten",
    teamTitle: "Team", teamSeatsUsed: "{used} von {total} Plätzen belegt.", inviteCreate: "Einladungslink erstellen", copyLink: "Link kopieren", noInvites: "Noch keine Einladungen.", teammateJoined: "Teammitglied beigetreten", invitePending: "Einladung ausstehend", revoke: "Widerrufen", couldNotCreateInvite: "Die Einladung konnte nicht erstellt werden.",
    checksThisWeek: "Prüfungen diese Woche", freeTrialBadge: "Kostenlose Testphase", freeTrialDesc: "Personal- und Business-Tarife beginnen mit 7 Tagen kostenlos.", seePlans: "Tarife ansehen →",
    zeroRetentionTitle: "● Zero-Retention-Modus", zeroRetentionDesc: "Ihr Prompt wird geprüft, nie gespeichert oder protokolliert.",
    createAccountBtn: "Konto erstellen", protectionActive: "Schutz aktiv",
    getSetUp: "Einrichtung starten", onboardCheckTitle: "Erste Prüfung durchführen", onboardCheckDesc: "Fügen Sie einen Prompt ein und prüfen Sie ihn einmal.", onboardTermsTitle: "Eigenen Begriff hinzufügen", onboardTermsDesc: "Schützen Sie einen Kunden- oder Projektnamen in den Einstellungen.", onboardThemeTitle: "Ein Thema wählen", onboardThemeDesc: "Gestalten Sie den Arbeitsbereich in den Einstellungen nach Ihrem Geschmack.",
    readyToInspect: "Bereit zur Prüfung", willCheckFor: "Wir prüfen auf gängige persönliche Daten und Geheimnisse.", detectsLabel: "Erkennt:", saferVersion: "Sichere Version", runFewChecks: "Führen Sie ein paar Prüfungen durch, um hier eine Übersicht zu sehen."
  }
};
const findingLabelsByLanguage: Record<Language, Record<string, string>> = {
  en: { email: "Email", phone: "Phone", secret: "API key", card: "Card", ip: "IP address", iban: "IBAN", fiscalCode: "Fiscal code", credential: "Credential", ssn: "SSN", crypto: "Wallet address", privateKey: "Private key", name: "Personal name", address: "Street address", custom: "Custom term" },
  it: { email: "Email", phone: "Telefono", secret: "Chiave API", card: "Carta", ip: "Indirizzo IP", iban: "IBAN", fiscalCode: "Codice fiscale", credential: "Credenziale", ssn: "SSN", crypto: "Indirizzo wallet", privateKey: "Chiave privata", name: "Nome personale", address: "Indirizzo", custom: "Termine personalizzato" },
  es: { email: "Correo electrónico", phone: "Teléfono", secret: "Clave API", card: "Tarjeta", ip: "Dirección IP", iban: "IBAN", fiscalCode: "Código fiscal", credential: "Credencial", ssn: "SSN", crypto: "Dirección de wallet", privateKey: "Clave privada", name: "Nombre personal", address: "Dirección postal", custom: "Término personalizado" },
  fr: { email: "E-mail", phone: "Téléphone", secret: "Clé API", card: "Carte", ip: "Adresse IP", iban: "IBAN", fiscalCode: "Code fiscal", credential: "Identifiant", ssn: "SSN", crypto: "Adresse de portefeuille", privateKey: "Clé privée", name: "Nom personnel", address: "Adresse postale", custom: "Terme personnalisé" },
  de: { email: "E-Mail", phone: "Telefon", secret: "API-Schlüssel", card: "Karte", ip: "IP-Adresse", iban: "IBAN", fiscalCode: "Steuernummer", credential: "Zugangsdaten", ssn: "SSN", crypto: "Wallet-Adresse", privateKey: "Privater Schlüssel", name: "Persönlicher Name", address: "Straßenadresse", custom: "Eigener Begriff" }
};
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
const settingsByLanguage: Record<Language, string[]> = {
  en: ["Personal preferences", "These settings stay in this browser. They do not create an online account or upload prompt content.", "Interface language", "Inspection mode", "Detect personal data (email, phone, IP, fiscal code)", "Detect API keys and credentials", "Detect cards and IBANs", "Keep local check summaries", "Show the detected value on screen", "Clear the prompt after copying its safer version", "Close", "Save preferences", "Custom protected terms"],
  it: ["Impostazioni personali", "Queste impostazioni restano in questo browser. Non creano un account online e non caricano il contenuto dei prompt.", "Lingua dell'interfaccia", "Modalità di controllo", "Rileva dati personali (email, telefono, IP, codice fiscale)", "Rileva API key e credenziali", "Rileva carte e IBAN", "Mantieni i riepiloghi locali", "Mostra il valore rilevato sullo schermo", "Svuota il prompt dopo aver copiato la versione sicura", "Chiudi", "Salva impostazioni", "Termini personali protetti"],
  es: ["Preferencias personales", "Estos ajustes permanecen en este navegador. No crean una cuenta ni suben el contenido de los prompts.", "Idioma de la interfaz", "Modo de revisión", "Detectar datos personales (correo, teléfono, IP, código fiscal)", "Detectar claves API y credenciales", "Detectar tarjetas e IBAN", "Guardar resúmenes locales", "Mostrar el valor detectado", "Limpiar el prompt después de copiar la versión segura", "Cerrar", "Guardar preferencias", "Términos protegidos personalizados"],
  fr: ["Préférences personnelles", "Ces réglages restent dans ce navigateur. Ils ne créent pas de compte et n’envoient pas le contenu des prompts.", "Langue de l’interface", "Mode de vérification", "Détecter les données personnelles (e-mail, téléphone, IP, code fiscal)", "Détecter les clés API et identifiants", "Détecter les cartes et IBAN", "Conserver les résumés locaux", "Afficher la valeur détectée", "Effacer le prompt après la copie", "Fermer", "Enregistrer", "Termes protégés personnalisés"],
  de: ["Persönliche Einstellungen", "Diese Einstellungen bleiben in diesem Browser. Sie erstellen kein Konto und laden keine Prompts hoch.", "Oberflächensprache", "Prüfmodus", "Personenbezogene Daten erkennen (E-Mail, Telefon, IP, Steuernummer)", "API-Schlüssel und Zugangsdaten erkennen", "Karten und IBAN erkennen", "Lokale Prüfzusammenfassungen speichern", "Erkannten Wert anzeigen", "Prompt nach dem Kopieren leeren", "Schließen", "Einstellungen speichern", "Eigene geschützte Begriffe"]
};

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
        theme: themes.some((t) => t.code === candidate.theme) ? candidate.theme as ThemeName : "lime",
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

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`PromptShield dashboard element missing: ${selector}`);
  return element;
}

export function mountDashboard(): void {
  // All dashboard-specific CSS lives in dashboard.html's own <style> tag rather
  // than being injected here at runtime. Tauri computes CSP hashes only for
  // inline <style>/script content present in the HTML at build time; per the CSP
  // spec, once a directive has hash-sources, 'unsafe-inline' is ignored entirely
  // for that directive (not merely supplemented) -- so a <style> tag created here
  // at runtime, and any style="" attribute set via innerHTML, was silently
  // dropped in the desktop build even though tauri.conf.json declares
  // 'unsafe-inline' for style-src. The web build has no such hashes and was
  // never affected, which is why this only showed up on desktop. Confirmed by
  // reading document.styleSheets from inside the running desktop app: the
  // dynamically created sheet was entirely absent.
  enableAppShell();
  const prompt = required<HTMLTextAreaElement>("#prompt");
  const findingsRoot = required<HTMLElement>("#findings");
  const safeRoot = required<HTMLElement>("#safe");
  const redacted = required<HTMLElement>("#redacted");
  const count = required<HTMLElement>("#risk-count");
  const title = required<HTMLElement>("#risk-title");
  const copy = required<HTMLElement>("#risk-copy");
  const historyRoot = required<HTMLElement>("#history");
  const actions = required<HTMLElement>(".actions");
  const historyCard = required<HTMLElement>(".history");
  const navItems = Array.from(document.querySelectorAll<HTMLElement>(".nav-item"));

  const preferences = readPreferences();
  applyTheme(preferences.theme);
  const words = (): Record<string, string> => copyByLanguage[preferences.language];
  const labels = (): Record<string, string> => findingLabelsByLanguage[preferences.language];

  const meta = document.createElement("div");
  meta.className = "prompt-meta";
  meta.innerHTML = `<span id="meta-label">${words().metaLabel}</span><span id="character-count"><strong>0</strong> / ${maxPromptLength.toLocaleString()}</span>`;
  prompt.insertAdjacentElement("afterend", meta);

  const clearPrompt = document.createElement("button");
  clearPrompt.type = "button";
  clearPrompt.className = "secondary";
  clearPrompt.textContent = words().clear;
  actions.insertBefore(clearPrompt, required<HTMLButtonElement>("#scan"));

  const historyTitle = document.createElement("div");
  historyTitle.className = "history-title";
  historyTitle.innerHTML = `<h2>${words().history}</h2><button class="secondary" id="clear-history" type="button">${words().clearHistory}</button>`;
  historyCard.querySelector("h2")?.replaceWith(historyTitle);
  const clearHistoryButton = required<HTMLButtonElement>("#clear-history");
  const characterCount = required<HTMLElement>("#character-count");

  navItems.forEach((item) => {
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
  });

  const preferenceDialog = document.createElement("div");
  preferenceDialog.className = "drawer-backdrop";
  preferenceDialog.innerHTML = `
    <section class="drawer" role="dialog" aria-modal="true" aria-labelledby="preferences-title">
      <h2 id="preferences-title">Personal preferences</h2>
      <p>These settings stay in this browser. They do not create an online account or upload prompt content.</p>
      <label class="pref-row">Interface language<select id="language"><option value="en">English</option><option value="it">Italiano</option><option value="es">Español</option><option value="fr">Français</option><option value="de">Deutsch</option></select></label>
      <div class="pref-row theme-pref-row">Theme<div class="theme-row" id="theme-row"></div></div>
      <label class="pref-row">Inspection mode<select id="scan-mode"><option value="standard">Standard — balanced local checks</option><option value="strict">Strict — careful review mode</option></select></label>
      <label class="switch"><input id="detect-personal" type="checkbox" checked> Detect personal data (email, phone, IP, fiscal code)</label>
      <label class="switch"><input id="detect-credentials" type="checkbox" checked> Detect API keys and credentials</label>
      <label class="switch"><input id="detect-financial" type="checkbox" checked> Detect cards and IBANs</label>
      <label class="switch"><input id="save-history" type="checkbox" checked> Keep local check summaries</label>
      <label class="switch"><input id="show-raw" type="checkbox" checked> Show the detected value on screen</label>
      <label class="switch"><input id="clear-after-copy" type="checkbox"> Clear the prompt after copying its safer version</label>
      <label class="pref-row">Custom protected terms<textarea class="term-editor" id="custom-terms" maxlength="1500" placeholder="One term per line, for example: Acme Client"></textarea></label>
      <div class="drawer-actions"><button class="secondary" id="close-preferences" type="button">Close</button><button class="primary" id="save-preferences" type="button">Save preferences</button></div>
    </section>`;
  document.body.append(preferenceDialog);
  // Same swatch-picker pattern as PC Tweaker, but the per-theme color comes from a
  // static CSS class (theme-swatch-lime, etc., defined in dashboard.html) instead
  // of an inline style="" attribute -- see the note above mountDashboard() for why.
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
      teamInviteList.innerHTML = data.invites.map((invite) => `<li data-id="${invite.id}"><span>${invite.status === "accepted" ? words().teammateJoined : words().invitePending} · ${new Date(invite.createdAt).toLocaleDateString()}</span>${invite.status === "pending" ? `<button type="button" class="secondary" data-revoke="${invite.id}">${words().revoke}</button>` : ""}</li>`).join("") || `<li class="empty">${words().noInvites}</li>`;
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

  const openPlans = (): void => {
    plansDialog.classList.add("open");
    document.documentElement.classList.add("preferences-open");
    void loadTeam();
  };
  required<HTMLButtonElement>("#close-plans").addEventListener("click", closePlans);
  document.querySelector("#side-fill-cta")?.addEventListener("click", (event) => { event.preventDefault(); openPlans(); });
  plansDialog.addEventListener("click", (event) => { if (event.target === plansDialog) closePlans(); });
  document.addEventListener("promptshield:need-upgrade", () => openPlans());
  const languageSelect = required<HTMLSelectElement>("#language");
  const scanModeSelect = required<HTMLSelectElement>("#scan-mode");
  const personalToggle = required<HTMLInputElement>("#detect-personal");
  const credentialToggle = required<HTMLInputElement>("#detect-credentials");
  const financialToggle = required<HTMLInputElement>("#detect-financial");
  const historyToggle = required<HTMLInputElement>("#save-history");
  const rawValueToggle = required<HTMLInputElement>("#show-raw");
  const clearAfterCopyToggle = required<HTMLInputElement>("#clear-after-copy");
  const customTermsInput = required<HTMLTextAreaElement>("#custom-terms");
  languageSelect.value = preferences.language;
  scanModeSelect.value = preferences.scanMode;
  personalToggle.checked = preferences.includePersonalData;
  credentialToggle.checked = preferences.includeCredentials;
  financialToggle.checked = preferences.includeFinancialData;
  historyToggle.checked = preferences.saveHistory;
  rawValueToggle.checked = preferences.showRawValues;
  clearAfterCopyToggle.checked = preferences.autoClearAfterCopy;
  customTermsInput.value = preferences.customTerms.join("\n");

  const closePreferences = (): void => {
    preferenceDialog.classList.remove("open");
    document.documentElement.classList.remove("preferences-open");
  };
  const openPreferences = (): void => {
    preferenceDialog.classList.add("open");
    document.documentElement.classList.add("preferences-open");
    languageSelect.focus();
  };

  const applyLanguage = (): void => {
    const w = words();
    const settings = settingsByLanguage[preferences.language];
    document.documentElement.lang = preferences.language;
    document.querySelectorAll<HTMLElement>(".nav-label")[0].textContent = w.workspace;
    document.querySelectorAll<HTMLElement>(".nav-label")[1].textContent = w.account;
    navItems[0].lastChild!.textContent = w.privateCheck;
    navItems[1].lastChild!.textContent = w.recent;
    navItems[2].lastChild!.textContent = w.plans;
    navItems[3].lastChild!.textContent = w.preferences;
    required<HTMLElement>(".eyebrow").textContent = w.eyebrow;
    required<HTMLElement>(".top h1").textContent = w.title;
    required<HTMLElement>(".top p").textContent = w.subtitle;
    prompt.placeholder = w.placeholder;
    required<HTMLButtonElement>("#sample").textContent = w.sample;
    required<HTMLButtonElement>("#scan").textContent = w.scan;
    clearPrompt.textContent = w.clear;
    required<HTMLElement>(".history-title h2").textContent = w.history;
    clearHistoryButton.textContent = w.clearHistory;
    document.querySelector("#meta-label")!.textContent = w.metaLabel;
    languageSelect.setAttribute("aria-label", `${w.interfaceLanguage}: ${languageNames[preferences.language]}`);
    required<HTMLElement>("#preferences-title").textContent = settings[0];
    required<HTMLElement>(".drawer p").textContent = settings[1];
    const prefRows = Array.from(document.querySelectorAll<HTMLElement>(".pref-row:not(.theme-pref-row)"));
    prefRows.slice(0, 2).forEach((row, index) => { if (row.firstChild) row.firstChild.textContent = settings[index + 2]; });
    if (prefRows[2]?.firstChild) prefRows[2].firstChild.textContent = settings[12];
    const switches = Array.from(document.querySelectorAll<HTMLElement>(".switch"));
    switches.forEach((row, index) => { if (row.lastChild) row.lastChild.textContent = settings[index + 4]; });
    required<HTMLButtonElement>("#close-preferences").textContent = settings[10];
    required<HTMLButtonElement>("#save-preferences").textContent = settings[11];
    scanModeSelect.options[0].textContent = w.scanModeStandard;
    scanModeSelect.options[1].textContent = w.scanModeStrict;

    // Plans drawer: patched in place rather than rebuilt via innerHTML, since
    // rebuilding would detach the click handlers already bound to these
    // specific button/select elements at mount time.
    required<HTMLElement>("#plans-title").textContent = w.plansTitle;
    required<HTMLElement>(".plans-drawer > p").innerHTML = format(w.plansIntro, { code: "<b>SHIELD</b>" });
    const planCards = Array.from(document.querySelectorAll<HTMLElement>(".plan-card"));
    const [personalCard, businessCard, manageCard] = planCards;
    personalCard.querySelector(".plan-tag")!.textContent = w.personalTag;
    personalCard.querySelector("h3")!.textContent = w.personalName;
    personalCard.querySelector("p")!.textContent = w.personalDesc;
    personalCard.querySelector<HTMLElement>('[data-interval="monthly"]')!.textContent = w.startTrial;
    personalCard.querySelector<HTMLElement>('[data-interval="yearly"]')!.textContent = w.yearlyPersonal;
    businessCard.querySelector(".plan-tag")!.textContent = w.businessTag;
    businessCard.querySelector("h3")!.textContent = w.businessName;
    businessCard.querySelector("p")!.textContent = w.businessDesc;
    if (businessCard.querySelector(".pref-row")?.firstChild) businessCard.querySelector(".pref-row")!.firstChild!.textContent = w.seatsLabel;
    const seatOptions = businessCard.querySelectorAll<HTMLOptionElement>("#business-seats option");
    if (seatOptions[0]) seatOptions[0].textContent = w.seat1;
    if (seatOptions[1]) seatOptions[1].textContent = w.seat2;
    if (seatOptions[2]) seatOptions[2].textContent = w.seat3;
    businessCard.querySelector<HTMLElement>('[data-interval="monthly"]')!.textContent = w.startTrial;
    businessCard.querySelector<HTMLElement>('[data-interval="yearly"]')!.textContent = w.yearlyBusiness;
    manageCard.querySelector(".plan-tag")!.textContent = w.manageTag;
    manageCard.querySelector("h3")!.textContent = w.manageTitle;
    manageCard.querySelector("p")!.textContent = w.manageDesc;
    required<HTMLElement>("#manage-billing").textContent = w.manageBtn;
    required<HTMLElement>("#team-section h3")!.textContent = w.teamTitle;
    required<HTMLElement>("#team-invite-btn").textContent = w.inviteCreate;
    required<HTMLElement>("#close-plans").textContent = settings[10];

    // Static sidebar/onboarding/results-panel copy that ships hardcoded in
    // dashboard.html -- patched here the same way the plans drawer is,
    // rather than duplicating each string's markup context.
    const sideStat = document.querySelector("#side-stat span");
    if (sideStat) sideStat.textContent = w.checksThisWeek;
    const sideFill = document.querySelector("#side-fill");
    if (sideFill) {
      sideFill.querySelector("b")!.textContent = w.freeTrialBadge;
      sideFill.querySelector("span")!.textContent = w.freeTrialDesc;
    }
    required<HTMLElement>("#side-fill-cta").textContent = w.seePlans;
    const privacyNote = document.querySelector(".privacy");
    if (privacyNote) privacyNote.innerHTML = `<b>${w.zeroRetentionTitle}</b><br>${w.zeroRetentionDesc}`;
    const topRight = document.querySelector(".top-right");
    if (topRight) {
      topRight.querySelector("a.small-btn")!.textContent = w.createAccountBtn;
      const status = topRight.querySelector(".status");
      if (status?.lastChild) status.lastChild.textContent = ` ${w.protectionActive}`;
    }
    const onboarding = document.querySelector("#onboarding");
    if (onboarding) {
      onboarding.querySelector("h2")!.textContent = w.getSetUp;
      const items = onboarding.querySelectorAll("#onboarding-list li[data-task]");
      const onboardCopy: [string, string][] = [
        [w.onboardCheckTitle, w.onboardCheckDesc], [w.onboardTermsTitle, w.onboardTermsDesc], [w.onboardThemeTitle, w.onboardThemeDesc]
      ];
      items.forEach((item, index) => {
        const [taskTitle, taskDesc] = onboardCopy[index] ?? [];
        if (taskTitle) item.querySelector("b")!.textContent = taskTitle;
        if (taskDesc) item.querySelector("span")!.textContent = taskDesc;
      });
    }
    // #risk-title/#risk-copy show real scan results once a check has run --
    // only overwrite the pre-scan placeholder text, not an actual result.
    if (!safeRoot.style.display || safeRoot.style.display === "none") {
      title.textContent = w.readyToInspect;
      copy.textContent = w.willCheckFor;
    }
    const findingsEmptyLabel = document.querySelector(".findings-empty-label");
    if (findingsEmptyLabel) findingsEmptyLabel.textContent = w.detectsLabel;
    document.querySelectorAll<HTMLElement>(".chip").forEach((chip) => {
      const kind = Object.keys(labels()).find((key) => findingLabelsByLanguage.en[key] === chip.textContent);
      if (kind) chip.textContent = labels()[kind];
    });
    const saferHeading = document.querySelector("#safe h3");
    if (saferHeading) saferHeading.textContent = w.saferVersion;
    if (!safeRoot.style.display || safeRoot.style.display === "none") {
      required<HTMLElement>("#copy").textContent = w.copySafer;
    }
    const analyticsEmptyEl = document.querySelector("#analytics-empty");
    if (analyticsEmptyEl) analyticsEmptyEl.textContent = w.runFewChecks;
  };

  // Sidebar nav items previously only had their label text swapped by
  // applyLanguage() -- clicking them did nothing. Wire them to the actions
  // their labels promise.
  const setActiveNav = (active: HTMLElement): void => {
    navItems.forEach((item) => item.classList.toggle("active", item === active));
  };
  navItems[0].addEventListener("click", () => { setActiveNav(navItems[0]); prompt.focus(); });
  navItems[1].addEventListener("click", () => { setActiveNav(navItems[0]); historyCard.scrollIntoView({ behavior: "smooth", block: "start" }); });
  navItems[2].addEventListener("click", () => { openPlans(); });
  navItems[3].addEventListener("click", () => { openPreferences(); });

  const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", "\"": "&quot;"
  }[character] ?? character));

  const onboardingKey = "promptshield.onboarding-dismissed.v1";
  const onboardingSection = document.querySelector<HTMLElement>("#onboarding");
  const renderOnboarding = (): void => {
    if (!onboardingSection) return;
    if (localStorage.getItem(onboardingKey) === "1") { onboardingSection.style.display = "none"; return; }
    const tasks: Record<string, boolean> = {
      check: readHistory().length > 0,
      terms: preferences.customTerms.length > 0,
      theme: preferences.theme !== defaultPreferences.theme
    };
    onboardingSection.querySelectorAll<HTMLElement>("#onboarding-list li[data-task]").forEach((item) => {
      item.classList.toggle("done", Boolean(tasks[item.dataset.task ?? ""]));
    });
    onboardingSection.style.display = Object.values(tasks).every(Boolean) ? "none" : "block";
  };
  document.querySelector("#onboarding-close")?.addEventListener("click", () => {
    localStorage.setItem(onboardingKey, "1");
    if (onboardingSection) onboardingSection.style.display = "none";
  });

  const sideStatCount = document.querySelector<HTMLElement>("#side-stat strong");
  const analyticsRoot = document.querySelector<HTMLElement>("#analytics-bars");
  const analyticsEmpty = document.querySelector<HTMLElement>("#analytics-empty");

  const renderHistory = (): void => {
    const history = readHistory();
    const visible = history.slice(0, 8);
    historyRoot.innerHTML = visible.length ? visible.map((entry) => {
      const breakdown = Object.entries(entry.byKind).map(([kind, n]) => `${labels()[kind] ?? kind} × ${n}`).join(", ");
      return `<article class="entry" data-id="${entry.id}" tabindex="0" role="button" aria-expanded="false"><strong>${plural(words().itemsReviewed, entry.findings)}</strong><span>${escapeHtml(entry.preview)}</span><em>${new Date(entry.createdAt).toLocaleString()}</em><div class="entry-detail">${breakdown ? escapeHtml(breakdown) : words().nothingFlagged}</div></article>`;
    }).join("") : `<div class="entry"><strong>${words().noChecksYet}</strong><span>${words().lastEightWillAppear}</span></div>`;

    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weekly = history.filter((entry) => new Date(entry.createdAt).getTime() >= weekAgo);
    if (sideStatCount) sideStatCount.textContent = String(weekly.length);

    if (analyticsRoot && analyticsEmpty) {
      const totals: Record<string, number> = {};
      for (const entry of weekly) for (const [kind, n] of Object.entries(entry.byKind)) totals[kind] = (totals[kind] ?? 0) + n;
      const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const max = rows.length ? rows[0][1] : 0;
      analyticsEmpty.style.display = rows.length ? "none" : "block";
      analyticsRoot.innerHTML = rows.map(([kind, n]) => `<div class="analytics-row"><span class="analytics-label">${labels()[kind] ?? kind}</span><div class="analytics-track"><div class="analytics-fill" style="width:${Math.max(6, Math.round((n / max) * 100))}%"></div></div><span class="analytics-value">${n}</span></div>`).join("");
    }
    renderOnboarding();
  };

  const updateCharacterCount = (): void => {
    characterCount.innerHTML = `<strong>${prompt.value.length.toLocaleString()}</strong> / ${maxPromptLength.toLocaleString()}`;
  };

  const scanButton = required<HTMLButtonElement>("#scan");
  const scan = async (): Promise<void> => {
    if (!prompt.value.trim()) {
      prompt.focus();
      return;
    }
    if (!window.promptShieldAuth?.hasAccess()) {
      window.promptShieldAuth?.requestAccess(words().createAccountTrial);
      return;
    }
    if (prompt.value.length > maxPromptLength) {
      count.textContent = "!";
      title.textContent = words().promptTooLong;
      copy.textContent = format(words().keepUnder, { max: maxPromptLength.toLocaleString() });
      return;
    }
    scanButton.disabled = true;
    const originalLabel = scanButton.textContent;
    scanButton.textContent = words().checking;
    try {
      const scanned = await window.promptShieldAuth!.scanPrompt(prompt.value, preferences);
      const result = storeResult(prompt.value, scanned.findings, scanned.redactedText, preferences);
      count.textContent = String(result.findings.length);
      title.textContent = result.findings.length ? plural(words().itemsToReview, result.findings.length) : words().nothingFound;
      copy.textContent = result.findings.length ? `${preferences.scanMode === "strict" ? words().strictReviewPrefix : ""}${words().reviewBeforeSharing}` : words().helpfulSignal;
      findingsRoot.className = "findings";
      findingsRoot.innerHTML = result.findings.length ? result.findings.map((finding) => `<div class="finding"><i></i><div><b>${labels()[finding.kind] ?? finding.label}</b><span>${escapeHtml(preferences.showRawValues ? finding.value : words().sensitiveValueHidden)}</span><small>${words().willBeReplacedWith}${escapeHtml(finding.replacement.replace("$1$2", ""))}</small></div></div>`).join("") : `<div class="empty">${words().noCommonSecrets}</div>`;
      redacted.textContent = result.redactedText;
      safeRoot.style.display = "block";
      renderHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "TRIAL_REQUIRED") {
        window.promptShieldAuth?.requestAccess(words().startTrialToInspect);
      } else {
        title.textContent = words().checkFailed;
        copy.textContent = words().couldNotRunCheck;
      }
    } finally {
      scanButton.disabled = false;
      scanButton.textContent = originalLabel;
    }
  };

  scanButton.addEventListener("click", () => { void scan(); });
  void enableDesktopCompanion((clipboardText) => {
    prompt.value = clipboardText;
    updateCharacterCount();
    scan();
  });
  prompt.addEventListener("input", updateCharacterCount);
  clearPrompt.addEventListener("click", () => {
    prompt.value = "";
    updateCharacterCount();
    prompt.focus();
  });
  clearHistoryButton.addEventListener("click", () => {
    clearHistory();
    renderHistory();
  });
  const toggleEntry = (entry: HTMLElement): void => {
    const open = entry.classList.toggle("open");
    entry.setAttribute("aria-expanded", String(open));
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
  navItems.forEach((item) => {
    const activate = (): void => {
      const index = navItems.indexOf(item);
      if (index === 1) historyCard.scrollIntoView({ behavior: "smooth", block: "start" });
      if (index === 2) openPlans();
      if (index === 3) openPreferences();
    };
    item.addEventListener("click", activate);
    item.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } });
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
    applyLanguage();
    renderHistory();
    closePreferences();
  });
  preferenceDialog.addEventListener("click", (event) => { if (event.target === preferenceDialog) closePreferences(); });
  required<HTMLButtonElement>("#sample").addEventListener("click", () => {
    prompt.value = "Send a project update to maria.rossi@example.com. The test server is 192.168.1.20 and password=demo-credential-123.";
    scan();
  });
  required<HTMLButtonElement>("#copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(redacted.textContent ?? "");
    const button = required<HTMLButtonElement>("#copy");
    button.textContent = words().copied;
    if (preferences.autoClearAfterCopy) {
      prompt.value = "";
      updateCharacterCount();
    }
    window.setTimeout(() => { button.textContent = words().copySafer; }, 1400);
  });
  renderHistory();
  updateCharacterCount();
  applyLanguage();
}

if (typeof document !== "undefined") mountDashboard();
