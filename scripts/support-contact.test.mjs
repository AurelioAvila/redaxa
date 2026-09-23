import assert from "node:assert/strict";
import fs from "node:fs";

const auth = fs.readFileSync(new URL("../auth.ts", import.meta.url), "utf8");
assert.match(auth, /mailto:canadesino91@gmail\.com\?subject=Redaxa%20support/);
assert.doesNotMatch(auth, /mailto:aurelio_11@outlook\.it\?subject=Redaxa%20support/);
