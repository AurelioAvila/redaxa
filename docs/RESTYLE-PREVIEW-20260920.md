# Redaxa restyle preview — 20 September 2026

Local development work for review; no deployment or release was performed.

## Design

`brand-system.css` supplies shared primitive, semantic and component tokens. Dark violet surfaces, warm lavender actions, calmer typography and the existing official Redaxa mark now connect the public page, prompt workspace, pricing and repository review. Existing selectable accent themes and account hooks remain available.

The workspace offers two explicit paths: check a prompt or review a repository. Navigation remains available on narrow screens; the previous dashboard hid the complete sidebar on mobile. Pro badges communicate the repository feature's tier. Pricing is reachable through `/dashboard.html#plans`, with Escape dismissal and keyboard focus containment.

The landing page introduces the repository review as a **development preview**, with illustrative categories rather than invented scan results. It explains grouping, example separation, coverage and redacted text reports. Pro benefits and Business team controls are listed separately. Trial copy states eligibility and card requirements. Landing free checks are described according to `api/scan.ts`: up to five per day, shared by network.

## Billing names

- Pro is the customer-facing name of the existing `personal` tier: €7.99/month or €79.90/year.
- Business keeps `business`: €14.99/user/month or €149.90/user/year, 1–3 seats.
- `data-plan` values, prices, Stripe configuration and checkout behavior were not changed by the design work.
- Hosted checkout and historical invoices may still use Personal. No remote billing products were renamed.

## Privacy correction found during review

`saveHistory()` previously retained the first 76 raw prompt characters despite its metadata-only comment. It now stores only an ID, timestamp, detection count, category counts and a fixed content-free label. Reading older history rewrites supported entries without raw previews or unknown fields, so legacy content is removed locally when the updated workspace opens.

History parsing also validates dates, counts and category names, caps records at 40, and escapes analytics labels before HTML rendering. This prevents malformed local records from breaking rendering and closes the unchecked category-to-HTML path.

## Verification

- TypeScript build passed.
- Existing landing demo/anonymous quota behavior test passed.
- `dashboard-history.test.ts` passed: new saves contain no prompt text; legacy content is removed; unsafe category names and invalid records are excluded; retained records are capped.
- Parent task handles the final browser/desktop visual and end-to-end review.
