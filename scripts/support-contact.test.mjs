import assert from "node:assert/strict";
import fs from "node:fs";

const auth = fs.readFileSync(new URL("../auth.ts", import.meta.url), "utf8");
// The public product alias (forwarded to the owner), never a personal inbox.
assert.match(auth, /mailto:redaxa@getcertsprint\.com\?subject=Redaxa%20support/);
assert.doesNotMatch(auth, /canadesino91/, "no personal address in the shipped bundle, not even in a comment");
assert.doesNotMatch(auth, /mailto:aurelio_11@outlook\.it\?subject=Redaxa%20support/);
