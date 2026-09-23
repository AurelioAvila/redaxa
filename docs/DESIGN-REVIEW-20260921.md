# Workspace design review — 21 September 2026

Status: local, uncommitted. User approval required before committing this redesign. No release artifacts published.

Implemented: neutral graphite task surfaces; repository URL above benefits; compact findings with optional explanations; existing API priority/notification and reveal controls retained; direct prompt composer; optional setup below composer; readable extension popup and Windows/Pro requirements; closed overlays removed from keyboard/accessibility navigation via visibility.

Validation:
- npm test passed: scanner, auth/billing, policy, repository triage/access, notification lifecycle, extension safeguards, redacted reports and updater metadata.
- TypeScript build passed; git diff --check passed.
- Browser visual review: empty repository, synthetic results, API alert/dismiss/reveal, prompt dashboard, plans and extension repository popup.
- Synthetic Show control changed to Hide and revealed the labeled demo value; no real credential used for visual review.
- Responsive DOM at 390px: document width 390px, no horizontal overflow, all three repository navigation routes visible, input width 320px. Viewport emulation restored after inspection.
- Hidden auth/preferences/plans no longer appear in the accessibility tree; opening/closing Plans works.
- Native development build compiled successfully (one non-blocking Windows linker message). Process 13528, title Redaxa — Design review · Development, executable src-tauri/target/debug/redaxa-desktop.exe, running against 127.0.0.1:4190. Native screenshot automation is unavailable in this tool session; visual checks were performed on the same served UI in browser.

Generated local repository runtime refreshed for the dev build. It must be signed and verified again before any future distribution. Existing public release was not changed. This pass does not claim a fresh live login, Chrome Store publication, full security audit or elimination of every false positive.

## Second proposal — replaces the rejected graphite preview

User rejected the first visual direction and oversized dev window. Replaced with paper/ink surfaces, compact aubergine horizontal navigation, editorial serif page/report titles and coordinated light dashboard/extension. Repository and prompt controls remain task-first. No additional product or security capability claimed.

Window configs now agree on 960 × 680 centered, resizable, minimum 720 × 520. Previous preview was 1280 × 880. Desktop native build compiled with the new config. Only the specific preview process was restarted; customer installs and public releases unchanged.

Checks for this revision: npm run check, git diff --check, desktop compilation. Browser visual pass at 960 × 640 content viewport: empty repository, synthetic report/API notification, prompt and plans. DOM checks at 720 × 490 content viewport found no horizontal overflow on repository or prompt; prompt editor 607px, repository input ~452px. All emulation restored. Native window opened with title Redaxa — Atelier preview · Development; native screenshot automation remains unavailable. Scanner logic unchanged in this second design pass; previous full suite results are not represented as a new test run.

Still uncommitted. Await user review; first proposal is not approved. Signing and distribution remain separate future work after approval.

## Third proposal — night blue and complete account navigation

User rejected the second proposal and explicitly excluded ivory and purple. Workspace and extension now use night-blue panels, ice-blue actions and sans-serif headings. The compact 960 × 680 window remains. Shared account controls are styled on the landing page as well; the public marketing redesign remains outside scope.

Account menu now exposes existing account summary, plans, subscription/invoices, preferences, API keys, recent checks, password recovery, verified support address, privacy and sign-out. Summary uses current entitlement data without inventing a plan. Fixed a focusout race that dismissed menu items before their click actions, and an auth initialization race that incorrectly displayed a sign-in message in API-key settings. Dashboard account links support direct hashes and reopening the same section. Theme choices update the actual accent; removed violet/indigo choices and made ice the default.

Validation for this revision:
- Full npm test suite passed after final behavioral changes, including TypeScript build and scanner/auth/billing/extension/report/updater checks.
- Browser UI exercised using an isolated local fixture with a synthetic account: menu, account summary, billing failure presentation, account refresh, password-recovery dialog, preferences, theme switching and API-key section navigation. No reset email sent, key created or payment service contacted. These checks do not claim successful live billing or live account authentication.
- Final browser visual check at 960 × 640 content viewport confirmed the night/ice repository page; temporary viewport overrides restored.
- Native dev build compiled successfully and opened as "Redaxa — UI & account · Development", process 4980, executable src-tauri/target/debug/redaxa-desktop.exe. Native screenshot automation remains unavailable; visual checks used the same served browser UI. Only the exact project debug executable was restarted.
- Isolated fixture server stopped and its tab closed after validation. Real development server and native preview remain open for user review.

No commit, push or release performed. User visual approval remains pending.

## Fourth proposal — integrated navigation, profile photo, account transport

User rejected the detached horizontal bar and type in the third proposal. Replaced with a continuous slate workspace and compact side navigation; locally bundled Inter variable (OFL license included), moderate title weights, larger editor text and muted blue controls. Prompt results stack below the composer at normal window width; wide layouts retain two columns. Updated spatially dependent preview copy across supported languages.

Fixed the actual unavailable-plan cause: development transport was hard-coded to 4186 while the native preview ran on 4190. Native loopback previews now use the existing guarded proxy regardless of port; packaged origins and browser cookie behavior are unchanged. Regression tests cover alternate dev ports, ordinary browser contexts, packaged origins and deceptive hostnames. Transient service failures no longer delete the saved desktop session.

