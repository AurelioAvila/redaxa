type ClipboardReader = () => Promise<string>;

// The build here is plain `tsc` with no bundler, so bare specifiers like
// `@tauri-apps/plugin-shell` cannot be resolved by the webview at runtime (no
// import map, no node_modules on disk in the shipped app) — a dynamic
// `import("@tauri-apps/plugin-shell")` throws at runtime. Every Tauri plugin's JS
// wrapper is itself just a thin call to `window.__TAURI_INTERNALS__.invoke(...)`
// (verified against each plugin's own dist-js source), so we call that primitive
// directly instead of importing the wrapper packages.
type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function tauriInvoke(): TauriInvoke | null {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: TauriInvoke } }).__TAURI_INTERNALS__;
  return internals?.invoke ?? null;
}

export function isTauri(): boolean {
  return tauriInvoke() !== null;
}

/** The notification-area menu speaks the window's language. */
export function syncTrayLanguage(language: string): void {
  void tauriInvoke()?.("set_tray_language", { language }).catch(() => {});
}

/** Only the desktop development webview uses the guarded loopback proxy. */
export function usesDesktopPreviewTransport(desktop: boolean, origin: string): boolean {
  if (!desktop) return false;
  try { const url = new URL(origin); return url.protocol === "http:" && url.hostname === "127.0.0.1"; }
  catch { return false; }
}

export function installDesktopTitlebar(): void {
  const invoke = tauriInvoke();
  if (!invoke || document.querySelector(".rx-titlebar")) return;
  document.body.classList.add("rx-native-window");
  const bar = document.createElement("div"); bar.className = "rx-titlebar";
  bar.innerHTML = `<div class="rx-window-title"><img src="/outputs/redaxa-mark.svg" alt="">Redaxa</div><div class="rx-window-controls"><button type="button" data-window-action="minimize" aria-label="Minimize window" title="Minimize"><svg viewBox="0 0 12 12"><path d="M1 6h10"/></svg></button><button type="button" data-window-action="toggle_maximize" aria-label="Maximize window" title="Maximize"><svg viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9"/></svg></button><button type="button" data-window-action="close" aria-label="Close window" title="Close"><svg viewBox="0 0 12 12"><path d="m1 1 10 10M11 1 1 11"/></svg></button></div>`;
  document.body.prepend(bar);
  const maximize = bar.querySelector<HTMLButtonElement>('[data-window-action="toggle_maximize"]')!;
  const refreshMaximized = async (): Promise<void> => {
    try {
      const maximized = await invoke("plugin:window|is_maximized", {label:"main"});
      const label = maximized ? "Restore window" : "Maximize window";
      maximize.setAttribute("aria-label", label); maximize.title = label;
      maximize.innerHTML = maximized ? '<svg viewBox="0 0 12 12"><path d="M4 2V1h7v7h-1"/><rect x="1" y="4" width="7" height="7"/></svg>' : '<svg viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9"/></svg>';
    } catch { /* Window controls remain accessible if the state query fails. */ }
  };
  const action = async (command: string): Promise<void> => {
    try { await invoke("plugin:window|" + command, {label:"main"}); if(command==="toggle_maximize") await refreshMaximized(); }
    catch { bar.querySelector(".rx-window-title")!.textContent = "Window action unavailable · use Alt+Space"; }
  };
  bar.querySelectorAll<HTMLButtonElement>("[data-window-action]").forEach(button => button.addEventListener("click", () => void action(button.dataset.windowAction!)));
  // The whole bar moves the window, not just the title: the empty stretch
  // between title and controls is where people grab it. The logo must not
  // start an HTML image drag, which would swallow the window drag.
  bar.querySelector("img")!.draggable = false;
  const onControl = (event: Event): boolean => (event.target as Element).closest(".rx-window-controls") !== null;
  bar.addEventListener("mousedown", event => { if(event.button===0 && event.detail===1 && !onControl(event)) void action("start_dragging"); });
  bar.addEventListener("dblclick", event => { if(!onControl(event)) void action("toggle_maximize"); });
  window.addEventListener("resize", () => void refreshMaximized());
  void refreshMaximized();
}

