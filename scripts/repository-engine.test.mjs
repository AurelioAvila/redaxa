import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const engine=new URL('./repository-engine.mjs',import.meta.url);
async function run(request, inject='') {
 const child=spawn(process.execPath,[...(inject?['--import','data:text/javascript,'+encodeURIComponent(inject)]:[]),fileURLToPath(engine)],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 let output='',stderr='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
 const timer=setTimeout(()=>child.kill(),10000);
 const ended=new Promise(resolve=>child.on('close',resolve));
 child.stdin.on('error',()=>{});
 if(request)child.stdin.write(JSON.stringify(request)+'\n');
 const code=await ended;clearTimeout(timer);
 return {code,stderr,messages:output.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)),output};
}
const demo=await run({type:'scan',demo:true});assert.equal(demo.code,0);assert.equal(demo.messages.at(-1)?.type,'result');
const gated=await run({type:'scan',url:'https://github.com/example/example'});assert.equal(gated.messages.at(-1)?.code,'PRO_REQUIRED');
const failed=await run(null,"setTimeout(()=>{throw Object.assign(new Error('SENSITIVE_DIAGNOSTIC_TEST'),{code:'EPIPE'})},200)");
assert.equal(failed.code,1);assert.equal(failed.messages.at(-1)?.code,'ENGINE_EPIPE');assert.ok(!failed.output.includes('SENSITIVE_DIAGNOSTIC_TEST'));assert.equal(failed.stderr,'');
console.log('Engine protocol: demo, entitlement gate and safe terminal pipe error passed.');
