import assert from 'node:assert/strict';
import {pack} from 'tar-stream';
import {gzipSync} from 'node:zlib';
import {parseRepository,inspectFile,scanRepository,demoReport} from './repository-scanner.js';
assert.deepEqual(parseRepository('https://github.com/owner/repo.git'),{owner:'owner',repo:'repo'});
for(const url of ['http://github.com/a/b','https://github.com.evil.com/a/b','https://user:pass@github.com/a/b','https://github.com/a/b/tree/main','https://127.0.0.1/a/b','https://github.com/a/b?x=1'])assert.throws(()=>parseRepository(url));
const secret='ghp_'+'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789ab';
const matches=inspectFile('config/.env.example','you@example.com\nonboarding@resend.dev\nTOKEN='+secret+'\nTOKEN='+secret,true);
assert.equal(matches.filter(f=>f.disposition==='reference').length,2);
const credentials=matches.filter(f=>f.category==='credentials');assert.equal(credentials.length,2);
assert.ok(credentials.every(f=>f.disposition==='review'));assert.deepEqual(credentials.map(f=>f.line),[3,4]);
assert.ok(!JSON.stringify(inspectFile('config.env','TOKEN='+secret)).includes(secret));
assert.equal(inspectFile('config.env','FROM=actual@company.com')[0].disposition,'review');
assert.equal(inspectFile('config.env','HOST=127.0.0.1')[0].disposition,'reference');
assert.equal(inspectFile('config.env','KEY=pk_live_1234567890abcdefghijkl')[0].disposition,'reference');
assert.equal(demoReport().findings.filter(f=>f.disposition==='review').length,1);

