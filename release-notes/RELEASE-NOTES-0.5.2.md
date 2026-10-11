Redaxa 0.5.2 closes itself before an update replaces its files, so updates no longer stop with "Error opening file for writing".

- Updating from the app, or running a downloaded installer while Redaxa is open, now closes Redaxa and its local repository scanner first, waits until their files are free, and reopens Redaxa when an update from the app finishes.
- Only Redaxa's own processes, started from its installation folder, are closed.
- If an earlier update stopped with that message, click Retry after a few seconds, or close Redaxa and run the latest installer from the website.

Windows installers require verified Aurelio Avila publisher signatures, trusted timestamps and compatible updater signatures before publication.
