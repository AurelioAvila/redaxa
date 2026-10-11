import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Windows installer must close Redaxa and its scanner runtime itself before
// replacing files (updates used to stop on "Error opening file for writing"),
// and it may only ever touch processes started from its own folder.
const hooks = readFileSync(new URL('../src-tauri/windows/installer-hooks.nsh', import.meta.url), 'utf8');
const conf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
assert.equal(conf.bundle.windows.nsis.installerHooks, './windows/installer-hooks.nsh');

const preinstall = /!macro NSIS_HOOK_PREINSTALL([\s\S]*?)!macroend/.exec(hooks)?.[1] ?? '';
assert.match(preinstall, /RedaxaCloseRunning/, 'the install step closes the running app first');
for (const file of ['${MAINBINARYNAME}.exe', 'repository-runtime\\node.exe', 'repository-runtime\\git\\bin\\git.exe', 'repository-runtime\\git\\bin\\git-remote-https.exe']) {
  assert.ok(hooks.includes(`RedaxaCloseByPath "$INSTDIR\\${file}"`), `${file} is closed by its exact path`);
  assert.ok(hooks.includes(`RedaxaWaitWritable "$INSTDIR\\${file}"`), `${file} is waited for until it can be replaced`);
}
// Restart Manager by file path only: never by process name, never a blanket kill.
assert.match(hooks, /RmRegisterResources|RestartManager_RegisterFile/);
assert.doesNotMatch(hooks, /taskkill|KillProcess|FindProcess|wmic|Stop-Process/i);
// A bounded wait: 40 tries of 500 ms.
assert.match(hooks, /IntCmp \$R7 40 /);
assert.match(hooks, /Sleep 500/);
console.log('Installer hooks: Redaxa and its scanner are closed by exact path and waited for before files are replaced.');
