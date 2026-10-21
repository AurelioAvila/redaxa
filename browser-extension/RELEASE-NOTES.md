# Extension 0.4.14

Edited messages are checked too. Clicking the Save, Send or Update button of the box for editing an earlier message on ChatGPT, Claude, Gemini or Perplexity now goes through the same check as a new message. Enter in that box is left as it is, since on some sites it adds a new line; the check runs when the edit is sent with its button.

Attached text files are checked on this device. When a file is dropped, pasted or chosen on a supported site, a text file up to 1 MB (`.env`, `.txt`, `.csv`, `.json`, `.yaml`, `.log`, source code, `.pem`, `.key` and similar) is read inside the browser and checked with the same engine; its contents are not sent anywhere. If something is found, a notice names the file and what was found, and the next send waits for "Send anyway". Uploads are never blocked or replayed. PDFs, images, Office documents and larger files are not inspected, and the dialog says so.

Team rules stay on. For members of a Business workspace, "Check automatically before sending" stays on while they are signed in; the popup shows the switch locked and why. Administrators who deploy the extension through enterprise policy can set `forceAutoCheck` (see `managed_schema.json`) to keep checks on whether or not anyone is signed in. Without a managed deployment, a person can still sign out or remove the extension.

An outage no longer stops everyone from sending. When the Redaxa account service cannot be reached, only members of a Business workspace, whose team rules might block a message, are asked to wait. Everyone else is checked on this device, as free use is, and told that protected terms and team rules were not applied.

New strings in English, Italian, Spanish, French and German. No new permissions, telemetry or dependencies.

Fixed before release, after checks on the live sites (21 October 2026):
- The first send after the browser starts no longer waits for enterprise policies to load (5 to 15 seconds in Brave). It waits at most 250 ms; a policy that arrives later is applied to open tabs.
- On ChatGPT and Gemini the edit box uses the same editor as the composer and comes first on the page, so it was taken for the composer and its Send/Update button went unchecked. The composer is now the lowest match.
- Only the edit box's own Save/Send/Update button counts. ChatGPT's feedback close and Perplexity's panel toggle no longer trigger a check, and Cancel never stands in while Save is still disabled.
- Switching automatic checks off while a status request was already on its way is no longer lost.

Verification: `npm test`, then `python scripts/qa/extension-e2e.py` on the staged package in a temporary Brave profile. On the live sites: Enter and the Send button held a prompt with fake secrets on ChatGPT, Gemini and Perplexity (signed out, temporary profile), a synthetic `.env` attachment was flagged and held the next send on ChatGPT and Gemini and flagged on Perplexity, and the edit box's own button was recognised on ChatGPT, Claude, Gemini and Perplexity (owner's sessions, benign text only).

## Previous extension 0.4.13

The account panel in the popup now says when a free trial ends ("Pro trial · ends 17 October") and when a payment did not go through: the plan shows as paused, and the button opens Account & team in the Redaxa workspace to update the payment method instead of offering the plan again. In English, Italian, Spanish, French and German. Nothing else changes: free checks still run inside the browser and send nothing. No new permissions, telemetry or dependencies.

Verification: `npm test`, then `python scripts/qa/extension-e2e.py` on the staged package in a temporary Brave profile.

## Previous extension 0.4.12

Catches more of what people actually paste. Checks now find secrets assigned by name in `.env` files and configuration (`DB_PASSWORD=…`, `JWT_SECRET: …`, `"apiKey": "…"`), passwords inside connection URLs such as `postgres://app:…@db.internal/main` (only the password is replaced, so the host stays readable), Stripe webhook secrets, SendGrid API keys, Slack webhook URLs, and AWS secret access keys under the names the AWS CLI and SDKs print (`SecretAccessKey`, `secretAccessKey`, `aws_secret_key`). "The password is …" is caught as well as "password: …". An IBAN followed by its BIC or another word in capitals is no longer missed; before, part of it could be read as a phone number and the rest left in the text.

Fewer false alarms in code: type names and expressions such as `password: string`, `process.env.API_KEY`, `request.form['password']` or `await …`, millisecond timestamps that happen to pass the card checksum, and `git@github.com` remotes are no longer flagged.

Sign-in kept out of reach of web pages. The scripts that run on the AI sites can no longer read the extension's storage, where a signed-in session lives; they receive only what they need, the automatic-check switch and the plan status, without the account email. Turning automatic checks on or off in the popup now applies at once to tabs that are already open.

Ctrl+Enter and ⌘+Enter are kept when Redaxa sends a checked message on, so a site set to send with Ctrl+Enter no longer receives a plain Enter, which it would read as a new line. After an update, a tab that was already open says once that it needs a reload to be checked again, instead of letting messages through without a word.

Includes the 0.4.11 changes, which were not submitted on their own. No new permissions, telemetry or dependencies. Free checks still run inside the browser and send nothing.

