# PromptShield

PromptShield is a privacy-first, installable prompt safety workspace. It detects sensitive details before text reaches an AI tool and produces a safer local version.

## What works today

- Local inspection for emails, phones, IP addresses, cards, IBANs, credentials and custom protected terms.
- Per-category controls, strict mode, local-only history and five interface languages.
- A share-safe redacted version with optional automatic clearing after copy.
- An installable PWA that works offline after the first successful load.

Prompt text is inspected in the browser and is never sent to a PromptShield server by the MVP.

## Run locally

```bash
npm install
npm test
npm start
```

Open `http://127.0.0.1:4173/dashboard.html`.

## Product boundaries

PromptShield is a protective review layer, not a guarantee that all sensitive data will be detected. Authentication, billing, team sharing and cloud synchronization are deliberately not implemented yet; they require a dedicated security and privacy review before launch.

**Think freely. Share safely.**

PromptShield checks prompts for common personal data and secrets before they are shared with an AI service.

## Current MVP

- Browser-local prompt scanning: the demo does not send or persist prompt text.
- Detection for email addresses, phone numbers, API keys/tokens, card numbers and IPv4 addresses.
- One-click redacted copy.
- Product landing page with a 14-day trial, Personal and Business plan framing.

## Privacy boundary

Raw prompts must never be stored in a database, logs, analytics, error reporting or backups. The production service should process scan requests in memory only and retain only minimal, non-sensitive usage metadata.

## Product direction

The first paid version will provide individual accounts, business workspaces, role-aware access, a 14-day trial and Stripe-managed subscriptions. The initial scanner stays deterministic and privacy-first; AI-assisted classification can be introduced later only after redaction.

## Run locally

Open `index.html` in a modern browser. No account or server is required for the current local demo.
