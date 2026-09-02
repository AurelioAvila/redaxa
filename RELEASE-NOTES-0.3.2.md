# Redaxa 0.3.2 — the key rotation 0.3.1 announced but did not ship

Account email that works, a webhook that minds its own business, and the
update-signing key change that 0.3.1 promised and did not actually deliver.

## The signing key, honestly

0.3.1's notes said Redaxa had moved to its own update-signing key. It had
not: that release shipped with the *old shared* public key still compiled
in, so every 0.3.1 install in the field still trusts the key PC Tweaker and
the PC Tweaker Uninstaller use. Signing 0.3.2 with the Redaxa-only key
would have been rejected by every one of them, silently — the update check
succeeds and the install never happens.

So 0.3.2 is the transition release 0.3.1 was supposed to be:

- It **ships** the Redaxa-only public key, so from here on installs trust
  Redaxa's own key and nothing else.
- It is **signed with the old shared key**, because that is the only key
  0.3.1 installs will accept. This is the last release signed with it.
- 0.3.3 onward signs with the Redaxa-only key, and by then every install
  that has updated normally already trusts it.

If you are on 0.3.1 or earlier the update works as usual. Nothing about
your account or your data changes.

## Email

- The password reset actually resets the password.
- New accounts get a welcome message, and every message now carries a plain
  text part alongside the HTML, so it renders in clients that refuse HTML.
- The layout survives Outlook, which had been collapsing it.
- "Just reply to this email" is now true — replies reach a mailbox that is
  read.
- Signup and subscription mails no longer send new accounts to a competitor's
  site; that URL was in the template twice.
- Nothing is sent at all when no sender address is configured, instead of
  half-sending.

## Elsewhere

- Stripe webhooks for the other two products sharing this account are
  acknowledged and ignored instead of returning 500, and only subscriptions
  that are actually Redaxa's get announced.
- Subscription confirmation goes to the person who actually started it.
- The audit trail exports into something an auditor can be handed.
- `--dim` text meets a readable contrast ratio, checked by a test from now on.
