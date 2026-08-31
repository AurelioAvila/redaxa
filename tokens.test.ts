// Design token tests: contrast against the surface each token sits on, and one
// brand accent across every page.
//
// Redaxa's pages each carry their own <style> block and, historically, their
// own vocabulary: the landing calls the text colour --ink, the dashboard calls
// it --text, and the legal pages use --ink for the *background* and --paper for
// the text. That is why the map below is written out by hand instead of
// inferred — the names do not line up, so a clever guess would quietly check
// the wrong pair and pass.
//
// Contrast is the part worth automating. --dim sat at 3.71:1 on the landing
// page across twelve rules, all of them between 10.5px and 13px, none large
// enough for the 3:1 allowance. Nothing about the page looked broken; the ratio
// is simply not something you can see.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// WCAG 2.1 AA for body text. The large-text allowance of 3:1 needs 24px, or
// 18.66px bold, and none of these tokens are used that big.
const AA_BODY_TEXT = 4.5;

/// Which token holds the surface, and which tokens are painted on it. Written
/// per page because the three page families never agreed on names.
const SURFACES: Record<string, { background: string; text: string[] }> = {
  "index.html": { background: "bg", text: ["ink", "mut", "dim"] },
  "dashboard.html": { background: "bg", text: ["text", "text-2", "text-3"] },
  "privacy.html": { background: "ink", text: ["paper", "muted"] },
  "terms.html": { background: "ink", text: ["paper", "muted"] },
  "api-docs.html": { background: "ink", text: ["paper", "muted"] }
};

/// The brand accent, whatever each page decided to call it.
const ACCENT: Record<string, string> = {
  "index.html": "acid",
  "dashboard.html": "accent",
  "privacy.html": "acid",
  "terms.html": "acid",
  "api-docs.html": "acid"
};

function tokensOf(page: string): Map<string, string> {
  const html = readFileSync(page, "utf8");
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join("\n");
  const found = new Map<string, string>();
  for (const block of styles.matchAll(/:root\s*\{([\s\S]*?)\}/g)) {
    for (const [, name, value] of block[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      found.set(name, value.trim());
    }
  }
  return found;
}

function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map(c => c + c).join("") : h;
  const channels = [0, 2, 4].map(i => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
  const [light, dark] = x > y ? [x, y] : [y, x];
  return (light + 0.05) / (dark + 0.05);
}

// --- every text token clears AA on its own surface ---------------------------
for (const [page, surface] of Object.entries(SURFACES)) {
  const tokens = tokensOf(page);

  const background = tokens.get(surface.background);
  assert.ok(
    background?.startsWith("#"),
    `${page}: --${surface.background} is missing, so the map above no longer describes this page`
  );

  for (const name of surface.text) {
    const colour = tokens.get(name);
    assert.ok(colour?.startsWith("#"), `${page}: --${name} is missing`);

    const ratio = contrast(colour!, background!);
    assert.ok(
      ratio >= AA_BODY_TEXT,
      `${page}: --${name} (${colour}) on --${surface.background} (${background}) ` +
        `is ${ratio.toFixed(2)}:1, under ${AA_BODY_TEXT}:1`
    );
  }
}

// --- one accent, five pages --------------------------------------------------
{
  const values = new Map<string, string>();
  for (const [page, name] of Object.entries(ACCENT)) {
    const value = tokensOf(page).get(name);
    assert.ok(value, `${page}: --${name} is missing`);
    values.set(page, value!.toLowerCase());
  }

  const distinct = new Set(values.values());
  assert.equal(
    distinct.size,
    1,
    `the accent differs between pages: ${[...values].map(([p, v]) => `${p}=${v}`).join(", ")}`
  );
}

console.log("tokens.test.ts: ok");
