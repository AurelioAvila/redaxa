import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {resolve,join,dirname,basename} from 'node:path';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
const runtime=resolve('src-tauri/repository-runtime'),bin=join(runtime,'git/bin');
const system=process.env.SystemRoot||'C:/Windows';
const env={SystemRoot:system,WINDIR:system,PATH:bin+';'+system+'/System32',TEMP:tmpdir(),TMP:tmpdir(),GIT_EXEC_PATH:bin,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.sslBackend',GIT_CONFIG_VALUE_0:'schannel',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'NUL',GIT_TERMINAL_PROMPT:'0'};
function run(request){return new Promise((resolve,reject)=>{
 const child=spawn(join(runtime,'node.exe'),[join(runtime,'engine.cjs')],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
 const timeout=setTimeout(()=>{child.kill();reject(new Error('Runtime did not finish'));},20_000);
 child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 child.on('error',reject);child.on('close',code=>{clearTimeout(timeout);try{assert.equal(code,0);assert.equal(stderr,'');resolve(stdout.trim().split('\n').map(s=>JSON.parse(s)));}catch(e){reject(e);}});
 child.stdin.write(JSON.stringify({type:'scan',...request})+'\n');
});}
const demo=await run({demo:true,url:''});assert.equal(demo.at(-1).type,'result');assert.equal(demo.at(-1).report.demo,true);
const denied=await run({url:'https://github.com/AurelioAvila/pc-tweaker-app'});assert.equal(denied.at(-1).code,'PRO_REQUIRED');
const invalid=await run({url:'https://127.0.0.1/private',accessToken:'not-a-real-token'});assert.equal(invalid.at(-1).code,'SCAN_FAILED');
assert.match(execFileSync(join(bin,'git.exe'),['--version'],{env,encoding:'utf8'}),/git version/);
if(process.argv.includes('--network')){
 const refs=execFileSync(join(bin,'git.exe'),['-c','credential.helper=','-c','protocol.allow=never','-c','protocol.https.allow=always','ls-remote','https://github.com/AurelioAvila/pc-tweaker-app.git','HEAD'],{env,encoding:'utf8',timeout:60_000,windowsHide:true});
 assert.match(refs,/^[a-f0-9]{40}\s+HEAD/);
}
if(process.argv.includes('--clone')){
 const parent=resolve(tmpdir()),temp=mkdtempSync(join(parent,'redaxa-runtime-test-')),repo=join(temp,'repo.git');
 const run=args=>execFileSync(join(bin,'git.exe'),['-c','credential.helper=','-c','core.hooksPath='+join(temp,'no-hooks'),'-c','protocol.allow=never','-c','protocol.https.allow=always',...args],{env,encoding:'utf8',timeout:120_000,windowsHide:true,stdio:['ignore','pipe','pipe']});
 try{
  run(['clone','--mirror','https://github.com/AurelioAvila/pc-tweaker-app.git',repo]);
  const tree=run(['--git-dir='+repo,'ls-tree','-r','--name-only','HEAD']);assert.ok(tree.includes('README.md'));
  const sample=run(['--git-dir='+repo,'rev-parse','HEAD:README.md']).trim();assert.ok(run(['--git-dir='+repo,'cat-file','blob',sample]).length>0);
  const commits=Number(run(['--git-dir='+repo,'rev-list','--all','--count']).trim());assert.ok(commits>1);
  console.log(`Bundled Git mirror, current-tree inventory, blob read and historical traversal passed (${commits} commits).`);
 }finally{if(dirname(resolve(temp))!==parent||!basename(temp).startsWith('redaxa-runtime-test-'))throw new Error('Unsafe test cleanup');rmSync(temp,{recursive:true,force:true,maxRetries:3});}
}
console.log('Bundled runtime: synthetic demo, Pro gate, URL restriction and isolated Git'+(process.argv.includes('--network')?' HTTPS transport':'')+' passed.');