const sha='a'.repeat(40),tree='b'.repeat(40);
const paths=Array.from({length:70},(_,i)=>`nested/folder${i}/config.txt`);
paths.push('.github/workflows/ci.yml','vendor/config.env','build/config.env','package.lock','sample/.env.example');
const tar=pack();const chunks:Buffer[]=[];const collect=(async()=>{for await(const chunk of tar)chunks.push(chunk);})();
for(const path of paths)tar.entry({name:'root/'+path},'TOKEN='+secret);
tar.entry({name:'root/icon.png'},Buffer.from([0,137,80,78,71]));
tar.entry({name:'root/utf16.txt'},Buffer.concat([Buffer.from([255,254]),Buffer.from('TOKEN='+secret,'utf16le')]));
tar.entry({name:'root/link',type:'symlink',linkname:'/outside/secret'});
tar.finalize();await collect;const archive=gzipSync(Buffer.concat(chunks));
const urls:string[]=[];
const fetcher=(async(url:string|URL|Request)=>{
 const u=String(url);urls.push(u);
 if(u.startsWith('https://codeload.github.com/'))return new Response(archive);
 let value:unknown;
 if(u.endsWith('/a/b'))value={private:false,default_branch:'main'};
 else if(u.includes('/commits/'))value={sha,commit:{tree:{sha:tree}}};
 else value={truncated:false,tree:[...paths,'icon.png','utf16.txt','link','export-ignored.txt'].map(path=>({path,type:'blob'})).concat([{path:'submodule',type:'commit'}])};
 return new Response(JSON.stringify(value));
}) as typeof fetch;
const report=await scanRepository('https://github.com/a/b',undefined,fetcher);
assert.equal(report.scanned,paths.length+1);assert.ok(report.scanned>35);
assert.equal(report.skipped,4);assert.ok(report.partial);assert.ok(report.inventoryComplete);
assert.ok(report.coverage.some(f=>f.path==='vendor/config.env'&&f.status==='scanned'));
assert.ok(report.coverage.some(f=>f.path==='export-ignored.txt'&&f.status==='skipped'));
assert.ok(report.coverage.some(f=>f.path==='submodule'&&f.reason.includes('submodule')));
assert.ok(report.findings[0].url?.includes(sha));assert.equal(urls.length,4);
assert.ok(urls.every(u=>u.startsWith('https://api.github.com/repos/a/b')||u===`https://codeload.github.com/a/b/tar.gz/${sha}`));
assert.ok(!JSON.stringify(report).includes(secret));
const corrupt=(async(url:string|URL|Request)=>String(url).startsWith('https://codeload.github.com/')?new Response('invalid gzip'):fetcher(url)) as typeof fetch;
const interrupted=await scanRepository('https://github.com/a/b',undefined,corrupt);
assert.ok(interrupted.partial);assert.equal(interrupted.scanned,0);assert.equal(interrupted.skipped,interrupted.total);
console.log('Passed: example precision, secrets in example files, repeated lines, masking/reveal, 76 text files across all folders, UTF-16, binary/symlink/submodule/missing-file accounting, fixed hosts and corrupt archive.');
// Precision: published demo keys, lockfile names, documentation placeholders.
const supabaseDemo='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const demo=inspectFile('.env.local','SUPABASE_SERVICE_ROLE_KEY='+supabaseDemo).find(f=>f.kind==='secret');
assert.equal(demo?.label,'JWT · public Supabase demo key');assert.equal(demo?.severity,'low');
const forged=supabaseDemo.slice(0,-4)+'AAAA';
assert.equal(inspectFile('.env','KEY='+forged).find(f=>f.kind==='secret')?.severity,'critical','a demo issuer claim without the demo signature stays privileged');
assert.ok(inspectFile('pnpm-lock.yaml','  passwd: 1.0.0\n').every(f=>f.disposition==='reference'));
assert.ok(inspectFile('src/types.ts',"const o = { secret: '<SECRET>' }").filter(f=>f.category==='credentials').every(f=>f.disposition==='reference'));
assert.equal(inspectFile('src/client.ts',"   * password: 'hunter2-x9Q'").find(f=>f.category==='credentials')?.severity,'low');
assert.ok(inspectFile('src/api.ts',"// email: 'example@email.com'").filter(f=>f.kind==='email').every(f=>f.disposition==='reference'));
const sampleUser=inspectFile('tests/fixtures/users.ts',"email: 'maria.bianchi@gmail.com'",true).find(f=>f.kind==='email');
assert.equal(sampleUser?.testValue,true,'Sample data in a fixture is counted, not listed');assert.equal(sampleUser?.value,undefined,'A test value never carries its value');
console.log('Passed precision: Supabase demo keys (signature-checked), lockfile names, documentation placeholders and sample data.');
// Test and example values: counted, never listed, unless shaped like a real key.
for(const path of ['tests/webhook.ts','test/a.js','src/__tests__/a.ts','spec/a.rb','fixtures/hook.json','src/mocks/a.ts','testdata/a.txt','e2e/login.ts','examples/app.py','sample/app.py','demo/app.js','src/hook.test.ts','src/hook.spec.js','pkg/hook_test.go','test_hook.py','conftest.py','src/__snapshots__/a.snap','[history 0123456789ab]/tests/webhook.ts']){
  const found=inspectFile(path,'const secret = "wh-secret-real-9Qz";',true);
  assert.equal(found.length,1,path);assert.equal(found[0].testValue,true,path);assert.equal(found[0].disposition,'reference',path);
  assert.equal(found[0].value,undefined,path);assert.equal(found[0].credential,undefined,path);
}
for(const path of ['src/latest.ts','src/contest/a.ts','src/attestation.ts','docs/setup.md','src/testimonials.ts'])assert.equal(inspectFile(path,'const secret = "wh-secret-real-9Qz";')[0]?.disposition,'review',path+' is not a test location');
// Outside test folders only an explicit marker in the value or variable name counts.
for(const source of ['const secret = "wh-secret-test";','password = "test1234"','password = "dummy-pass-Xq9"','secret = "fake_webhook_9Qz"','password = "changeme-9Qz"','password = "xxx-9Qz"','mockSecret = "secret = r3al-l00king-9Qz"','password = "MySamplePass9"']){
  const found=inspectFile('src/config.ts',source);
  assert.ok(found.length>0&&found.every(f=>f.testValue),source);
}
assert.equal(inspectFile('src/auth.ts','Bearer q8ZrTest9-x7Lm2Vb4Nc6Kd1Pf3')[0]?.disposition,'review','A token body is not split into words to find a marker');
for(const source of ['password = "Xq9-hunter2-prod"','secret = "latest-9Qz-real"'])assert.equal(inspectFile('src/config.ts',source)[0]?.disposition,'review',source);
// Real-looking keys stay listed, at low priority, in a test file.
const liveStripe='sk_live_'+'4eC39HqLyjWDarjtT1zdp7dc9Xk2Lm',liveGitHub='ghp_'+'Q7mZ2kR9vT4wX8yB1nC6dF3gH5jK0pL2sA9e';
for(const [source,label] of [['STRIPE_KEY='+liveStripe,'stripe'],['TOKEN='+liveGitHub,'github'],['AWS_ACCESS_KEY_ID=AKIA'+'Z3MQ7XK2PVN4RT8W','aws']]){
  const found=inspectFile('tests/billing.test.ts',source,true).find(f=>f.category==='credentials')!;
  assert.equal(found.disposition,'review',label);assert.equal(found.severity,'low',label);assert.match(found.label,/ · found in a test file$/,label);assert.ok(!found.testValue,label);
}
assert.equal(inspectFile('src/billing.ts','STRIPE_KEY='+liveStripe)[0].severity,'critical','The same key outside tests keeps its priority');
for(const source of ['STRIPE_KEY=sk_'+'live_1234567890abcdefghijklmnop','STRIPE_KEY=sk_'+'live_TESTkeyQ7mZ2kR9vT4wX8yB1n','TOKEN=ghp_'+'a'.repeat(36),'AWS_ACCESS_KEY_ID=AKIA'+'IOSFODNN7EXAMPLE','STRIPE_KEY=sk_test_'+'51Hx9qLmZp2Rt7Vw4Ky8Nb3Jc6Fd'])
  assert.equal(inspectFile('tests/billing.test.ts',source).find(f=>f.category==='credentials')?.testValue,true,source+' is a test value in a test file');
