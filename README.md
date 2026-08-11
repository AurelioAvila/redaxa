<p align="center"><img src="outputs/promptshield-mark.svg" width="156" alt="PromptShield logo" /></p>

<h1 align="center">PromptShield</h1>

<p align="center"><strong>Think freely. Share safely.</strong><br />A privacy-first checkpoint for prompts before they reach an AI tool.</p>

<p align="center">
  <a href="dashboard.html"><img src="https://img.shields.io/badge/TRY%20THE%20PERSONAL%20WORKSPACE-b9ff00?style=for-the-badge&labelColor=111311&color=b9ff00" alt="Try the personal workspace" /></a>
  <img src="https://img.shields.io/badge/STATUS-private%20prototype-111311?style=for-the-badge&labelColor=111311&color=555b52" alt="Private prototype" />
  <img src="https://img.shields.io/badge/DEFAULT%20LANGUAGE-English-111311?style=for-the-badge&labelColor=111311&color=555b52" alt="English default language" />
</p>

<p align="center"><a href="#what-it-does">What it does</a> · <a href="#privacy-boundary">Privacy boundary</a> · <a href="#roadmap">Roadmap</a></p>

---

## What it does

PromptShield checks a prompt for common personal data and secrets before you share it with an AI model. It highlights what needs attention and creates a safer redacted version in one click.

### Current personal workspace

Open [`dashboard.html`](dashboard.html) to try the browser-local workspace.

- Paste a prompt and inspect it locally.
- Review clear findings with the original value visible only on your device.
- Copy a redacted version.
- Keep a short local history of recent checks without storing full prompts.

## Detection coverage

| Category | Example |
| --- | --- |
| Email address | `name@example.com` |
| Phone number | International and domestic formats |
| API key or token | Common provider prefixes and bearer tokens |
| Card number | 13–16 digit payment card patterns |
| IPv4 address | Internal and public IPv4 addresses |
| IBAN | European bank account identifiers |
| Italian fiscal code | Codice fiscale format |
| Credential assignment | `password: …`, `secret=…` |

## Privacy boundary

The current prototype is intentionally local-first.

- Prompt text is processed in the browser.
- No prompt is sent to a server.
- Local history stores only a short preview, timestamp, and finding count.
- There is no authentication, hosted API, telemetry, billing, or cloud database yet.
- This tool is a helpful signal, not a guarantee. Always review a prompt before sharing it.

## Product direction

PromptShield is being designed for independent professionals and small teams that use AI with real client, business, or personal information.

1. Local detection and explainable redaction.
2. A clean English-first interface with major-language translations later.
3. Optional cloud features that receive only already-redacted content.
4. Personal and Business plans with a 14-day trial.
5. Railway deployment under a `getcertsprint.com` subdomain.

## Roadmap

- [x] Browser-local scanner MVP
- [x] Personal workspace proof of concept
- [x] Typed detection engine
- [x] Italian and European data patterns
- [ ] Connect the typed engine directly to the dashboard build
- [ ] Add authentication and a private beta waitlist
- [ ] Add hosted environments on Railway
- [ ] Add Stripe trials and subscriptions
- [ ] Add workspace roles and team policies
- [ ] Validate detection quality with a labelled test set

## Development

The core detection logic is written in strict TypeScript.

```bash
npm install
npm run check
```

The repository intentionally stays private while the product scope and threat model are validated.

See [`SECURITY.md`](SECURITY.md) for the current security boundary.
