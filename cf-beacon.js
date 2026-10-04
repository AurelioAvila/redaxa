// Cookieless Cloudflare Web Analytics on the canonical site, skipped under Do Not Track or Global Privacy Control.
if (location.hostname === 'redaxa.getcertsprint.com' && navigator.doNotTrack !== '1' && !navigator.globalPrivacyControl) {
  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.dataset.cfBeacon = '{"token": "5b460af4cf5245ab90d58981086f8749"}';
  document.head.append(s);
}
