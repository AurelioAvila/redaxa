Redaxa 0.5.4 finds AWS secret access keys and UK National Insurance numbers, and no longer counts a mistyped Italian fiscal code as one.

- AWS secret access keys are found next to an `aws_secret_access_key` or `secret_access_key` assignment, in prompt checks and in the repository check. A bare 40-character string is not flagged, and AWS's documented example key and filler values are ignored. The key is not tested against AWS, so the repository check lists it for review at high priority.
- UK National Insurance numbers are found with or without spaces and shown as "NI number". Prefixes that are never issued, such as QQ and BG, and placeholder digits like 123456 are ignored.
- An Italian fiscal code now needs a correct check letter, so a mistyped or invented code is no longer reported.
- The Redaxa service lets browsers reuse its CORS preflight answer for ten minutes, so the website and the browser extension repeat fewer OPTIONS requests.
- Detection relies on patterns and checksums, so it can miss sensitive information; review results before relying on them.

Windows installers require verified Aurelio Avila publisher signatures, trusted timestamps and compatible updater signatures before publication.
