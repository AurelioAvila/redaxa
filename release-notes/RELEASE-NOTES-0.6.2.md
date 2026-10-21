Redaxa 0.6.2 checks files with long runs of spaces or tabs in a fraction of a second, and can receive updates from our own download server, dl.pctweaker.app, as well as from GitHub.

- Faster checks on unusual files: a file or prompt with a very long run of spaces or tabs could hold a check for several seconds. It now takes milliseconds, and settings with long names, such as `PRODUCTION_DATABASE_PASSWORD=...`, are still found.
- Updates from dl.pctweaker.app: when Redaxa checks for a new version, it asks dl.pctweaker.app first. If that server has nothing to offer, it asks GitHub, as before.
- An update is installed only when it carries Redaxa's update signature and its signed file name and version match the release on offer. Redaxa accepts it only from the Redaxa release folder on dl.pctweaker.app or the Redaxa release on GitHub.
- Version 0.6.1 was prepared but never published. Its changes are part of this release.

Windows installers require verified Aurelio Avila publisher signatures, trusted timestamps and compatible updater signatures before publication.