// The desktop shell has no domain of its own, so account creation and billing are
// never handled in the embedded webview: they open the user's regular browser against
// the hosted web app instead. This avoids needing cross-origin cookies (which would
// require SameSite=None and a dedicated CSRF token to stay safe) and matches how
// Slack/Discord-style desktop apps hand off auth.
export async function openInSystemBrowser(url: string): Promise<boolean> {
  const invoke = tauriInvoke();
  if (!invoke) return false;
  await invoke("plugin:shell|open", { path: url, with: null });
  return true;
}

/** Opens a support e-mail in the user's mail app, from the desktop app or a browser. */
export function openSupportEmail(): void {
  const support = "mailto:redaxa@getcertsprint.com?subject=Redaxa%20support";
  void openInSystemBrowser(support).then((opened) => { if (!opened) location.href = support; }).catch(() => { location.href = support; });
}

function nativeClipboardReader(): ClipboardReader | null {
  const invoke = tauriInvoke();
  if (!invoke) return null;
  return async () => String(await invoke("plugin:clipboard-manager|read_text"));
}

export function enableDesktopCompanion(onPrompt: (value: string) => void): void {
  const readClipboard = nativeClipboardReader();
  if (!readClipboard) return;

  const control = document.createElement("button");
  control.id = "inspect-clipboard";
  control.type = "button";
  control.textContent = "Inspect clipboard";
  control.title = "Read the clipboard only when you press this button";
  control.setAttribute("aria-label", "Inspect text currently in the clipboard");
  const actions=document.querySelector('#clear-prompt')?.parentElement;
  if(!actions||document.getElementById(control.id))return;
  control.className='ghost-btn';
  actions.insertBefore(control,document.getElementById('clear-prompt'));

  control.addEventListener("click", async () => {
    const value = await readClipboard();
    if (value.trim()) onPrompt(value);
  });

  // A global "Ctrl+Shift+P to inspect clipboard" shortcut was previously attempted
  // here via the global-shortcut plugin, but that plugin's `register` call requires
  // a Tauri `Channel` (an ordered-callback IPC primitive from @tauri-apps/api/core,
  // not a plain invoke) to receive the keypress event. Reimplementing that
  // serialization by hand without a bundler was judged too easy to get subtly
  // wrong and silently non-functional, so this build only ships the visible
  // "Inspect clipboard" button, which needs no callback channel.
}

