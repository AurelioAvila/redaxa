const sent = new Set<string>();
export function track(event: string): void {
  if (!['redaxa.getcertsprint.com', 'promptshield-beta.vercel.app'].includes(location.hostname) || navigator.doNotTrack === '1' || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl || sent.has(event)) return;
  sent.add(event);
  void fetch('https://redexa.getcertsprint.com/growth-event', { method: 'POST', body: event, credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true }).then(r => { if (!r.ok) sent.delete(event); }).catch(() => { sent.delete(event); });
}
// Module-level wiring only runs in a page; tests import track() without a DOM.
if (typeof document !== 'undefined') {
  if (location.pathname === '/' || location.pathname.endsWith('/index.html')) track('visit');
  document.addEventListener('click', e => {
    const link = (e.target as Element)?.closest('a');
    if (link?.href.startsWith('https://chromewebstore.google.com/detail/redaxa/')) track('extension_click');
  });
}
