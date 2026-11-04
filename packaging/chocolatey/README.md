# Chocolatey package source

This package downloads the version-specific official Redaxa installer with a
pinned SHA-256. It does not embed application binaries or change the application's
proprietary license. Microsoft Edge WebView2 Runtime is a shared prerequisite.

Installation and removal require administrator access and affect the machine-wide
application. The package does not request prompt checking, repository analysis,
browser-extension installation or account setup. Account and feature limits are
described on the official product website.

Keep the Windows/web prompt transport distinct from free browser-extension checks
and the packaged desktop repository engine. Review the current privacy policy and
the desktop repository runtime documentation before changing those claims.

`choco pack` creates the metadata/script archive without installing the app. For
each release, verify the final installer SHA-256, Aurelio Avila Authenticode
signature and trusted timestamp before changing the URL/checksum/version. Inspect
the archive and submit it once to normal community moderation. Source publication
does not establish approval or a successful native install/uninstall test.
