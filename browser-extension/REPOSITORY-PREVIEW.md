# Extension repository check — 0.4.0

The popup now uses the same violet privacy-workspace design as Repository check, with separate Prompt protection and Repository tabs. Existing prompt interception/content scripts remain intact; injected panels share the updated palette.

Repository checks open the web workspace, which offers an explicit launch into Redaxa 0.4.0 or later for Windows. The bundled Windows engine performs the scan locally; neither the extension popup nor the web page runs the repository engine. A pasted public GitHub URL is validated before navigation. No active-tab permission, broad host permission, credential URL or session-token handoff has been added. A separate workspace or desktop sign-in may be needed.

Access is checked from a fresh authenticated `/api/account` response on each open. Prefer `active === true && repositoryAccess === true` when that server field exists. The previous API falls back to an active/trialing `personal` (Pro billing ID), `pro`, or `business` plan. An explicit false response always wins. Opening the page is not the authorization boundary: the local Windows engine verifies the account plan before scanning.

Use `node browser-extension/repository.test.mjs` for the mocked entitlement, revoked-access, URL-validation, token-absence and popup-origin checks. Tests include Business member entitlements.

For a visual preview, open `/browser-extension/popup.html` on the local development server. It clearly labels itself as a design preview when Chrome extension APIs are unavailable; it does not impersonate a signed-in account or unlock Pro. The Repository tab and password-visibility control work in the preview. Production links still use the official app.

Production configuration remains `config.js`, pointing at the existing official web app. The web handoff and signed Windows 0.4.0 release must be verified before distributing the extension update. The extension ZIP contains only manifest, scripts, styles, popup, configuration and icons; no tests, documents or credentials.
