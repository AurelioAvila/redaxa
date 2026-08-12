# PromptShield

PromptShield is a privacy-first prompt safety workspace. It detects sensitive details before text reaches an AI tool and produces a safer, redacted local version.

**Think freely. Share safely.**

## What works today

- Local, deterministic inspection for emails, phone numbers, IP addresses, card numbers (Luhn-validated), IBANs (checksum-validated), Italian fiscal codes, credentials/tokens and custom protected terms.
- Per-category controls, strict mode, local-only history and five interface languages.
- A share-safe redacted version with optional automatic clearing after copy.
- An installable PWA that works offline after the first successful load, plus a Tauri desktop companion.
- Accounts (Supabase Auth) and subscription billing (Stripe Checkout + Customer Portal), with the browser session held in an httpOnly cookie set by the server — page scripts never see the access or refresh token.

Prompt text is inspected entirely in the browser and is never sent to a PromptShield server.

## Run locally

```bash
npm install
npm test
npm start
```

Open `http://127.0.0.1:4173/dashboard.html`. The local dev server serves the scanner and static assets; account creation and billing require the Vercel deployment (`api/`) with Supabase and Stripe configured (see `.env.example`).

## Product boundaries

PromptShield is a protective review layer, not a guarantee that all sensitive data will be detected — regex-based detection has irreducible false negatives. Team sharing and cloud synchronization of scan history are not implemented; scan history stays in the browser's local storage only.

## Privacy boundary

Raw prompts must never be stored in a database, logs, analytics, error reporting or backups. The production service processes scan requests in the browser only and the server never sees prompt content — only auth and billing events (email, subscription status) touch the backend.

## Architecture notes

- `scanner.ts` — the detection engine. Card and IBAN matches are checksum-validated (Luhn / mod-97) before being reported, to keep the false-positive rate low.
- `api/auth/*.ts` — thin proxies to Supabase Auth. They set/clear the `ps_at` / `ps_rt` httpOnly cookies; the client never handles raw tokens.
- `api/checkout.ts`, `api/portal.ts`, `api/stripe-webhook.ts` — Stripe subscription lifecycle, backed by `supabase/migrations/20260811_billing.sql` (RLS enabled, no public write policies — only the service role and `security definer` RPCs touch billing state).
