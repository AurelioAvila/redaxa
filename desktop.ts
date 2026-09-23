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
  const drag = bar.querySelector<HTMLElement>(".rx-window-title")!;
  drag.addEventListener("mousedown", event => { if(event.button===0 && event.detail===1) void action("start_dragging"); });
  drag.addEventListener("dblclick", () => void action("toggle_maximize"));
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
