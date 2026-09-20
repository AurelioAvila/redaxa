# Repository check — development preview

Isolated branch: `codex/redaxa-github-scan-20260920`, based on current main `11ff647`.

Local desktop launch (PowerShell):

```powershell
$env:PORT='4186'
$env:REPO_SCAN_PREVIEW='1'
npm run tauri -- dev --config dev-repository.json
```

Web preview: http://127.0.0.1:4186/github.html. The focused page is also linked from the workspace sidebar.

Public GitHub repository URL → resolve default branch to a commit → read tree and bounded blobs from fixed GitHub API host → reuse Redaxa's detector in local Node process. No checkout, code execution, LLM request, uploaded repository, token validation, or secret persistence. Report values are always fully redacted; file/first matching line and commit-pinned links are returned.

Scope: latest default-branch snapshot, at most 35 text files, 150 KB each and 1.5 MB reserved total; 45-second timeout; three concurrent reads; 30-second scan interval. Binary/large/generated/dependency content, symlinks, submodules and LFS pointer files are skipped. All skipped files and truncated trees cause partial coverage. History, other branches, private repositories, dependency CVEs and general code vulnerability analysis are not implemented. No matches is not a security guarantee. A result is a possible exposure, not proof that a credential is valid.

API is disabled without the explicit preview environment flag, loopback only, exact Host/Origin checked, custom request header required, request size capped. Static serving excludes dotfiles/source/Git metadata. Existing production APIs, billing and releases are unchanged. This endpoint is development-only; production integration and desktop packaging are not claimed complete.

Validation: TypeScript build, existing scanner tests, new tests for URL restrictions, fully redacted results, line mapping, synthetic example, immutable snapshot links, coverage and fixed API host. Browser example found two synthetic exposures. Real public `octocat/Hello-World` check scanned its one file at commit `7fd1a60b01f9…` in about one second and displayed no matches with the scope caveat.

No release or installer distributed. Digital signing remains required before any future distribution.

## Requested revision: reveal controls and desktop development login

This supersedes the always-redacted UI description above: the local preview explicitly requests reveal-capable results held in memory. Values start hidden; Show/Hide controls operate per finding, per category and across all results. No values enter persistent scan history. The detector's default API still omits raw values unless explicitly opted in.

Desktop development auth uses an explicitly gated loopback relay to the existing official Redaxa API. Only enumerated API routes and GET/POST are accepted, with Host/Origin checks and a custom header. It does not forward cookies, add account permissions or bypass authentication/billing. Native session handling and Windows Credential Manager remain unchanged; packaged production endpoints are unchanged. The browser-only preview is not configured for account login.

Verified the relay returns configured=true, an empty sign-in request reaches the official endpoint and returns its missing-credentials validation, and a foreign Origin receives 403. No user password was used and a successful account sign-in is not claimed.

## Coverage and precision revision (supersedes the original 35-file scope)

- All folders in the default-branch snapshot are inventoried. Removed file-count limits and exclusions for dotfolders, vendor/build output, dependency folders, examples and lockfiles. Use a complete commit-pinned archive and reconcile it against the Git tree. If GitHub metadata is rate-limited, use an unauthenticated shallow bare Git clone and read tracked objects; no checkout, hooks or project code execution. The exact temporary clone directory is removed in a finally block.
- Show a file-by-file coverage list, including each unsupported binary/encoding, oversized file, symlink, external submodule/LFS object and missing archive entry. Never label an incomplete inventory or unreadable files as a complete security check.
- Limits: 10 MiB text per file; three-minute overall deadline; archive download 128 MiB compressed / 512 MiB expanded, or 512 MiB object reads for the Git fallback. At most 5,000 displayed matches, explicitly reported when capped; file traversal continues. Git fallback clone size itself is governed by the time budget, not an enforced byte cap.
- Recognized reserved example email domains, provider onboarding address in example config, loopback/documentation IPs, version-context dotted numbers, publishable key prefixes and explicit credential placeholders are informational references, excluded from exposure counts. They remain inspectable in a separate collapsed section. A filename containing example/test never suppresses a real-looking credential. Validity is not tested.
- Fixed line mapping for repeated values. Added tests covering 76 text files, deeply nested and previously excluded paths, UTF-16, masked/opt-in reveal, secrets in .env.example, known example addresses, missing/archive-filtered entries, submodules, symlinks, binary content and corrupt archives.
- Live validation on AurelioAvila/pc-tweaker-app: 477 tracked entries across 50 folders, 426 text files scanned, 51 entries not scanned, complete inventory and explicitly partial content coverage. 69 references separated from 75 potential matches requiring contextual review. Approximately 23 seconds using Git fallback while unauthenticated metadata API was rate-limited; these are observed test counts, not guarantees for future commits or key-validity claims.

