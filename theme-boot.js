// Blocking head script: restore presentation before the first paint. No account data.
(() => {
  try {
    const saved = JSON.parse(localStorage.getItem('redaxa.personal-preferences.v1') || '{}');
    const theme = saved?.theme;
    // Paper is the default palette, set before the first paint so a light
    // workspace never flashes dark while the scripts load. Same rule as
    // chosenTheme() in themes.ts: the pre-0.5.1 automatic default counts as
    // a choice only when a theme click recorded themeChosen.
    const chosen = typeof theme === 'string' && /^[a-z]{1,20}$/.test(theme) && !(theme === 'graphite' && saved?.themeChosen !== true);
    document.documentElement.dataset.theme = chosen ? theme : 'paper';
  } catch { document.documentElement.dataset.theme = 'paper'; }
  if ('__TAURI_INTERNALS__' in window) document.documentElement.classList.add('rx-native');
})();
