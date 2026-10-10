import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const early = fs.readFileSync(new URL('../theme-boot.js', import.meta.url), 'utf8');
for (const [saved, expected] of [['{"theme":"carbon"}', 'carbon'], ['null', 'paper'], ['broken', 'paper']]) {
  const root = {dataset:{},classList:{add(){}}};
  vm.runInNewContext(early, {document:{documentElement:root},window:{},localStorage:{getItem:key=>{assert.equal(key,'redaxa.personal-preferences.v1');return saved;}}});
  assert.equal(root.dataset.theme, expected);
}

// Identity must render without waiting for configuration or entitlement responses.
const source = ts.createSourceFile('auth.ts', fs.readFileSync(new URL('../auth.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest);
const boot = source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='boot');
const controls = {account:{classList:{toggle(_name,value){this.open=value;}}},trigger:{},login:{},email:{},closeMenu(){}};
let resolveSession;
let checkingPlan = false;
const root = {removeAttribute(name){this[name]=false;}};
const context = vm.createContext({restoreTheme(){},installDesktopTitlebar(){},installStylesheet(){},isTauri:()=>true,
  accountControls:()=>controls,installDialog:()=>({}),loadConfig:()=>new Promise(()=>{}),
  loadSession:()=>new Promise(resolve=>{resolveSession=resolve;}),
  refreshEntitlement:()=>{checkingPlan=true;return new Promise(()=>{});},loadProfilePhoto:async()=>{},
  window:{addEventListener(){}},document:{documentElement:root},currentEmail:null});
vm.runInContext(ts.transpileModule(boot.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
vm.runInContext('boot()',context);
resolveSession('example@example.test');
await new Promise(resolve=>setImmediate(resolve));
assert.equal(checkingPlan,true);
assert.equal(controls.account.classList.open,true);
assert.equal(controls.trigger.hidden,true);
assert.equal(controls.login.hidden,true);
assert.equal(controls.email.textContent,'example@example.test');
assert.equal(root['data-account-loading'],false);
console.log('Early palette restore and account rendering independent of plan/config passed.');

const dashboard = ts.createSourceFile('dashboard.ts',fs.readFileSync(new URL('../dashboard.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest);
let previewSetup;
function findPreview(node) {
  if (ts.isExpressionStatement(node) && node.getText(dashboard).startsWith("document.querySelectorAll<HTMLButtonElement>('[data-preview]')")) previewSetup=node;
  ts.forEachChild(node,findPreview);
}
findPreview(dashboard);
assert.ok(previewSetup);
const buttons=['personal','credential'].map(value=>({dataset:{preview:value},setAttribute(_key,value){this.pressed=value;},addEventListener(_event,fn){this.click=fn;}}));
const elements={'.compare-original':{},'.compare-redacted':{},'#preview-use':{dataset:{}}};
vm.runInNewContext(ts.transpileModule(previewSetup.getText(dashboard),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{document:{querySelectorAll:()=>buttons},required:key=>elements[key]});
buttons[1].click();
assert.equal(elements['#preview-use'].dataset.sample,'apikey');
assert.match(elements['.compare-redacted'].innerHTML,/\[CREDENTIAL\]/);
assert.equal(buttons[0].pressed,'false');
buttons[0].click();
assert.equal(elements['#preview-use'].dataset.sample,'email');
assert.match(elements['.compare-redacted'].innerHTML,/\[EMAIL\]/);
console.log('Preview scenarios select the corresponding editable sample and redaction example.');
