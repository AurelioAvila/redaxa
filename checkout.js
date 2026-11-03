// /checkout (api/_consent.ts): the Terms box must be ticked before the form goes
// on to Stripe. The server checks it too; this only answers at once, without a reload.
(() => {
  const form = document.getElementById('consent-form');
  if (!form) return;
  const box = document.getElementById('agree');
  const label = document.getElementById('consent-box');
  const error = document.getElementById('consent-error');
  const button = form.querySelector('button[type="submit"]');
  const show = (on) => {
    label.classList.toggle('err', on);
    error.hidden = !on;
    if (on) { error.textContent = error.dataset.required; box.setAttribute('aria-invalid', 'true'); } else box.removeAttribute('aria-invalid');
  };
  box.addEventListener('change', () => { if (box.checked) show(false); });
  form.addEventListener('submit', (event) => {
    if (box.checked) { button.disabled = true; return; }
    event.preventDefault();
    show(true);
    box.focus();
  });
  // Back from Stripe restores this page from the cache with the button still disabled.
  addEventListener('pageshow', () => { button.disabled = false; });
})();
