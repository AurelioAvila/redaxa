import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Run the actual boot function with a minimal DOM and intercepted API, so the
// test checks link handling and registered user actions without a live account.
const source = ts.createSourceFile('auth.ts', fs.readFileSync(new URL('../auth.ts', import.meta.url),'utf8'), ts.ScriptTarget.Latest);
const boot = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'boot');
const code = ts.transpileModule(boot.getText(source), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
class Element {
  constructor() {
    this.value=''; this.textContent=''; this.disabled=false; this.open=false;
    this.dataset={}; this.events=new Map(); this.nodes=new Map();
    this.attributes=new Map(); this.classes=new Set();
    this.classList={add:value=>this.classes.add(value),remove:value=>this.classes.delete(value),toggle:(value,on)=>on?this.classes.add(value):this.classes.delete(value)};
  }
  setAttribute(key,value) { this.attributes.set(key,value); }
  removeAttribute(key) { this.attributes.delete(key); }
  querySelector(key) { if(!this.nodes.has(key))this.nodes.set(key,new Element()); return this.nodes.get(key); }
  querySelectorAll(key) { return key==='[data-invite-cancel]'?[this.querySelector('close'),this.querySelector('decline')]:[]; }
  closest(key) { return key==='label'?this.querySelector('label'):null; }
  addEventListener(event,handler) { const list=this.events.get(event)??[];list.push(handler);this.events.set(event,list); }
  async fire(event) { for(const handler of this.events.get(event)??[])await handler({preventDefault(){},currentTarget:this,target:this}); }
  focus() {}
  showModal() { this.open=true; }
  close() { this.open=false; }
}
const token='a'.repeat(32);
const pendingKey='redaxa.pending-invite.v1';
async function fixture({url='https://redaxa.example/dashboard.html',email=null,previewError=false,pending=false}={}) {
  const dialog=Object.fromEntries(['backdrop','email','message','title','description','registerFields','firstName','passwordField','password','confirmPasswordField','confirmPassword','legal','rememberRow','resendRow','resend','forgot','submit','switcher','form','remember'].map(key=>[key,new Element()]));
  const controls={account:new Element(),trigger:new Element(),login:new Element(),email:new Element(),signout:new Element(),closeMenu(){}};
  const dialogs=[]; const calls=[]; const storage=new Map(pending?[[pendingKey,token]]:[]);
  let location=new URL(url);
  const context=vm.createContext({URL,URLSearchParams,Error,Event,CustomEvent:Event,console,
    mode:'signin',currentEmail:null,accountActive:false,config:null,latestAccount:null,webAppUrl:'https://redaxa.example',
    restoreTheme(){},installDesktopTitlebar(){},installStylesheet(){},isTauri:()=>false,
    accountControls:()=>controls,installDialog:()=>dialog,loadConfig:async()=>({configured:true}),loadSession:async()=>email,
    refreshEntitlement:async()=>{},loadProfilePhoto:async()=>{},publishAccountState(){},accountPlanLabel:()=>'',
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    window:{addEventListener(){},setTimeout(){}},
    document:{documentElement:new Element(),body:{append:element=>dialogs.push(element)},createElement:()=>new Element(),querySelectorAll:()=>[],querySelector:()=>null,dispatchEvent(){}},
    history:{replaceState(_state,_title,path){location=new URL(path,location);context.location=location;}},location,
    authRedirect:()=> 'https://redaxa.example/dashboard.html',
    apiRequest:async(path,body,method)=>{
      calls.push({path,body,method});
      if(path.includes('action=preview')) {
        if(previewError)throw new Error('Invitation revoked');
        return {inviter:{email:'owner@example.test'},organization:{id:'org-id',name:'<img src=x onerror=alert(1)>'}};
      }
      if(path==='/api/auth/signin')return {email:'member@example.test'};
      return {};
    }
  });
  vm.runInContext(code,context);
  await vm.runInContext('boot()',context);
  return {context,dialog,controls,invite:dialogs[0],calls,storage,get location(){return location;}};
}

for(const email of [null,'existing@example.test']) {
  const state=await fixture({email,url:'https://redaxa.example/dashboard.html#access_token=attacker-token&refresh_token=attacker-refresh&type=signup'});
  assert.equal(state.calls.length,0);
  assert.equal(state.context.currentEmail,email,'A token fragment cannot replace the current identity');
  assert.equal(state.location.hash,'');
  assert.equal(state.context.mode,'signin');
  assert.match(state.dialog.message.textContent,/own email and password/);
}

const recovery=await fixture({pending:true,url:'https://redaxa.example/dashboard.html?auth=recovery#access_token=recovery-only&type=recovery'});
assert.equal(recovery.calls.length,0,'Recovery link neither adopts a session nor previews/accepts an invitation');
assert.equal(recovery.dialog.email.required,false);
assert.equal(recovery.dialog.passwordField.hidden,false);
assert.equal(recovery.dialog.form.events.get('submit').length,1,'Recovery form handler is installed');
recovery.dialog.password.value='a-new-fixture-password';
await recovery.dialog.form.fire('submit');
assert.equal(recovery.calls.length,1);
assert.equal(recovery.calls[0].path,'/api/auth/recover?action=finish');
assert.equal(recovery.calls[0].body.access_token,'recovery-only');
assert.equal(recovery.calls[0].body.password,'a-new-fixture-password');
assert.equal(recovery.context.mode,'signin');
assert.equal(recovery.dialog.email.required,true);
assert.equal(recovery.dialog.email.closest('label').attributes.has('hidden'),false);

const cancelledRecovery=await fixture({url:'https://redaxa.example/dashboard.html#access_token=recovery-only&type=recovery'});
assert.equal(cancelledRecovery.dialog.switcher.hidden,true);
await cancelledRecovery.controls.login.fire('click');
assert.equal(cancelledRecovery.context.mode,'signin');
assert.equal(cancelledRecovery.dialog.switcher.hidden,false,'Normal login restores account mode controls');
cancelledRecovery.dialog.email.value='member@example.test';
cancelledRecovery.dialog.password.value='fixture-password';
await cancelledRecovery.dialog.form.fire('submit');
assert.equal(cancelledRecovery.calls.length,1);
assert.equal(cancelledRecovery.calls[0].path,'/api/auth/signin','Leaving recovery discards its token');

const invited=await fixture({email:'member@example.test',url:`https://redaxa.example/dashboard.html?invite=${token}`});
assert.equal(invited.calls.length,1);
assert.equal(invited.calls[0].path,`/api/team?action=preview&token=${token}`);
assert.equal(invited.calls[0].method,'GET');
assert.equal(invited.invite.open,true);
assert.equal(invited.invite.querySelector('[data-invite-accept]').disabled,false);
assert.match(invited.invite.querySelector('[data-invite-details]').textContent,/<img src=x onerror=alert\(1\)>/,'Untrusted workspace name is plain text');
assert.equal(invited.invite.querySelector('[data-invite-details]').innerHTML,undefined);
assert.equal(invited.location.search,'');
await invited.invite.querySelector('[data-invite-accept]').fire('click');
assert.equal(invited.calls.length,2);
assert.equal(invited.calls[1].path,'/api/team?action=accept');
assert.equal(invited.calls[1].body.token,token);
assert.equal(invited.storage.has(pendingKey),false);
await invited.invite.querySelector('[data-invite-accept]').fire('click');
assert.equal(invited.calls.length,2,'Acceptance is consumed once');

const declined=await fixture({email:'member@example.test',pending:true});
await declined.invite.querySelector('decline').fire('click');
assert.equal(declined.storage.has(pendingKey),false);
assert.equal(declined.invite.open,false);
assert.equal(declined.calls.length,1,'Declining never accepts');

const revoked=await fixture({email:'member@example.test',pending:true,previewError:true});
assert.equal(revoked.invite.querySelector('[data-invite-accept]').disabled,true);
await revoked.invite.querySelector('[data-invite-accept]').fire('click');
assert.equal(revoked.calls.length,1,'Failed preview cannot authorize acceptance');

const signup=await fixture({url:`https://redaxa.example/dashboard.html?invite=${token}`});
assert.equal(signup.calls.length,0);
assert.equal(signup.context.mode,'signup');
signup.dialog.email.value='member@example.test';
signup.dialog.password.value=signup.dialog.confirmPassword.value='fixture-password';
await signup.dialog.form.fire('submit');
assert.equal(signup.calls.length,1);
assert.equal(signup.calls[0].path,'/api/auth/signup');
assert.equal(signup.storage.get(pendingKey),token,'Signup preserves invitation until explicit review');
await signup.dialog.switcher.fire('click');
await signup.dialog.form.fire('submit');
assert.equal(signup.calls.length,3);
assert.equal(signup.calls[1].path,'/api/auth/signin');
assert.match(signup.calls[2].path,/action=preview/);
assert.equal(signup.calls.some(call=>call.path.includes('action=accept')),false,'Credential sign-in only opens invitation review');

console.log('Unsolicited fragments, explicit recovery, invitation preview/consent, decline and signup/sign-in passed.');
