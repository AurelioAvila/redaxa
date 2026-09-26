import { inspectPrompt, apiCredentialReference, type Finding } from './scanner.js';
import { extract } from 'tar-stream';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { createHmac, randomBytes } from 'node:crypto';
import {credentialContext,credentialValue,jwtClaims,supabaseIssuer,type CredentialContext} from './credential-context.js';

export type RepoFinding = { path:string; line:number; label:string; severity:string; category:string; masked:string; value?:string; action:string; url?:string; disposition:'review'|'reference'; reason:string; location?:string; kind?:string; fingerprint?:string; confidence?:'high'|'medium'|'low'; credential?:CredentialContext };
export type FileCoverage = {path:string; status:'scanned'|'skipped'; reason:string};
export type RepoReport = { repository:string; commit:string; scanned:number; total:number; skipped:number; partial:boolean; findings:RepoFinding[]; warnings:string[]; durationMs:number; demo:boolean; coverage:FileCoverage[]; inventoryComplete:boolean; folders:number; findingsTruncated:boolean; deep?:{refs:number;historyVersions:number;binaryFiles:number;lfsObjects:number;submodules:number;archiveEntries:number} };
const MAX_FILE = 10 * 1024 * 1024;
const MAX_ARCHIVE = 512 * 1024 * 1024;
const MAX_FINDINGS = 5000;
// Session-keyed identities support deduplication even in redacted reports, without
// publishing an unsalted password hash that could be attacked with a dictionary.
const fingerprintKey = randomBytes(32);

export function parseRepository(input:string):{owner:string;repo:string} {
  let u:URL;try{u=new URL(input.trim());}catch{throw new Error('Paste a GitHub repository URL, such as https://github.com/owner/repository.');}
  const m=/^\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9_.-]+)\/?$/.exec(u.pathname);
  if(u.protocol!=='https:'||u.hostname!=='github.com'||u.port||u.username||u.password||u.search||u.hash||!m||/^\.+$/.test(m[2]))throw new Error('Use the repository home URL on https://github.com, without a branch, query or credentials.');
  const repo=m[2].replace(/\.git$/,'');if(!repo||/^\.+$/.test(repo))throw new Error('Invalid repository name.');
  return {owner:m[1],repo};
}

