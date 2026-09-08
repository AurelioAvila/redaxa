import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const elements = new Map();
for (const id of ['prompt','findings','safe-output','redacted','result-title','result-copy','scan','sample','copy']) {
  elements.set('#'+id,{value:'',textContent:'',innerHTML:'',className:'',style:{},handlers:{},addEventListener(event,fn){this.handlers[event]=fn;}});
}
let authCalls=0, scans=0;
const document={querySelector:s=>elements.get(s),addEventListener(){}};
const window={promptShieldAuth:{hasAccess:()=>false,requestAccess:()=>authCalls++,scanPrompt:()=>{scans++;throw Error('Demo must not scan');}}};
const script=readFileSync(new URL('../dist/landing.js',import.meta.url),'utf8').replace(/import \{ track \} from ['"]\.\/growth.js['"];?/, 'const track=()=>{};');
new Function('document','window',script)(document,window);
elements.get('#sample').handlers.click();
assert.equal(authCalls,0);
assert.equal(scans,0);
assert.equal(elements.get('#safe-output').style.display,'block');
assert.match(elements.get('#result-copy').textContent,/Illustrative demo/);
assert.doesNotMatch(elements.get('#redacted').textContent,/maria\.rossi|192\.168|demo-secret/);
elements.get('#prompt').value='A different prompt with fictional details';
elements.get('#prompt').handlers.input();
assert.equal(elements.get('#safe-output').style.display,'none');
elements.get('#scan').handlers.click();
assert.equal(authCalls,1);
assert.equal(scans,0);
console.log('Demo gives an immediate result without auth or scanning; edited text is not treated as checked.');
