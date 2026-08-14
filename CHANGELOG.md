# Changelog

## v0.1.7 — 2026-08-13

- Desktop session tokens now live in Windows Credential Manager instead of
  the webview's `localStorage`, closing a real disk-based token-theft path.
- Fixed a CORS origin mismatch (`http://tauri.localhost` vs the real
  `https://tauri.localhost`) that made the desktop app look signed out on
  every reopen until you clicked "Log in" again.
- Added a strict Content-Security-Policy to the production deployment
  (previously only the local dev server had one).
- `api/auth/callback.ts` no longer trusts a client-supplied refresh token
  paired with an access token on faith — it's now verified against Supabase.
- New browser extension (Chrome, MV3) for ChatGPT, Claude, Gemini, Copilot
  and Perplexity: a "Check" button that scans the composer before you send.
- Contextual detection: names right after a greeting ("Dear John Smith,"),
  street addresses.
- Fixed a rule-ordering bug where the phone-number pattern could corrupt an
  IBAN before the IBAN rule ever saw the full string, when all scan
  categories were enabled together (the real default).
- Full security audit: verified Stripe webhook signature checks, IDOR
  protection, rate limiting coverage, and no hardcoded secrets.
