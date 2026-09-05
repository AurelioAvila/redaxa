# Windows release signing

The release signing configuration uses Aurelio Avila's Certum certificate from
the current user's Windows certificate store. Its private key stays with the
signing provider; the thumbprint in the configuration is public information.

Connect SimplySign Desktop before building. Windows SDK SignTool must be
installed, and the existing Tauri updater signing key must be available through
the normal release environment. Authenticode and Tauri updater signatures serve
different purposes; both are required for a signed automatic update.

From the repository root:

```powershell
npm ci
npm run check
npm test
npm run tauri -- build --config src-tauri/tauri.signing.conf.json
```

The override leaves ordinary development builds independent of the release
certificate. The release build must stop if the certificate or private key
cannot be accessed. Never remove the signing override to work around a release
signing failure.

Before publishing, verify the application executable and both generated
installers with `signtool verify /pa /all /v`. Check the expected publisher,
certificate chain and timestamp. Generate `latest.json` using the existing
`scripts/make-latest-json.mjs` only after the final bundles and their updater
signatures have been produced.

Use a new release version for signed packages. Do not overwrite an existing
release asset: changing its bytes invalidates its updater signature and any
WinGet checksum already submitted. Update WinGet from the final uploaded asset.

The v0.3.3 release build uses this configuration. Verify each new release
independently before publishing; a previous successful signature does not
establish the status of a later build.
