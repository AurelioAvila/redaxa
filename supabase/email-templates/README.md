# Supabase auth email templates

Supabase Auth sends these emails itself, so the templates live in the
dashboard (**Authentication > Emails > Templates**). The files here are the
reviewable copy of what is installed. The Supabase project is shared with
Frame Witness, so three templates carry a second, Frame Witness-branded branch
selected by `{{ if eq .RedirectTo "https://framewitness.pages.dev/account.html" }}`.

| File | Dashboard template | Subject |
|---|---|---|
| `confirm-signup.html` | Confirm sign up (Redaxa + Frame Witness) | Confirm your email for Redaxa / Activate your Frame Witness account |
| `invite.html` | Invite user | You are invited to join Redaxa |
| `magic-link.html` | Magic link or OTP (Redaxa link + Frame Witness code) | Your secure Redaxa sign-in link / Your Frame Witness verification code |
| `change-email.html` | Change email address (Redaxa + Frame Witness) | Confirm your Redaxa email change / Confirm your Frame Witness email change |
| `reset-password.html` | Reset password | Reset your Redaxa password |
| `reauthentication.html` | Reauthentication | Your Redaxa verification code |

Each subject is the same Go-template conditional where a Frame Witness branch exists.

## Design

Table-based HTML with inline styles, a hidden preheader, a text-built logo mark
(no remote images in the Redaxa branch), a mobile breakpoint at 480px and a
dark theme (Redaxa is dark by design; Frame Witness switches with
`prefers-color-scheme`). The palette matches `api/_email.ts`. Supabase template
variables (`{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .TokenHash }}`,
`{{ .RedirectTo }}`, `{{ .Email }}`, `{{ .NewEmail }}`) are untouched.

## Installing

Paste a file into the matching template body and its subject into the Subject
field, then save. Re-read the template after saving. Also check:

- **Sender**: point SMTP at the verified sending domain, not Supabase's shared address.
- **Site URL / Redirect URLs**: they build the links in these emails.
