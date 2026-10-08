# Redaxa 0.4.0

## A clearer privacy workspace

- A refreshed interface brings prompt protection and repository reviews together, with clearer navigation and plan benefits.
- Pro is the new display name for Personal. Existing prices and subscriptions stay the same. Business includes Pro features.

## Repository check for Windows — included with Pro

- Review public GitHub repositories locally in the Windows app, including current files and accessible Git history, branches, tags and commit messages.
- See potential API keys and credentials first, with a recap organized by priority. Repeated matches are grouped; known examples and placeholders are separated from items needing review.
- Follow scan progress and an estimated remaining time that updates as the scope becomes clearer.
- Inspect coverage, reveal individual values when needed, and export or copy a redacted text report. The email action prepares a draft in your mail app; it does not send automatically.
- Read supported archive contents and binary strings, and attempt accessible LFS objects and public GitHub submodules. Coverage gaps remain visible.

Repository check requires Redaxa 0.4.0 or later for Windows and an active Pro or Business plan. The extension opens the web workspace, where you can launch the Windows app. Repository scans run on your PC, not inside the extension or a cloud scanner. Prompt checks remain available on web, Windows and Chrome.

Matches are potential exposures to review, not proof that a key works. Checks do not execute project code, test credentials against providers, perform OCR or decompile binaries, and are not a complete vulnerability audit.

## Privacy and access improvements

- Local prompt history retains counts and categories without keeping prompt excerpts.
- Session-related responses are excluded from the app cache.
- Server-only scanning modules are excluded from public static assets.
- Repository access is verified against the account plan before a scan begins.

Windows release artifacts must pass publisher-signature, timestamp and updater-signature verification before publication.
