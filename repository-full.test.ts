import assert from 'node:assert/strict';
import {printableContent,submoduleURLs,allowedLfsURL,retainFinding,scanFullRepository,focusedSkipReason} from './repository-full.js';
import {channel} from 'node:diagnostics_channel';
import {inspectFile} from './repository-scanner.js';
const key='ghp_'+'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789ab';
const bytes=Buffer.concat([Buffer.from([0,255,1]),Buffer.from('TOKEN='+key),Buffer.from([0,128]),Buffer.from('TOKEN='+key,'utf16le'),Buffer.from([0])]);
const extracted=printableContent(bytes);assert.ok(extracted.binary);assert.ok(extracted.text.includes(key));
assert.ok(inspectFile('app.bin',extracted.text,true).some(f=>f.value===key));
const utf16=printableContent(Buffer.concat([Buffer.from([255,254]),Buffer.from('TOKEN='+key,'utf16le')]));assert.equal(utf16.binary,false);assert.ok(utf16.text.includes(key));
const modules=submoduleURLs('[submodule "a"]\npath = deps/a\nurl = ../other.git\n[submodule "b"]\npath = deps/b\nurl = https://127.0.0.1/private\n[submodule "c"]\npath = deps/c\nurl = git@github.com:public/project.git','owner/main');
assert.equal(modules.get('deps/a'),'owner/other');assert.ok(!modules.has('deps/b'));assert.equal(modules.get('deps/c'),'public/project');
assert.ok(allowedLfsURL('https://media.githubusercontent.com/media/a/b/main/file'));
for(const url of ['http://github.com/file','https://127.0.0.1/file','https://github.com.evil.com/file','https://user:password@github.com/file','file:///C:/private','https://github.com:444/file'])assert.ok(!allowedLfsURL(url));
console.log('Extended scan helpers passed: binary ASCII/UTF-16 extraction, secret detection, relative/public submodules, LFS destination restrictions.');

const example=inspectFile('.env.example','EMAIL=you@example.com',true)[0];
const secret=inspectFile('settings.env','TOKEN='+key,true).find(f=>f.kind==='secret')!;
const retained=[example,example];assert.equal(retainFinding(retained,secret,2),true);
assert.ok(retained.includes(secret));assert.equal(retained.length,2);
assert.equal(retainFinding([secret,secret],example,2),false);
console.log('Result budget preserves credentials ahead of informational matches.');

// A deadline/cancellation must prevent Git spawning, not spawn then kill it.
const spawned=channel('child_process');let children=0;
const countChild=()=>{children++;};spawned.subscribe(countChild);
try {await assert.rejects(scanFullRepository('https://github.com/example/cancelled',AbortSignal.abort()));}
finally {spawned.unsubscribe(countChild);}
assert.equal(children,0,'Cancelled scans must not start another Git process');
console.log('Cancelled scans do not spawn Git.');

const mixed='customer=person@company.io\nIP=10.0.0.5\npassword = process.env.PASSWORD\nKEY='+key+'\npassword = "ActualLiteral-978!"';
const focused=inspectFile('src/config.ts',mixed,true,true);
assert.equal(focused.length,2);assert.ok(focused.every(f=>f.category==='credentials'&&f.disposition==='review'));
assert.ok(focused.some(f=>f.value===key));
assert.equal(inspectFile('.env.example','TOKEN='+key,true,true)[0]?.kind,'secret','Realistic credentials in example files must remain visible');
assert.deepEqual(inspectFile('README.md','secret = your_secret_here\nAPI_KEY=pk_live_1234567890123456',true,true),[]);
const unsubscribe='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({act:'unsubscribe'})).toString('base64url')+'.'+'a'.repeat(32);
assert.deepEqual(inspectFile('email.md',unsubscribe,true,true),[]);
const linkToken='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({id:'fixture',sub:'mail'})).toString('base64url')+'.'+'a'.repeat(32);
assert.deepEqual(inspectFile('email.md','https://example.com/email/unsubscribe?token='+linkToken,true,true),[]);
assert.deepEqual(inspectFile('email.md','Unsubscribe (https://example.com/preferences?token='+linkToken+')',true,true),[]);
assert.deepEqual(inspectFile('email.md','[Unsubscribe](https://example.com/preferences?token='+linkToken+')',true,true),[]);
assert.equal(inspectFile('auth.env','TOKEN='+linkToken,true,true).length,1,'The same JWT outside an unsubscribe URL still needs review');
assert.deepEqual(inspectFile('example.txt','eyJ'+ 'a'.repeat(20)+'.'+'b'.repeat(20)+'.'+'c'.repeat(20),true,true),[],'Malformed JWT-shaped text must not raise an API alert');
console.log('Focused scan retains plausible credentials and omits personal data, public keys, placeholders and unsubscribe links.');
for(const path of ['apps/site/node_modules/pkg/auth.js','.venv/lib/site-packages/example.py','public/movie.mp4','cache/data.zip'])assert.ok(focusedSkipReason(path));
for(const path of ['.env','.env.example','src/nested/auth.ts','.github/workflows/ci.yml','dist/app.js','config/secrets.json','docs/access.md','package-lock.json'])assert.equal(focusedSkipReason(path),undefined);
