# Subject fields

Paste each value into the Subject field of the matching dashboard template.

| File | Dashboard template | Subject field |
|---|---|---|
| `confirm-signup.html` | Confirm sign up | `{{ if eq .RedirectTo "https://framewitness.pages.dev/account.html" }}Activate your Frame Witness account{{ else }}Confirm your email for Redaxa{{ end }}` |
| `reset-password.html` | Reset password | `Reset your Redaxa password` |
| `magic-link.html` | Magic link | `{{ if eq .RedirectTo "https://framewitness.pages.dev/account.html" }}Your Frame Witness verification code{{ else }}A sign-in link was requested for Redaxa{{ end }}` |
| `change-email.html` | Change email address | `{{ if eq .RedirectTo "https://framewitness.pages.dev/account.html" }}Confirm your new Frame Witness email address{{ else }}Confirm your new Redaxa email address{{ end }}` |
| `invite.html` | Invite user | `You are invited to Redaxa` |
| `reauthentication.html` | Reauthentication | `Your Redaxa verification code` |
