# Security at Redaxa

Redaxa is privacy-sensitive by design.

## Current prototype boundary

- The browser dashboard performs detection locally.
- Prompt text is not sent to a server by the current prototype.
- The local history stores only a short preview, timestamp, and finding count.
- Never paste production credentials into a demo or test prompt.

## Reporting a vulnerability

Please do not open a public issue with secret material, personal data, or exploit details. Contact the repository owner privately with a reproducible description and the affected file or commit.

## Before public beta

Authentication, server-side processing, billing, telemetry, rate limits, and deployment configuration must receive a separate security review before they are enabled.