Added device-local account photos: explicit file picker, change and removal, account-scoped hashed key, 5 MB JPEG/PNG/WebP validation, bitmap dimension budget, 256px center-crop/re-encoding, initials fallback. No external upload. Browser checks with a synthetic account verified save, reload persistence, persistence between prompt/repository routes, rejection of SVG and successful removal. No real profile image or account was modified in these tests.

Full npm test passed including the new transport regression, TypeScript build, scanner and entitlement/report/extension/updater checks. Browser inspected at 960×640 and repository at 720×490; font loaded and no horizontal overflow. Temporary viewport restored and test tab/server closed.

Native rebuild succeeded and opened as Redaxa — Profile & workspace · Development (PID 12460), 960×680. Opt-in server diagnostics confirmed the actual native account lookup returned HTTP 200 and a structured state with a boolean active field; no credentials or identities logged. Native visual automation remains unavailable; the equivalent served UI was visually checked in browser. Changes remain uncommitted and unpublished.

## Native title bar, complete themes and scanner investigation

Replaced OS decorations with native-only themed titlebar and scoped Tauri window permissions. Implemented drag, minimize, toggle maximize/restore with state labels, and close. Browser fixture verified command dispatch using an explicitly synthetic native bridge; this does not constitute native mouse interaction testing. Native build compiled and the updated application reopened.

Replaced split-color swatches with labeled solid-color choices. All workspace palette literals now resolve through shared semantic theme variables; selection restores across repository/dashboard. Browser verification confirmed Emerald changes page, panel, action and titlebar colors, survives route navigation and has no split gradients. All ten text/action palette contrast combinations checked at >=4.5:1. Full npm test and cargo test --lib passed; no distribution performed.

Scanner investigation: ran the exact packaged Node/engine/Git runtime with the same cleared environment against https://github.com/justnoobmal2-cell/Cluade. Only the account lookup was replaced with a synthetic entitlement in an ignored test preload; production enforcement unchanged. The first diagnostic run was stopped by its 180-second harness limit, not by a product crash. A full-budget rerun exited 0 after approximately 325 seconds, returned a partial report: 3,214 inventoried entries, 2,205 scanned, 1,009 skipped; 10,000 retained matches hit the display budget. Counts include historical versions. This does not establish full coverage or 10,000 vulnerabilities. Findings were never printed or saved.

The user's original native crash was NOT reproduced and is NOT claimed definitively fixed. Removed silent stderr discard: the native parent drains a bounded in-memory tail and classifies cancellation/memory/exit-code failures without exposing paths, report data or credentials. Interrupted pipe reads retry. A future repeated failure will provide a diagnostic code instead of the undifferentiated old message. Native visual automation remains unavailable in this session.

All changes remain local and uncommitted, awaiting user review.

## Review update — 23 September 2026

Ocean is now the default palette with a one-time migration from the previous preview preferences. Subsequent selections persist. Pricing contains only Pro/Business, a shared monthly/yearly selector (yearly initially selected), actual annual totals and annual Pro marked Recommended; no unverified popularity claim. Team, organization, policies and billing administration live under Account > Workspace & team. Pricing fits the 960x680 preview without horizontal overflow.

Clear is available for repository results/URL/alerts, prompt results, local activity and recent local checks. Clearing prompt results shows an empty state rather than a synthetic example. Concurrent prompt submissions are blocked and each request retains the submitted text even if the input changes while awaiting its response. No remote audit records are erased by local clear.

Scanner fixes: handle Git stdin errors at the shared inventory process; uncaught stream failures produce a bounded, sanitized terminal protocol error without raw secrets/stacks. Added runnable protocol regression test (demo, Pro gate, EPIPE redaction). A separate bug allowed the 10,000-result budget to crowd out later credentials with informational matches; retention now replaces lower-priority entries, API candidate tracking continues independently, and a regression test covers a full informational buffer.

Validation: full npm test and cargo test --lib passed; subsequent targeted protocol and repository helper/retention tests passed after the final changes. Browser confirmed plans, empty-state clearing, example API notification and full repository reset. Actual native account lookup returned HTTP 200 with structured state; credentials not logged. Packaged runtime scan of justnoobmal2-cell/Cluade finished at 377 seconds with exit 0: 2,210 scanned / 3,232 inventoried, partial coverage and display cap explicitly reported. This run used only a synthetic account entitlement preload, with real public Git content; no values printed or stored. It preceded the result-retention fix, which was separately regression-tested. The historical user's exact exit-1 cause was not captured, so the successful run is not proof that every original native failure mode was reproduced. Native mouse automation remains unavailable; user review requested.

All work remains local, uncommitted and unpublished. Development preview runs from port 4190 with the freshly rebuilt bundled engine.

## Confirmed native scanner startup fix — 23 September 2026

