# Updating Redaxa for Windows

Redaxa checks for updates when the desktop app starts. When an update is available, choose **Install and restart**. Choosing **Later** defers installation; reopen the app to check again. The download is verified against the updater public key before installation.

## Updating to 0.4.0

- **Redaxa 0.3.1, 0.3.2 and 0.3.3:** the published installers contain the current updater key. They can download and authenticate 0.4.0. MSI installations receive the MSI package; EXE/NSIS installations receive the EXE package.
- **Redaxa 0.3.0 and 0.2.0, and PromptShield 0.1.9–0.1.11:** the published installers contain an older updater key. They cannot authenticate the current update and need one manual upgrade.
- **PromptShield 0.1.7:** the original published desktop build has no updater and also needs a manual upgrade. The 0.1.8 release contains no desktop installer.

For a manual upgrade, close the app, download the signed Windows installer from [the official latest release](https://github.com/AurelioAvila/redaxa/releases/latest), and run it. Use the MSI if the existing app was installed through MSI; otherwise use the EXE setup. Sign in with the existing account if requested. The 0.4.0 installation contains the current updater key for future updates. Older PromptShield installations use a different application identity and may remain installed separately.

Do not disable signature verification to work around the older key. This check protects the update channel. A static manifest cannot provide different signatures for clients sharing the same endpoint and target; changing the manifest to the older key would break newer clients instead.

## Verify-download block and llms.txt

The landing page shows the SHA-256 and Authenticode status of the published installer, and `/llms.txt` repeats them. Both come from `release-trust.json`, written by `scripts/release-trust.mjs` from the real release asset (it re-downloads the file and stops if the hash differs from GitHub's digest or the signature is not Valid). After a release is published and copied to dl.pctweaker.app, refresh it, commit the file and deploy:

```powershell
node scripts/release-trust.mjs --repo AurelioAvila/redaxa --key redaxa --asset '^Redaxa_.*_x64-setup\.exe$' --out release-trust.json --url https://dl.pctweaker.app/redaxa/vX.Y.Z/Redaxa_X.Y.Z_x64-setup.exe
```

`softwareVersion` in the structured data is filled from `package.json` at build time; prices are read from the same JSON-LD, which `npm test` (`scripts/seo.test.mjs`) checks against the prices shown on the page.
