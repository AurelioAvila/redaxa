import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const listeners={};
vm.runInNewContext(readFileSync(new URL('../service-worker.js',import.meta.url),'utf8'),{self:{location:{origin:'https://redaxa.test'},addEventListener:(name,fn)=>listeners[name]=fn},URL,fetch:()=>Promise.reject(new Error('offline')),caches:{match:async()=>null},Response});
for(const path of ['/api/account','/api/auth/session','/api/repository-progress','/github.html?repo=private','/dist/server.js']) {
 let intercepted=false;listeners.fetch({request:new Request('https://redaxa.test'+path),respondWith:()=>{intercepted=true;}});assert.equal(intercepted,false,path);
}
let intercepted=false;
listeners.fetch({request:new Request('https://redaxa.test/dashboard.html',{headers:{Authorization:'Bearer synthetic'}}),respondWith:()=>{intercepted=true;}});
assert.equal(intercepted,false);
listeners.fetch({request:new Request('https://redaxa.test/dashboard.html'),respondWith:p=>{intercepted=true;void p;}});
assert.equal(intercepted,true);
console.log('Offline cache excludes sessions, account data, repository responses and authenticated requests.');
