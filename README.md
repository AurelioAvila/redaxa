<p align="center">
  <img src="src-tauri/icons/128x128.png" width="112" alt="Redaxa logo">
</p>

<h1 align="center">Redaxa</h1>

<p align="center">
  <strong>Catch what you're about to leak, before it leaves.</strong><br>
  Emails, secrets, cards, IBANs, private keys — flagged and redactable before you paste into ChatGPT, Claude, Gemini, Copilot or Perplexity.
</p>

<p align="center">
  <a href="https://promptshield-beta.vercel.app"><img src="https://img.shields.io/badge/TRY_IT_NOW-No_install%2C_no_SmartScreen-2E7D32?style=for-the-badge" alt="Try the web app, no install required"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Proprietary-3DA639?style=for-the-badge" alt="Proprietary License"></a>
  <a href="../../releases"><img src="https://img.shields.io/github/v/release/AurelioAvila/redaxa?display_name=tag&style=for-the-badge&color=7C3AED" alt="Latest release"></a>
</p>

<p align="center"><sub>Want safer AI workflows? ⭐ Star Redaxa to follow new protections and help others find it.</sub></p>

**Fastest way to try it — [web app](https://promptshield-beta.vercel.app), nothing to install** ·
[⬇ Windows desktop app](../../releases/latest) (not code-signed yet — SmartScreen shows a warning, click **More info** → **Run anyway**) ·
[Changelog](CHANGELOG.md) · [Privacy Policy](https://promptshield-beta.vercel.app/privacy.html) ·
[Terms](https://promptshield-beta.vercel.app/terms.html)

> The browser extension (source in [`browser-extension/`](browser-extension))
> is not yet published on the Chrome Web Store — pending review.

---

## Why

You're about to paste a stack trace, a config file, or a client email into
ChatGPT. Somewhere in there is an API key, a card number, or someone's
email address you didn't mean to send. Redaxa catches it in the
half-second before you hit enter — not with a vague "this might be
sensitive" guess, but with real validation: a Luhn check on card numbers, a
mod-97 checksum on IBANs, reserved-range filtering on SSNs. Copy-pasting
into a text box and hoping isn't a strategy. This is.

---

## What it does

Paste a prompt in. Redaxa finds what's sensitive in it — real ones,
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

## For teams: the control layer

On the Business plan, a workspace is a real organization:

- **Policies** — per category (credentials, financial, personal, protected
  terms) an admin chooses *warn*, *redact* or *block*. Block removes "Send
  anyway" in the browser extension: the prompt does not leave until fixed.
- **Shared protected terms** — protect a project codename or client name
  once and every member's checks flag it, on every device and surface.
- **Explainable decisions** — every scan names the rule that decided and
  why, on every surface.
- **Audit trail, metadata only** — every check leaves an event (surface,
  detection kinds, decision). Never the prompt, never a value: the events
  table has no column that could hold content. Members see their own
  activity; owners and admins see the organization's.

## Where it runs

- **Web app** — [promptshield-beta.vercel.app](https://promptshield-beta.vercel.app), no install
- **Windows desktop app** — this repo's installer, signs in once and stays signed in (session held in the OS credential store, not a file on disk)
- **Browser extension** *(pending Chrome Web Store review)* — a "Check" button injected into ChatGPT, Claude, Gemini, Copilot and Perplexity that scans whatever's in the composer before you send it

## Privacy

**Your prompt text is sent to Redaxa's own backend to be scanned — it
is not processed entirely on-device.** That's a deliberate tradeoff, not a
hidden detail: running the same detection logic server-side is what lets
the web app, desktop app and browser extension all give identical results.
What that scan does *not* do: your text is never sent to a third-party AI
or classification service as part of scanning (`api/scan.ts` is regex/Luhn/
mod-97 logic, no outbound calls), and the request body is used only to
compute the response — never logged, stored, or forwarded anywhere; see
[`api/scan.ts`](api/scan.ts) and the full
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

Redaxa is a protective review layer, not a guarantee that all
sensitive data will be caught — detection has irreducible false negatives,
and you're always the one who decides what actually gets sent. Team sharing
and cloud sync of scan history are not implemented; history stays in the
browser's local storage only.

Secret/credential detection matches known vendor prefixes (`sk-`, `AIza`,
`AKIA`, `ghp_`/`gho_`, `xox*-`, JWTs, `Bearer` tokens) — a generic
high-entropy API key without a recognizable prefix won't be flagged. If
your workflow involves custom or in-house token formats, add them as a
custom term rather than relying on the built-in credential patterns.

## Architecture notes

- [`scanner.ts`](scanner.ts) — the detection engine shared by every surface
- [`api/scan.ts`](api/scan.ts) — the endpoint the web app, desktop app and browser extension all call
- [`api/auth/*.ts`](api/auth) — thin proxies to Supabase Auth; the web app never handles raw tokens (httpOnly cookies), the desktop app and extension hold a Bearer token pair themselves
- [`api/billing.ts`](api/billing.ts), [`api/stripe-webhook.ts`](api/stripe-webhook.ts) — Stripe subscription lifecycle, backed by `supabase/migrations/` (RLS enabled, no public write policies)
- [`browser-extension/`](browser-extension) — the MV3 Chrome extension source
- [`src-tauri/`](src-tauri) — the Windows desktop app shell (Tauri v2 + Rust)

## License

Proprietary — all rights reserved. Source is visible for transparency; see [LICENSE](LICENSE) for terms. Not open for reuse, modification, or redistribution.
