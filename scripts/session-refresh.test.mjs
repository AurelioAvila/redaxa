import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const desktop = ts.createSourceFile('auth.ts', fs.readFileSync(new URL('../auth.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest);
const tokenFunction = desktop.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'desktopAccessToken');
const desktopCode = ts.transpileModule(tokenFunction.getText(desktop), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const extensionCode = fs.readFileSync(new URL('../browser-extension/background.js', import.meta.url), 'utf8');

for (const surface of ['desktop', 'extension']) {
  for (const test of [
    {status:200, body:{email:'fixture@example.test'}, expected:'old-access'},
    {status:200, body:{email:'fixture@example.test',access_token:'new-access',refresh_token:'new-refresh',expires_in:3600}, expected:'new-access'},
    {status:503, body:{error:'Unavailable'}, error:true},
    {status:429, body:{error:'Rate limited'}, error:true},
    {status:200, body:{}, error:true},
    {status:200, body:{email:'fixture@example.test',access_token:'incomplete'}, error:true},
    {status:200, body:{email:null}, expected:null, deleted:true},
    {status:401, body:{error:'Unauthorized'}, expected:null, deleted:true}
  ]) {
    let session={email:'fixture@example.test',access_token:'old-access',refresh_token:'old-refresh',expires_at:Date.now()+15_000};
    let deleted=false;
    const fetcher=async (_url,init) => {
      assert.ok(init.signal, `${surface}: refresh has a timeout`);
      return {ok:test.status===200,status:test.status,json:async()=>test.body};
    };
    const context=vm.createContext({AbortSignal,AbortController,URL,setTimeout,clearTimeout,console,
      fetch:fetcher,authFetch:fetcher,apiBase:'',importScripts(){},
      readDesktopSession:async()=>session,saveDesktopSession:async value=>{session=value;},clearDesktopSession:async()=>{deleted=true;},
      chrome:{storage:{local:{get:async()=>({redaxa_session:session}),set:async value=>{session=value.redaxa_session;},remove:async()=>{deleted=true;}}},runtime:{onMessage:{addListener(){}}}}
    });
    vm.runInContext(surface==='desktop'?desktopCode:extensionCode,context);
    const result=vm.runInContext(surface==='desktop'?'desktopAccessToken()':'accessToken()',context);
    if(test.error) await assert.rejects(result); else assert.equal(await result,test.expected);
    assert.equal(deleted,test.deleted===true,`${surface}: HTTP ${test.status} preserves recoverable sessions`);
    if(test.expected==='new-access') assert.equal(session.refresh_token,'new-refresh');
  }
}
console.log('Desktop and extension: near-expiry sessions, rotated tokens, transient failures, malformed responses and invalid sessions passed.');
