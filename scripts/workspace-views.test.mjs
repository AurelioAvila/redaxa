import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// The workspace copy is read straight from dashboard.ts, as the other
// workspace tests do, so this needs no DOM.
const source = ts.createSourceFile('dashboard.ts', fs.readFileSync(new URL('../dashboard.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest);
const constant = name => {
  let found;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node.initializer; else ts.forEachChild(node, visit); };
  visit(source);
  assert.ok(found, `${name} not found`);
  const js = ts.transpileModule('(' + found.getText(source) + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(js, { PROMO_WORDS_EN: {} });
};
const languages = ['en', 'it', 'es', 'fr', 'de'];
const base = constant('copyByLanguage');
const views = constant('viewCopyByLanguage');

// Every language carries every key of the new pages, and none is left empty or in English by accident.
const keys = Object.keys(views.en).sort();
for (const language of languages) {
  assert.deepEqual(Object.keys(views[language]).sort(), keys, `${language}: view copy keys differ from English`);
  for (const key of keys) assert.ok(views[language][key].trim(), `${language}.${key} is empty`);
}
for (const key of ['navCheck', 'plansHeadline', 'trustServer', 'faqMissA', 'sevCriticalHint']) {
  for (const language of languages.slice(1)) assert.notEqual(views[language][key], views.en[key], `${language}.${key} is untranslated`);
}

// Every data-i18n key the workspace markup uses exists in all five languages.
const markup = fs.readFileSync(new URL('../dashboard.html', import.meta.url), 'utf8') + fs.readFileSync(new URL('../dashboard.ts', import.meta.url), 'utf8');
const used = new Set([...markup.matchAll(/data-i18n(?:-placeholder|-label|-html)?="([A-Za-z0-9]+)"/g)].map(match => match[1]));
for (const language of languages) {
  for (const key of used) assert.ok(key in base[language] || key in views[language], `${language}: data-i18n key "${key}" has no copy`);
}

// Claims the pages must never make: absolute protection or private repositories.
const english = Object.values(views.en).join(' ');
assert.doesNotMatch(english, /\b(blocks everything|100%|guarantee|never miss|the best)\b/i);
assert.doesNotMatch(english.replace(/Private repositories are not supported/g, ''), /private repositories/i);
assert.match(views.en.trustLimit, /can miss sensitive information/);

// Old dialog links keep landing on the matching page.
const routes = constant('viewForHash');
for (const [hash, view] of [['', 'check'], ['#plans', 'plans'], ['#preferences', 'settings'], ['#api-keys', 'settings'], ['#history', 'activity'], ['#workspace', 'account'], ['#terms', 'terms']]) assert.equal(routes[hash], view, hash);
assert.equal(routes['#account'], undefined, '#account belongs to the sign-in dialog in auth.ts');
console.log(`Workspace views: ${keys.length} keys in ${languages.length} languages, ${used.size} markup keys covered, hash routes ${Object.keys(routes).length}.`);