## Extended scope requested after the coverage revision

The preview now calls `repository-full.ts` by default. Mirror read of accessible Git refs, no checkout/project execution, all current objects plus unique reachable historical blob versions, commit/tag messages, binary ASCII/UTF-16 strings, bounded nested ZIP/gzip/tar decoding, verified SHA-256 LFS downloads and traversal of pinned public GitHub submodules (including historical configurations). The UI polls an origin-checked local progress endpoint and separates file versions/embedded entries from current file counts.

Initial live extended run on PC Tweaker: 1,982 checked entries (477 current + 1,505 historical blob versions), 137 refs, 90 binary string checks, zero skipped, 92 seconds. This run preceded the additional commit/tag-message inspection; final UI totals can therefore be higher. No LFS/submodule/archive entries were present in that run, so it is not a real-world validation of those external paths. Binary extraction and submodule/LFS destination boundaries have separate synthetic tests. OCR/decompilation, inaccessible Git objects and unsupported encodings/container formats are not claimed covered.

Current budgets: ten-minute deadline, 2 GiB content read/decoded, 64 MiB in-memory archive/LFS content, four nested levels and 20 submodule snapshots. Larger Git blobs are read in overlapping chunks. Clone transfer itself is bounded by the deadline, not a byte cap. All resulting unreadable/unsupported/limited entries remain in coverage. Temp clones are removed only inside their invocation-created temp directory. Never advertise this as proof that a repository has no vulnerabilities.

Final browser validation (20 September 2026): 2,612 / 2,612 files, versions and entries checked; 0 skipped; 50 folders; 137 refs; 1,505 historical blob versions; 90 binary-string checks; 134.8 seconds. Includes commit/tag messages. UI displayed extended check complete, 111 recognized references separated. The 1,405 potential matches include historical occurrences and are not a count of distinct confirmed vulnerabilities. LFS/submodules/archive counters remained zero in this repository. TypeScript build and extended helper tests passed.

## Restyle and precision review — 20 September 2026

Final browser run: PC Tweaker revision 96c30fad78be, 2,612/2,612 entries, 50 folders, zero skipped. Nine distinct candidates: zero critical, zero high, seven medium, two low. Five current and four history-only; 80 unique informational/reference values; 1,427 repeated matches grouped. These counts are detection candidates, not verified vulnerabilities. Live ETA was observed updating with the measured traversal rate. The final browser report was copied successfully and Show all/Hide all verified without logging raw values.

Implemented: shared violet identity and intuitive prompt/repository entry points; Pro benefit cards with unchanged Personal Stripe billing identifiers and prices; Business includes Pro; extension repository entry with fresh account verification and no token URLs; server-side entitlement validation with explicit denial, fail-closed outages and Business membership capability; progress bound to a per-scan identifier; grouped context/priority/current/history recap; redacted text export, clipboard report and user-triggered mailto summary draft (no automatic delivery service).

Security fixes: prompt history no longer stores text excerpts and migrates legacy entries to metadata; validates persisted history and escapes analytics labels. Offline cache now only caches static app shell, excludes account/session/API/query and authenticated responses, removes old Redaxa cache versions. Build and dev static server allowlist client modules instead of exposing server/detector/API modules. Extension rejects privileged auth/navigation messages from content scripts.

Validation: full existing npm test suite passed, repository scanner/report/full helper/access tests passed, history privacy regression and extension entitlement tests passed, service worker privacy test passed. Runtime npm audit reported zero known vulnerabilities (22 production dependencies). Both web/desktop asset builds verified; sensitive JS modules returned 404. Real unauthenticated repository request returned 403 PRO_REQUIRED; hostile Origin denied. Desktop/landing/pricing/extension visual review completed. Mobile dashboard CSS measured 390px viewport and 390px document width without horizontal overflow. No successful customer sign-in or paid checkout was performed.

Review environment only: localhost:4186 runs with REPO_SCAN_PREVIEW=1 and explicit REPO_SCAN_DESIGN_REVIEW=1, visibly labeled and permits owner evaluation without changing subscription records. With that separate review switch off, live scans require verified Pro/Business entitlement. Demo synthetic data remains accessible. No production deploy, extension store upload or signed release performed. Repository engine currently runs in local Node/Git preview; customer release still requires packaging the engine/transport or deployment of an appropriate long-running backend and verification of that integration, then signed Windows artifacts. Do not describe the published extension as already containing these changes.
