Redaxa 0.5.5 brings the newer detection to the Windows app's local repository check: secrets assigned by name in `.env` and configuration files, passwords inside connection URLs and three more provider keys, with fewer false alarms in code. It also keeps you signed in when the computer's clock is wrong.

- Secrets assigned by name in `.env` files and configuration (`DB_PASSWORD=…`, `JWT_SECRET: …`, `"apiKey": "…"`) are found and shown as "Secret in a configuration value". Only literal values with letters and digits count; type names, environment references and code expressions are left alone.
- Passwords inside connection URLs such as `postgres://app:…@db.internal/main` are found and shown as "Password in a URL". Only the password is masked, so the scheme, user and host stay readable. Neither kind is tested for validity, so the repository check lists them for review at high priority, or medium in example files.
- Stripe webhook signing secrets, SendGrid API keys and Slack incoming webhook URLs are recognised with their service. AWS secret access keys are also found under the names the AWS CLI and SDKs print (`SecretAccessKey`, `secretAccessKey`, `aws_secret_key`).
- "The password is …" is caught as well as "password: …", and an IBAN followed by its BIC or another word in capitals is no longer missed.
- Fewer false alarms: `password: string`, `process.env.API_KEY`, `git@github.com` remotes and 13-digit millisecond timestamps that happen to pass the card checksum are no longer reported. A password-like value in a code comment is described as "Usually a placeholder".
- Sign-in: when the Redaxa service refuses a session this computer's clock still considers valid (a clock set back after sign-in, or a session ended elsewhere), the app asks the service once for a refreshed session instead of signing you out.
- Text fields show a single focus ring instead of two concentric lines.
- Detection relies on patterns and checksums, so it can miss sensitive information; review results before relying on them.

Windows installers require verified Aurelio Avila publisher signatures, trusted timestamps and compatible updater signatures before publication.
