import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {promisify} from 'node:util';
import {syncBuiltinESMExports} from 'node:module';
import {channel} from 'node:diagnostics_channel';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
const parent=resolve(tmpdir()),root=await mkdtemp(join(parent,'redaxa-fixture-'));
const original=cp.execFile,exec=promisify(original);
const git=args=>exec('git',['-c','core.hooksPath='+join(root,'no-hooks'),'-c','commit.gpgsign=false','-c','user.name=Fixture','-c','user.email=fixture@example.com',...args],{cwd:root,windowsHide:true});
const key='ghp_'+'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789ab',old=key+'old';
try {
 await git(['init','-q']);await writeFile(join(root,'config.env'),'KEY='+old);await git(['add','.']);await git(['commit','-qm','old fixture']);
 await writeFile(join(root,'config.env'),'KEY='+key);await mkdir(join(root,'src'));await mkdir(join(root,'node_modules'));
 for(let i=0;i<30;i++)await writeFile(join(root,'src',i+'.ts'),'// application fixture\n'.repeat(4000)+'\nKEY='+key);
 await writeFile(join(root,'empty.txt'),'');await writeFile(join(root,'node_modules','fixture.env'),'KEY='+key+'dependency');await writeFile(join(root,'contacts.csv'),'person@company.io\n10.0.0.5');
 await git(['add','.']);await git(['commit','-qm','current fixture']);
 // Redirect only this test repository's clone to a local Git fixture.
 const fixtureUrl='https://github.com/example/focused-fixture';
 const redirect=args=>args.some(arg=>arg===fixtureUrl)?['-c','protocol.file.allow=always',...args.map(arg=>arg===fixtureUrl?pathToFileURL(root).href:arg)]:args;
 const wrapped=(file,args,options,callback)=>original(file,redirect(args),options,callback);
 wrapped[promisify.custom]=(file,args,options)=>exec(file,redirect(args),options);
 cp.execFile=wrapped;syncBuiltinESMExports();
 const {scanFullRepository}=await import('../dist/repository-full.js');
 let blobProcesses=0;const onChild=({process})=>process.once('spawn',()=>{if(process.spawnargs.includes('cat-file')&&process.spawnargs.includes('--batch'))blobProcesses++;});
 channel('child_process').subscribe(onChild);
 const focused=await scanFullRepository('https://github.com/example/focused-fixture',undefined,true);
 channel('child_process').unsubscribe(onChild);
 assert.equal(blobProcesses,1,'Many files must use one Git blob process');
 assert.equal(focused.scanned,33);assert.equal(focused.skipped,1);assert.equal(focused.deep.historyVersions,0);
 assert.ok(focused.findings.length>0&&focused.findings.every(f=>f.value===key));
 const extended=await scanFullRepository('https://github.com/example/focused-fixture',undefined,true,undefined,true);
 assert.ok(extended.findings.some(f=>f.value===old),'Extended scan still finds removed credentials');
 assert.ok(extended.findings.some(f=>f.value===key+'dependency'),'Extended scan includes dependencies');
 console.log('Focused/extended Git fixture passed: current folders, empty/large files, one blob process, credentials only, skipped dependencies and historical secrets.');
} finally {
 cp.execFile=original;syncBuiltinESMExports();
 if(dirname(resolve(root))===parent)await rm(root,{recursive:true,force:true,maxRetries:3});
}
