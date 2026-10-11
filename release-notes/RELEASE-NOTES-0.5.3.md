Redaxa 0.5.3 stops listing test and example values, such as a webhook secret written for a test, as exposures in the repository check.

- Values in test, fixture, mock, sample and example folders or in test-named files, and values marked as test or placeholder data, are counted on one line ("N test or example values not reported") and are no longer listed, in the app, in the web check and in the downloaded report. Their values are never shown.
- A value in a test file that looks like a real key, such as a live Stripe key, a real-format AWS or GitHub key, or a complete private key, is still listed at low priority and marked "found in a test file".
- If the same value also appears outside the test files, it is listed as before.
- On the light Paper palette, the priority counts and alerts in repository results now use darker colours that are easier to read.
- The separation relies on file paths and value patterns, so it can miss sensitive information; review a report before relying on it.

Windows installers require verified Aurelio Avila publisher signatures, trusted timestamps and compatible updater signatures before publication.