Verification: `npm test`, then `python scripts/qa/extension-e2e.py` on the staged package in a temporary Brave profile, three consecutive clean runs. The end-to-end check now also confirms in the browser that the content script cannot read extension storage and that the off switch reaches a tab that is already open. Its earlier intermittent failures had two causes, both fixed: it waited for any dialog, so on a busy machine it read the "Checking…" notice shown for a check slower than 300 ms as the result (the Italian dialog-title failures), and it looked for the welcome tab only among Playwright's pages, which can miss a tab the extension opens while Playwright is still attaching; the browser's own target list is now the evidence.

## Previous extension 0.4.11 (not submitted on its own)

The bundled detection engine matches Redaxa 0.5.4. Checks now find AWS secret access keys next to an `aws_secret_access_key` or `secret_access_key` assignment (a bare 40-character string, AWS's documented example key and filler values are not flagged) and UK National Insurance numbers, shown as "UK National Insurance number" (prefixes that are never issued, such as QQ and BG, and placeholder digits like 123456 are ignored). An Italian fiscal code needs a correct check letter, so a mistyped or invented code is no longer reported. Free checks still run inside the browser and send nothing. No new permissions, telemetry or dependencies. This version includes the 0.4.10 changes.

## Previous extension 0.4.10

Fewer permissions. The extension no longer asks for access to any website besides ChatGPT, Claude, Gemini and Perplexity: the host permission for the old backend (promptshield-beta.vercel.app) is gone, because the Redaxa API on redaxa.getcertsprint.com answers the extension over CORS, and free checks never call it. The retired chat.openai.com and copilot.microsoft.com patterns are removed (the first redirects to chatgpt.com, the second to copilot.com, where the extension does not run). Removing permissions does not ask existing users to approve anything.

Clearer results. When a check before sending finds something, the dialog groups the findings ("Email address × 2"), shows the redacted version with each placeholder highlighted, explains what Replace does, keeps the Replace and Send anyway buttons in view in small windows, and puts focus on the safe action; Escape closes it and the prompt stays unsent. A clean prompt no longer flashes a "Checking" dialog: it only appears when a check takes longer than 300 ms, and it can now be closed (close button or Escape) without the message being sent when the check finishes. Tab stays inside the dialog. A message longer than 20,000 characters is no longer held with a confusing error: the dialog says it was too long to check and, for free use, offers "Send without checking" (accounts with a plan keep it unsent, since team rules may apply). Plan errors from the server read as sentences instead of codes, and signing in or out in the popup applies to open tabs on the next send. The page button now reads "Check with Redaxa".

First run. A new install opens a short welcome page: automatic checks are on, try an example (an API key, an email and a card number, all fictional), see the result. Nothing opens on updates.

Five languages. The popup, the page button, the dialog, finding labels, credential advice and the store name and summary are in English, Italian, Spanish, French and German, following the browser language (English otherwise).

Also: the Repository tab is removed, so the popup no longer quotes daily allowances that belong to the website and keeps to one purpose (the web repository check stays one click away on the website); footer links to Privacy, Website and the Windows app; the Lock Pup icons are redrawn with the store's 16 px padding plus a 32 px toolbar size; the popup and page elements use the Redaxa Paper and copper palette, with a dark variant that follows the system. After three checks on AI sites that found something, the popup shows a link to the store reviews and a copy-link button once, with no reward attached; what is stored is that count and the fact that the link was shown. Detection is unchanged and still matches the Redaxa engine. No new permissions, telemetry or dependencies. This version includes the 0.4.8 and 0.4.9 changes.

Verification: `npm test` (locales, detection with timing, background, findings, interception, popup), plus `python scripts/qa/extension-e2e.py <staged extension>` in a temporary browser profile: welcome flow, Enter and Send interception on stand-ins of the four sites, Escape, replace, send anyway, manual check, the off switch, Italian interface, a 20,000-character prompt, an over-limit prompt and the Tab trap, no worker request during free checks, and the account API reachable over CORS without host permission. Live check on 11 October 2026 in a temporary, logged-out profile: ChatGPT, Gemini and Perplexity hold the send, show the dialog, replace (Perplexity through the clipboard fallback) and re-send a clean prompt; Claude's composer and Send button were matched in a logged-in session without sending.

## Previous extension 0.4.9

The popup now describes the paid plans accurately. Repository checks cover public GitHub repositories only, on the web and in the Windows app; the popup no longer mentions private repositories, which the Windows app does not support. The 60-a-day allowance is labelled as repository checks, not prompt checks: prompt checks with a plan have no daily limit. Copilot is no longer listed among the supported sites, because copilot.microsoft.com now redirects to copilot.com, which the extension does not run on. No change to detection, permissions, telemetry or dependencies. This version includes the 0.4.8 changes.

## Previous extension 0.4.8

Clicking Send is now checked in every interface language. The send buttons on ChatGPT, Claude, Gemini and Perplexity are recognized by their structure rather than their English label, so a click on Send in an Italian, German or other translated interface no longer skips the automatic check; pressing Enter was already covered. Stopping a ChatGPT reply is not treated as a send.

The bundled detection engine matches Redaxa 0.4.12, so some unusual text patterns no longer slow down a check. No new permissions, telemetry or dependencies.

## Previous extension 0.4.7

Prompts are now checked inside your browser. For free use nothing is sent anywhere: the same detection engine the Redaxa service runs is bundled with the extension, so checks are instant, unlimited and work without an account. Automatic checks before sending are now on for everyone on ChatGPT, Claude, Gemini, Copilot and Perplexity, with a switch in the popup to turn them off. Accounts with an active plan keep using the Redaxa service, where workspace protected terms, team policies and the activity record live; a Business block still holds the message when the account cannot be verified.

The Repository tab opens the free web check of public GitHub repositories (exposed keys and vulnerable dependencies). Workspace links point to redaxa.getcertsprint.com. No new permissions; the background worker is now an ES module.

## Previous extension 0.4.6

Signed-in accounts without a plan now get 5 free manual checks a day, counted per account, instead of being sent straight to the plans page. Visitors keep their 5 checks per 24 hours per network. Automatic checks before sending still need Pro or Business. Plan links now open redaxa.getcertsprint.com. This release also includes the 0.4.5 changes, which it replaces in review. No new permissions, telemetry or dependencies.

## Previous extension 0.4.5

After the extension updates, tabs that were already open keep sending normally instead of holding every message until they are reloaded; a reload restores checking. Account status is refreshed when a tab comes back into view and before a send, instead of every 30 seconds from every open tab. No new permissions, telemetry or dependencies.

## Previous extension 0.4.4

An authenticated composer now holds the send action while account status is unresolved or temporarily unavailable. A failed scan keeps the prompt unsent instead of offering an unchecked policy bypass. Repeated actions share the pending check, and automatic checks cannot fall back to anonymous quota after session expiry.

Confirmed signed-out and inactive accounts retain ordinary sending. Manual guest checks keep their existing disclosure, explicit action and server quota. No new permissions, telemetry, dependencies or client-side paid access were added. Prompt analysis still uses the existing Redaxa backend; this is not a local-only prompt scanner.

Run `node browser-extension/interception.test.mjs` alongside the existing findings, repository, popup and session-refresh checks. The regression fails against the prior content script before its first account response. Chrome Web Store approval remains separate from a GitHub download release; do not claim the installed Store version was automatically updated.

## Previous extension 0.4.3

Desktop release 0.4.5 includes the matching shared scanner update. Extension 0.4.3 replaced the 0.4.2 submission on September 26, 2026 and is awaiting Chrome Web Store review, with automatic publication enabled after approval. The console still lists 0.4.0 as published. Approval and publication are external steps.

- Paste a prompt, email or draft directly into the popup; check it, review grouped findings and copy the redacted version.
- Try a fictional example before creating an account. Real anonymous checks use the existing server quota: 5 per 24 hours per network. No new free entitlement or client-side quota bypass.
- Signed-out visitors can also explicitly request a manual check on supported AI sites after seeing the data-use disclosure. Automatic interception still requires an active account.
- API keys and tokens appear first, followed by other credentials and remaining findings. No credential-validity testing or guarantee that every sensitive detail is detected.
- Clear removes text and results; editing invalidates prior results. No scan text is saved in extension storage. Account service interruptions keep the account visible without unlocking access.
- Pro explains the paid workflow and links directly to plans. Paying customers do not see the upgrade panel. No new permissions, telemetry, dependencies or duplicate prices.

## Verification

Run `node browser-extension/popup.test.mjs`, `node browser-extension/findings.test.mjs`, `node browser-extension/repository.test.mjs`, `node scripts/session-refresh.test.mjs` and `npm run check`. Popup tests are also included in `npm run test:repository` and therefore `npm test`.

One anonymous production API check with fictional email and test card data returned the expected redacted result. Browser preview checks cover example → result → copy, clear, account entry and the plan link. The preview response is simulated and labelled; it does not transmit text. Native Chrome popup installation and live AI-site compatibility were not retested in this change.

## Store listing

The Chrome Web Store description is maintained in the Developer Dashboard. The version entered on October 9, 2026 states that free checks run in the browser with no account and no extension-side limit, that the automatic check before sending is on by default and can be turned off, that plan checks run on Redaxa's server without storing the text, that repository checks cover public GitHub repositories in the Windows app, and that Copilot is not listed. Keep the popup, the site and the privacy policy consistent with it.

## Measurement

The login wall was an observed obstacle, not proof of why purchases are absent. Compare store visitors → installs → completed authenticated extension checks → paid subscriptions using existing store, activity and billing data. Anonymous completions are intentionally not persisted, so this change does not establish a complete conversion funnel or demonstrate an uplift.
