import {copyFileSync,cpSync,existsSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,dirname,basename,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';

// Only this generated directory may be replaced. Never copy a whole developer
// installation: its root can contain unrelated user files and credentials.
const root=process.cwd(),output=resolve(root,'src-tauri','repository-runtime');
if(dirname(output)!==resolve(root,'src-tauri')||basename(output)!=='repository-runtime')throw new Error('Unsafe runtime output');
const sourceFiles=['scripts/repository-engine.mjs','scripts/build-repository-runtime.mjs','dist/repository-full.js','dist/repository-scanner.js','dist/repository-git.js','dist/scanner.js','package-lock.json'];
const sourceFingerprint=createHash('sha256').update(sourceFiles.map(file=>file+'\0'+readFileSync(resolve(root,file),'utf8')).join('\0')).digest('hex');
await (async()=>{
if(process.env.REDAXA_RUNTIME_PREPARED==='1'){
 const manifest=JSON.parse(readFileSync(join(output,'runtime-manifest.json'),'utf8'));
 if(manifest.sourceFingerprint!==sourceFingerprint)throw new Error('Prepared runtime is stale. Rebuild and sign it again.');
 for(const file of manifest.files){const path=join(output,file.path);if(!existsSync(path))throw new Error('Incomplete prepared runtime: '+file.path);if(!/\.(?:exe|dll)$/i.test(file.path)&&createHash('sha256').update(readFileSync(path)).digest('hex')!==file.sha256)throw new Error('Prepared runtime integrity mismatch: '+file.path);}
 console.log('Reusing prepared repository runtime; publisher signatures preserved.');return;
}
const node=process.env.REDAXA_BUILD_NODE||process.execPath;
const gitRoot=process.env.REDAXA_BUILD_GIT||'C:/Program Files/Git';
const bin=join(gitRoot,'mingw64','bin'),core=join(gitRoot,'mingw64','libexec','git-core');
if(process.platform!=='win32'||process.arch!=='x64')throw new Error('Windows x64 runtime packaging is required.');
for(const file of [node,join(bin,'git.exe'),join(core,'git-remote-https.exe')])if(!existsSync(file))throw new Error('Missing build runtime: '+file);
rmSync(output,{recursive:true,force:true});mkdirSync(join(output,'git','bin'),{recursive:true});mkdirSync(join(output,'licenses'),{recursive:true});
copyFileSync(node,join(output,'node.exe'));

// Follow PE import tables so every required non-system DLL is bundled without
// shipping optional credential managers, shells, hooks or external Git tools.
function imports(file){
 const b=readFileSync(file),pe=b.readUInt32LE(0x3c);if(b.toString('ascii',pe,pe+4)!=='PE\0\0')throw new Error('Invalid PE runtime');
 const coff=pe+4,n=b.readUInt16LE(coff+2),optional=coff+20,size=b.readUInt16LE(coff+16),directory=optional+(b.readUInt16LE(optional)===0x20b?112:96);
 const sections=[];for(let i=0;i<n;i++){const p=optional+size+i*40;sections.push({rva:b.readUInt32LE(p+12),size:Math.max(b.readUInt32LE(p+8),b.readUInt32LE(p+16)),offset:b.readUInt32LE(p+20)});}
 const offset=rva=>{const s=sections.find(s=>rva>=s.rva&&rva<s.rva+s.size);if(!s)throw new Error('Invalid PE import');return s.offset+rva-s.rva;};
 const rva=b.readUInt32LE(directory+8);if(!rva)return[];const found=[];
 for(let p=offset(rva);b.readUInt32LE(p+12);p+=20){const start=offset(b.readUInt32LE(p+12)),end=b.indexOf(0,start);found.push(b.toString('ascii',start,end));}return found;
}
const available=new Map(readdirSync(bin).map(name=>[name.toLowerCase(),join(bin,name)]));
const done=new Set();
function include(file){const name=basename(file);if(done.has(name.toLowerCase()))return;done.add(name.toLowerCase());copyFileSync(file,join(output,'git','bin',name));for(const dep of imports(file)){const path=available.get(dep.toLowerCase());if(path)include(path);else if(!existsSync(join(process.env.SystemRoot||'C:/Windows','System32',dep))&&!/^(api-ms-|ext-ms-)/i.test(dep))throw new Error('Missing runtime dependency: '+dep);}}
include(join(bin,'git.exe'));include(join(core,'git-remote-https.exe'));
// Git's HTTPS helper loads libcurl dynamically rather than through PE imports.
include(join(bin,'libcurl-4.dll'));
copyFileSync(join(gitRoot,'LICENSE.txt'),join(output,'licenses','Git-for-Windows-LICENSE.txt'));
cpSync(join(gitRoot,'mingw64','share','licenses'),join(output,'licenses','Git-dependencies'),{recursive:true});
const nodeVersion=execFileSync(node,['--version'],{encoding:'utf8'}).trim();
const license=await fetch('https://raw.githubusercontent.com/nodejs/node/'+nodeVersion+'/LICENSE',{signal:AbortSignal.timeout(30_000)});if(!license.ok)throw new Error('Cannot retrieve the matching Node license');writeFileSync(join(output,'licenses','Node-LICENSE.txt'),await license.text());
const bundled=await build({entryPoints:[resolve(root,'scripts','repository-engine.mjs')],outfile:join(output,'engine.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',legalComments:'eof',metafile:true});
writeFileSync(join(output,'licenses','SOURCE-NOTICES.txt'),`Unmodified Node.js ${nodeVersion}: https://github.com/nodejs/node/tree/${nodeVersion}\nGit for Windows: https://github.com/git-for-windows/git (version recorded in runtime-manifest.json). Corresponding source releases: https://github.com/git-for-windows/git/releases\nGit dependencies and their license notices are included in Git-dependencies.\nBundled JavaScript modules retain source license comments.\n`);
const packages=new Set(Object.keys(bundled.metafile.inputs).filter(path=>path.startsWith('node_modules/')).map(path=>{const parts=path.split('/');return parts[1].startsWith('@')?parts.slice(1,3).join('/'):parts[1];}));
for(const name of packages){const dir=resolve(root,'node_modules',name);const licenseName=readdirSync(dir).find(f=>/^licen[sc]e(?:\.|$)/i.test(f));if(!licenseName)throw new Error('Missing third-party license: '+name);copyFileSync(join(dir,licenseName),join(output,'licenses',name.replaceAll('/','-')+'-LICENSE.txt'));}
const files=[];function inventory(dir){for(const item of readdirSync(dir,{withFileTypes:true})){const path=join(dir,item.name);if(item.isDirectory())inventory(path);else files.push({path:path.slice(output.length+1).replaceAll('\\','/'),sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});}}inventory(output);
writeFileSync(join(output,'runtime-manifest.json'),JSON.stringify({sourceFingerprint,node:nodeVersion,git:execFileSync(join(bin,'git.exe'),['--version'],{encoding:'utf8'}).trim(),files},null,2));
console.log(`Packaged ${done.size} Git runtime binaries plus Node ${nodeVersion} and the private scanner engine.`);
})();
