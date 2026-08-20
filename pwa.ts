interface DeferredInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

let deferredInstallPrompt: DeferredInstallPromptEvent | null = null;

function addInstallControl(): void {
  // Prefer the styled button the page already places in its nav; fall back to
  // creating one only on pages that don't declare it.
  let control = document.getElementById("pwa-install") as HTMLButtonElement | null;
  if (control === null) {
    control = document.createElement("button");
    control.id = "pwa-install";
    control.type = "button";
    control.hidden = true;
    control.textContent = "Install app";
    control.setAttribute("aria-label", "Install PromptShield on this device");
    document.body.append(control);
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as DeferredInstallPromptEvent;
    control.hidden = false;
  });
  window.addEventListener("appinstalled", () => { deferredInstallPrompt = null; control.hidden = true; });
  control.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    await deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    control.hidden = true;
  });
}

export function enableAppShell(): void {
  const manifest = document.createElement("link");
  manifest.rel = "manifest";
  manifest.href = "/manifest.webmanifest";
  document.head.append(manifest);
  const themeColor = document.createElement("meta");
  themeColor.name = "theme-color";
  themeColor.content = "#b9ff00";
  document.head.append(themeColor);
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) void navigator.serviceWorker.register("/service-worker.js");
  addInstallControl();
}
