# Packaged repository engine (0.4.0)

The Windows app runs the repository engine as a private subprocess, not an HTTP
server. Node and the required Git for Windows binaries are packaged resources;
customers do not need to install Node, npm, Git or any scanner dependencies.
Repository files never execute. Existing scanner limits and coverage reporting
remain in force.

## Native bridge

- `repository_scan({url, accessToken, demo})` returns the scanner report. Only one
  check runs at a time. The token is delivered through an anonymous stdin pipe,
  never a command argument, environment variable or log.
- `repository_progress()` returns the latest progress snapshot without finding
  values. The UI polls while a check is active.
- `repository_cancel()` aborts through stdin. Closing the app also cancels; the
  engine handles parent-pipe closure and cleans its own temporary directory.
- The engine verifies `active === true && repositoryAccess === true` against the
  official `/api/account` endpoint before contacting GitHub. Demo output is
  synthetic and does not require a subscription. No cached entitlement grants
  offline access. The production account API must ship before this desktop build.

`redaxa://repository?repo=<encoded public GitHub repository URL>` selects a repo
in the app without automatically starting a check. The handler rejects other
hosts, credentials, paths beyond owner/repo, extra parameters and fragments.
Only the internal application origin is navigated. A single-instance plugin
routes subsequent protocol opens to the running app.

## Build and signing order

1. Run `npm run build` after the final source/package-lock changes.
2. Run `node scripts/build-repository-runtime.mjs` to generate
   `src-tauri/repository-runtime/`. This retrieves the exact Node version's
   official license; runtime binaries come from the build computer's Node/Git
   installations. `REDAXA_BUILD_NODE` and `REDAXA_BUILD_GIT` may specify paths.
3. Review the generated runtime manifest, licenses and publisher signatures.
   Apply the release signing policy to the final binaries before packaging.
4. Set `REDAXA_RUNTIME_PREPARED=1` for the final Tauri build. Its prebuild script
   verifies source freshness and non-binary integrity, then preserves the
   prepared binaries and their signatures. It deliberately fails on stale
   scanner code or package-lock changes; regenerate and sign again in that case.
5. Sign and verify the final application/installer and updater artifacts under
   the normal release procedure. Runtime-manifest hashes describe the original
   preparation inputs; final signed-artifact checks belong to the release record.

The generated resource folder is ignored by Git and excluded from the hosted
web build. Do not remove the packaged Node/Git/dependency license notices or
corresponding upstream source references.

## Validation

- `cargo check` and `cargo test --lib repository::tests` in `src-tauri`.
- `node scripts/repository-runtime.test.mjs` checks synthetic output, Pro denial,
  URL restrictions and isolated Git execution.
- Add `--network` for real GitHub HTTPS transport without an installed Git PATH.
- Add `--clone` for a temporary mirror of the authorized PC Tweaker repository,
  tree enumeration, blob reads and history traversal, with scoped cleanup.

The runtime tests do not assert that a paid user's authentication succeeded or
that all reachable repository contents are free of vulnerabilities.
