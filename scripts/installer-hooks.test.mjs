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

// Installed for all users as Program Files\Redaxa\Redaxa.exe, never the internal crate name.
assert.equal(conf.productName, 'Redaxa');
assert.equal(conf.mainBinaryName, 'Redaxa');
assert.equal(conf.bundle.windows.nsis.installMode, 'perMachine');
assert.equal(conf.identifier, 'com.aurelioavila.redaxa', 'settings and sign-in stay where they are: the identifier never changes');
// The per-user installation up to 0.5.5 (%LocalAppData%\Redaxa\redaxa-desktop.exe) is closed
// before files are copied and removed after, only when its own uninstall entry says so, and
// only by name: never the whole folder, never app data.
assert.match(preinstall, /RedaxaCloseByPath "\$RedaxaOldDir\\redaxa-desktop\.exe"/);
const migrate = /!macro RedaxaMigratePerUser([\s\S]*?)!macroend/.exec(hooks)?.[1] ?? '';
const postinstall = /!macro NSIS_HOOK_POSTINSTALL([\s\S]*?)!macroend/.exec(hooks)?.[1] ?? '';
assert.match(postinstall, /RedaxaMigratePerUser/);
assert.match(migrate, /StrCmp \$R9 '"\$RedaxaOldDir\\uninstall\.exe"' 0 redaxa_migrate_done/, 'only the standard per-user installation');
assert.match(migrate, /StrCmp \$RedaxaOldDir \$INSTDIR redaxa_migrate_done/, 'never its own folder');
const allowed = [
  'Delete "$RedaxaOldDir\\redaxa-desktop.exe"', 'Delete "$RedaxaOldDir\\uninstall.exe"', 'RMDir /r "$RedaxaOldDir\\repository-runtime"',
  'RMDir "$RedaxaOldDir"', 'Delete "$SMPROGRAMS\\${PRODUCTNAME}.lnk"', 'Delete "$DESKTOP\\${PRODUCTNAME}.lnk"',
];
for (const line of migrate.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(RMDir|Delete) /.test(l))) {
  assert.ok(allowed.includes(line), `removes only known program files and shortcuts: ${line}`);
}
assert.doesNotMatch(migrate, /com\.aurelioavila/, 'app data is never touched');
// The user's own paths are read in the user's context, then the installer's context comes back.
assert.match(hooks, /!macro RedaxaFindPerUser\s+SetShellVarContext current\s+StrCpy \$RedaxaOldDir "\$LOCALAPPDATA\\Redaxa"\s+!insertmacro SetContext/);
assert.match(postinstall, /SetShellVarContext current[\s\S]*PromptShield[\s\S]*!insertmacro SetContext/);
console.log('Installer hooks: Redaxa and its scanner are closed by exact path and waited for before files are replaced; all-users install as Redaxa.exe, the per-user one moved by name only.');
