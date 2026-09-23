# API alerts and detection precision — 21 September 2026

Repository scans now expose only the distinct API-candidate count in progress events. A persistent, dismissible in-app notification appears while scanning and offers a keyboard-accessible jump to the API results once the report is ready. It never contains matched values, paths or repository names. This is an in-app alert, not a Windows notification outside the app. Dismissal lasts for that scan; starting or cancelling a scan clears it. Synthetic examples are labelled.

API candidates are the first finding group on screen and in text exports, even when context assigns a medium priority. The extension has the same alert and ordering for prompt checks, without changing the Business block policy or requesting new browser permissions. Repository checks still run in the Windows app; the extension opens the workspace.

The shared prompt scanner rejects malformed common email addresses, bare @ signs, invalid dot/domain labels and overlength components. It preserves source-code quotes when redacting. Explicit API placeholders and publishable Stripe keys do not trigger prompt credential alerts; repository reports retain these as informational references. Repository source identifiers and retina image filenames are distinguished from literal credentials and email. Address-shaped media bytes without email context are informational; explicit customer-email metadata and API candidates in media remain reviewable. No filename-wide exclusion was added.

Fine-grained GitHub tokens use the 82-character payload format also used by [Gitleaks' GitHub rule](https://github.com/gitleaks/gitleaks/blob/master/cmd/generate/config/rules/github.go). Incorrect lengths are tested. Pattern matching does not validate credentials or guarantee detection of every format.

Validation:

- `npm test`: full suite passed, including new notification lifecycle and extension interception tests.
- Final source-quote adjustment: scanner/report tests and TypeScript build passed.
- Browser preview: synthetic API alert, masked results and focus/navigation to the first section verified.
- Real public PC Tweaker scan at `bbe48c424fc7dc294360fbaba14adaba35eeccc8`: 2,628/2,628 inventoried entries across 50 folders, zero skipped, 1,442 repeats grouped, six contextual candidates (four current, two historical), zero high/critical candidates, zero API candidates. 83 distinct references retained. This real run preceded the final source-quote adjustment; that adjustment has separate regression coverage. Counts include history and embedded entries, not only current filenames.

Release state: development changes only. No installer, updater manifest or Chrome Store package has been replaced by this change. The previously submitted extension 0.4.0 does not contain these new alerts. A new signed desktop release, backend deployment and extension package are required for customer delivery.
