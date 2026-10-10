import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const elements = new Map();
for (const id of ['prompt','findings','safe-output','redacted','result-title','result-copy','scan','sample','copy','pro-plan-price','business-plan-price','pro-plan-tag']) {
  elements.set('#'+id,{value:'',textContent:'',innerHTML:'',className:'',style:{},handlers:{},addEventListener(event,fn){this.handlers[event]=fn;}});
}
let authCalls=0, scans=0, scanOutcome=null;
const billingButtons=['monthly','yearly'].map(billing=>({dataset:{billing},handlers:{},attributes:{},addEventListener(event,fn){this.handlers[event]=fn;},setAttribute(key,value){this.attributes[key]=value;}}));
const checkoutButtons=['personal','business'].map(plan=>({dataset:{plan,interval:'yearly'}}));
const document={querySelector:s=>elements.get(s),querySelectorAll:s=>s==='[data-billing]'?billingButtons:s==='[data-plan]'?checkoutButtons:[],addEventListener(){}};
// scanOutcome is null while the demo path is under test: any scan there is a
// bug. The anonymous-scan cases below set it to the result the server would
// have produced.
const window={promptShieldAuth:{hasAccess:()=>false,requestAccess:()=>authCalls++,scanPrompt:async()=>{scans++;if(!scanOutcome)throw Error('Demo must not scan');if(scanOutcome.error)throw Error(scanOutcome.error);return scanOutcome;}}};
const realPromo=await import('../dist/promo.js');
let showPromo=null;const placed=[];
elements.set('#pricing .billing-switch',{before:node=>placed.push(node)});
// The real price formatting, with the network and the banner stubbed: the
// harness turns the offer on and off by hand.
const promo={...realPromo,mountPromo:(place,words,lang,onChange)=>{place({});assert.equal(words().kicker,'Halloween offer');assert.equal(lang(),'en');showPromo=onChange;return {relabel(){}};}};
const script=readFileSync(new URL('../dist/landing.js',import.meta.url),'utf8')
  .replace(/import \{ track \} from ['"]\.\/growth.js['"];?/, 'const track=()=>{};')
  .replace(/import \{[^}]*\} from ['"]\.\/promo.js['"];?/, 'const { PROMO_WORDS_EN, mountPromo, promoPriceHtml } = promo;');
new Function('document','window','promo',script)(document,window,promo);

for (const [index,interval,personal,business] of [[0,'monthly','€7.99','€14.99'],[1,'yearly','€79.90','€149.90']]) {
  billingButtons[index].handlers.click();
  assert.ok(elements.get('#pro-plan-price').innerHTML.startsWith(personal));
  assert.ok(elements.get('#business-plan-price').innerHTML.startsWith(business));
  assert.equal(billingButtons[index].attributes['aria-pressed'],'true');
  assert.equal(billingButtons[1-index].attributes['aria-pressed'],'false');
  assert.ok(checkoutButtons.every(button=>button.dataset.interval===interval),'checkout must match the displayed billing period');
}
assert.match(elements.get('#pro-plan-tag').textContent,/Recommended/);
// A running offer strikes the lawful reference and names the renewal; its end restores the list prices.
const offers=[['personal','yearly',7990,3900,false],['business','yearly',14990,7400,true],['personal','monthly',799,399,false],['business','monthly',1499,700,true]].map(([plan,interval,regular,price,perSeat])=>({plan,interval,regular,reference:regular,price,perSeat}));
const view={promo:{offers},remaining:60_000,offer:(plan,interval)=>offers.find(o=>o.plan===plan&&o.interval===interval)??null};
showPromo(view);
assert.equal(placed.length,1,'one banner, before the billing switch');
assert.ok(elements.get('#pro-plan-price').innerHTML.startsWith('<s class="rx-was">€79.90</s> €39 <small>/ year</small>'));
assert.match(elements.get('#pro-plan-price').innerHTML,/First year, then €79\.90 a year/);
assert.match(elements.get('#business-plan-price').innerHTML,/€149\.90<\/s> €74 <small>\/ user \/ year<\/small>.*50%/);
billingButtons[0].handlers.click();
assert.ok(elements.get('#pro-plan-price').innerHTML.startsWith('<s class="rx-was">€7.99</s> €3.99'));
assert.match(elements.get('#business-plan-price').innerHTML,/First month, then €14\.99 per user a month/);
showPromo({promo:null,remaining:0,offer:()=>null});
assert.ok(elements.get('#pro-plan-price').innerHTML.startsWith('€7.99'));
billingButtons[1].handlers.click();
assert.ok(elements.get('#pro-plan-price').innerHTML.startsWith('€79.90'));
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