The repeated exit-1 failure was reproduced without any repository or account input: Tauri caches a canonical Windows executable/resource path with the verbatim `\\?\` prefix. Passing the derived absolute engine.cjs path as Node's entry-point argument fails before application code loads: EISDIR, lstat 'C:', exit 1. Earlier standalone probes used ordinary paths and therefore missed this startup defect.

The shared native launcher now starts `engine.cjs` relative to its already-selected trusted runtime working directory. The executable, working directory and cleared environment remain unchanged; no shell, path search or auth fallback was added. A Rust regression invokes the same launcher with an actual canonicalized Windows runtime path and checks a successful structured demo report. The failing standalone canonical-path probe reproduced exit 1; the relative-entry probe returned exit 0 with no stderr. Both cargo library tests pass.

The development window is reopened on github.html with Ub207/vault-sync prefilled. Work remains uncommitted and unpublished.

The real Ub207/vault-sync probe also exposed slow deadline completion: after the signal expired, the commit/tag loop kept calling execFile, which spawned Git before observing the already-aborted signal. A stack sample of the isolated test process identified that path; the probe was then terminated. The shared Git runner now calls signal.throwIfAborted before execFile. A diagnostics-channel regression proved one unwanted child before the fix and zero after it. Repository/access/report/extension/cache tests and both native tests pass; packaged source and debug engine hashes match.

A separate real-repository probe with a test-only 60-second deadline exited cleanly with a structured error and no diagnostics, rather than a report (inventory did not complete within that shortened budget). This is not evidence of complete repository coverage. Full repository completion remains for user verification in the reopened native preview. Production remains at its ten-minute budget; synthetic entitlement and shortened timeout are confined to ignored test fixtures. No commit or publication performed.

## Reveal and JWT triage — 23 September 2026

Global Show all now materializes every result page, reveals its values and opens informational references. Section controls are explicitly named Show/Hide section and remain scoped; Hide all remasks every rendered value. A runnable DOM regression covers 26 synthetic findings across pagination and references, global hide and section/global interaction.

Repository JWT matches now distinguish general signed-token candidates, declared unsubscribe-link tokens, public Supabase client tokens and privileged-role claims. Claims remain unverified; unsubscribe tokens remain reviewable, not silently suppressed. Overall ordering uses severity first, then credential category and current-file context, so medium-context tokens no longer precede critical private keys or high-priority credentials. Screen sections and redacted text exports follow that ordering. Synthetic classification/order tests and the complete repository/extension suite pass. Native runtime and preview rebuilt; rescanning is required for new labels. No commit or release.

## Focused scan and throughput — 23 September 2026

The user's narrower requirement supersedes the default exhaustive sweep. Default is a shallow current-branch credential scan; Extended scan explicitly includes history, other refs and dependency/cache/media/archive paths. All indexed exclusions remain in coverage. Current application/configuration files are inspected across folders, including dotfiles, examples, lockfiles and built JavaScript. Personal/financial patterns are not executed in this mode, and recognized credential placeholders/public identifiers are omitted. JWT JSON structure is checked locally; tokens explicitly associated with unsubscribe claims, URL paths or link labels are excluded from the focused report. The same JWT outside that context remains reviewable, and privileged roles are not dismissed. Keys are never tested against providers.

Replaced one Git subprocess per small/normal blob with one private `cat-file --batch` reader per repository, validating SHA/type/size and delimiters and closing pipes on completion/cancellation. Added an offline real-Git fixture covering 30 large source files, an empty file, focused exclusions, one reused reader and historical credentials retained by Extended scan. It is wired into npm test. Coverage UI initially renders 100 rows with pagination, preserving access to the full inventory instead of constructing over 100,000 DOM rows at once.

Measured Ub207/vault-sync with the packaged engine and synthetic entitlement only: before the batch reader, the current-snapshot probe was cancelled at 120 seconds after roughly 2,450 entries. Optimized final run finished in 15.883 seconds: 109,629 checked entries / 109,655 total including embedded content, 26 skipped, partial coverage, 12 raw credential candidates, no history. Earlier optimized run before unsubscribe-link-label filtering had 31 raw candidates. Repository HEAD changed slightly between runs; these are observed local timings, not a guaranteed speed ratio. No raw findings were printed or saved. The screenshot's public source was read only to verify its explicit Unsubscribe link context; no token was submitted to its provider.

Full npm suite and native tests passed after the transport/reader changes; final JWT/context and UI pagination regressions passed after the last adjustments. Source/runtime rebuilt and development preview reopened. Changes remain uncommitted and unpublished.

## 23 September — clipboard and credential context
- Inspect clipboard is in the prompt action row, not a floating viewport control. Browser fixture with an empty native bridge confirms static positioning and no horizontal overflow at 720px; no real clipboard was read.
- Findings show probable service, credential type, recognition evidence and conditional response guidance. Unknown services stay unknown; JWT claims are unverified. Google API restrictions and AWS access-key-ID limitations are explicit. No credential is tested or revoked automatically.
- Context remains available with values hidden and in redacted exports. Regression assertions cover GitHub, Google, AWS, unknown prefixes and absence of raw secrets in metadata/export.
- Desktop build and full npm test passed. Repository cards visually checked at 960px; repository and dashboard have no horizontal overflow at 720px. Local preview only, no commit or release.
