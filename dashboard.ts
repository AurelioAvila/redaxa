import { inspectPrompt, type Finding, type ScanOptions } from "./scanner.js";
import { enableAppShell } from "./pwa.js";
import { enableDesktopCompanion } from "./desktop.js";

type HistoryEntry = { id: string; createdAt: string; findings: number; preview: string };
type Language = "en" | "it" | "es" | "fr" | "de";
type ThemeName = "lime" | "violet" | "ocean" | "amber" | "crimson";
type Preferences = ScanOptions & { language: Language; theme: ThemeName; scanMode: "standard" | "strict"; saveHistory: boolean; autoClearAfterCopy: boolean; showRawValues: boolean; customTerms: string[] };

const storageKey = "promptshield.personal-history.v1";
const preferencesKey = "promptshield.personal-preferences.v1";
const maxPromptLength = 10_000;

const defaultPreferences: Preferences = { language: "en", theme: "lime", scanMode: "standard", includePersonalData: true, includeCredentials: true, includeFinancialData: true, saveHistory: true, autoClearAfterCopy: false, showRawValues: true, customTerms: [] };

const themes: { code: ThemeName; label: string; accent: string; accentInk: string }[] = [
  { code: "lime", label: "Lime", accent: "#b9ff00", accentInk: "#080a07" },
  { code: "violet", label: "Violet", accent: "#a78bfa", accentInk: "#0c0a17" },
  { code: "ocean", label: "Ocean Blue", accent: "#4ea1ff", accentInk: "#05070c" },
  { code: "amber", label: "Amber Dusk", accent: "#ffb84d", accentInk: "#140d02" },
  { code: "crimson", label: "Crimson Steel", accent: "#ff5d78", accentInk: "#12060a" }
];

function applyTheme(theme: ThemeName): void {
  const match = themes.find((candidate) => candidate.code === theme) ?? themes[0];
  document.documentElement.style.setProperty("--accent", match.accent);
  document.documentElement.style.setProperty("--accent-ink", match.accentInk);
}

