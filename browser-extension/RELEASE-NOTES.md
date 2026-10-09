# Extension 0.4.9

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
