// Localized landing pages: opening the workspace from /it/, /es/, /fr/ or /de/ starts it in
// that language, unless the visitor already chose one in Settings (never overwritten).
document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest("[data-workspace-lang]") : null;
  if (!link) return;
  try {
    const key = "redaxa.personal-preferences.v1";
    const saved = JSON.parse(localStorage.getItem(key) || "{}");
    if (saved && typeof saved === "object" && !saved.language) {
      saved.language = link.getAttribute("data-workspace-lang");
      localStorage.setItem(key, JSON.stringify(saved));
    }
  } catch { /* storage unavailable: the workspace opens in English */ }
});