const languageNames: Record<Language, string> = { en: "English", it: "Italiano", es: "Español", fr: "Français", de: "Deutsch" };
const copyByLanguage: Record<Language, Record<string, string>> = {
  en: { workspace: "Workspace", privateCheck: "Private check", recent: "Recent checks", account: "Account", plans: "Plans & pricing", preferences: "Preferences", eyebrow: "Personal workspace", title: "Your private AI checkpoint.", subtitle: "Review a prompt before it reaches any AI tool.", scan: "Inspect prompt →", sample: "Use sample", clear: "Clear", history: "Recent local checks", clearHistory: "Clear history", placeholder: "Paste your prompt here…" },
  it: { workspace: "Spazio di lavoro", privateCheck: "Controllo privato", recent: "Controlli recenti", account: "Account", plans: "Piani e prezzi", preferences: "Impostazioni", eyebrow: "Spazio personale", title: "Il tuo controllo AI privato.", subtitle: "Rivedi un prompt prima di inviarlo a uno strumento AI.", scan: "Controlla prompt →", sample: "Usa esempio", clear: "Svuota", history: "Controlli locali recenti", clearHistory: "Cancella cronologia", placeholder: "Incolla qui il tuo prompt…" },
  es: { workspace: "Espacio de trabajo", privateCheck: "Revisión privada", recent: "Revisiones recientes", account: "Cuenta", plans: "Planes y precios", preferences: "Preferencias", eyebrow: "Espacio personal", title: "Tu punto de control privado para IA.", subtitle: "Revisa un prompt antes de enviarlo a una herramienta de IA.", scan: "Revisar prompt →", sample: "Usar ejemplo", clear: "Limpiar", history: "Revisiones locales recientes", clearHistory: "Borrar historial", placeholder: "Pega tu prompt aquí…" },
  fr: { workspace: "Espace de travail", privateCheck: "Vérification privée", recent: "Vérifications récentes", account: "Compte", plans: "Offres et tarifs", preferences: "Préférences", eyebrow: "Espace personnel", title: "Votre contrôle IA privé.", subtitle: "Vérifiez un prompt avant de l’envoyer à un outil d’IA.", scan: "Vérifier le prompt →", sample: "Utiliser l’exemple", clear: "Effacer", history: "Vérifications locales récentes", clearHistory: "Effacer l’historique", placeholder: "Collez votre prompt ici…" },
  de: { workspace: "Arbeitsbereich", privateCheck: "Private Prüfung", recent: "Letzte Prüfungen", account: "Konto", plans: "Tarife & Preise", preferences: "Einstellungen", eyebrow: "Persönlicher Bereich", title: "Ihr privater KI-Prüfpunkt.", subtitle: "Prüfen Sie einen Prompt, bevor er ein KI-Tool erreicht.", scan: "Prompt prüfen →", sample: "Beispiel verwenden", clear: "Leeren", history: "Letzte lokale Prüfungen", clearHistory: "Verlauf löschen", placeholder: "Prompt hier einfügen…" }
};
const settingsByLanguage: Record<Language, string[]> = {
  en: ["Personal preferences", "These settings stay in this browser. They do not create an online account or upload prompt content.", "Interface language", "Inspection mode", "Detect personal data (email, phone, IP, fiscal code)", "Detect API keys and credentials", "Detect cards and IBANs", "Keep local check summaries", "Show the detected value on screen", "Clear the prompt after copying its safer version", "Close", "Save preferences", "Custom protected terms"],
  it: ["Impostazioni personali", "Queste impostazioni restano in questo browser. Non creano un account online e non caricano il contenuto dei prompt.", "Lingua dell'interfaccia", "Modalità di controllo", "Rileva dati personali (email, telefono, IP, codice fiscale)", "Rileva API key e credenziali", "Rileva carte e IBAN", "Mantieni i riepiloghi locali", "Mostra il valore rilevato sullo schermo", "Svuota il prompt dopo aver copiato la versione sicura", "Chiudi", "Salva impostazioni", "Termini personali protetti"],
  es: ["Preferencias personales", "Estos ajustes permanecen en este navegador. No crean una cuenta ni suben el contenido de los prompts.", "Idioma de la interfaz", "Modo de revisión", "Detectar datos personales", "Detectar claves API y credenciales", "Detectar tarjetas e IBAN", "Guardar resúmenes locales", "Mostrar el valor detectado", "Limpiar el prompt después de copiar la versión segura", "Cerrar", "Guardar preferencias", "Términos protegidos personalizados"],
  fr: ["Préférences personnelles", "Ces réglages restent dans ce navigateur. Ils ne créent pas de compte et n’envoient pas le contenu des prompts.", "Langue de l’interface", "Mode de vérification", "Détecter les données personnelles", "Détecter les clés API et identifiants", "Détecter les cartes et IBAN", "Conserver les résumés locaux", "Afficher la valeur détectée", "Effacer le prompt après la copie", "Fermer", "Enregistrer", "Termes protégés personnalisés"],
  de: ["Persönliche Einstellungen", "Diese Einstellungen bleiben in diesem Browser. Sie erstellen kein Konto und laden keine Prompts hoch.", "Oberflächensprache", "Prüfmodus", "Personenbezogene Daten erkennen", "API-Schlüssel und Zugangsdaten erkennen", "Karten und IBAN erkennen", "Lokale Prüfzusammenfassungen speichern", "Erkannten Wert anzeigen", "Prompt nach dem Kopieren leeren", "Schließen", "Einstellungen speichern", "Eigene geschützte Begriffe"]
};

export function saveHistory(text: string, findings: Finding[]): HistoryEntry[] {
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    findings: findings.length,
    preview: text.replace(/\s+/g, " ").trim().slice(0, 76)
  };
  const history = [entry, ...readHistory()].slice(0, 8);
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

export function inspectAndStore(text: string, preferences: Preferences) {
  const result = inspectPrompt(text, preferences);
  return { ...result, history: preferences.saveHistory ? saveHistory(text, result.findings) : readHistory() };
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`PromptShield dashboard element missing: ${selector}`);
  return element;
}