// The rail and page bar are shared by the workspace and the repository page,
// so their labels live here, where both pages already import from.
export type ShellLanguage = "en" | "it" | "es" | "fr" | "de";
export const shellCopyByLanguage: Record<ShellLanguage, Record<string, string>> = {
  en: { brandTag: "Check before you send", groupProtect: "Protect", groupConfigure: "Configure", navCheck: "Check text", navRepository: "Repository check", navActivity: "Activity", navTerms: "Protected terms", navSettings: "Settings", navAccount: "Account & team", navHelp: "Help & support", navPlans: "Plans & pricing", crumbWorkspace: "Workspace", repoNoteTitle: "Values stay hidden", repoNoteText: "Matched values are masked until you choose to reveal them.", coffeeNav: "Buy me a coffee", coffeeCta: "Fuel the next release", coffeeFewer: "One fewer coffee", coffeeMore: "One more coffee" },
  it: { brandTag: "Controlla prima di inviare", groupProtect: "Proteggi", groupConfigure: "Configura", navCheck: "Controlla testo", navRepository: "Controllo repository", navActivity: "Attività", navTerms: "Termini protetti", navSettings: "Impostazioni", navAccount: "Account e team", navHelp: "Aiuto e supporto", navPlans: "Piani e prezzi", crumbWorkspace: "Spazio di lavoro", repoNoteTitle: "I valori restano nascosti", repoNoteText: "I valori trovati sono mascherati finché non scegli di mostrarli.", coffeeNav: "Offrimi un caffè", coffeeCta: "Sostieni la prossima versione", coffeeFewer: "Un caffè in meno", coffeeMore: "Un caffè in più" },
  es: { brandTag: "Revisa antes de enviar", groupProtect: "Proteger", groupConfigure: "Configurar", navCheck: "Revisar texto", navRepository: "Revisión de repositorios", navActivity: "Actividad", navTerms: "Términos protegidos", navSettings: "Ajustes", navAccount: "Cuenta y equipo", navHelp: "Ayuda y soporte", navPlans: "Planes y precios", crumbWorkspace: "Espacio de trabajo", repoNoteTitle: "Los valores quedan ocultos", repoNoteText: "Los valores encontrados se enmascaran hasta que decides mostrarlos.", coffeeNav: "Invítame a un café", coffeeCta: "Apoya la próxima versión", coffeeFewer: "Un café menos", coffeeMore: "Un café más" },
  fr: { brandTag: "Vérifiez avant d’envoyer", groupProtect: "Protéger", groupConfigure: "Configurer", navCheck: "Vérifier un texte", navRepository: "Vérification de dépôt", navActivity: "Activité", navTerms: "Termes protégés", navSettings: "Réglages", navAccount: "Compte et équipe", navHelp: "Aide et support", navPlans: "Offres et tarifs", crumbWorkspace: "Espace de travail", repoNoteTitle: "Les valeurs restent masquées", repoNoteText: "Les valeurs trouvées restent masquées tant que vous ne choisissez pas de les afficher.", coffeeNav: "Offrez-moi un café", coffeeCta: "Soutenir la prochaine version", coffeeFewer: "Un café de moins", coffeeMore: "Un café de plus" },
  de: { brandTag: "Erst prüfen, dann senden", groupProtect: "Schützen", groupConfigure: "Einrichten", navCheck: "Text prüfen", navRepository: "Repository-Prüfung", navActivity: "Aktivität", navTerms: "Geschützte Begriffe", navSettings: "Einstellungen", navAccount: "Konto & Team", navHelp: "Hilfe und Support", navPlans: "Tarife & Preise", crumbWorkspace: "Arbeitsbereich", repoNoteTitle: "Werte bleiben verborgen", repoNoteText: "Gefundene Werte bleiben maskiert, bis Sie sie bewusst einblenden.", coffeeNav: "Einen Kaffee spendieren", coffeeCta: "Nächste Version unterstützen", coffeeFewer: "Ein Kaffee weniger", coffeeMore: "Ein Kaffee mehr" }
};

/** Translates the shared rail and page bar on pages that do not load the
 *  workspace, in the language picked in Settings. Only those two regions
 *  change language, so they carry their own lang attribute. */
export function applyShellLanguage(): void {
  const language = savedShellLanguage();
  const copy = shellCopyByLanguage[language];
  document.querySelectorAll<HTMLElement>(".side, .page-bar .crumbs").forEach((region) => {
    region.lang = language;
    region.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
      const value = copy[element.dataset.i18n ?? ""];
      if (value !== undefined) element.textContent = value;
    });
    region.querySelectorAll<HTMLElement>("[data-i18n-label]").forEach((element) => {
      const value = copy[element.dataset.i18nLabel ?? ""];
      if (value !== undefined) element.setAttribute("aria-label", value);
    });
  });
}

function savedShellLanguage(): ShellLanguage {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem("redaxa.personal-preferences.v1") ?? "{}")?.language;
    if (typeof saved === "string" && saved in shellCopyByLanguage) return saved as ShellLanguage;
  } catch { /* storage unavailable: English */ }
  return "en";
}

/** Matches TIP_MAX_QUANTITY on the shared tip API, which clamps to it anyway. */
const MAX_COFFEES = 10;
/** The shared, account-less tip checkout (one Stripe account for every product).
 *  Its GET launcher answers with a redirect to Stripe Checkout, so nothing here
 *  needs CORS: the browser simply opens it. Only product and quantity are sent. */
