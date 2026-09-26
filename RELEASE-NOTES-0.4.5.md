# Redaxa 0.4.5

- Clearer credential review: probable service, key type, evidence and the recommended response now accompany prompt results on web and Windows, and in extension 0.4.3.
- Improved Bearer-token handling, stricter JWT structure and issuer checks, and detection of Supabase secret keys, Slack app tokens, Stripe restricted test keys and AWS temporary access-key identifiers.
- Public client keys and explicit placeholders stay separate from secret alerts. AWS identifiers and Google browser keys receive context-specific guidance; no claim of working credentials or verified ownership.
- Extension 0.4.3 adds manual text checks, redacted copy, Clear and an easier first-use path using the existing five-check daily anonymous allowance. Chrome Web Store approval is separate from this desktop release.

No discovered credential is tested against its provider. If a genuine secret has been exposed, removing it from the repository does not revoke it; follow the issuing service's rotation or invalidation process.

Detection references: [GitHub token types](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github), [Anthropic authentication](https://platform.claude.com/docs/en/manage-claude/authentication), [Stripe keys](https://docs.stripe.com/keys), [Supabase keys](https://supabase.com/docs/guides/getting-started/api-keys), [Slack tokens](https://docs.slack.dev/authentication/tokens/), [AWS access-key IDs](https://docs.aws.amazon.com/STS/latest/APIReference/API_GetAccessKeyInfo.html).
