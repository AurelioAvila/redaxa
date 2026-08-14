<p align="center">
  <img src="src-tauri/icons/128x128.png" width="112" alt="PromptShield logo">
</p>

<h1 align="center">PromptShield</h1>

<p align="center">
  <strong>Catch what you're about to leak, before it leaves.</strong><br>
  Emails, secrets, cards, IBANs, private keys — flagged and redactable before you paste into ChatGPT, Claude, Gemini, Copilot or Perplexity.
</p>

<p align="center">
  <a href="../../releases/latest"><img src="https://img.shields.io/badge/Download-Windows%2010%2F11-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Download for Windows"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-3DA639?style=for-the-badge" alt="MIT License"></a>
  <a href="../../releases"><img src="https://img.shields.io/github/v/release/AurelioAvila/promptshield?display_name=tag&style=for-the-badge&color=7C3AED" alt="Latest release"></a>
</p>

**[⬇ Download for Windows](../../releases/latest)** · [Web app](https://promptshield-beta.vercel.app) ·
[Changelog](CHANGELOG.md) · [Privacy Policy](https://promptshield-beta.vercel.app/privacy.html) ·
[Terms](https://promptshield-beta.vercel.app/terms.html)

---

## What it does

Paste a prompt in. PromptShield finds what's sensitive in it — real ones,
not guesses — and hands you back a redacted version you can send instead.

| Category | Detected |
| --- | --- |
| **Personal data** | Email addresses, phone numbers, IPv4 addresses, names right after a greeting ("Dear John Smith,"), street addresses |
| **Credentials** | API keys and tokens (OpenAI, Stripe, AWS, Google, GitHub, Slack), JWTs, private key blocks, passwords/secrets after `key: value` |
| **Financial data** | Card numbers (Luhn-checksum validated), IBANs (mod-97 checksum validated), crypto wallet addresses, Italian fiscal codes, US SSNs (reserved-range filtered) |
| **Custom terms** | Your own project codenames, client names, anything you want flagged that isn't generic PII |

Every check is a real validator, not a loose regex guess — a Luhn check
keeps ordinary 16-digit tracking numbers from being flagged as credit cards,
a mod-97 checksum does the same for IBANs, and reserved SSN ranges are
excluded so invoice numbers don't trip it.

## Where it runs

- **Web app** — [promptshield-beta.vercel.app](https://promptshield-beta.vercel.app), no install
- **Windows desktop app** — this repo's installer, signs in once and stays signed in (session held in the OS credential store, not a file on disk)
- **Browser extension** — a "Check" button injected into ChatGPT, Claude, Gemini, Copilot and Perplexity that scans whatever's in the composer before you send it

## Privacy

The scan itself runs server-side (so the same detection logic works
identically across the web app, desktop app and browser extension) — but
the request body is used only to compute the response and is never logged,
stored, or forwarded anywhere; see [`api/scan.ts`](api/scan.ts) and the full
[privacy policy](https://promptshield-beta.vercel.app/privacy.html). No
analytics, no ad trackers, no selling data. The desktop app never handles
your password directly for long — auth tokens live in Windows Credential
Manager, not in a plain file.

## Run locally

```bash
npm install
npm test
npm start
```

Open `http://127.0.0.1:4173/dashboard.html`. Account creation and billing
require the Vercel deployment (`api/`) with Supabase and Stripe configured
— see `.env.example`.

To build the Windows desktop app:

```bash
npx tauri build
```

## Product boundaries

PromptShield is a protective review layer, not a guarantee that all
sensitive data will be caught — detection has irreducible false negatives,
and you're always the one who decides what actually gets sent. Team sharing
and cloud sync of scan history are not implemented; history stays in the
browser's local storage only.

## Architecture notes

- [`scanner.ts`](scanner.ts) — the detection engine shared by every surface
- [`api/scan.ts`](api/scan.ts) — the endpoint the web app, desktop app and browser extension all call
- [`api/auth/*.ts`](api/auth) — thin proxies to Supabase Auth; the web app never handles raw tokens (httpOnly cookies), the desktop app and extension hold a Bearer token pair themselves
- [`api/billing.ts`](api/billing.ts), [`api/stripe-webhook.ts`](api/stripe-webhook.ts) — Stripe subscription lifecycle, backed by `supabase/migrations/` (RLS enabled, no public write policies)
- [`browser-extension/`](browser-extension) — the MV3 Chrome extension source
- [`src-tauri/`](src-tauri) — the Windows desktop app shell (Tauri v2 + Rust)

## License

MIT — see [LICENSE](LICENSE).
