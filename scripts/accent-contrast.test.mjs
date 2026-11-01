import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Text on the accent (primary buttons, badges, the avatar, the yearly switch)
// uses one token per surface and must reach WCAG AA (4.5:1) in every theme,
// including the hover, which brightens the accent by up to 10%.
// Workspace and app: --theme-ink. Popup: --on-accent. Page overlay: --rx-on-accent.
const read = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (channels) => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = channels.map(f);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const brighter = (channels) => channels.map((c) => Math.min(255, c * 1.1));
const value = (block, name) => block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
const check = (label, accent, ink) => {
  assert.ok(accent && ink, `${label}: accent and on-accent colours are set`);
  for (const [state, background] of [['accent', rgb(accent)], ['hover', brighter(rgb(accent))]]) {
    const r = ratio(background, rgb(ink));
    assert.ok(r >= 4.5, `${label}: ${ink} on ${state} ${accent} is ${r.toFixed(2)}:1`);
  }
};

const themes = [...read('themes.css').matchAll(/data-theme="(\w+)"\]\{([^}]*)\}/g)];
const listed = read('themes.ts').match(/code:"\w+"/g).length;
assert.equal(themes.length, listed, 'every theme in themes.ts has a palette');
for (const [, name, block] of themes) check(`workspace ${name}`, value(block, '--theme-accent'), value(block, '--theme-ink'));

const popup = read('browser-extension/popup.css');
const popupDark = popup.match(/prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/)[1];
check('popup light', value(popup, '--accent'), value(popup, '--on-accent'));
check('popup dark', value(popupDark, '--accent'), value(popupDark, '--on-accent'));
const overlay = read('browser-extension/content.css');
const overlayBlocks = [...overlay.matchAll(/--rx-accent:\s*(#[0-9a-fA-F]{6});\s*--rx-on-accent:\s*(#[0-9a-fA-F]{6})/g)];
assert.equal(overlayBlocks.length, 2, 'page overlay: light and dark palettes');
overlayBlocks.forEach(([, accent, ink], i) => check(`overlay ${i ? 'dark' : 'light'}`, accent, ink));

// An accent background never sets another text colour than its surface's token.
for (const file of ['app.css', 'brand-system.css', 'dialogs.css', 'plans.css', 'repository.css', 'auth.css', 'browser-extension/popup.css', 'browser-extension/content.css']) {
  for (const [, selector, body] of read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/background(-color)?:\s*var\(--(theme-accent|accent|rx-accent)\)/.test(body)) continue;
    const color = body.match(/(?<![-\w])color:\s*([^;}]+)/)?.[1];
    if (color) assert.match(color, /var\(--(theme-ink|on-accent|rx-on-accent)\)/, `${file}: ${selector.trim()}`);
  }
}
console.log(`Accent contrast: ${themes.length} workspace themes, popup and page overlay at 4.5:1 or more, hover included; one on-accent token per surface.`);
