import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
const parent=fs.realpathSync(os.tmpdir());
const root=fs.mkdtempSync(path.join(parent,'redaxa-updater-test-'));
try {
  for(const dir of ['scripts','src-tauri/target/release/bundle/nsis','src-tauri/target/release/bundle/msi']) fs.mkdirSync(path.join(root,dir),{recursive:true});
  fs.copyFileSync(new URL('./make-latest-json.mjs',import.meta.url),path.join(root,'scripts/make-latest-json.mjs'));
  fs.writeFileSync(path.join(root,'src-tauri/tauri.conf.json'),JSON.stringify({version:'0.4.0',plugins:{updater:{endpoints:['https://dl.pctweaker.app/redaxa/latest.json','https://github.com/AurelioAvila/redaxa/releases/latest/download/latest.json']}}}));
  fs.writeFileSync(path.join(root,'notes.md'),'# Redaxa\n\nUpdate notes.\n');
  const nsis=path.join(root,'src-tauri/target/release/bundle/nsis/Redaxa_0.4.0_x64-setup.exe');
  const msi=path.join(root,'src-tauri/target/release/bundle/msi/Redaxa_0.4.0_x64_en-US.msi');
  // A minisign signature as `tauri signer sign` writes it (base64 of four lines).
  const sig=(file,extra='')=>Buffer.from(`untrusted comment: signature from tauri secret key\nRUQfixture\ntrusted comment: timestamp:1792656968\tfile:${file}${extra}\nfixture\n`).toString('base64');
  fs.writeFileSync(nsis,'test fixture');fs.writeFileSync(nsis+'.sig',sig('Redaxa_0.4.0_x64-setup.exe'));
  fs.writeFileSync(msi,'test fixture');
  const run=()=>spawnSync(process.execPath,[path.join(root,'scripts/make-latest-json.mjs'),'notes.md'],{cwd:root,encoding:'utf8'});
  assert.notEqual(run().status,0,'Missing MSI signature must prevent publication');
  fs.writeFileSync(msi+'.sig',sig('Redaxa_0.4.0_x64_en-US.msi'));
  assert.equal(run().status,0);
  const manifest=JSON.parse(fs.readFileSync(path.join(path.dirname(nsis),'latest.json')));
  assert.deepEqual(manifest.platforms['windows-x86_64'],manifest.platforms['windows-x86_64-nsis'],'Legacy fallback remains NSIS');
  assert.equal(manifest.platforms['windows-x86_64-msi'].url,'https://github.com/AurelioAvila/redaxa/releases/download/v0.4.0/Redaxa_0.4.0_x64_en-US.msi');
  assert.equal(manifest.platforms['windows-x86_64-msi'].signature,sig('Redaxa_0.4.0_x64_en-US.msi'));
  assert.equal(manifest.platforms['windows-x86_64-nsis'].signature,sig('Redaxa_0.4.0_x64-setup.exe'));
  // Installed clients read everything after "\tfile:" as the file name, so a
  // version-bound signature (0.6.3) or another file's signature is refused.
  for(const [bad,why] of [[sig('Redaxa_0.4.0_x64_en-US.msi','\tversion:0.4.0'),'version-bound signature'],[sig('Redaxa_0.3.9_x64_en-US.msi'),'signature of another file']]){
    fs.writeFileSync(msi+'.sig',bad);
    const refused=run();
    assert.notEqual(refused.status,0,`${why} must prevent publication`);
    assert.match(refused.stderr,/trusted comment must be exactly/);
  }
  fs.writeFileSync(msi+'.sig',' \n');
  assert.notEqual(run().status,0,'Empty signature must prevent publication');
  console.log('Updater metadata: MSI/NSIS pairing, legacy fallback, missing/empty signature and client-readable signed file name passed.');
} finally {
  if(path.dirname(fs.realpathSync(root))!==parent||!path.basename(root).startsWith('redaxa-updater-test-'))throw new Error('Unsafe test cleanup');
  fs.rmSync(root,{recursive:true,force:true});
}
