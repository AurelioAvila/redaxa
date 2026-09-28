# Extension 0.4.3

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

## Store copy for the next submission

Check before you share. Redaxa helps you spot potential credentials, personal details and financial data in text before you send it to an AI tool.

Paste text into the extension, review the findings, and copy a redacted version. Try a fictional example or use up to five real manual checks per 24 hours without an account (limit shared by network).

With an active plan, Redaxa checks supported composers on ChatGPT, Claude, Gemini, Copilot and Perplexity before sending. Pro and Business also include public GitHub repository checks in the Redaxa Windows app, with grouped findings and a prioritized report.

Text you choose to check is sent to Redaxa's service for analysis. It is not stored or forwarded to an AI provider. Detection can miss sensitive data or flag examples; review the result before sharing. Repository checks require the Windows app and do not verify whether a detected credential works.

## Measurement

The login wall was an observed obstacle, not proof of why purchases are absent. Compare store visitors → installs → completed authenticated extension checks → paid subscriptions using existing store, activity and billing data. Anonymous completions are intentionally not persisted, so this change does not establish a complete conversion funnel or demonstrate an uplift.
