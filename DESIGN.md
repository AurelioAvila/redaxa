# Redaxa — Petrol & Copper workspace

Current local development design, 28 September 2026. Replaces the rejected compact charcoal treatment. Redexa Social remains untouched. Icons and production services are unchanged; no commit or release is included.

## Identity
The saved theme code `graphite` now displays as Petrol & Copper: background #10252d, surfaces #193740, inset #142e37, accent #ffb184, text #eef5f4, secondary text #b6cccd. Existing theme preferences and the other ten palettes remain available. No gradients or split swatches. Bundled Inter, page headings 29–35px, working headings 19px, readable secondary text. A 194px navigation rail, themed native caption and continuous workspace replace the small inset frame.

## Customer workflow
The start screen distinguishes Text for AI from GitHub repository, with a three-step review journey. The editor includes usable sample buttons and a clearly labelled synthetic before/after comparison controlled by a native checkbox. Real findings retain their existing severity, reveal, redaction and report behavior.

The repository screen explains focused scanning versus optional history and archives. Its helper text changes with the real scan checkbox. Adjacent guidance explains credential priority, probable provider attribution, unverified validity and rotation advice. Guidance yields space to actual results. Authentication, Pro gating, alerts, coverage accounting, explicit reveal and secret-free exports are preserved.

## Desktop and accessibility
Default native size 1220×820, minimum 860×600, constrained to the available display. The 34px native control strip uses application theme tokens. Editor and results share two columns above 900px; they stack below it. Native checkboxes, visible keyboard focus, reduced-motion support and all-theme contrast checks remain. No new dependency.

## Validation
TypeScript compilation; eleven theme contrast/default/restoration checks; repository notification/reveal regression check. Browser checks at 1220×786 and 860×566: no horizontal overflow, sample and Clear behavior, original/redacted comparison, scan-depth explanation, synthetic report and clearing, no console errors. This validates interface behavior, not a new live credential scan or subscription transaction.

## Rollback
Pre-change snapshot: ../ui-backup-redaxa-petrol-20260928. Follow its README to restore only the captured UI/configuration files. Earlier design reports are historical and superseded by this contract.

## Navigation and controls refinement — 28 September 2026
Added Carbon & Mint (12 palettes). Theme selection uses a single border plus a check; keyboard focus remains explicit. The comparison uses inline replacements at the same font size and baseline as the surrounding sentence, without an offset panel/shadow. Two synthetic preview scenarios link to existing editable samples. Headings now use a quieter 27–31px scale with normal spacing and restrained button states. Preferences are wider with persistent footer actions.

A blocking, CSP-compatible theme-boot.js restores only theme presentation before first paint, and native caption space is reserved immediately. Auth CSS is loaded in the head. Pending account/plan areas do not display signed-out or inactive claims before resolution. Session restoration runs concurrently with config loading; the avatar renders before entitlement/config complete. No credentials or entitlement caches were added; secure storage and server authorization remain intact. Native cross-document transitions are progressive enhancement with reduced-motion support.

Checks: TypeScript build; workspace-boot.test.mjs (early palette, delayed account/config, both preview scenarios); session-refresh.test.mjs; workspace-theme.test.mjs (12 palettes); service-worker.test.mjs. Browser: new theme persists across pages, selected swatch has one 1px border/no shadow/no mouse outline, replacement and sentence fonts both14px, no horizontal overflow at1220×786 or860×566, no console errors. Live signed-in native behavior is available for user review; automated auth timing checks use synthetic sessions. Snapshot: ../ui-backup-redaxa-polish-20260928.

## Typography and evidence — 28 September 2026
Workspace typography now uses the installed Windows Bahnschrift family (Arial fallback, no redistributed font files). Page headings28px, navigation14px, working headings19px and action text14px; no compressed heading tracking. Tiny Pro rectangles are removed from the workspace navigation and task selector; plan availability appears as normal descriptive text.

Repository precision: generic sk-/Bearer signals without assignment evidence are medium-priority, low-confidence contextual candidates; explicit credential assignments remain high priority; provider-specific candidates remain prioritized even in example files. Explicit instruction placeholders and alg=none JWT data do not produce credential alerts. Low-confidence findings remain reviewable but do not trigger live or final API alerts. Both paths use the same predicate. Under the result limit, severity dominates generic token type so a weak token cannot displace a critical private key. UI and text exports expose detection confidence separately from validity.

Validated: scanner, credential context, report aggregation, full repository helpers and notification regressions. Browser confirms28px Bahnschrift heading, no tiny Pro badges and no horizontal overflow at1220px. The local desktop scanner bundle was rebuilt and copied to its actual runtime location; production signing/release preparation must still regenerate the runtime manifest and sign final artifacts. No release or commit. This improves tested classifications, not a promise of zero false positives or proof that credentials work.