function classify(f:Finding,path:string,text:string,offset:number):{disposition:'review'|'reference';reason:string;severity?:string;confidence?:'high'|'medium'|'low';label?:string} {
  const exampleFile=/(?:^|[/. _-])(?:example|sample|template|fixture|test)(?:s|[/. _-]|$)/i.test(path);
  const lineStart=text.lastIndexOf('\n',offset)+1;
  const lineEnd=text.indexOf('\n',offset);
  const line=text.slice(lineStart,lineEnd<0?text.length:lineEnd);
  const before=text.slice(Math.max(lineStart,offset-100),offset);
  const reference=(reason:string)=>({disposition:'reference' as const,reason,confidence:'high' as const});
  if(f.kind==='email' && /@(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|invalid|test|localhost)$/i.test(f.value))return {disposition:'reference',reason:'Reserved example/test domain: demonstrative address, not evidence of exposed personal data.'};
  if(f.kind==='email' && f.value.toLowerCase()==='onboarding@resend.dev')return {disposition:'reference',reason:'Public provider onboarding address; not an API credential or private customer address.'};
  if(f.kind==='email' && /@(?:users\.)?noreply\.github\.com$/i.test(f.value))return reference('GitHub no-reply attribution address, designed for public commit attribution.');
  if(f.kind==='email' && /@\d+x\.(?:png|jpe?g|webp|gif|svg|ico)$/i.test(f.value))return reference('Retina image filename with a scale suffix, not an email address.');
  if(f.kind==='ip') {
    if(/^(?:127\.|0\.0\.0\.0$|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|255\.255\.255\.255$)/.test(f.value))return {disposition:'reference',reason:'Loopback, wildcard or reserved documentation address; not evidence of a secret.'};
    if(/(?:\bv|\bversion[\s:="']*|\brelease[\s:="']*)$/i.test(text.slice(Math.max(0,offset-35),offset)))return {disposition:'reference',reason:'Version-like value in release/version context, not a confirmed IP exposure.'};
    return reference('Network address or version-shaped number. An address alone is not a credential or evidence of a vulnerability; retained as informational context.');
  }
  if(f.kind==='crypto')return reference('Public wallet/contract address or hash-shaped identifier, not a private signing key. Its presence alone does not establish financial exposure.');
  if(f.kind==='email' && (/(?:^|\/)(?:package\.json|LICENSE[^/]*|AUTHORS[^/]*|CODEOWNERS)$/i.test(path)||/\b(?:support|contact|maintainer|author|copyright|mailto|report(?:ing)?\s+(?:a\s+)?(?:bug|security))\b/i.test(line)))return reference('Address appears in explicit public-contact or authorship context. Review only if this publication was not intentional.');
  if(f.kind==='phone' && (/\b(?:version|release|timestamp|timeout|milliseconds|bytes|size|sha|checksum)\b/i.test(line)||/^\s*[-+]?\d+[ -]\d+\s*$/.test(line)))return reference('Numeric sequence in technical metadata; insufficient evidence that this is a personal phone number.');
  if(f.kind==='phone' && !f.value.trim().startsWith('+')&&!/\b(?:phone|mobile|telephone|tel|fax|whatsapp|call|contact\s+number)\b/i.test(text.slice(Math.max(0,lineStart-180),lineEnd<0?text.length:lineEnd)))return reference('Loose numeric pattern without telephone context; commonly coordinates, CSS colors, UUID segments or technical counters.');
  if(f.kind==='card') {
    // Explicit allowlist, verified against https://docs.stripe.com/testing.
    // A filename or the word "test" alone must never dismiss card data.
    if(f.value.replace(/\D/g,'')==='4242424242424242'&&/\btest\b/i.test(line)&&/\b(?:card|visa|mastercard|amex)\b/i.test(line))return reference('Documented Stripe test-card number in an explicit testing example, not a real payment credential.');
    if(!/\b(?:card|pan|payment|visa|mastercard|amex|credit|debit)\b/i.test(text.slice(Math.max(0,lineStart-180),lineEnd<0?text.length:lineEnd).replace(/_/g,' ')))return reference('Checksum-compatible number without payment-card context; a numeric match alone is insufficient evidence of card data.');
  }
  if(f.kind==='secret'&&!/^eyJ/.test(credentialValue(f.value))){const reason=apiCredentialReference(f.value);if(reason)return reference(reason);}
  if(f.kind==='secret' && /^eyJ/.test(credentialValue(f.value))) {
    try {
      const claims=jwtClaims(f.value);if(!claims)throw new Error('Invalid JWT structure');
      const {payload}=claims;
      const prefix=text.slice(Math.max(0,offset-2048),offset).match(/https?:\/\/[^\s<>"']*$/)?.[0];
      let unsubscribeLink=false;try{unsubscribeLink=!!prefix&&(/(?:^|\/)unsubscribe(?:[/.]|$)/i.test(new URL(prefix+f.value).pathname)||/(?:\[\s*unsubscribe\s*\]\s*\(|\bunsubscribe\s*[:\-]?\s*[(<]?)\s*$/i.test(text.slice(Math.max(0,offset-2048),offset-prefix.length)));}catch{}
      if(payload.role==='anon'&&supabaseIssuer(payload.iss))return {...reference('Claims match a public Supabase anonymous client token. Signature and database policies are not verified by this exposure check.'),label:'JWT · public Supabase client token'};
      if(typeof payload.role==='string'&&['service_role','admin','owner','root'].includes(payload.role))return {disposition:'review',severity:'critical',confidence:'medium',label:'JWT · privileged-role claim',reason:'The decoded payload declares a privileged role. Review access and rotate if genuine. Claims, signature and validity have not been verified.'};
      if(!payload?.role&&(unsubscribeLink||[payload?.act,payload?.action,payload?.purpose].includes('unsubscribe')))return {disposition:'review',severity:'medium',confidence:'medium',label:'JWT · unsubscribe-link token',reason:'The explicit link label, URL path or decoded payload identifies an unsubscribe action. This appears to authorize an email preference link, not general API access. Its signature and actual permissions have not been verified; review whether the link was intended to be public.'};
    }catch{return {...reference('JWT-shaped text with an invalid JSON header/payload; not a structurally valid JWT credential.'),label:'Malformed JWT-like text'};}
    return {disposition:'review',severity:'high',confidence:'medium',label:'JWT · signed-token candidate',reason:'JWT-shaped token, not necessarily an API key. It may represent a session, access token or signed link. Signature, permissions and validity are not verified; identify the issuing service before deciding what to revoke.'};
  }
  if(f.category==='credentials') {
    const value=f.value.replace(/^(?:password|passwd|pwd|secret)\s*[:=]\s*/i,'').replace(/^["']|["']$/g,'');
    if(/^(?:(?:sk-|ghp_|sk_test_)?(?:your[_-](?:api[_-])?(?:key|token|secret)(?:[_-]here)?|replace[_-]?me|change[_-]?me|placeholder|x{8,}))$/i.test(value))return {disposition:'reference',reason:'Explicit placeholder value. The example filename alone is never used to dismiss a credential.'};
    if(f.kind==='credential') {
      const match=/^(?:password|passwd|pwd|secret)(\s*[:=]\s*|\s+)(.*)$/i.exec(f.value);
      const token=match?.[2]??value;
      const unquoted=token.replace(/^["'`]/,'').replace(/["'`)}\]]+$/,'');
      if(!match||!/[=:]/.test(match[1]))return reference('Mention of a password/secret in prose or code, without a literal credential assignment.');
      const translation=/\b(?:password|passwd|pwd|secret)\s*:\s*["']([^"'\r\n]+)["']/.exec(line)?.[1];
      if(/(?:i18n|locales?|translations?|dictionary)(?:[/. _-]|$)/i.test(path)&&translation&&translation.length<60&&/^[\p{L}\s]+$/u.test(translation))return reference('Human-language label in a localization dictionary, not a password value.');
      if(/^(?:\\[nrt])/.test(token)&&/\$\{/.test(token))return reference('Escaped template text containing a dynamic link/value, not a literal credential.');
      if(/^(?:string|str|String|boolean|bool|number|unknown|undefined|null|None|true|false|never|any|Buffer|SecretString)(?:[;\]})>.]|$)/.test(unquoted))return reference('Type annotation or language constant, not a password value.');
      if(/^(?:process\.env\b|import\.meta\.env\b|Deno\.env\b|os\.environ\b|std::env\b|env[.(\[]|\$|\{|\[|<)/.test(token)||/^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$]|\(|\[|::)/.test(token))return reference('Computed value, variable/property access or environment lookup; no literal credential is exposed in this expression.');
      if(/^[A-Za-z_$][\w$]*(?:[)}\]]+|\s*=>)$/.test(token)||/^(?:password|passwd|secret|token|credentials|newPassword|currentPassword|hashedPassword|passwordHash|apiKey|secretKey)$/i.test(token))return reference('Code identifier or function argument, not a literal credential.');
      if(/\.(?:[cm]?[jt]sx?|py|rs|java|go|cs|cpp|hpp|c|h)(?:$|\s)/i.test(path)&&/^[A-Za-z_$][\w$]*$/.test(token))return reference('Unquoted source-code identifier, not a literal string credential. Environment/config values are still reviewed.');
      if(/^(?:your[_-].*|insert[_-].*|replace[_-].*|change[_-]?me|placeholder|redacted|REDACTED|\*{3,}|x{4,}|example[_-].*|test[_-](?:password|secret))$/i.test(unquoted))return reference('Explicit redaction or demonstration placeholder; retained separately for transparency.');
      // The prose scanner deliberately accepts loose assignment syntax. Repository
      // source contains many form attributes and object schemas with that syntax.
      if(/["']$/.test(before)&&/^(?:type|label|value|required|name|id|autocomplete|form|input|field|schema|error|message|pattern|length|minimum|maximum)\b/i.test(unquoted))return reference('Form/schema metadata, not a literal password.');
      return {disposition:'review',severity:exampleFile?'medium':'high',confidence:exampleFile?'low':'medium',reason:exampleFile?'Password-like literal in test/example code. It may be a deliberately invalid test input or a temporary test-account password; check whether it is reused outside tests. No account validity is tested.':'Possible hard-coded password assignment. Confirm its context before treating it as a credential; no login or validity test is performed.'};
    }
    if(f.kind==='secret'&&/^AIza/.test(credentialValue(f.value)))return {disposition:'review',severity:'medium',confidence:'medium',reason:'Google API key pattern. Some browser keys are intentionally public; verify application/API restrictions and billing scope before deciding whether rotation is needed.'};
    if(f.kind==='secret'&&/^(?:AKIA|ASIA)/.test(credentialValue(f.value)))return {disposition:'review',severity:'medium',confidence:'high',reason:'AWS access key identifier only. Check whether its paired secret and any session token are exposed before treating this as usable account access.'};
    return {disposition:'review',confidence:'high',reason:exampleFile?'Credential-shaped value in an example/test file. It still needs review: example files can contain genuine secrets.':'Credential pattern matched. Validity is not tested; review and rotate if genuine.'};
  }
  if(f.kind==='email'&&/\.(?:mp4|mov|webm|mp3|wav|png|jpe?g|webp|ico)(?:$|\s|!)/i.test(path)) {
    if(!/\b(?:email|e-mail|recipient|customer|user|account)\b/i.test(line.replace(/_/g,' ')))return {disposition:'reference',confidence:'low',reason:'Address-shaped string in media bytes without email context; random bytes can resemble addresses. Retained for manual inspection, not counted as an exposure.'};
    return {disposition:'review',severity:'low',confidence:'low',reason:'Email-shaped string in media metadata with email context. Inspect the source; binary extraction does not confirm personal data.'};
  }
  return {disposition:'review',reason:'Potential sensitive data. Context and authorization must be reviewed; this is not a confirmed vulnerability.'};
}

export function inspectFile(path:string,text:string,allowReveal=false,credentialsOnly=false):RepoFinding[] {
  const {findings}=inspectPrompt(text,credentialsOnly?{includePersonalData:false,includeFinancialData:false,includeCredentials:true}:undefined,true);const offsets=new Map<string,number>();
  return findings.flatMap(f=>{
    const key=f.kind+'\0'+f.value;const offset=text.indexOf(f.value,offsets.get(key)??0);
    // inspectPrompt progressively redacts text. A later generic rule can match
    // its generated markers; those strings never appeared in the source file.
    if(offset<0)return [];
    offsets.set(key,offset+f.value.length);
    const c=classify(f,path,text,offset);
    if(credentialsOnly&&(c.disposition==='reference'||c.label==='JWT · unsubscribe-link token'))return [];
    const assignment=text.slice(Math.max(0,offset-100),offset).match(/\b(OPENAI_API_KEY)["']?\s*[:=]\s*["']?$/)?.[1]??'';
    const credential=f.category==='credentials'?credentialContext(f.kind,f.value,c.label??f.label,c.disposition==='reference',assignment):undefined;
    const identity=f.kind==='credential'?f.value.replace(/^(?:password|passwd|pwd|secret)\s*[:=]\s*/i,'').replace(/^["']|["']$/g,''):f.kind==='email'?f.value.toLowerCase():f.kind==='secret'?credentialValue(f.value):f.value;
    const fingerprint=createHmac('sha256',fingerprintKey).update(f.kind+'\0'+identity).digest('hex');
    return [{path,line:text.slice(0,offset).split('\n').length,label:f.label,category:f.category,masked:'[REDACTED]',kind:f.kind,fingerprint,...(credential?{credential}:{}),...(allowReveal?{value:f.value}:{}),...c,severity:c.disposition==='reference'?'info':c.severity??f.severity,
      action:credential?.guidance??(c.disposition==='reference'?'Informational or recognized reference. Kept for transparency; excluded from the review count.':'Check whether this data is intentional and authorized for public sharing. Remove or anonymize it if needed.')}];
  });
}

async function boundedJSON(response:Response,max:number):Promise<any> {
  if(!response.ok){await response.body?.cancel();if(response.status===404)throw new Error('Repository unavailable. This preview supports public repositories only.');if(response.status===403||response.status===429)throw new Error('GitHub metadata request limit reached. Wait before trying again.');throw new Error('GitHub could not complete the request.');}
  const reader=response.body?.getReader();if(!reader)throw new Error('Empty GitHub response.');const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>max)throw new Error('Repository metadata exceeded the size limit.');chunks.push(r.value);}}finally{await reader.cancel();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function budget(max:number){let size=0;return new Transform({transform(chunk,_,cb){size+=chunk.length;cb(size>max?new Error('Archive safety size limit reached.'):null,chunk);}});}
function decode(bytes:Buffer):string|null {
  try {
    if(bytes[0]===255&&bytes[1]===254)return new TextDecoder('utf-16le',{fatal:true}).decode(bytes);
    if(bytes[0]===254&&bytes[1]===255)return new TextDecoder('utf-16be',{fatal:true}).decode(bytes);
    if(bytes.includes(0))return null;
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }catch{return null;}
}

export async function scanRepository(input:string,signal?:AbortSignal,fetcher:typeof fetch=fetch,allowReveal=false):Promise<RepoReport> {
  const {owner,repo}=parseRepository(input);const started=Date.now();const abort=AbortSignal.any([AbortSignal.timeout(180_000),...(signal?[signal]:[])]);
  const base=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const get=async(suffix:string,max=1_000_000)=>boundedJSON(await fetcher(base+suffix,{signal:abort,redirect:'error',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Redaxa-development-secret-scan'}}),max);
  let commit:any,manifest:any;
  try {
    const metadata=await get('');if(metadata.private!==false||typeof metadata.default_branch!=='string')throw new Error('Only public repositories are supported in this preview.');
    commit=await get('/commits/'+encodeURIComponent(metadata.default_branch));if(!/^[a-f0-9]{40}$/.test(commit.sha)||!/^[a-f0-9]{40}$/.test(commit.commit?.tree?.sha))throw new Error('Invalid repository snapshot.');
    manifest=await get('/git/trees/'+commit.commit.tree.sha+'?recursive=1',8_000_000);
  }catch(error){
    if(error instanceof Error&&error.message.includes('metadata request limit'))return (await import('./repository-git.js')).scanWithGit(owner,repo,abort,allowReveal);
    throw error;
  }
  if(!Array.isArray(manifest.tree))throw new Error('Invalid repository inventory.');
  const report:RepoReport={repository:`${owner}/${repo}`,commit:commit.sha,scanned:0,total:0,skipped:0,partial:false,findings:[],warnings:[],durationMs:0,demo:false,coverage:[],inventoryComplete:!manifest.truncated,folders:0,findingsTruncated:false};
  const expected=new Map<string,string>();const folders=new Set<string>();
  for(const e of manifest.tree)if(typeof e.path==='string'){if(e.type==='tree')folders.add(e.path);else expected.set(e.path,e.type==='commit'?'External submodule content is not part of this repository snapshot.':'File not received in archive (possibly export-ignored or interrupted).');}
  const archive=await fetcher(`https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tar.gz/${commit.sha}`,{redirect:'error',signal:abort});
  if(!archive.ok||!archive.body)throw new Error('The repository archive could not be downloaded.');
  const parser=extract();const seen=new Set<string>();
  const reading=(async()=>{
    for await(const entry of parser){
      const path=entry.header.name.split('/').slice(1).join('/').replace(/\/$/,'');
      if(entry.header.type==='directory'){if(path)folders.add(path);entry.resume();continue;}
      if(!path||seen.has(path)){entry.resume();continue;}seen.add(path);
      let reason='';const chunks:Buffer[]=[];let length=0;
      if(entry.header.type!=='file')reason='Symlink or special entry: not followed.';
      if((entry.header.size??0)>MAX_FILE)reason='File exceeds the 10 MiB per-file memory limit.';
      for await(const raw of entry){const chunk=Buffer.from(raw as Uint8Array);length+=chunk.length;if(!reason&&length>MAX_FILE)reason='File exceeds the 10 MiB per-file memory limit.';if(!reason)chunks.push(chunk);}
      if(!reason){const source=decode(Buffer.concat(chunks));if(source===null)reason='Binary or unsupported text encoding.';
        else if(source.startsWith('version https://git-lfs.github.com/spec/'))reason='Git LFS pointer: external object is not in this snapshot.';
        else {
          const found=inspectFile(path,source,allowReveal);report.scanned++;
          for(const f of found){if(report.findings.length>=MAX_FINDINGS){report.findingsTruncated=true;break;}f.url=`https://github.com/${owner}/${repo}/blob/${commit.sha}/${path.split('/').map(encodeURIComponent).join('/')}#L${f.line}`;report.findings.push(f);}
        }
      }
      report.coverage.push({path,status:reason?'skipped':'scanned',reason:reason||'Entire text file checked.'});
    }
  })();
  const transfer=pipeline(Readable.fromWeb(archive.body as any),budget(128*1024*1024),createGunzip(),budget(MAX_ARCHIVE),parser,{signal:abort});
  const results=await Promise.allSettled([reading,transfer]);
  if(results.some(r=>r.status==='rejected')){report.partial=true;report.warnings.push('Archive download/read interrupted or safety/time limit reached. Missing files are listed below.');}
  const covered=new Set(report.coverage.map(f=>f.path));
  for(const [path,reason] of expected)if(!covered.has(path))report.coverage.push({path,status:'skipped',reason});
  report.total=report.coverage.length;report.skipped=report.total-report.scanned;report.folders=folders.size;
  report.partial ||= report.skipped>0||!report.inventoryComplete||report.findingsTruncated;
  if(!report.inventoryComplete)report.warnings.push('GitHub truncated the manifest: archive entries were checked, but full inventory reconciliation could not be verified.');
  if(report.findingsTruncated)report.warnings.push('All readable files were checked, but only the first 5,000 matches are displayed.');
  report.warnings.push('All folders in this default-branch snapshot are traversed, including dotfolders, examples, vendor/build output and lockfiles. Git history, other branches, external submodules/LFS objects and general code/dependency vulnerabilities are outside this check. Keys are never tested against providers.');
  report.durationMs=Date.now()-started;return report;
}

export function demoReport(allowReveal=false):RepoReport {
  const files=[{path:'config/service.env',text:'# Synthetic non-working demonstration\nOPENAI_API_KEY=sk-'+'demoOnlyNotARealCredential123456789012345678901234567890'},{path:'config/.env.example',text:'SUPPORT_EMAIL=you@example.com\nMAIL_FROM=onboarding@resend.dev'}];
  return {repository:'demo / sample-project',commit:'Synthetic fixture • no GitHub request',scanned:2,total:2,skipped:0,partial:false,findings:files.flatMap(f=>inspectFile(f.path,f.text,allowReveal)),warnings:['Synthetic data. The credential-shaped fixture stays reviewable; recognized example addresses are separated.'],durationMs:0,demo:true,coverage:files.map(f=>({path:f.path,status:'scanned',reason:'Entire synthetic file checked.'})),inventoryComplete:true,folders:1,findingsTruncated:false};
}
