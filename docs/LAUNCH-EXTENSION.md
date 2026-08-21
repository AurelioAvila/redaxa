# Extension launch kit — ready to fire when the Chrome Web Store approves

## 1. Swap the landing link
In `index.html`, the `#extension` suite-line currently points at
`https://github.com/AurelioAvila/promptshield/releases/latest`.
Replace with the store URL (`https://chromewebstore.google.com/detail/<listing-id>`),
rebuild (`npm run build:web`) and `vercel deploy --prod`.

## 2. Show HN draft
- **Title:** `Show HN: PromptShield – catches secrets in your prompt before it reaches ChatGPT`
- **URL:** `https://github.com/AurelioAvila/promptshield`
- **First comment (post immediately after submitting):**

> Solo dev here. PromptShield sits between you and the AI chat: a browser
> extension that intercepts your send on ChatGPT, Claude, Gemini, Copilot and
> Perplexity, scans the prompt for real sensitive data — API keys, card numbers
> (Luhn-validated), IBANs (mod-97), SSNs, emails — and offers a redacted
> version before anything leaves the browser.
>
> Two design decisions I'd defend:
> 1. Every detector is a validator, not a loose regex — a 16-digit tracking
>    number won't trip the card rule.
> 2. The audit trail is metadata-only *by table design*: the events table has
>    no column that could hold prompt content, so "we never store your
>    prompts" is enforced by the schema, not by policy.
>
> Teams get shared protected terms and per-category policies (warn / redact /
> block — block removes "Send anyway" entirely). Ironically, while testing I
> found live Meta API tokens sitting in my own clipboard — the exact accident
> this thing exists to prevent.
>
> Happy to answer anything about the detection engine or the org/policy model.

## 3. Announcement blurb (site/newsletter/social)
> PromptShield is now on the Chrome Web Store. One click, and every prompt you
> type into ChatGPT, Claude, Gemini, Copilot or Perplexity gets checked for
> secrets and personal data before it sends — with a safe, redacted version one
> click away. Free 7-day trial; team policies on Business.

## 4. Post-approval checklist
- [ ] Swap landing link (step 1)
- [ ] Update README "Where it runs" with the store link
- [ ] Show HN (step 2) — morning US time works best
- [ ] Newsletter via the shared PC Tweaker endpoint (source: promptshield)
- [ ] Winget: still blocked on microsoft/winget-pkgs PR #417245 (new-package
      admin review); submit 0.1.9 update once merged
