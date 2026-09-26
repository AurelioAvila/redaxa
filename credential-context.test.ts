import assert from 'node:assert/strict';
import {inspectPrompt} from './scanner.js';
import {inspectFile} from './repository-scanner.js';
import {jwtClaims,supabaseIssuer} from './credential-context.js';
const suffix='SyntheticNonWorkingKeyAb19Cd28Ef37Gh46';
const cases=[['ghp_'+suffix,'GitHub'],['sk-ant-api03-'+suffix,'Anthropic / Claude'],['sk-proj-'+suffix,'OpenAI (probable)'],['rk_test_'+suffix,'Stripe'],['sb_secret_'+suffix,'Supabase'],['xapp-1-'+suffix,'Slack'],['ASIA1234567890ABCDEF','AWS'],['AIza'+suffix,'Google APIs']];
for(const [key,provider] of cases){
 for(const prefix of ['', 'Bearer ', 'bearer ']){
  const findings=inspectPrompt(prefix+key).findings.filter(f=>f.kind==='secret');
  assert.equal(findings.length,1,provider+' '+prefix);
  assert.equal(findings[0].credential?.service,provider);
  assert.ok(!JSON.stringify(findings[0].credential).includes(key));
  assert.equal(inspectFile('.env',prefix+key)[0].credential?.service,provider);
 }
}
for(const key of ['sb_publishable_'+suffix,'pk_live_'+suffix,'sk-proj-'+'x'.repeat(40),'sb_secret_'+'x'.repeat(40)]){
 assert.equal(inspectPrompt('Bearer '+key).findings.filter(f=>f.category==='credentials').length,0,key);
 assert.equal(inspectFile('.env','Bearer '+key)[0].disposition,'reference');
}
assert.equal(inspectPrompt('sk-'+suffix).findings[0].credential?.service,'Unknown service');
assert.equal(inspectPrompt('OPENAI_API_KEY="sk-'+suffix+'"').findings[0].credential?.service,'OpenAI (probable from context)');
assert.equal(inspectPrompt('NOT_OPENAI_API_KEY="sk-'+suffix+'"').findings[0].credential?.service,'Unknown service');
const jwt=(payload:unknown,header:unknown={alg:'HS256'})=>[header,payload].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.'+'a'.repeat(32);
for(const issuer of ['supabase','https://example.supabase.co/auth/v1']){
 const publicKey=jwt({iss:issuer,role:'anon'});
 assert.equal(inspectFile('config.env','Bearer '+publicKey)[0].disposition,'reference');
 assert.equal(inspectPrompt(publicKey).findings.filter(f=>f.kind==='secret').length,0);
 const admin=jwt({iss:issuer,role:'service_role',exp:1});
 const found=inspectFile('config.env','Bearer '+admin)[0];
 assert.equal(found.severity,'critical','Unverified expiry never dismisses a privileged credential');
 assert.equal(found.credential?.service,'Supabase (claimed issuer)');
}
for(const issuer of ['not-supabase','https://supabase.evil.test','https://example.supabase.co.evil.test/auth/v1','https://evil.test/supabase','https://example.supabase.co/auth/v1?secret=x','http://example.supabase.co/auth/v1']){
 assert.equal(supabaseIssuer(issuer),false);
 const found=inspectFile('config.env','Bearer '+jwt({iss:issuer,role:'anon'}))[0];
 assert.equal(found.disposition,'review',issuer);
 assert.equal(found.credential?.service,'Issuer not established');
}
for(const token of [jwt(['not','claims']),jwt({sub:'test'}, {alg:42}), 'eyJaaaaaaaaaaaa.aaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaa']){
 assert.equal(jwtClaims(token),undefined);
 assert.equal(inspectPrompt(token).findings.filter(f=>f.kind==='secret').length,0);
}
const id='AKIA1234567890ABCDEF';
for(const malformed of [id+'X',id+'_', 'prefix-'+id])assert.equal(inspectPrompt(malformed).findings.filter(f=>f.kind==='secret').length,0,'No partial key inside a larger identifier');
assert.equal(inspectFile('config.env',id)[0].severity,'medium');
const sessionToken=jwt({sub:'fixture'});
assert.equal(inspectFile('README.md','Authorization: Bearer '+sessionToken+'.',false,true).length,1,'Sentence punctuation is not part of a JWT');
assert.equal(inspectPrompt('Bearer '+sessionToken+'.').findings.filter(f=>f.kind==='secret').length,1);
const same=inspectFile('config.env','KEY=ghp_'+suffix+'\nAuthorization: Bearer ghp_'+suffix);
assert.equal(same.length,2);assert.equal(same[0].fingerprint,same[1].fingerprint,'Bearer wrapper does not create a second unique credential');
console.log('Credential accuracy: provider prefixes, Bearer normalization, public keys, strict issuer/JWT shape, context and secret-free metadata passed.');

assert.equal(inspectFile('config.env',jwt({role:['admin']}))[0].severity,'high','Role arrays do not establish a privileged claim');
