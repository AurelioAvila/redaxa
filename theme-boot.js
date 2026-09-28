// Blocking head script: restore presentation before the first paint. No account data.
(() => {
  try {
    const theme = JSON.parse(localStorage.getItem('redaxa.personal-preferences.v1') || '{}')?.theme;
    if (typeof theme === 'string' && /^[a-z]{1,20}$/.test(theme)) document.documentElement.dataset.theme = theme;
  } catch { /* The default CSS palette also covers unavailable storage. */ }
  if ('__TAURI_INTERNALS__' in window) document.documentElement.classList.add('rx-native');
})();
