# Changelog

## v0.5.5 — 2026-10-14

- Detection in the Windows app's local repository check now matches the service: secrets assigned by name in `.env` and configuration files ("Secret in a configuration value"), passwords inside connection URLs ("Password in a URL", only the password is masked), Stripe webhook signing secrets, SendGrid API keys, Slack incoming webhook URLs, and AWS secret access keys under the CLI and SDK names (`SecretAccessKey`, `secretAccessKey`, `aws_secret_key`). Both new kinds are listed for review at high priority (medium in example files) and are never tested for validity.
- Fewer false alarms: type names and expressions (`password: string`, `process.env.API_KEY`), `git@github.com` remotes and 13-digit millisecond timestamps are no longer reported. "The password is …" is caught, and an IBAN followed by its BIC is no longer missed. Code-comment passwords read "Usually a placeholder".
- Sign-in: a 401 from the API on a token the local clock still considers valid triggers one server-side session check and a single retry with the refreshed token, instead of signing the user out (desktop app; the extension part ships with its next store submission).
- Text fields draw one focus ring (accent border and a 1px shadow) instead of a border plus an offset outline.

## v0.5.4 — 2026-10-11

- Detection: AWS secret access keys (found beside an `aws_secret_access_key` assignment, never as a bare 40-character string; AWS's documented example key and filler values are ignored), UK National Insurance numbers (unissued prefixes such as QQ and BG, and placeholder digits like 123456, are ignored), and a check-letter test for Italian fiscal codes, so a mistyped code no longer counts as one.
- API: preflight responses carry `Access-Control-Max-Age: 600`, so browsers and the extension stop repeating the OPTIONS request for ten minutes.
- UK National Insurance numbers have their own finding type, shown as "NI number" in the app and "UK National Insurance number" in the extension, instead of sharing the US Social Security number label.

## v0.5.3 — 2026-10-11

- Repository check: test, fixture and example values (for example `wh-secret-test` in a test fixture) are no longer listed as exposures. A finding is a test value when its file is in a test, spec, fixture, mock, snapshot, testdata, e2e, example, sample or demo folder or has a test name (`*.test.*`, `*.spec.*`, `*_test.*`, `test_*.*`, `conftest.py`, `*.snap`), or, anywhere else, when a credential's value or variable name carries an explicit test or placeholder marker and the value is not a random-looking provider token.
- Test values are kept out of the counts and lists in the app, the web check and the text export, and counted as "N test or example values not reported", without values, credential context or paths.
- A value in a test location shaped like a real key is still listed at low priority as "found in a test file": live Stripe keys, real-format AWS key IDs and GitHub tokens, other provider tokens with high-entropy bodies (no test markers, no 1234/abcd runs), privileged-role JWTs and complete private keys. Card numbers in test files stay listed unless they repeat only a few digits like documented test cards.
- A value found both in a test file and elsewhere is listed from the other location, with the test file as one more occurrence. The web check returns listed findings before test values when its result cap applies.
- Scope texts on the repository page, the repository guide and the README describe the separation and its limits. The guide's malformed "Ready to look?" FAQ entry is now a plain link.
- Repository results on Paper: the priority numbers, the partial-coverage label, the API-key alert and danger labels kept colours made for the dark palettes (as low as 1.5:1). They now use darker inks on Paper (5.6:1 or more); the dark palettes are unchanged.

## v0.5.2 — 2026-10-11

- Updates no longer stop with "Error opening file for writing". The updater starts the installer and ends the app straight away, and the installer could reach the program file while the process was still exiting (or while a repository check kept the bundled scanner open). The installer now closes Redaxa, `node.exe` and Git from `repository-runtime` by their exact paths through Restart Manager (asking first, stopping only an app that does not respond), then waits up to 20 seconds for each file to be replaceable. The same applies when a downloaded installer is run with Redaxa open.
- Before the updater ends the app, a running repository check is cancelled and the tray icon removed.
- `scripts/installer-hooks.test.mjs` keeps the hook in place and forbids name-based or blanket process termination.

## v0.5.1 — 2026-10-11

- Paper is the starting palette on every page: the app, the website, the guides and the policy pages (the site was still starting in Ink & Copper).
- Before this release every saved preference carried the theme, so the default of the time, Petrol & Copper, was stored for people who never chose it. A theme click now records `themeChosen`; without it, that old default is treated as "never chose" and becomes Paper. Any other saved palette is kept.
- The first frame, the desktop window background and the web app manifest start in Paper; dark palettes declare a dark colour scheme only when chosen.
- Sign-in and account dialogs on the website use the same themed styles as the app (`dialogs.css`).
- The repository page's main button uses the accent's text colour in every palette.

## v0.5.0 — 2026-10-10

A redesign of the Windows app and the web workspace. Detection, accounts, billing and the browser extension are unchanged.

- One sidebar with a page for every task: Check text, Repository check, Activity, Protected terms, Settings, Account & team, and Plans & pricing. Links to the earlier dialogs still open the matching page.
- Check results are grouped by severity, with an icon and a label as well as a colour, and each value found is highlighted in the original text.
- Plans & pricing is a full page in the app and on the website: current plan, Free, Pro and Business side by side, a comparison table, what leaves your device, and common questions. The Halloween offer appears only while the server confirms it.
- Paper is the default theme for anyone who never chose one; Ink & Copper is its dark counterpart and the website's palette. Saved themes are kept.
- Sign-in, account, team and invitation dialogs take every colour from the active theme; text meets WCAG AA and field outlines 3:1 in all 14 palettes.
- Page switches render in the frame of the click: no entrance animations and no transitions longer than 120 ms.
- Development builds keep their own credential entry and read the live offer through the local preview relay, so a development run never touches an installed copy.

## v0.4.7 — 2026-10-02

- Removing an accepted teammate removes their organization access. Team invitation creation and acceptance enforce paid seat limits atomically.
- Joining a team requires explicit acceptance after previewing the invitation. Account fragments cannot silently replace the signed-in identity.
- Private-key parsing remains bounded on large malformed inputs.
- Includes the recent website, canonical-link and branded-email improvements. Windows installers retain the existing updater key and endpoint and have verified publisher signatures and trusted timestamps.

For intervening releases, see the [GitHub release notes](https://github.com/AurelioAvila/redaxa/releases).

## v0.3.2 — 2026-09-03

The key rotation 0.3.1 announced but did not ship, plus the account email
that was quietly half-working.

- **Update signing.** 0.3.1's notes claimed Redaxa had moved to its own
  signing key; that release still shipped the old *shared* public key, so
  every install in the field trusts it. 0.3.2 ships the Redaxa-only key and
  is signed with the shared one — the last release that will be. 0.3.3
  onward signs with Redaxa's key alone.
- The password reset actually resets the password.
- New accounts get a welcome message; every message carries a text part
  beside the HTML, survives Outlook, and "just reply to this email" is true.
- Signup and subscription mail no longer points new accounts at a
  competitor's site, which it did twice per message.
- Nothing is sent at all when no sender address is configured, instead of
  half-sending.
- Stripe webhooks belonging to the other two products on the same account
  are acknowledged and ignored instead of returning 500, and only
  subscriptions that are actually Redaxa's are announced.
- The audit trail exports into something an auditor can be handed.
- `--dim` text meets a readable contrast ratio, with a test to keep it there.

## v0.3.1 — 2026-08-30

Security-only. Written down after the fact: this release shipped without an
entry here.

- Intended to give Redaxa its own update-signing key instead of sharing one
  with PC Tweaker and the PC Tweaker Uninstaller. The new key was generated
  and the notes announced it, but the shipped configuration still carried
  the old shared public key — see 0.3.2, which completes it.

## v0.3.0 — 2026-08-29

- New brand mark: a padlock with a face, replacing the violet R monogram,
  matching the icon already live on the Chrome Web Store listing.
- Dashboard history rendering escapes identifiers and uses safe DOM APIs
  instead of building HTML from strings.
- Hardened CORS handling.
- Folded `/api/auth-config` into `/api/auth/session` to stay under the
  platform's function cap.

## v0.2.0 — 2026-08-23

Renamed from PromptShield. A rebrand, not a rewrite: every feature and
guarantee is unchanged. The old name turned out to be in use by several
unrelated products, including an established one with its own domain.

## v0.1.11 — 2026-08-21

Layout fix: the Organization activity admin snapshot spans the full width.

## v0.1.10 — 2026-08-21

Desktop catch-up: admin snapshot + per-member breakdown + CSV export in
Organization activity, prefetched Organization panel, overflow fixes.
First release delivered via the auto-updater.

## v0.1.9 — 2026-08-21

The privacy control layer release.

- Organizations with owner/admin/member roles (auto-provisioned for
  Business owners; invites join the workspace automatically).
- Shared protected terms, enforced server-side on every member's checks.
- Per-category organization policies: Warn / Redact / Block. Block removes
  "Send anyway" in the extension.
- Explainable policy decisions on every surface (which rule, why).
- Metadata-first audit trail: personal and organization activity in the
  dashboard; the events table has no columns for content by design.
- Desktop: signed auto-updates, checked at startup.
- Landing: always-visible Dashboard link.

## v0.1.8 — 2026-08-21

Web release: the landing page becomes the product demo.

- **Landing redesign.** A hairline-framed layout on a quiet dot grid, a
  product-led hero where an animated shield card replays a real scan
  (raw prompt → detection → safe version), a four-category overview of
  what the scanner actually detects, a four-step "before it leaves your
  screen" flow, and a premium pricing treatment. All CSS, all honest,
  reduced-motion respected.
- **Scanner:** casual "password xxx" credential mentions are now caught
  even without a colon or equals separator.
- **Install app** is a real, styled navbar button (the PWA prompt control
  was previously an unstyled element appended to the page body — and was
  being accidentally hijacked as the account button by a selector
  collision, now fixed with an explicit trigger).
- Suite footer: PC Tweaker cross-link. Same maker, same rules.

The desktop app is unchanged in this release (still 0.1.7 binaries).

## v0.1.7 — 2026-08-13

- Desktop session tokens now live in Windows Credential Manager instead of
  the webview's `localStorage`, closing a real disk-based token-theft path.
- Fixed a CORS origin mismatch (`http://tauri.localhost` vs the real
  `https://tauri.localhost`) that made the desktop app look signed out on
  every reopen until you clicked "Log in" again.
- Added a strict Content-Security-Policy to the production deployment
  (previously only the local dev server had one).
- `api/auth/callback.ts` no longer trusts a client-supplied refresh token
  paired with an access token on faith — it's now verified against Supabase.
- New browser extension (Chrome, MV3) for ChatGPT, Claude, Gemini, Copilot
  and Perplexity: a "Check" button that scans the composer before you send.
- Contextual detection: names right after a greeting ("Dear John Smith,"),
  street addresses.
- Fixed a rule-ordering bug where the phone-number pattern could corrupt an
  IBAN before the IBAN rule ever saw the full string, when all scan
  categories were enabled together (the real default).
- Full security audit: verified Stripe webhook signature checks, IDOR
  protection, rate limiting coverage, and no hardcoded secrets.
