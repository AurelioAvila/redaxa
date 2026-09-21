import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

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
}
const body=new Element('body');
const find=(id,node=body)=>node.id===id?node:node.children.map(c=>find(id,c)).find(Boolean);
for(const id of ['repo-form','demo','cancel','scan','status','preview-notice','api-findings']){const node=new Element('div');node.id=id;body.append(node);}
const sandbox=vm.createContext({document:{body,createElement:tag=>new Element(tag),getElementById:find,addEventListener(){}},location:{origin:'https://preview.invalid',search:''},URLSearchParams,nativeRepositoryEngine:()=>false});
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
