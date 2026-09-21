import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {Readable} from 'node:stream';
import {extract} from 'tar-stream';
import * as zip from 'yauzl';
import {inspectFile,parseRepository,type RepoReport,type RepoFinding} from './repository-scanner.js';
const exec=promisify(execFile);
const MEMORY=64*1024*1024,TOTAL=2*1024*1024*1024;
type Source={path:string;url?:string;repo:string;depth:number;historical?:boolean};
export type Progress={stage:string;checked:number;findings:number;apiKeyCandidates?:number;elapsedSeconds?:number;estimatedRemainingSeconds?:number|null;estimatedTotal?:number|null};

export function submoduleURLs(text:string,parent:string):Map<string,string>{
 const result=new Map<string,string>();let path='',url='';
 const flush=()=>{if(!path||!url)return;try{let value=url.replace(/^git@github\.com:/,'https://github.com/');if(value.startsWith('../')||value.startsWith('./'))value=new URL(value,'https://github.com/'+parent+'/').href;const parsed=parseRepository(value);result.set(path,parsed.owner+'/'+parsed.repo);}catch{/* Unsupported external hosts remain listed, never fetched. */}};
 for(const line of text.split(/\r?\n/)){if(/^\s*\[/.test(line)){flush();path='';url='';}const m=/^\s*(path|url)\s*=\s*(.*?)\s*$/.exec(line);if(m){const value=m[2].replace(/^"|"$/g,'');if(m[1]==='path')path=value;else url=value;}}flush();return result;
}
export function printableContent(bytes:Buffer):{text:string;binary:boolean}{
 try{if(bytes[0]===255&&bytes[1]===254)return{text:new TextDecoder('utf-16le',{fatal:true}).decode(bytes),binary:false};if(bytes[0]===254&&bytes[1]===255)return{text:new TextDecoder('utf-16be',{fatal:true}).decode(bytes),binary:false};if(!bytes.includes(0))return{text:new TextDecoder('utf-8',{fatal:true}).decode(bytes),binary:false};}catch{}
 const raw=bytes.toString('latin1');const ascii=raw.match(/[\x20-\x7e\r\n\t]{6,}/g)??[];
 const wide=(raw.match(/(?:[\x20-\x7e]\x00){6,}/g)??[]).map(s=>s.replace(/\x00/g,''));
 const wideBE=(raw.match(/(?:\x00[\x20-\x7e]){6,}/g)??[]).map(s=>s.replace(/\x00/g,''));
 return{text:[...ascii,...wide,...wideBE].join('\n'),binary:true};
}
export function allowedLfsURL(value:string):boolean{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(u.hostname==='github.com'||u.hostname.endsWith('.githubusercontent.com')||/^github-production-repository-file-[a-z0-9-]+\.s3\.amazonaws\.com$/.test(u.hostname));}catch{return false;}}

