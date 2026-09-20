import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {inspectFile,type RepoReport} from './repository-scanner.js';
const exec=promisify(execFile);

// Public, shallow bare clone. No checkout, filters, hooks, submodule commands or repository code.
export async function scanWithGit(owner:string,repo:string,signal:AbortSignal,allowReveal:boolean):Promise<RepoReport>{
 const start=Date.now();const parent=resolve(tmpdir());const temp=await mkdtemp(join(parent,'redaxa-scan-'));const repository=join(temp,'repository.git');
 const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_LFS_SKIP_SMUDGE:'1'};
 const options={env,signal,timeout:180_000,maxBuffer:32*1024*1024,windowsHide:true};
 const base=['-c','credential.helper=','-c','core.hooksPath='+join(temp,'no-hooks'),'-c','protocol.allow=never','-c','protocol.https.allow=always'];
 const run=(args:string[])=>exec('git',[...base,...args],options);
 const report:RepoReport={repository:`${owner}/${repo}`,commit:'',scanned:0,total:0,skipped:0,partial:false,findings:[],warnings:[],durationMs:0,demo:false,coverage:[],inventoryComplete:false,folders:0,findingsTruncated:false};
 try{
  await run(['clone','--bare','--depth=1','--single-branch','--no-tags','--','https://github.com/'+owner+'/'+repo,repository]);
  report.commit=(await run(['--git-dir='+repository,'rev-parse','HEAD'])).stdout.trim();
  if(!/^[a-f0-9]{40}$/.test(report.commit))throw new Error('Invalid snapshot');
  const inventory=(await run(['--git-dir='+repository,'ls-tree','-r','-z','-l',report.commit])).stdout;
  const entries=inventory.split('\0').filter(Boolean).map(line=>{const m=/^(\d+) (\w+) ([a-f0-9]{40})\s+(\d+|-)\t([\s\S]+)$/.exec(line);if(!m)throw new Error('Invalid tree');return {mode:m[1],type:m[2],sha:m[3],size:Number(m[4]),path:m[5]};});
  report.inventoryComplete=true;report.total=entries.length;
  const folders=new Set<string>();for(const f of entries){const parts=f.path.split('/');for(let i=1;i<parts.length;i++)folders.add(parts.slice(0,i).join('/'));}
  report.folders=folders.size;
  let scannedBytes=0;
  for(const file of entries){let reason='';
   if(signal.aborted)reason='Time budget exceeded or scan cancelled.';
   else if(file.type==='commit')reason='External submodule: separate repository, not followed.';
   else if(file.mode==='120000')reason='Symlink: external target not followed.';
   else if(file.size>10*1024*1024)reason='File exceeds the 10 MiB per-file memory limit.';
   else if(scannedBytes+file.size>512*1024*1024)reason='512 MiB total text-read budget reached.';
   else try {
    const {stdout:bytes}=await exec('git',[...base,'--git-dir='+repository,'cat-file','blob',file.sha],{...options,encoding:'buffer',maxBuffer:10*1024*1024+1024});
    scannedBytes+=bytes.length;let source:string;
    if(bytes[0]===255&&bytes[1]===254)source=new TextDecoder('utf-16le',{fatal:true}).decode(bytes);
    else if(bytes[0]===254&&bytes[1]===255)source=new TextDecoder('utf-16be',{fatal:true}).decode(bytes);
    else {if(bytes.includes(0))throw new Error('binary');source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
    if(source.startsWith('version https://git-lfs.github.com/spec/'))reason='Git LFS pointer: external content not included.';
    else {report.scanned++;for(const f of inspectFile(file.path,source,allowReveal)){if(report.findings.length>=5000){report.findingsTruncated=true;break;}f.url=`https://github.com/${owner}/${repo}/blob/${report.commit}/${file.path.split('/').map(encodeURIComponent).join('/')}#L${f.line}`;report.findings.push(f);}}
   }catch(error){reason=signal.aborted?'Time budget exceeded or scan cancelled.':error instanceof Error&&error.message==='binary'?'Binary content (contains NUL bytes).':error instanceof TypeError?'Unsupported text encoding.':'Git object could not be read.';}
   report.coverage.push({path:file.path,status:reason?'skipped':'scanned',reason:reason||'Entire text file checked.'});
  }
  report.skipped=report.total-report.scanned;report.partial=report.skipped>0||report.findingsTruncated;
  report.warnings.push('Read through a shallow Git snapshot because GitHub metadata API limits were reached. Every tracked path is inventoried, including dotfolders and export-ignored files. No folder-name exclusions.');
  report.warnings.push('Default branch only. Git history, other branches, external submodule/LFS objects and general code/dependency vulnerabilities are not audited. Keys are never validated against providers.');
  if(report.findingsTruncated)report.warnings.push('All readable files checked; only the first 5,000 matches displayed.');
  report.durationMs=Date.now()-start;return report;
 }catch{throw new Error('The complete Git snapshot could not be read. Check network/Git availability and try again.');}
 finally{
  // Only delete the exact temporary directory created by this invocation.
  if(dirname(resolve(temp))===parent&&basename(temp).startsWith('redaxa-scan-'))await rm(temp,{recursive:true,force:true,maxRetries:3});
 }
}