export const coffeeUrl = (quantity: number): string =>
  `https://api.pctweaker.app/api/tip/start?product=redaxa&quantity=${Math.min(MAX_COFFEES, Math.max(1, Math.trunc(quantity) || 1))}`;

/**
 * "Buy me a coffee", the last row of the rail's footer on the workspace and the
 * repository page, in the browser and in the Windows app. At rest it is one
 * quiet row, the size of a navigation row and quieter than the plan entry above
 * it; pressing it unfolds a 1–10 stepper and the button that opens the tip
 * checkout. Never a dialog, never a nag, nowhere near a plan's checkout.
 *
 * The panel stays mounted so it can animate shut, so every control inside is
 * disabled (and the panel inert) while it is closed: interactivity hangs on this
 * state, never on a transition finishing, which once let a hidden PC Tweaker
 * tip button take a real click under reduced motion.
 */
export function mountCoffee(): void {
  const foot = document.querySelector(".nav-foot");
  if (!foot || document.getElementById("coffee")) return;
  const copy = shellCopyByLanguage[savedShellLanguage()];
  const box = document.createElement("div");
  box.className = "coffee"; box.id = "coffee";
  box.innerHTML = `<button class="nav-item coffee-row" type="button" aria-expanded="false" aria-controls="coffee-panel"><i class="ico coffee-mark" aria-hidden="true">☕</i><span data-i18n="coffeeNav"></span><svg class="coffee-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg></button><div class="coffee-reveal" id="coffee-panel" data-open="false" inert aria-hidden="true"><div><div class="coffee-stepper"><button type="button" class="coffee-step" data-step="-1" data-i18n-label="coffeeFewer" disabled>−</button><span class="coffee-count" aria-live="polite"></span><button type="button" class="coffee-step" data-step="1" data-i18n-label="coffeeMore" disabled>+</button></div><button type="button" class="coffee-cta" data-i18n="coffeeCta" disabled></button></div></div>`;
  box.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => { element.textContent = copy[element.dataset.i18n!]; });
  box.querySelectorAll<HTMLElement>("[data-i18n-label]").forEach((element) => { element.setAttribute("aria-label", copy[element.dataset.i18nLabel!]); });
  foot.append(box);

  const row = box.querySelector<HTMLButtonElement>(".coffee-row")!;
  const panel = box.querySelector<HTMLElement>(".coffee-reveal")!;
  const [fewer, more] = box.querySelectorAll<HTMLButtonElement>(".coffee-step");
  const cta = box.querySelector<HTMLButtonElement>(".coffee-cta")!;
  const countLabel = box.querySelector<HTMLElement>(".coffee-count")!;
  let open = false, count = 1;
  const render = (): void => {
    row.setAttribute("aria-expanded", String(open));
    panel.dataset.open = String(open); panel.inert = !open; panel.setAttribute("aria-hidden", String(!open));
    fewer.disabled = !open || count <= 1; more.disabled = !open || count >= MAX_COFFEES; cta.disabled = !open;
  };
  const show = (value: number): void => {
    count = value;
    countLabel.textContent = `${count} ☕`;
    // The live region itself stays put so the new count is announced; only its pop is replayed.
    countLabel.style.animation = "none"; void countLabel.offsetWidth; countLabel.style.animation = "";
    render();
  };
  row.addEventListener("click", () => { open = !open; render(); });
  fewer.addEventListener("click", () => show(Math.max(1, count - 1)));
  more.addEventListener("click", () => show(Math.min(MAX_COFFEES, count + 1)));
  cta.addEventListener("click", () => {
    if (!open) return;
    const url = coffeeUrl(count);
    // The Windows app hands checkout to the default browser, like billing does;
    // the web workspace opens it in a new tab so the page keeps its text.
    if (isTauri()) void openInSystemBrowser(url).catch(() => {});
    else window.open(url, "_blank", "noopener");
  });
  show(1);
}