export async function scanFullRepository(input:string,outer?:AbortSignal,reveal=false,onProgress?:(p:Progress)=>void):Promise<RepoReport>{
 const parsed=parseRepository(input),initial=parsed.owner+'/'+parsed.repo;const start=Date.now();const signal=AbortSignal.any([AbortSignal.timeout(10*60_000),...(outer?[outer]:[])]);
 const parent=resolve(tmpdir()),temp=await mkdtemp(join(parent,'redaxa-full-'));
 const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_LFS_SKIP_SMUDGE:'1'};
 const base=['-c','credential.helper=','-c','core.askPass=','-c','core.hooksPath='+join(temp,'no-hooks'),'-c','protocol.allow=never','-c','protocol.https.allow=always','-c','core.quotePath=false'];
 const options={env,signal,timeout:600_000,maxBuffer:64*1024*1024,windowsHide:true};
 const run=(directory:string,args:string[])=>exec('git',[...base,...(directory?['--git-dir='+directory]:[]),...args],options);
 const r:RepoReport={repository:initial,commit:'',scanned:0,total:0,skipped:0,partial:false,findings:[],warnings:[],durationMs:0,demo:false,coverage:[],inventoryComplete:false,folders:0,findingsTruncated:false,deep:{refs:0,historyVersions:0,binaryFiles:0,lfsObjects:0,submodules:0,archiveEntries:0}};
 let used=0,expected=0,inspectionStart=0;const visited=new Set<string>(),lfsSeen=new Set<string>(),folders=new Set<string>(),findingSeen=new Set<string>();
 const apiIdentities=new Set<string>();
 const progress=(stage:string)=>{const elapsedSeconds=Math.round((Date.now()-start)/1000);const done=r.scanned+r.skipped;const remaining=inspectionStart&&done>=20&&expected>done?Math.ceil((Date.now()-inspectionStart)/1000/done*(expected-done)):null;onProgress?.({stage,checked:r.scanned,findings:r.findings.filter(f=>f.disposition==='review').length,apiKeyCandidates:apiIdentities.size,elapsedSeconds,estimatedRemainingSeconds:remaining,estimatedTotal:expected||null});};
 const record=(s:Source,reason:string,ok:boolean)=>{r.coverage.push({path:s.path,status:ok?'scanned':'skipped',reason});if(ok)r.scanned++;else{r.skipped++;r.partial=true;}};
 const charge=(n:number)=>{signal.throwIfAborted();used+=n;if(used>TOTAL)throw new Error('Total 2 GiB content budget reached.');};
 const addFindings=(bytes:Buffer,s:Source,segment?:number)=>{
   const decoded=printableContent(bytes);if(decoded.binary)r.deep!.binaryFiles++;
   for(const f of inspectFile(s.path,decoded.text,reveal)){
    const signature=createHash('sha256').update(s.path+'\0'+f.label+'\0'+f.line+'\0'+(f.value??JSON.stringify(f))).digest('hex');if(findingSeen.has(signature))continue;findingSeen.add(signature);
    if(r.findings.length>=10_000){r.findingsTruncated=true;continue;}
    if(decoded.binary||segment!==undefined)f.location=decoded.binary?'Extracted binary string'+(segment!==undefined?` near byte ${segment}`:''):`Text segment near byte ${segment}`;
    if(s.historical)f.reason+=' Historical file version; it may already be removed, but an exposed credential may still require rotation.';
    if(s.url)f.url=s.url;r.findings.push(f);
    if(f.kind==='secret'&&f.disposition==='review'&&f.fingerprint&&!apiIdentities.has(f.fingerprint)){apiIdentities.add(f.fingerprint);progress('Potential API key or token detected; continuing the scan…');}
   }
   return decoded;
 };
 async function download(url:string):Promise<Buffer>{
  for(let redirects=0;redirects<5;redirects++){
   if(!allowedLfsURL(url))throw new Error('Untrusted LFS download destination.');
   const response=await fetch(url,{signal,redirect:'manual'});
   if(response.status>=300&&response.status<400){const next=response.headers.get('location');await response.body?.cancel();if(!next)break;url=new URL(next,url).href;continue;}
   if(!response.ok||!response.body)throw new Error('LFS object unavailable or requires authentication.');
   const reader=response.body.getReader(),chunks:Buffer[]=[];let length=0;
   try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;charge(part.value.length);if(length>MEMORY)throw new Error('LFS object exceeds the 64 MiB memory budget.');chunks.push(Buffer.from(part.value));}}finally{await reader.cancel();}
   return Buffer.concat(chunks);
  }throw new Error('LFS redirect limit.');
 }
 async function analyze(bytes:Buffer,s:Source):Promise<void>{
  signal.throwIfAborted();const decoded=addFindings(bytes,s);
  record(s,decoded.binary?'ASCII and UTF-16 readable strings checked across binary bytes; not OCR or decompilation.':'Full text checked.',true);
  const pointer=/^version https:\/\/git-lfs.github.com\/spec\/v1\r?\noid sha256:([a-f0-9]{64})\r?\nsize (\d+)/.exec(decoded.text);
  if(pointer){const child={...s,path:s.path+' [LFS object]'};const oid=pointer[1];if(lfsSeen.has(s.repo+oid)){record(child,'Identical LFS object already checked.',true);return;}
   try{const response=await fetch('https://github.com/'+s.repo+'.git/info/lfs/objects/batch',{method:'POST',headers:{Accept:'application/vnd.git-lfs+json','Content-Type':'application/vnd.git-lfs+json'},body:JSON.stringify({operation:'download',transfers:['basic'],objects:[{oid,size:Number(pointer[2])}]}),signal,redirect:'error'});if(!response.ok)throw new Error();const data=await response.json();const object=data.objects?.find((x:any)=>x.oid===oid);const href=object?.actions?.download?.href;if(typeof href!=='string')throw new Error();const content=await download(href);if(content.length!==Number(pointer[2])||createHash('sha256').update(content).digest('hex')!==oid)throw new Error();lfsSeen.add(s.repo+oid);r.deep!.lfsObjects++;await analyze(content,child);}catch{record(child,'LFS object unavailable, untrusted, too large, interrupted or failed integrity verification.',false);}return;
  }
  const isZip=bytes[0]===80&&bytes[1]===75&&[3,5,7].includes(bytes[2]);const isGzip=bytes[0]===31&&bytes[1]===139;
  const isTar=bytes.length>262&&bytes.subarray(257,262).toString()==='ustar';
  if((isZip||isGzip||isTar)&&s.depth>=4){record({...s,path:s.path+' [nested archive]'},'Archive nesting limit (4) reached.',false);return;}
  if(isZip){await new Promise<void>((done)=>{zip.fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true},(error,archive)=>{if(error||!archive){record({...s,path:s.path+' [ZIP contents]'},'ZIP could not be decoded.',false);done();return;}
    let ended=false;const finish=(failed=false)=>{if(ended)return;ended=true;if(failed)record({...s,path:s.path+' [ZIP contents]'},'ZIP interrupted, encrypted, unsupported or budget exceeded.',false);archive.close();done();};archive.on('error',()=>finish(true));archive.on('end',()=>finish());
    archive.on('entry',(entry)=>{if(entry.fileName.endsWith('/')){archive.readEntry();return;}const child={...s,path:s.path+'!/'+entry.fileName,depth:s.depth+1};
     if(entry.uncompressedSize>MEMORY||entry.isEncrypted()){record(child,'Encrypted or exceeds 64 MiB archive-entry memory budget.',false);archive.readEntry();return;}
     archive.openReadStream(entry,(error,stream)=>{if(error||!stream){record(child,'Archive entry cannot be read.',false);archive.readEntry();return;}
      void(async()=>{const chunks:Buffer[]=[];let length=0;try{for await(const chunk of stream){length+=chunk.length;charge(chunk.length);if(length>MEMORY)throw new Error();chunks.push(chunk);}r.deep!.archiveEntries++;await analyze(Buffer.concat(chunks),child);archive.readEntry();}catch{stream.destroy();finish(true);}})();
     });
    });archive.readEntry();});});
  }else if(isGzip){try{const output=gunzipSync(bytes,{maxOutputLength:MEMORY});charge(output.length);r.deep!.archiveEntries++;await analyze(output,{...s,path:s.path+'!/uncompressed',depth:s.depth+1});}catch{record({...s,path:s.path+' [gzip contents]'},'Gzip unsupported, corrupted or memory budget exceeded.',false);}}
  else if(isTar){const parser=extract();const read=(async()=>{for await(const entry of parser){const child={...s,path:s.path+'!/'+entry.header.name,depth:s.depth+1};if(entry.header.type==='directory'){entry.resume();continue;}if(entry.header.type!=='file'||(entry.header.size??0)>MEMORY){record(child,'Unsupported archive entry or memory budget exceeded.',false);entry.resume();continue;}const chunks:Buffer[]=[];let length=0;for await(const raw of entry){const b=Buffer.from(raw as Uint8Array);length+=b.length;charge(b.length);if(length>MEMORY)throw new Error();chunks.push(b);}r.deep!.archiveEntries++;await analyze(Buffer.concat(chunks),child);}})();Readable.from(bytes).pipe(parser);try{await read;}catch{parser.destroy();record({...s,path:s.path+' [tar contents]'},'Tar interrupted or budget exceeded.',false);}}
  else if(/\.(?:7z|rar|xz|bz2|zst|pdf)$/i.test(s.path))record({...s,path:s.path+' [encoded contents]'},'Readable strings checked; this compression/document format is not decoded.',false);
 }
 async function scanRepo(name:string,prefix:string,pinned?:string,depth=0):Promise<void>{
  const visit=name+'@'+(pinned??'all');if(visited.has(visit))return;visited.add(visit);
  if(depth>4||visited.size>20){record({path:prefix,repo:name,depth},'Submodule traversal budget reached.',false);return;}
  progress('Downloading repository and Git history…');const directory=join(temp,'repo-'+visited.size+'.git');
  await run('',['clone','--mirror','--','https://github.com/'+name,directory]);
  const head=pinned??(await run(directory,['rev-parse','HEAD'])).stdout.trim();if(!/^[a-f0-9]{40}$/.test(head))throw new Error('Invalid revision');
  if(pinned)await run(directory,['cat-file','-e',pinned+'^{commit}']);else r.commit=head;
  const refs=(await run(directory,['for-each-ref','--format=%(refname)'])).stdout.trim().split('\n').filter(Boolean);r.deep!.refs+=refs.length;
  const inventory=(await run(directory,['ls-tree','-r','-z','-l',head])).stdout;
  const entries=inventory.split('\0').filter(Boolean).map(line=>{const m=/^(\d+) (\w+) ([a-f0-9]{40})\s+(\d+|-)\t([\s\S]+)$/.exec(line);if(!m)throw new Error('Invalid tree');return {mode:m[1],type:m[2],sha:m[3],size:Number(m[4]),path:m[5]};});
  const current=new Set<string>(entries.filter(e=>e.type==='blob').map(e=>e.sha));let modules=new Map<string,string>();
  progress('Mapping current files and reachable history…');
  const history=(await run(directory,['rev-list','--objects','--all'])).stdout.split('\n').filter(Boolean);const objects=new Map<string,string>();for(const row of history){const m=/^([a-f0-9]{40})(?: (.*))?$/.exec(row);if(m&&!current.has(m[1]))objects.set(m[1],m[2]??'object');}
  const check=exec('git',[...base,'--git-dir='+directory,'cat-file','--batch-check'],options);check.child.stdin?.end([...objects.keys()].join('\n')+'\n');const checked=(await check).stdout;
  expected+=entries.length+checked.split('\n').filter(row=>/^[a-f0-9]{40} (blob|commit|tag) \d+$/.test(row)).length;
  if(!inspectionStart)inspectionStart=Date.now();
  const gm=entries.find(e=>e.path==='.gitmodules');if(gm){const text=(await run(directory,['cat-file','blob',gm.sha])).stdout;modules=submoduleURLs(text,name);}
  async function object(sha:string,size:number,s:Source):Promise<void>{
    progress(s.historical?'Checking historical file versions…':'Checking files, binary strings and embedded archives…');
    if(signal.aborted||used+size>TOTAL){record(s,'Time or total 2 GiB content budget reached.',false);return;}
    try{if(size<=MEMORY){const {stdout}=await exec('git',[...base,'--git-dir='+directory,'cat-file','blob',sha],{...options,encoding:'buffer',maxBuffer:MEMORY+1024});charge(stdout.length);await analyze(stdout,s);}
     else {const child=spawn('git',[...base,'--git-dir='+directory,'cat-file','blob',sha],{env,signal,windowsHide:true,stdio:['ignore','pipe','ignore']});const exited=new Promise<number|null>((res,rej)=>{child.on('error',rej);child.on('close',res);});exited.catch(()=>{});let carry=Buffer.alloc(0),offset=0;try{for await(const raw of child.stdout){const chunk=Buffer.from(raw);charge(chunk.length);const joined=Buffer.concat([carry,chunk]);addFindings(joined,s,Math.max(0,offset-carry.length));carry=joined.subarray(Math.max(0,joined.length-65536));offset+=chunk.length;}if(await exited!==0)throw new Error();record(s,'All bytes read in overlapping chunks; text/ASCII/UTF-16 patterns checked.',true);if(/\.(?:zip|gz|tar|7z|rar|pdf|xz|bz2|zst)$/i.test(s.path))record({...s,path:s.path+' [encoded contents]'},'Large container read as strings; nested contents exceed the memory budget.',false);}finally{if(child.exitCode===null)child.kill();}}
    }catch{record(s,signal.aborted?'Scan cancelled or ten-minute deadline reached.':'Object could not be completely analyzed or resource budget reached.',false);}
  }
  for(const e of entries){const path=prefix+e.path;const parts=path.split('/');for(let i=1;i<parts.length;i++)folders.add(parts.slice(0,i).join('/'));const s={path,repo:name,depth:0,url:`https://github.com/${name}/blob/${head}/${e.path.split('/').map(encodeURIComponent).join('/')}`};
   if(e.type==='commit'){const target=modules.get(e.path);if(!target)record(s,'Submodule URL is missing or is not a supported public GitHub URL.',false);else try{r.deep!.submodules++;await scanRepo(target,path+'/',e.sha,depth+1);record(s,'Pinned submodule and its accessible history traversed.',true);}catch{record(s,'Pinned submodule unavailable or requires authentication.',false);}continue;}
   current.add(e.sha);await object(e.sha,e.size,s);
  }
  for(const row of checked.split('\n')){const m=/^([a-f0-9]{40}) (blob|commit|tag) (\d+)$/.exec(row);if(!m)continue;
   if(m[2]==='blob'){r.deep!.historyVersions++;await object(m[1],Number(m[3]),{path:prefix+'[history '+m[1].slice(0,12)+']/'+objects.get(m[1]),repo:name,depth:0,historical:true});}
   else {const source={path:prefix+'['+m[2]+' message '+m[1].slice(0,12)+']',repo:name,depth:0,historical:true};try{const raw=(await run(directory,['cat-file',m[2],m[1]])).stdout;const message=raw.slice(raw.indexOf('\n\n')+2);charge(Buffer.byteLength(message));await analyze(Buffer.from(message),source);}catch{record(source,'Commit/tag message could not be checked.',false);}}
  }
  // A submodule removed from HEAD is still in scope when an older configuration references it.
  if([...objects.values()].some(path=>path==='.gitmodules')||gm){
   progress('Checking historical submodule references…');const commits=(await run(directory,['rev-list','--all'])).stdout.trim().split('\n');const configCache=new Map<string,Map<string,string>>();
   for(const revision of commits){if(signal.aborted){record({path:prefix+'[historical submodules]',repo:name,depth},'Historical submodule traversal timed out.',false);break;}
    const listing=(await run(directory,['ls-tree','-r','-z',revision])).stdout.split('\0');const links=listing.map(line=>/^(\d+) (\w+) ([a-f0-9]{40})\t([\s\S]+)$/.exec(line)).filter(x=>x!==null);
    const config=links.find(x=>x![4]==='.gitmodules');if(!config)continue;let urls=configCache.get(config[3]);if(!urls){urls=submoduleURLs((await run(directory,['cat-file','blob',config[3]])).stdout,name);configCache.set(config[3],urls);}
    for(const link of links.filter(x=>x![2]==='commit')){const target=urls.get(link![4]);const source={path:prefix+'[historical submodule '+revision.slice(0,12)+']/'+link![4],repo:name,depth};if(!target){record(source,'Historical submodule URL unavailable or unsupported.',false);continue;}if(visited.has(target+'@'+link![3]))continue;
     try{r.deep!.submodules++;await scanRepo(target,source.path+'/',link![3],depth+1);record(source,'Historical pinned submodule traversed.',true);}catch{record(source,'Historical pinned submodule inaccessible or requires authentication.',false);}
    }
   }
  }
  if(!prefix)r.inventoryComplete=true;
 }
 try{await scanRepo(initial,'');}
 catch{r.partial=true;r.inventoryComplete=false;r.warnings.push('Repository/history inventory interrupted, inaccessible or resource limit reached. Uninventoried items cannot be counted.');if(!r.coverage.length)throw new Error('Unable to read the public repository. Check its URL, Git availability and network access.');}
 finally{if(dirname(resolve(temp))===parent&&basename(temp).startsWith('redaxa-full-'))await rm(temp,{recursive:true,force:true,maxRetries:3});}
 r.total=r.coverage.length;r.folders=folders.size;r.durationMs=Date.now()-start;r.partial ||=r.skipped>0||!r.inventoryComplete||r.findingsTruncated;
 r.warnings.push('Checks current files plus unique historical blob versions reachable from accessible branches/tags; not server-deleted or inaccessible objects. Counts include historical versions and embedded entries, not just current filenames.');
 r.warnings.push('Binary coverage means readable ASCII/UTF-16 strings, not OCR, decompilation or every possible encoding. ZIP, gzip and tar contents are inspected within budgets. No code or credential is executed/tested.');
 r.warnings.push('LFS objects and current/historical pinned public GitHub submodules are attempted. Access failures, unsupported hosts/formats and resource limits remain visible.');
 if(r.findingsTruncated)r.warnings.push('Display capped at 10,000 findings; traversal continues.');
 progress('Review ready');return r;
}
