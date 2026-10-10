// Blocking head script: restore presentation before the first paint. No account data.
(() => {
  try {
    const theme = JSON.parse(localStorage.getItem('redaxa.personal-preferences.v1') || '{}')?.theme;
    // Paper is the default palette; set before the first paint so a light
    // workspace never flashes dark while the scripts load.
    document.documentElement.dataset.theme = typeof theme === 'string' && /^[a-z]{1,20}$/.test(theme) ? theme : 'paper';
  } catch { document.documentElement.dataset.theme = 'paper'; }
  if ('__TAURI_INTERNALS__' in window) document.documentElement.classList.add('rx-native');
})();
