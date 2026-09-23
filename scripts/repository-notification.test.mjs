import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {aggregateRepositoryReport,reportToText,apiKeyCandidates} from '../dist/repository-report.js';
import {demoReport,inspectFile} from '../dist/repository-scanner.js';

// Execute the built UI notification functions with a small DOM fixture, never
// test-only hooks in the production app. Existing browser handlers remain inert.
class Element {
  children=[];attributes={};hidden=false;ownText='';
  constructor(tag){this.tag=tag;this.classList={add(){}};}
  set textContent(value){this.ownText=value;this.children=[];}
  get textContent(){return this.ownText+this.children.map(c=>c.textContent).join('');}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
  replaceChildren(...children){this.children=[];this.ownText='';this.append(...children);}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(){}
  remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}
  scrollIntoView(){this.scrolled=true;}
  focus(){this.focused=true;}
  querySelector(selector){return walk(this).find(node=>selector.startsWith('#')?node.id===selector.slice(1):false);}
}
const walk=node=>[node,...node.children.flatMap(walk)];
const body=new Element('body');
const find=(id,node=body)=>node.id===id?node:node.children.map(c=>find(id,c)).find(Boolean);
for(const id of ['repo-form','demo','cancel','scan','status','preview-notice','api-findings','results']){const node=new Element('div');node.id=id;body.append(node);}
const sandbox=vm.createContext({aggregateRepositoryReport,reportToText,apiKeyCandidates,document:{body,createElement:tag=>new Element(tag),getElementById:find,addEventListener(){}},location:{origin:'https://preview.invalid',search:''},URLSearchParams,nativeRepositoryEngine:()=>false});
const source=readFileSync(new URL('../dist/repository-ui.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
vm.runInContext(source,sandbox);
const notify=vm.runInContext('notifyApiKeys',sandbox),reset=vm.runInContext('resetApiNotice',sandbox);
for(const count of [0,-1,NaN,undefined,1.5])notify(count);
assert.equal(find('repository-api-notice'),undefined);
notify(1);
const first=find('repository-api-notice');
assert.match(first.textContent,/1 potential match/);
assert.equal(find('repository-api-message').attributes.role,'alert');
assert.equal(find('repository-api-review').hidden,true,'Results are not offered before they exist');
notify(2);
assert.equal(find('repository-api-notice'),first,'One notification per scan; no stacked alerts');
assert.match(first.textContent,/2 potential matches/);
notify(2,false,true);
assert.equal(find('repository-api-review').hidden,false);
find('repository-api-review').onclick();
assert.equal(find('api-findings').focused,true);
assert.equal(find('api-findings').scrolled,true);
first.children.at(-1).onclick();
notify(3);
assert.equal(find('repository-api-notice'),undefined,'Dismissal survives later progress updates');
reset();notify(1,true,true);
assert.match(find('repository-api-notice').textContent,/Example/);
reset();
assert.equal(find('repository-api-notice'),undefined,'New/cancelled scans clear stale alerts');
console.log('Repository notification: live count, deduplication, dismissal, focus, demo label and reset passed.');
const report=demoReport(true);
report.findings=Array.from({length:25},(_,i)=>inspectFile('file'+i+'.csv',`customer${i}@company.io`,true)[0]);
report.findings.push(...inspectFile('example.txt','you@example.com',true));
report.coverage=Array.from({length:205},(_,i)=>({path:'file'+i,status:'scanned',reason:'Synthetic check'}));
vm.runInContext('render',sandbox)(report);
const results=find('results'), all=()=>walk(results);
assert.equal(all().filter(n=>n.className==='coverage-row').length,100,'Large inventories load one page initially');
all().find(n=>n.tag==='button'&&n.textContent.startsWith('Show more files')).onclick();
assert.equal(all().filter(n=>n.className==='coverage-row').length,200);
assert.equal(all().filter(n=>n.tag==='article').length,13,'Pagination starts with 12 review rows and one reference');
const global=()=>all().find(n=>n.tag==='button'&&/^(Show|Hide) all$/.test(n.textContent));
global().onclick();
assert.equal(all().filter(n=>n.tag==='article').length,26,'Show all includes every additional page');
assert.equal(all().filter(n=>n.className==='masked').some(n=>n.textContent.includes('Value hidden')),false);
assert.equal(all().find(n=>n.className?.includes('reference-group')).open,true,'Show all opens references');
assert.equal(global().textContent,'Hide all');global().onclick();
assert.equal(all().filter(n=>n.className==='masked').every(n=>n.textContent.includes('Value hidden')),true);
all().find(n=>n.tag==='button'&&n.textContent==='Show section').onclick();
assert.equal(global().textContent,'Show all','A section reveal must not claim global visibility');
global().onclick();
assert.equal(all().filter(n=>n.className==='masked').some(n=>n.textContent.includes('Value hidden')),false);
console.log('Global reveal covers pagination and references; section and hide controls stay independent.');
