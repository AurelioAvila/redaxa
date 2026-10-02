import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

if (!process.argv.includes('--child')) {
  // A regressed quadratic scan must time out in a disposable process, rather
  // than freeze the complete test runner as an in-process timing test would.
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child'], {timeout:15_000, encoding:'utf8'});
  assert.equal(child.error, undefined, `PEM scan exceeded its bounded process budget: ${child.error?.message}`);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  console.log(child.stdout.trim());
} else {
  const compile = file => ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const credentialExports = {};
  vm.runInNewContext(compile('../credential-context.ts'), {exports:credentialExports,Buffer,TextDecoder,URL});
  const scannerExports = {};
  vm.runInNewContext(compile('../scanner.ts'), {exports:scannerExports,require:name=>{assert.equal(name,'./credential-context.js');return credentialExports;}});
  const {inspectPrompt} = scannerExports;
  const options = {includePersonalData:false,includeFinancialData:false,includeCredentials:true};
  const key = type => `-----BEGIN ${type}PRIVATE KEY-----\nc2FtcGxl\n-----END ${type}PRIVATE KEY-----`;
  for (const type of ['', 'RSA ', 'EC ', 'OPENSSH ', 'ENCRYPTED ']) {
    const result = inspectPrompt(`before\n${key(type)}\nafter`, options);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].value, key(type));
    assert.equal(result.redactedText, 'before\n[PRIVATE KEY]\nafter');
  }
  const mismatch = '-----BEGIN RSA PRIVATE KEY-----\nc2FtcGxl\n-----END EC PRIVATE KEY-----';
  assert.equal(inspectPrompt(mismatch, options).findings.length, 0);
  const nested = '-----BEGIN RSA PRIVATE KEY-----\nunfinished\n' + key('EC ');
  const nestedResult = inspectPrompt(nested, options);
  assert.equal(nestedResult.findings.length, 1);
  assert.equal(nestedResult.findings[0].value, key('EC '));
  assert.match(nestedResult.redactedText, /unfinished\n\[PRIVATE KEY\]$/);
  const mixed = key('RSA ') + '\n' + key('EC ');
  assert.equal(inspectPrompt(mixed, options).redactedText, '[PRIVATE KEY]\n[PRIVATE KEY]');
  assert.equal(inspectPrompt(mixed, {...options, includeCredentials:false}).redactedText, mixed);
  const longType = 'A'.repeat(65) + ' ';
  assert.equal(inspectPrompt(key(longType), options).findings.length, 0);
  for (const size of [4 * 1024 * 1024, 12 * 1024 * 1024]) {
    const unterminated = '-----BEGIN RSA PRIVATE KEY-----\n'.repeat(Math.ceil(size / 32));
    const result = inspectPrompt(unterminated, options);
    assert.equal(result.findings.length, 0);
    assert.equal(result.redactedText, unterminated);
  }
  console.log('PEM types, mismatches, nesting and large unterminated inputs passed within the isolated time budget.');
}
