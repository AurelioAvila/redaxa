import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let scanResult;
const sandbox=vm.createContext({
  document:{body:null,addEventListener(){}},window:{setInterval(){}},
  chrome:{runtime:{sendMessage(message,callback){callback({ok:true,result:message.type==='SCAN'?scanResult:{signedIn:false,active:false}});}}}
});
vm.runInContext(fs.readFileSync(new URL('content.js',import.meta.url),'utf8'),sandbox);
const warning=vm.runInContext('apiWarning',sandbox);
const sorted=vm.runInContext('findingPriority',sandbox);
const render=vm.runInContext('renderFindings',sandbox);
const token='ghp_SYNTHETIC_DO_NOT_USE_1234567890';
const findings=[{kind:'email',label:'Email address',severity:'medium',value:'person@company.com'}, {kind:'privateKey',label:'Private key',severity:'critical',value:'SYNTHETIC PEM'}, {kind:'secret',label:'API key or token',severity:'medium',value:token},{kind:'secret',label:'API key or token',severity:'medium',value:token}];
assert.equal(sorted(findings)[0].kind,'secret');
assert.equal(findings[0].kind,'email','Sorting does not mutate the scan/policy input');
const html=warning(findings);
assert.match(html,/1 potential match/);
assert.match(html,/role="alert"/);
assert.ok(!html.includes(token));
assert.ok(!html.includes('person@company.com'));
assert.equal(warning([findings[0]]),'');
const body={innerHTML:'',querySelector(){return null;}};
render(body,{findings,decision:{action:'block',decidedBy:{reason:'Policy <script>'}}},null,()=>{});
assert.ok(body.innerHTML.indexOf('API key or token</b>')<body.innerHTML.indexOf('Email address</b>'));
assert.ok(body.innerHTML.includes('Policy &lt;script&gt;'));
assert.ok(!body.innerHTML.includes(token));
assert.ok(!body.innerHTML.includes('person@company.com'));
let currentModal;
sandbox.document.createElement=()=>({innerHTML:'',remove(){},querySelector(){return {addEventListener(){}};}});
sandbox.document.body={append(modal){currentModal=modal;}};
const gate=vm.runInContext('gate',sandbox);
let sent=0;
scanResult={findings,redactedText:'[SECRET]',decision:{action:'block'}};
await gate({value:'synthetic prompt'},()=>sent++);
assert.match(currentModal.innerHTML,/API key or token found/);
assert.ok(!currentModal.innerHTML.includes('ps-int-send-anyway'),'New alert must not weaken Business block policy');
assert.equal(sent,0);
scanResult={...scanResult,decision:{action:'warn'}};
await gate({value:'synthetic prompt'},()=>sent++);
assert.ok(currentModal.innerHTML.includes('ps-int-send-anyway'));
assert.equal(sent,0,'Warn still requires an explicit choice');
scanResult={findings:[],redactedText:'ordinary prompt'};
await gate({value:'ordinary prompt'},()=>sent++);
assert.equal(sent,1,'No false alert when scan has no findings');
console.log('Extension: API alert, deduplication, priority, escaping and secret-free markup passed.');
