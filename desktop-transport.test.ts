import assert from "node:assert/strict";
import { usesDesktopPreviewTransport } from "./desktop.js";

// Every supported dev port must use the guarded proxy. Packaged clients and
// ordinary browser pages must never send native session headers to it.
for (const port of [4173, 4186, 4190, 4299]) {
  assert.equal(usesDesktopPreviewTransport(true, `http://127.0.0.1:${port}`), true);
  assert.equal(usesDesktopPreviewTransport(false, `http://127.0.0.1:${port}`), false);
}
for (const origin of ["https://tauri.localhost", "tauri://localhost", "https://promptshield-beta.vercel.app", "http://127.0.0.1.attacker.test:4190", "https://127.0.0.1:4190", "invalid"]) {
  assert.equal(usesDesktopPreviewTransport(true, origin), false);
}
console.log("Desktop development account routing passed.");
