# Supabase auth email templates

Supabase Auth sends these emails itself, so the templates live in the
dashboard (**Authentication > Emails > Templates**). The files here are the
reviewable copy of what is installed, and they are generated: edit the
renderer, not the HTML.

- Redaxa's branch comes from `renderEmail` in `api/_email.ts`, the renderer of
  every other Redaxa email (Paper with the copper accent; Ink & Copper in dark
  mode).
- The Supabase project is shared with Frame Witness. Three templates carry a
  Frame Witness branch selected by
  `{{ if eq .RedirectTo "https://framewitness.pages.dev/account.html" }}`. That
  HTML is generated in the Frame Witness repository
  (`validation/render_supabase_templates.mjs`) and stored in `frame-witness/`.

Rebuild with `npx tsx scripts/build-auth-email-templates.ts`; `npm test` fails
when the files are stale. Subjects are listed in `SUBJECTS.md`.

## Links

Confirmation and password-reset emails link to
`https://redaxa.getcertsprint.com/#confirm=…` and `#recovery=…` with
Supabase's one-time `{{ .TokenHash }}`. The page spends the hash only when the
reader selects Confirm email or sets the new password (`api/auth/signup.ts`
`confirm`, `api/auth/recover.ts?action=finish` with `token_hash`), so mail
security scanners that open every link cannot use it up. Links sent earlier
(`{{ .ConfirmationURL }}`) keep working. The other templates use
`{{ .ConfirmationURL }}`.

## Installing

Paste a file into the matching template body and its subject into the Subject
field, then save. Re-read the template after saving. Also check:

- **Sender**: point SMTP at the verified sending domain, not Supabase's shared address.
- **Site URL / Redirect URLs**: Site URL should be `https://redaxa.getcertsprint.com`
  and both `https://redaxa.getcertsprint.com/**` and
  `https://framewitness.pages.dev/account.html` should be allowed redirects.
