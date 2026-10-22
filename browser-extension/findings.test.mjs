import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { getMessage } from './messages.test.mjs';

let scanResult;
const sandbox=vm.createContext({
  document:{body:null,addEventListener(){}},window:{setInterval(){},setTimeout(){},clearTimeout(){}},
  chrome:{i18n:{getMessage},runtime:{id:'test-extension',sendMessage(message,callback){callback({ok:true,result:message.type==='SCAN'?scanResult:{signedIn:true,active:true}});}}}
});
vm.runInContext(fs.readFileSync(new URL('shared.js',import.meta.url),'utf8'),sandbox);
vm.runInContext(fs.readFileSync(new URL('content.js',import.meta.url),'utf8'),sandbox);
const warning=vm.runInContext('apiWarning',sandbox);
const sorted=vm.runInContext('findingPriority',sandbox);
const list=vm.runInContext('findingList',sandbox);
const preview=vm.runInContext('redactedPreview',sandbox);
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

// Grouped rows, credentials first; the redacted preview is escaped and marks placeholders only.
const grouped = list(findings);
assert.ok(grouped.indexOf('API key or token</b> <span class="ps-times">× 2</span>') >= 0, 'Duplicate keys are grouped');
assert.ok(grouped.indexOf('API key or token') < grouped.indexOf('Private key') && grouped.indexOf('Private key') < grouped.indexOf('Email address'));
const shown = preview({ redactedText: 'Mail [EMAIL] <img src=x onerror=alert(1)> key [SECRET]' });
assert.ok(shown.includes('<mark>[EMAIL]</mark>') && shown.includes('<mark>[SECRET]</mark>'));
assert.ok(!shown.includes('<img'), 'Prompt text is escaped in the preview');
sandbox.chrome.i18n.getMessage = (key, subs) => getMessage(key, subs, 'it');
assert.ok(list([{ kind: 'iban', label: 'IBAN' }, { kind: 'card', label: 'Card number' }]).includes('Numero di carta'), 'Labels follow the interface language');
const italianKey = list([{ kind: 'secret', label: 'API key or token', credential: { service: 'OpenAI (probable)', type: 'Project API key', response: 'Revoke or rotate if genuine', evidence: 'x', guidance: 'y' } }]);
assert.ok(italianKey.includes('OpenAI (probabile) · Chiave API o token') && italianKey.includes('Revocala o ruotala se è autentica'), 'Credential advice is translated');
sandbox.chrome.i18n.getMessage = getMessage;
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
scanResult={findings:[],redactedText:'synthetic prompt',decision:{action:'block'}};
await gate({value:'synthetic prompt'},()=>sent++);
assert.equal(sent,0,'A block decision wins even when the findings list is empty');
assert.ok(!currentModal.innerHTML.includes('ps-int-send-anyway'));
scanResult={...scanResult,decision:{action:'warn'}};
scanResult.findings=findings;
await gate({value:'synthetic prompt'},()=>sent++);
assert.ok(currentModal.innerHTML.includes('ps-int-send-anyway'));
assert.equal(sent,0,'Warn still requires an explicit choice');
scanResult={findings:[],redactedText:'ordinary prompt'};
await gate({value:'ordinary prompt'},()=>sent++);
assert.equal(sent,1,'No false alert when scan has no findings');
// A delayed answer must not authorize a newer prompt, or overwrite newer edits.
const handlers=new Map();
sandbox.document.createElement=()=>({innerHTML:'',remove(){},querySelector(selector){return {addEventListener(_event,handler){handlers.set(selector,handler);}};}});
let notices=0;
sandbox.psToast=()=>{notices++;};
const composer={value:'checked prompt'};
let finishScan;
sandbox.chrome.runtime.sendMessage=(message,callback)=>{
  if(message.type==='SCAN')finishScan=()=>callback({ok:true,result:{findings:[],redactedText:'checked prompt'}});
};
const pending=gate(composer,()=>sent++);
await Promise.resolve();
composer.value='edited while checking';
finishScan();
await pending;
assert.equal(sent,1,'Changed text is never automatically sent under an old scan');
assert.equal(notices,1);
sandbox.chrome.runtime.sendMessage=(message,callback)=>callback({ok:true,result:{findings,redactedText:'[SECRET]',decision:{action:'warn'}}});
await gate(composer,()=>sent++);
composer.value='edited after results';
handlers.get('#ps-int-send-anyway')();
assert.equal(sent,1,'Send anyway applies only to the text reviewed');
handlers.get('#ps-int-fix')();
assert.equal(composer.value,'edited after results','Stale redaction cannot overwrite new edits');
const manualBody={innerHTML:'',querySelector(selector){return {addEventListener(_event,handler){handlers.set(selector,handler);}};}};
render(manualBody,{findings,redactedText:'[SECRET]',checkedText:'old prompt'},composer,()=>{});
handlers.get('#redaxa-use-redacted')();
assert.equal(composer.value,'edited after results','Manual check also protects newer edits');
assert.equal(vm.runInContext('sameCheckedPrompt',sandbox)({value:'checked',isConnected:false},'checked'),false,'Replaced editors cannot reuse an old scan');
console.log('Extension: API alert, deduplication, priority, escaping and secret-free markup passed.');
// Manual checks run straight away and say where they ran.
const ui = new Map();
const uiNode = () => ({ innerHTML: '', handlers: {}, classList: { add() {}, remove() {} }, setAttribute() {},
  addEventListener(event, handler) { this.handlers[event] = handler; },
  querySelector(selector) { if (!ui.has(selector)) ui.set(selector, uiNode()); return ui.get(selector); }
});
let guestScans = 0, lastScan;
sandbox.document.createElement = uiNode;
sandbox.document.body = { append(node) { ui.set(`#${node.id}`, node); } };
sandbox.findComposer = () => ({ value: 'Synthetic guest text' });
sandbox.chrome.runtime.sendMessage = (message, callback) => {
  if (message.type === 'SCAN') { guestScans++; lastScan = message; callback({ ok: true, result: { findings, redactedText: '[SECRET]', engine: 'local' } }); }
  else callback({ ok: true, result: { signedIn: false } });
};
vm.runInContext('buildUI()', sandbox);
await ui.get('#redaxa-check-btn').handlers.click();
assert.equal(guestScans, 1, 'one click, one check');
assert.equal(lastScan.requireAccount, false, 'a visitor is checked on the device');
assert.match(ui.get('#redaxa-body').innerHTML, /Checked on this device/);
assert.ok(!ui.get('#redaxa-body').innerHTML.includes(token));
console.log('Manual check: runs locally on one click and says so, without exposing values.');
// Narrow Gemini (929 x 923, measured live): Send sits where the check button
// used to be. The button moves above the composer card, and back down once
// the card no longer reaches the right edge.
{
  const style = {}, panelStyle = {};
  const send = { offsetHeight: 40, getBoundingClientRect: () => ({ left: 745, right: 785, top: 800, bottom: 840 }) };
  const card = { contains: node => node === send, getBoundingClientRect: () => ({ left: 135, right: 795, top: 702, bottom: 857, height: 155 }) };
  const editor = { parentElement: card, contains: node => node === editor, getBoundingClientRect: () => ({ left: 160, right: 770, top: 715, bottom: 790, height: 75 }) };
  const saved = { find: sandbox.findComposer, get: sandbox.document.getElementById, all: sandbox.document.querySelectorAll };
  sandbox.findComposer = () => editor;
  Object.assign(sandbox.window, { innerWidth: 929, innerHeight: 923 });
  sandbox.document.getElementById = id => id === 'redaxa-check-btn' ? { offsetHeight: 34, offsetWidth: 170, style } : id === 'redaxa-panel' ? { style: panelStyle } : null;
  sandbox.document.querySelectorAll = selector => selector === '.send-button button' ? [send] : [];
  vm.runInContext('placeCheckButton()', sandbox);
  assert.equal(style.bottom, '233px', 'the button sits 12 px above the composer card');
  assert.equal(panelStyle.bottom, '281px', 'the panel opens above the moved button');
  sandbox.window.innerWidth = 1600;
  vm.runInContext('placeCheckButton()', sandbox);
  assert.equal(style.bottom, '88px', 'back to the usual place when nothing is covered');
  Object.assign(sandbox, { findComposer: saved.find });
  Object.assign(sandbox.document, { getElementById: saved.get, querySelectorAll: saved.all });
}
console.log('Check button: moves off Send and the composer on narrow layouts.');
// Too long to check: free use may send it unchecked, a plan account may not.
sandbox.document.createElement=()=>({innerHTML:'',remove(){},querySelector(selector){return {addEventListener(_e,h){handlers.set(selector,h);}};}});
sandbox.document.body={append(m){currentModal=m;}};
let unchecked=0;
sandbox.chrome.runtime.sendMessage=(message,callback)=>callback({ok:true,result:message.type==='STATUS'?{signedIn:false}:{findings:[],redactedText:''}});
vm.runInContext('statusCheckedAt = 0',sandbox);
const long={value:'x'.repeat(20001)};
await gate(long,()=>unchecked++);
assert.match(currentModal.innerHTML,/longer than 20,000 characters/);
handlers.get('#ps-int-send-unchecked')();
assert.equal(unchecked,1,'free use can send a too-long prompt without a check');
sandbox.chrome.runtime.sendMessage=(message,callback)=>callback({ok:true,result:message.type==='STATUS'?{signedIn:true,active:true}:{findings:[],redactedText:''}});
vm.runInContext('statusCheckedAt = 0',sandbox);
await gate(long,()=>unchecked++);
assert.ok(!currentModal.innerHTML.includes('ps-int-send-unchecked'),'a plan account cannot skip team rules');
// A check dismissed while it runs never sends.
let finish;
sandbox.chrome.runtime.sendMessage=(message,callback)=>{ if(message.type==='SCAN') finish=()=>callback({ok:true,result:{findings:[],redactedText:'later'}}); else callback({ok:true,result:{signedIn:false}}); };
vm.runInContext('statusCheckedAt = 0',sandbox);
let late=0;
const pendingGate=gate({value:'later'},()=>late++);
for(let i=0;i<10;i++) await Promise.resolve();
vm.runInContext('dismissModal()',sandbox);
finish(); await pendingGate;
assert.equal(late,0,'a dismissed check does not send');
// Server codes become words the user can act on.
assert.match(vm.runInContext('errorText',sandbox)({httpStatus:402,message:'TRIAL_REQUIRED'}),/plan could not be confirmed/);
assert.match(vm.runInContext('errorText',sandbox)({httpStatus:401,message:'UNAUTHORIZED'}),/Sign in again/);
console.log('Dialog: too-long prompts, dismissal during a check and readable server errors passed.');

