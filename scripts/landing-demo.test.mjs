import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const elements = new Map();
for (const id of ['prompt','findings','safe-output','redacted','result-title','result-copy','scan','sample','copy']) {
  elements.set('#'+id,{value:'',textContent:'',innerHTML:'',className:'',style:{},handlers:{},addEventListener(event,fn){this.handlers[event]=fn;}});
}
let authCalls=0, scans=0, scanOutcome=null;
const document={querySelector:s=>elements.get(s),addEventListener(){}};
// scanOutcome is null while the demo path is under test: any scan there is a
// bug. The anonymous-scan cases below set it to the result the server would
// have produced.
const window={promptShieldAuth:{hasAccess:()=>false,requestAccess:()=>authCalls++,scanPrompt:async()=>{scans++;if(!scanOutcome)throw Error('Demo must not scan');if(scanOutcome.error)throw Error(scanOutcome.error);return scanOutcome;}}};
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
// A visitor with no account gets a real scan, not a signup dialog: the
// server hands out a few free checks a day (anonymousDailyScans in
// api/scan.ts) and is the only thing allowed to decide the gate. The client
// used to refuse the request itself, which meant the first genuine prompt
// anyone tried bounced off a modal.
scanOutcome={findings:[{label:'Email',value:'a@b.c -> [email]'}],redactedText:'[email]'};
elements.get('#scan').handlers.click();
await new Promise((resolve)=>setImmediate(resolve));
assert.equal(scans,1,'an anonymous visitor must reach the server');
assert.equal(authCalls,0,'no signup dialog while free checks remain');
assert.equal(elements.get('#safe-output').style.display,'block');

// Quota spent: the server answers TRIAL_REQUIRED and only then is the
// account asked for.
scanOutcome={error:'TRIAL_REQUIRED'};
elements.get('#prompt').value='Another prompt once the quota is gone';
elements.get('#prompt').handlers.input();
elements.get('#scan').handlers.click();
await new Promise((resolve)=>setImmediate(resolve));
assert.equal(scans,2);
assert.equal(authCalls,1,'the dialog opens when the server says the quota is spent');
console.log('Demo answers without scanning; an anonymous visitor gets a real scan, and the signup dialog waits for the server to say the quota is spent.');
