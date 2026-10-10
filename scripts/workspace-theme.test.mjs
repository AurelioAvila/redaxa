import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyTheme, restoreTheme, themes } from '../dist/themes.js';

globalThis.document = { documentElement: { dataset: {} } };
let saved = null;
globalThis.localStorage = { getItem: () => saved, setItem: () => assert.fail('Restoring a theme must not overwrite preferences') };
// Paper is the default only for people who never chose a palette; the earlier
// default, Petrol & Copper, stays for everyone who has it saved.
for (const [value, expected] of [[null, 'paper'], ['{}', 'paper'], ['null', 'paper'], ['invalid json', 'paper'], ['{"theme":"missing"}', 'paper'], ['{"theme":"ocean"}', 'ocean'], ['{"theme":"graphite"}', 'graphite']]) {
  saved = value;
  restoreTheme();
  assert.equal(document.documentElement.dataset.theme, expected);
}
for (const { code } of themes) {
  saved = JSON.stringify({ theme: code });
  restoreTheme();
  assert.equal(document.documentElement.dataset.theme, code);
}
applyTheme('unknown');
assert.equal(document.documentElement.dataset.theme, 'paper');

const css = readFileSync(new URL('../themes.css', import.meta.url), 'utf8');
const luminance = hex => hex.match(/[\da-f]{2}/gi).map(value => parseInt(value, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
for (const { code } of themes) {
  const palette = css.match(new RegExp(`html\\[data-theme="${code}"\\]\\{([^}]+)`))[1];
  const token = name => palette.match(new RegExp(`--theme-${name}:(#[\\da-f]+)`))[1];
  for (const surface of ['bg', 'surface', 'inset', 'hover']) {
    for (const foreground of ['text', 'muted']) assert.ok(contrast(token(foreground), token(surface)) >= 4.5, `${code}: ${foreground} on ${surface}`);
  }
  assert.ok(contrast(token('accent'), token('ink')) >= 4.5, `${code}: primary button contrast`);
  assert.ok(contrast(token('muted'), token('bg')) >= 3, `${code}: prompt field boundary`);
  assert.ok(contrast(token('accent'), token('bg')) >= 3, `${code}: prompt focus indicator`);
}
const brand = readFileSync(new URL('../brand-system.css', import.meta.url), 'utf8');
assert.match(brand, /textarea::placeholder[^}]+color:var\(--theme-muted\);opacity:1/, 'Prompt placeholders must use readable theme colors without fading');
assert.match(brand, /\.ps-avatar-btn\{[^}]*width:44px;height:44px[^}]+place-items:center/, 'Account control must stay centered with a 44px target');
assert.match(brand, /\.ps-avatar-btn \.ps-avatar\{width:36px;height:36px;border-radius:50%/, 'Account photos must fill the circular inset');
console.log('Workspace themes: defaults, saved selections, invalid storage and all palette text contrasts passed.');