assert.equal(inspectFile('src/client.ts','const KEY = "sk_test_'+'51Hx9qLmZp2Rt7Vw4Ky8Nb3Jc6Fd"')[0].disposition,'review','A provider test-mode key outside tests stays listed');
const pemBody='MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7'.repeat(5);
assert.equal(inspectFile('tests/tls.test.ts','-----BEGIN PRIVATE KEY-----\n'+pemBody+'\n-----END PRIVATE KEY-----').find(f=>f.kind==='privateKey')?.severity,'low','A complete private key in a test file is listed');
assert.equal(inspectFile('tests/tls.test.ts','-----BEGIN PRIVATE KEY-----\nMIIfake\n-----END PRIVATE KEY-----').find(f=>f.kind==='privateKey')?.testValue,true,'A truncated private-key stub is a test value');
assert.equal(inspectFile('tests/pay.test.ts','card 4111 1111 1111 1111 visa').find(f=>f.kind==='card')?.testValue,true,'Documented test card');
assert.equal(inspectFile('tests/pay.test.ts','card 4929 3812 7765 0143 visa').find(f=>f.kind==='card')?.disposition,'review','Other card numbers in tests stay listed');
assert.equal(inspectFile('tests/pay.test.ts','IBAN IT60X0542811101000000123456').find(f=>f.kind==='iban')?.testValue,true,'An IBAN in a test file is a test value');
// The credentials-only (extended) check keeps test values so they can be counted.
assert.equal(inspectFile('tests/webhook.ts','const secret = "wh-secret-test";',true,true)[0]?.testValue,true);
console.log('Passed test values: test locations and markers counted, real-looking keys listed as found in a test file.');
// Archive-only mode (web): no GitHub API call, commit read from the archive root, lockfiles audited.
const headSha='c'.repeat(40);
const headTar=pack();const headChunks:Buffer[]=[];const headCollect=(async()=>{for await(const chunk of headTar)headChunks.push(chunk);})();
headTar.entry({name:`b-${headSha}/config.env`},'TOKEN='+secret);
headTar.entry({name:`b-${headSha}/package-lock.json`},JSON.stringify({lockfileVersion:3,packages:{'':{},'node_modules/minimist':{version:'1.2.0'}}}));
headTar.finalize();await headCollect;const headArchive=gzipSync(Buffer.concat(headChunks));
const archiveUrls:string[]=[];
const archiveFetcher=(async(url:string|URL|Request)=>{const u=String(url);archiveUrls.push(u);
  if(u==='https://codeload.github.com/a/b/tar.gz/HEAD')return new Response(headArchive);
  if(u==='https://api.osv.dev/v1/querybatch')return Response.json({results:[{vulns:[]}]});
  return new Response('unexpected',{status:500});}) as typeof fetch;
const archiveOnly=await scanRepository('https://github.com/a/b',undefined,archiveFetcher,false,{archiveOnly:true});
assert.ok(!archiveUrls.some(u=>u.startsWith('https://api.github.com/')),'archive-only never calls the GitHub API');
assert.equal(archiveOnly.commit,headSha);
assert.ok(archiveOnly.findings.some(f=>f.url?.includes(`/blob/${headSha}/config.env`)));
assert.equal(archiveOnly.dependencies?.checked,1);
const missing=(async()=>new Response('',{status:404})) as typeof fetch;
await assert.rejects(scanRepository('https://github.com/a/private',undefined,missing,false,{archiveOnly:true}),/Only public GitHub repositories/);
// Files with many matches: line numbers come from a newline index, and a capped
// caller keeps credentials ahead of personal data. Both used to be quadratic.
{
  const started=performance.now();
  const emails=inspectFile('data/users.csv','a@b.cc\n'.repeat(60_000));
  assert.equal(emails.length,60_000);assert.equal(emails.at(-1)?.line,60_000);
  assert.ok(performance.now()-started<20_000,'line numbers must not rescan the file for every match');
  const key='ghp_'+'k'.repeat(36);
  const capped=inspectFile('data/mixed.env','a@b.cc\n'.repeat(20_000)+'TOKEN='+key+'\n',false,false,5);
  assert.equal(capped.length,5);assert.equal(capped[0].kind,'secret');assert.equal(capped[0].line,20_001);
  const minified=inspectFile('dist/app.min.js','x="a@b.cc";'.repeat(40_000));
  assert.equal(minified.length,40_000);assert.ok(minified.every(f=>f.line===1));
}
console.log('Archive-only scan: no API calls, commit from archive root, lockfile audit and private/missing repositories passed.');