function installDashboardPolish(): void {
  if (!document.querySelector("link[data-promptshield-dashboard]")) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "dashboard.css";
    stylesheet.dataset.promptshieldDashboard = "true";
    document.head.append(stylesheet);
  }
  const style = document.createElement("style");
  style.textContent = `
    .side { position: sticky; top: 0; height: 100vh; }
    html.preferences-open, html.preferences-open body { overflow:hidden; }
    #pwa-install { position:fixed; right:24px; bottom:24px; z-index:20; border:1px solid var(--accent); border-radius:999px; padding:11px 15px; background:var(--accent); color:var(--accent-ink); font-weight:850; box-shadow:0 12px 32px #0008; cursor:pointer; }
    #pwa-install:focus-visible { outline:3px solid #fff; outline-offset:3px; }
    #inspect-clipboard { position:fixed; right:24px; bottom:76px; z-index:20; border:1px solid #405535; border-radius:999px; padding:10px 14px; background:#141b10; color:#e7eddc; font-weight:750; box-shadow:0 12px 32px #0008; cursor:pointer; }
    #inspect-clipboard:hover { border-color:var(--accent); color:var(--accent); }
    #inspect-clipboard:focus-visible { outline:3px solid #d5ff73; outline-offset:3px; }
    .link-btn, .primary, .copy { cursor: pointer; transition: transform .16s ease, filter .16s ease, background .16s ease; }
    .link-btn:hover { color: var(--text); }
    .primary:hover { filter: brightness(1.08); transform: translateY(-1px); }
    .primary:active { transform: translateY(0); }
    .copy:hover { background: #30382a; }
    .link-btn:focus-visible, .primary:focus-visible, .copy:focus-visible { outline: 3px solid #d5ff73; outline-offset: 3px; }
    .prompt-meta { display:flex; justify-content:space-between; gap:12px; margin-top:10px; color:var(--muted); font-size:11px; }
    .prompt-meta strong { color:var(--accent); font-weight:750; }
    .secondary { border:1px solid #40483c; border-radius:7px; background:transparent; color:#bdc5b8; padding:7px 9px; font-size:12px; cursor:pointer; }
    .secondary:hover { border-color:#68755f; color:var(--text); background:#181d16; }
    .history-title { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:14px; }
    .history-title h2 { margin:0; }
    .finding small { display:block; margin-top:3px; color:#777e73; font-size:11px; }
    .nav-item { border:0; width:100%; background:transparent; text-align:left; cursor:pointer; }
    .nav-item:hover:not(.active) { background:#ffffff08; color:var(--text); }
    .drawer-backdrop { position:fixed; inset:0; z-index:20; display:grid; place-items:center; overflow-y:auto; padding:24px; background:#0009; opacity:0; pointer-events:none; transition:opacity .18s ease; }
    .drawer-backdrop.open { opacity:1; pointer-events:auto; }
    .drawer { position:relative; width:min(460px,100%); max-height:calc(100dvh - 48px); overflow-y:auto; border:1px solid #3a4335; border-radius:18px; background:#131711; padding:24px; box-shadow:0 30px 90px #000b; }
    .drawer h2 { font-size:22px; margin:0 0 8px; }
    .drawer p { color:var(--muted); font-size:13px; line-height:1.5; margin:0 0 20px; }
    .pref-row { display:grid; gap:7px; margin:14px 0; color:#cdd3c8; font-size:13px; font-weight:700; }
    .pref-row select { border:1px solid #3b4437; border-radius:8px; background:#0b0e09; color:var(--text); padding:10px; }
    .term-editor { width:100%; min-height:82px; resize:vertical; border:1px solid #3b4437; border-radius:8px; background:#0b0e09; color:var(--text); padding:10px; line-height:1.45; }
    .switch { display:flex; gap:10px; align-items:center; margin:12px 0; color:#cdd3c8; font-size:13px; cursor:pointer; }
    .switch input { accent-color:var(--accent); width:16px; height:16px; }
    .drawer-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:22px; }
    .plan-note { margin:16px 0 0; border:1px solid #405535; border-radius:10px; background:color-mix(in srgb, var(--accent) 5%, transparent); color:#d8e5cf; padding:12px; font-size:12px; line-height:1.5; }
    .plans-drawer { width:min(760px,100%); }
    .plan-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:6px; }
    .plan-card { border:1px solid var(--line); border-radius:14px; background:#0e120c; padding:16px; display:flex; flex-direction:column; gap:8px; }
    .plan-card.featured { border-color:color-mix(in srgb, var(--accent) 45%, var(--line)); background:linear-gradient(160deg, color-mix(in srgb, var(--accent) 8%, #0e120c), #0e120c); }
    .plan-tag { color:var(--accent); font-size:10px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
    .plan-card h3 { margin:2px 0 0; font-size:18px; }
    .plan-price { font-size:22px; font-weight:850; }
    .plan-price small { font-size:12px; font-weight:600; color:var(--muted); }
    .plan-card p { margin:0; color:var(--muted); font-size:12px; line-height:1.5; flex:1; }
    .plan-card select { border:1px solid #3b4437; border-radius:8px; background:#0b0e09; color:var(--text); padding:8px; }
    .plan-card button { width:100%; }
    @media(max-width:760px) { .plan-grid { grid-template-columns:1fr; } }
  `;
  document.head.append(style);
}

