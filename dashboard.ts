import type { Finding, ScanOptions } from "./scanner.js";
import { enableAppShell } from "./pwa.js";
import { enableDesktopCompanion } from "./desktop.js";

type HistoryEntry = { id: string; createdAt: string; findings: number; preview: string };
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

  const meta = document.createElement("div");
  meta.className = "prompt-meta";
  meta.innerHTML = `<span>Private scan · never stored or logged</span><span id="character-count"><strong>0</strong> / ${maxPromptLength.toLocaleString()}</span>`;
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
          <div class="plan-actions">
            <button type="button" class="primary" data-plan="personal" data-interval="monthly">Start 7-day trial</button>
            <button type="button" class="secondary" data-plan="personal" data-interval="yearly">€79.90 yearly</button>
          </div>
        </article>
        <article class="plan-card featured">
          <div class="plan-tag">For teams · up to 3 users</div>
          <h3>Business</h3>
          <div class="plan-price">€14.99 <small>/ user / month</small></div>
          <p>Team controls and a clear privacy boundary for growing teams. Choose one to three seats.</p>
          <label class="pref-row">Seats<select id="business-seats"><option value="1">1 user</option><option value="2">2 users</option><option value="3">3 users</option></select></label>
          <div class="plan-actions">
            <button type="button" class="primary" data-plan="business" data-interval="monthly">Start 7-day trial</button>
            <button type="button" class="secondary" data-plan="business" data-interval="yearly">€149.90 yearly / user</button>
          </div>
        </article>
        <article class="plan-card">
          <div class="plan-tag">Already subscribed?</div>
          <h3>Manage billing</h3>
          <div class="plan-price">&nbsp;</div>
          <p>Update your payment method, download invoices, or cancel renewal whenever you need to.</p>
          <div class="plan-actions"><button type="button" class="secondary" id="manage-billing">Manage subscription</button></div>
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

  const sideStatCount = document.querySelector<HTMLElement>("#side-stat strong");
  const renderHistory = (): void => {
    const history = readHistory();
    historyRoot.innerHTML = history.length ? history.map((entry) => `<article class="entry"><strong>${entry.findings} item${entry.findings === 1 ? "" : "s"} reviewed</strong><span>${escapeHtml(entry.preview)}</span><em>${new Date(entry.createdAt).toLocaleString()}</em></article>`).join("") : `<div class="entry"><strong>No checks yet</strong><span>Your last eight check summaries will appear here.</span></div>`;
    if (sideStatCount) {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      sideStatCount.textContent = String(history.filter((entry) => new Date(entry.createdAt).getTime() >= weekAgo).length);
    }
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
      window.promptShieldAuth?.requestAccess("Create your account and start your 7-day free trial to inspect prompts.");
      return;
    }
    if (prompt.value.length > maxPromptLength) {
      count.textContent = "!";
      title.textContent = "Prompt is too long";
      copy.textContent = `Keep it under ${maxPromptLength.toLocaleString()} characters for a check.`;
      return;
    }
    scanButton.disabled = true;
    const originalLabel = scanButton.textContent;
    scanButton.textContent = "Checking…";
    try {
      const scanned = await window.promptShieldAuth!.scanPrompt(prompt.value, preferences);
      const result = storeResult(prompt.value, scanned.findings, scanned.redactedText, preferences);
      count.textContent = String(result.findings.length);
      title.textContent = result.findings.length ? `${result.findings.length} item${result.findings.length === 1 ? "" : "s"} to review` : "Nothing obvious found";
      copy.textContent = result.findings.length ? `${preferences.scanMode === "strict" ? "Strict review: " : ""}Review these before sharing your prompt.` : "This is a helpful signal, not a guarantee.";
      findingsRoot.className = "findings";
      findingsRoot.innerHTML = result.findings.length ? result.findings.map((finding) => `<div class="finding"><i></i><div><b>${finding.label}</b><span>${escapeHtml(preferences.showRawValues ? finding.value : "Sensitive value hidden")}</span><small>Will be replaced with ${escapeHtml(finding.replacement.replace("$1$2", ""))}</small></div></div>`).join("") : `<div class="empty">No common secrets or personal details were detected. This is a helpful signal, not a guarantee.</div>`;
      redacted.textContent = result.redactedText;
      safeRoot.style.display = "block";
      renderHistory();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "TRIAL_REQUIRED") {
        window.promptShieldAuth?.requestAccess("Start your 7-day free trial to inspect prompts.");
      } else {
        title.textContent = "Check failed";
        copy.textContent = "We could not run that check. Please try again.";
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
