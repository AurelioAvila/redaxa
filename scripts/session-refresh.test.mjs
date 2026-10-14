import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const desktop = ts.createSourceFile('auth.ts', fs.readFileSync(new URL('../auth.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest);
const tokenFunction = desktop.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'desktopAccessToken');
const desktopCode = ts.transpileModule(tokenFunction.getText(desktop), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
// The worker is an ES module; its engine imports are not needed for session handling.
const extensionCode = fs.readFileSync(new URL('../browser-extension/background.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '');

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
      chrome:{storage:{local:{get:async()=>({redaxa_session:session}),set:async value=>{session=value.redaxa_session;},remove:async()=>{deleted=true;}}},runtime:{onMessage:{addListener(){}},onInstalled:{addListener(){}}},i18n:{getMessage:key=>key}}
    });
    vm.runInContext(surface==='desktop'?desktopCode:extensionCode,context);
    const result=vm.runInContext(surface==='desktop'?'desktopAccessToken()':'accessToken()',context);
    if(test.error) await assert.rejects(result); else assert.equal(await result,test.expected);
    assert.equal(deleted,test.deleted===true,`${surface}: HTTP ${test.status} preserves recoverable sessions`);
    if(test.expected==='new-access') assert.equal(session.refresh_token,'new-refresh');
  }
}
// A clock moved back after sign-in makes a dead token look alive: after the API
// answers 401, `force` asks the server instead of trusting the local expiry.
for (const surface of ['desktop', 'extension']) {
  for (const force of [false, true]) {
    let session={email:'fixture@example.test',access_token:'old-access',refresh_token:'old-refresh',expires_at:Date.now()+3_600_000};
    let calls=0;
    const fetcher=async () => { calls++; return {ok:true,status:200,json:async()=>({email:'fixture@example.test',access_token:'new-access',refresh_token:'new-refresh',expires_in:3600})}; };
    const context=vm.createContext({AbortSignal,AbortController,URL,setTimeout,clearTimeout,console,
      fetch:fetcher,authFetch:fetcher,apiBase:'',importScripts(){},
      readDesktopSession:async()=>session,saveDesktopSession:async value=>{session=value;},clearDesktopSession:async()=>{},
      chrome:{storage:{local:{get:async()=>({redaxa_session:session}),set:async value=>{session=value.redaxa_session;},remove:async()=>{}}},runtime:{onMessage:{addListener(){}},onInstalled:{addListener(){}}},i18n:{getMessage:key=>key}}
    });
    vm.runInContext(surface==='desktop'?desktopCode:extensionCode,context);
    const token=await vm.runInContext(`${surface==='desktop'?'desktopAccessToken':'accessToken'}(${force})`,context);
    assert.equal(token,force?'new-access':'old-access',`${surface}: force=${force}`);
    assert.equal(calls,force?1:0,`${surface}: a token the clock considers valid is only re-checked when forced`);
  }
}
// A request refused with 401 is sent once more with the server-confirmed token, never twice with the same one.
const retryFunction = desktop.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'authorizedFetch');
const retryCode = ts.transpileModule(retryFunction.getText(desktop), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
for (const surface of ['desktop', 'extension']) {
  for (const refreshed of [true, false]) {
    let session={email:'fixture@example.test',access_token:'old-access',refresh_token:'old-refresh',expires_at:Date.now()+3_600_000};
    const sent=[];
    const fetcher=async (url,init) => {
      if (String(url).endsWith('/api/auth/session')) return {ok:true,status:200,json:async()=>refreshed
        ? {email:'fixture@example.test',access_token:'new-access',refresh_token:'new-refresh',expires_in:3600} : {email:'fixture@example.test'}};
      const auth=(init.headers.Authorization ?? init.headers.authorization);sent.push(auth);
      return auth==='Bearer new-access' ? {ok:true,status:200,json:async()=>({ok:true})} : {ok:false,status:401,json:async()=>({error:'UNAUTHORIZED'})};
    };
    const context=vm.createContext({AbortSignal,AbortController,URL,setTimeout,clearTimeout,console,
      fetch:fetcher,authFetch:fetcher,apiBase:'',importScripts(){},isTauri:()=>true,
      readDesktopSession:async()=>session,saveDesktopSession:async value=>{session=value;},clearDesktopSession:async()=>{},
      chrome:{storage:{local:{get:async()=>({redaxa_session:session}),set:async value=>{session=value.redaxa_session;},remove:async()=>{}}},runtime:{onMessage:{addListener(){}},onInstalled:{addListener(){}}},i18n:{getMessage:key=>key}}
    });
    vm.runInContext(surface==='desktop'?desktopCode+retryCode:extensionCode,context);
    const call=surface==='desktop'?"authorizedFetch('/api/account',{method:'GET',headers:{}}).then(r=>r.status)":"apiRequest('/api/account',undefined,'GET').then(()=>200,e=>e.httpStatus)";
    assert.equal(await vm.runInContext(call,context),refreshed?200:401,`${surface}: refreshed=${refreshed}`);
    assert.deepEqual(sent,refreshed?['Bearer old-access','Bearer new-access']:['Bearer old-access'],`${surface}: no blind resend`);
  }
}
console.log('Desktop and extension: near-expiry sessions, rotated tokens, transient failures, malformed responses, invalid sessions, forced re-checks and the single retry after a 401 passed.');
