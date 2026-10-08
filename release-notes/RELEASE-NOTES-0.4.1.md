# Redaxa 0.4.1

## Faster, more precise repository reviews

- Focused scans prioritize realistic API keys, tokens and credentials while filtering common examples, placeholders, public identifiers and unsubscribe tokens.
- Credential findings now explain the probable provider, why the value was recognized and whether it should be reviewed, restricted, rotated or revoked.
- API and token findings appear first, trigger an in-app alert and remain available in redacted text reports without exposing their values.
- Repository reads use a persistent Git object stream, substantially reducing process overhead on large repositories while keeping coverage and exclusions visible.
- Current files are scanned by default for a faster result; Pro and Business users can explicitly include accessible Git history when needed.

## Refined Windows workspace

- The Ocean interface is now the default, with a compact integrated title bar and a consistent account, pricing and preferences experience.
- Repository progress shows an adaptive time estimate, prioritized recap and clearer coverage details.
- Show all, section reveal and hide controls now cover paginated findings consistently.
- Inspect clipboard is part of the prompt action row and scrolls naturally with the page.

Repository findings are candidates for review, not confirmation that a credential is valid or that every vulnerability has been found. Redaxa does not test detected credentials against providers or revoke them automatically.
