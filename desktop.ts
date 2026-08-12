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
  document.body.append(control);

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