export function mountDashboard(): void {
  installDashboardPolish();
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

  const meta = document.createElement("div");
  meta.className = "prompt-meta";
  meta.innerHTML = `<span>Private scan · nothing leaves this browser</span><span id="character-count"><strong>0</strong> / ${maxPromptLength.toLocaleString()}</span>`;
  prompt.insertAdjacentElement("afterend", meta);

  const clearPrompt = document.createElement("button");
  clearPrompt.type = "button";
  clearPrompt.className = "secondary";
  clearPrompt.textContent = "Clear";
  actions.insertBefore(clearPrompt, required<HTMLButtonElement>("#scan"));

  const historyTitle = document.createElement("div");
  historyTitle.className = "history-title";
  historyTitle.innerHTML = `<h2>Recent local checks</h2><button class="secondary" id="clear-history" type="button">Clear history</button>`;
  historyCard.querySelector("h2")?.replaceWith(historyTitle);
  const clearHistoryButton = required<HTMLButtonElement>("#clear-history");
  const characterCount = required<HTMLElement>("#character-count");
  const preferences = readPreferences();
  applyTheme(preferences.theme);

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
      <label class="pref-row theme-pref-row">Theme<select id="theme-select"></select></label>
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
  // A colored-circle swatch picker (the PC Tweaker look) rendered as an invisible
  // sliver in the desktop WebView2 build regardless of markup approach tried
  // (native <button>, appearance:none, inline styles, plain <span>) even though the
  // click targets stayed correctly positioned the whole time. A <select> uses the
  // exact control type that was already confirmed rendering correctly elsewhere in
  // this same drawer (language, inspection mode), trading some visual flair for a
  // theme picker that is guaranteed visible and usable on every platform.
  const themeSelect = required<HTMLSelectElement>("#theme-select");
  themeSelect.innerHTML = themes.map((theme) => `<option value="${theme.code}">${theme.label}</option>`).join("");
  themeSelect.value = preferences.theme;
  themeSelect.addEventListener("change", () => {
    const code = themes.some((theme) => theme.code === themeSelect.value) ? themeSelect.value as ThemeName : "lime";
    preferences.theme = code;
    applyTheme(code);
    savePreferences(preferences);
  });

  const plansDialog = document.createElement("div");
  plansDialog.className = "drawer-backdrop";
  plansDialog.innerHTML = `
    <section class="drawer plans-drawer" role="dialog" aria-modal="true" aria-labelledby="plans-title">
      <h2 id="plans-title">Plans &amp; pricing</h2>
      <p>Every plan starts with a 7-day trial. Use code <b>SHIELD</b> for 20% off your first monthly payment.</p>
      <div class="plan-grid">
        <article class="plan-card">
          <div class="plan-tag">For individuals</div>
          <h3>Personal</h3>
          <div class="plan-price">€7.99 <small>/ month</small></div>
          <p>For independent professionals who use AI with real client and personal information.</p>
          <button type="button" class="primary" data-plan="personal" data-interval="monthly">Start 7-day trial</button>
          <button type="button" class="secondary" data-plan="personal" data-interval="yearly">€79.90 yearly</button>
        </article>
        <article class="plan-card featured">
          <div class="plan-tag">For teams · up to 3 users</div>
          <h3>Business</h3>
          <div class="plan-price">€14.99 <small>/ user / month</small></div>
          <p>Team controls and a clear privacy boundary for growing teams. Choose one to three seats.</p>
          <label class="pref-row">Seats<select id="business-seats"><option value="1">1 user</option><option value="2">2 users</option><option value="3">3 users</option></select></label>
          <button type="button" class="primary" data-plan="business" data-interval="monthly">Start 7-day trial</button>
          <button type="button" class="secondary" data-plan="business" data-interval="yearly">€149.90 yearly / user</button>
        </article>
        <article class="plan-card">
          <div class="plan-tag">Already subscribed?</div>
          <h3>Manage billing</h3>
          <p>Update your payment method, download invoices, or cancel renewal whenever you need to.</p>
          <button type="button" class="secondary" id="manage-billing">Manage subscription</button>
        </article>
      </div>
      <div class="drawer-actions"><button class="secondary" id="close-plans" type="button">Close</button></div>
    </section>`;
  document.body.append(plansDialog);
  const closePlans = (): void => {
    plansDialog.classList.remove("open");
    document.documentElement.classList.remove("preferences-open");
  };
  const openPlans = (): void => {
    plansDialog.classList.add("open");
    document.documentElement.classList.add("preferences-open");
  };
  required<HTMLButtonElement>("#close-plans").addEventListener("click", closePlans);
  plansDialog.addEventListener("click", (event) => { if (event.target === plansDialog) closePlans(); });
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
    const words = copyByLanguage[preferences.language];
    const settings = settingsByLanguage[preferences.language];
    document.documentElement.lang = preferences.language;
    document.querySelectorAll<HTMLElement>(".nav-label")[0].textContent = words.workspace;
    document.querySelectorAll<HTMLElement>(".nav-label")[1].textContent = words.account;
    navItems[0].lastChild!.textContent = words.privateCheck;
    navItems[1].lastChild!.textContent = words.recent;
    navItems[2].lastChild!.textContent = words.plans;
    navItems[3].lastChild!.textContent = words.preferences;
    required<HTMLElement>(".eyebrow").textContent = words.eyebrow;
    required<HTMLElement>(".top h1").textContent = words.title;
    required<HTMLElement>(".top p").textContent = words.subtitle;
    prompt.placeholder = words.placeholder;
    required<HTMLButtonElement>("#sample").textContent = words.sample;
    required<HTMLButtonElement>("#scan").textContent = words.scan;
    clearPrompt.textContent = words.clear;
    required<HTMLElement>(".history-title h2").textContent = words.history;
    clearHistoryButton.textContent = words.clearHistory;
    languageSelect.setAttribute("aria-label", `Interface language: ${languageNames[preferences.language]}`);
    required<HTMLElement>("#preferences-title").textContent = settings[0];
    required<HTMLElement>(".drawer p").textContent = settings[1];
    const prefRows = Array.from(document.querySelectorAll<HTMLElement>(".pref-row:not(.theme-pref-row)"));
    prefRows.slice(0, 2).forEach((row, index) => { if (row.firstChild) row.firstChild.textContent = settings[index + 2]; });
    if (prefRows[2]?.firstChild) prefRows[2].firstChild.textContent = settings[12];
    const switches = Array.from(document.querySelectorAll<HTMLElement>(".switch"));
    switches.forEach((row, index) => { if (row.lastChild) row.lastChild.textContent = settings[index + 4]; });
    required<HTMLButtonElement>("#close-preferences").textContent = settings[10];
    required<HTMLButtonElement>("#save-preferences").textContent = settings[11];
  };

  const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", "\"": "&quot;"
  }[character] ?? character));

  const renderHistory = (): void => {
    const history = readHistory();
    historyRoot.innerHTML = history.length ? history.map((entry) => `<article class="entry"><strong>${entry.findings} item${entry.findings === 1 ? "" : "s"} reviewed</strong><span>${escapeHtml(entry.preview)}</span><em>${new Date(entry.createdAt).toLocaleString()}</em></article>`).join("") : `<div class="entry"><strong>No checks yet</strong><span>Your last eight check summaries will appear here.</span></div>`;
  };

  const updateCharacterCount = (): void => {
    characterCount.innerHTML = `<strong>${prompt.value.length.toLocaleString()}</strong> / ${maxPromptLength.toLocaleString()}`;
  };

  const scan = (): void => {
    if (!prompt.value.trim()) {
      prompt.focus();
      return;
    }
    if (prompt.value.length > maxPromptLength) {
      count.textContent = "!";
      title.textContent = "Prompt is too long";
      copy.textContent = `Keep it under ${maxPromptLength.toLocaleString()} characters for a local check.`;
      return;
    }
    const result = inspectAndStore(prompt.value, preferences);
    count.textContent = String(result.findings.length);
    title.textContent = result.findings.length ? `${result.findings.length} item${result.findings.length === 1 ? "" : "s"} to review` : "Nothing obvious found";
    copy.textContent = result.findings.length ? `${preferences.scanMode === "strict" ? "Strict review: " : ""}Review these before sharing your prompt.` : "This is a helpful signal, not a guarantee.";
    findingsRoot.className = "findings";
    findingsRoot.innerHTML = result.findings.length ? result.findings.map((finding) => `<div class="finding"><i></i><div><b>${finding.label}</b><span>${escapeHtml(preferences.showRawValues ? finding.value : "Sensitive value hidden")}</span><small>Will be replaced with ${escapeHtml(finding.replacement.replace("$1$2", ""))}</small></div></div>`).join("") : `<div class="empty">No common secrets or personal details were detected. This is a helpful signal, not a guarantee.</div>`;
    redacted.textContent = result.redactedText;
    safeRoot.style.display = "block";
    renderHistory();
  };

  required<HTMLButtonElement>("#scan").addEventListener("click", scan);
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
    button.textContent = "Copied";
    if (preferences.autoClearAfterCopy) {
      prompt.value = "";
      updateCharacterCount();
    }
    window.setTimeout(() => { button.textContent = "Copy safer prompt"; }, 1400);
  });
  renderHistory();
  updateCharacterCount();
  applyLanguage();
}

if (typeof document !== "undefined") mountDashboard();
