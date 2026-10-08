Redaxa 0.4.7 improves team access security, explicit account consent and scanning resilience.

- Removing an accepted teammate also removes their organization access. Invitation creation and acceptance enforce paid seat limits atomically.
- Team links show a verified invitation before joining; opening a link no longer silently joins a workspace.
- Account tokens in URL fragments cannot silently replace your signed-in identity. Password recovery still uses its explicit form.
- Private-key parsing handles large, malformed inputs without repeated expensive matching.
- Includes the latest website readability, branded email and canonical link improvements.

Windows installers require verified Aurelio Avila publisher signatures, trusted timestamps and compatible updater signatures before publication. Repository matches remain review candidates; no detector can guarantee zero false positives or prove that a credential is active.
