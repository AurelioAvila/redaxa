# Security at Redaxa

Redaxa handles potentially sensitive prompts and untrusted repository content.

## Data and trust boundaries

- Prompt checks from the web app, desktop app and browser extension send the supplied text over HTTPS to the hosted `/api/scan` endpoint. Detection runs there; do not describe these checks as local-only processing.
- Scan history and organization audit records store activity metadata, such as time, application, counts, categories and policy decisions. The scan endpoint does not persist prompt text or finding values in those records. Hosting and upstream services remain separate operational trust boundaries.
- Protected terms and workspace settings are stored server-side. Joining a team applies its policies and allows its owner and admins to view future scan metadata. Invitation links require a preview and explicit acceptance by the signed-in user.
- Web sessions use HTTP-only cookies. Desktop sessions use the operating system credential store; extension sessions use extension-local storage. URL fragments cannot establish web sessions. Email confirmation requires sign-in, and recovery tokens are used only when a new password is explicitly submitted.
- Windows repository checks read local files or downloaded repository archives in the local scanner runtime. They do not execute repository code or test discovered credentials against providers. Repository content, paths and archives are untrusted input and require traversal, size, file-count and processing limits.
- Detection is advisory and may have false positives or misses. Never use real production credentials as test fixtures. Repository results and exported reports can contain sensitive evidence and should be handled accordingly.

## Reporting a vulnerability

Please do not open a public issue with secret material, personal data or exploit details. Contact the repository owner privately with a reproducible description and the affected file or version.

## Deployment requirements

Review authentication, organization authorization, billing, retention, rate limits and hosting configuration before deployment. Apply required database migrations with the application change. Every distributed application update must be digitally signed and its final signatures verified under the owner's release policy; local preparation and tests do not authorize publication.
