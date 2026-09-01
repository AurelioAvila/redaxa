# Supabase auth email templates

Three of Redaxa's transactional emails are not sent by this codebase. Supabase
Auth sends them, from *its* default templates — plain grey boxes with a bare
link and the word "Supabase" nowhere removed. They are the first thing a new
account ever receives, and on a product sold on handling secrets carefully,
an unbranded link asking someone to click and authenticate is exactly the
shape of the email they should have been taught to distrust.

These are the branded replacements. They use the same frame as the
subscription and welcome emails in `api/_email.ts`: same palette, same
preheader, same footer.

| File | Supabase template |
|---|---|
| `confirm-signup.html` | Confirm signup |
| `reset-password.html` | Reset password |
| `change-email.html` | Change email address |

## Installing them

Dashboard → **Authentication → Emails → Templates**, pick the template, paste
the file's contents into the body, save. Once each. They are plain HTML with
Supabase's own `{{ .ConfirmationURL }}` placeholder, so nothing else changes
about how the flow works.

While you are there, two settings decide whether any of this arrives:

- **Sender**: the default is Supabase's shared address, which is rate-limited
  and shares its reputation with every other project on it. Point SMTP at the
  same Resend domain the rest of Redaxa sends from.
- **Site URL / Redirect URLs**: these build the link inside the template. They
  must name the domain the product actually lives on, or every confirmation
  lands somewhere that cannot handle it.

## Why they are files here and not code

Supabase renders them itself, so there is nowhere in this repo they could be
imported from. Keeping them in the repo at least means the branded versions
are reviewable, diffable, and not lost the next time the dashboard is
reconfigured.
