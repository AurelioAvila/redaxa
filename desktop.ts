type ClipboardReader = () => Promise<string>;

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function nativeClipboardReader(): Promise<ClipboardReader | null> {
  if (!isTauri()) return null;
  const clipboard = await import("@tauri-apps/plugin-clipboard-manager");
  return clipboard.readText;
}

export async function enableDesktopCompanion(onPrompt: (value: string) => void): Promise<void> {
  const readClipboard = await nativeClipboardReader();
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

  try {
    const { register } = await import("@tauri-apps/plugin-global-shortcut");
    await register("CommandOrControl+Shift+P", async () => {
      const value = await readClipboard();
      if (value.trim()) onPrompt(value);
    });
  } catch {
    // Another application may already own the shortcut. The visible button remains available.
  }
}
