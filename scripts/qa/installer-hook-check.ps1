# Windows QA check, not part of npm test: compiles the installer hooks into a small
# NSIS test (makensis from the Tauri NSIS cache) and runs it against stand-in
# processes that hold the files open. Run: pwsh scripts/qa/installer-hook-check.ps1 -Repo .
# Exercises the installer's PREINSTALL hook against real running processes.
# Stand-in "apps" are copies of ping.exe placed where Redaxa's program files live.
param([string]$Repo)
$ErrorActionPreference = 'Stop'
$work = Join-Path ([IO.Path]::GetTempPath()) "redaxa-hook-check"; New-Item -ItemType Directory -Force $work | Out-Null
$makensis = "$env:LOCALAPPDATA\tauri\NSIS\Bin\makensis.exe"
$hooks = Join-Path $Repo 'src-tauri\windows\installer-hooks.nsh'
Copy-Item "$env:SystemRoot\System32\PING.EXE" "$work\payload.exe" -Force

$nsi = @"
Unicode true
!define MAINBINARYNAME "Redaxa"
!define PRODUCTNAME "Redaxa"
!define INSTALLMODE "currentUser"
; Stand-in for the Tauri template's macro (utils.nsh); this test installs for the current user.
!macro SetContext
  SetShellVarContext current
!macroend
!define /ifndef ERROR_MORE_DATA 234
!include LogicLib.nsh
!include "Win\RestartManager.nsh"
!include "$hooks"
Name "RedaxaHookTest"
OutFile "$work\hooktest.exe"
RequestExecutionLevel user
InstallDir "$work\inst"
SilentInstall silent
AllowSkipFiles on
Section
  SetOutPath `$INSTDIR
  !insertmacro NSIS_HOOK_PREINSTALL
  ClearErrors
  SetOverwrite on
  File "/oname=Redaxa.exe" "$work\payload.exe"
  CreateDirectory "`$INSTDIR\repository-runtime"
  File "/oname=repository-runtime\node.exe" "$work\payload.exe"
  FileOpen `$9 "$work\result.txt" w
  `${If} `${Errors}
    FileWrite `$9 "FAIL"
  `${Else}
    FileWrite `$9 "OK"
  `${EndIf}
  FileClose `$9
SectionEnd
"@
Set-Content -Path "$work\hooktest.nsi" -Value $nsi -Encoding UTF8
& $makensis /V2 "$work\hooktest.nsi" | Out-Null
if (-not (Test-Path "$work\hooktest.exe")) { throw 'makensis failed' }

function Reset-Inst {
  if (Test-Path "$work\inst") { Get-ChildItem "$work\inst" -Recurse -File | ForEach-Object { $_.IsReadOnly = $false } }
  New-Item -ItemType Directory -Force "$work\inst\repository-runtime" | Out-Null
  Copy-Item "$work\payload.exe" "$work\inst\Redaxa.exe" -Force
  Copy-Item "$work\payload.exe" "$work\inst\repository-runtime\node.exe" -Force
  New-Item -ItemType Directory -Force "$work\other" | Out-Null
  Copy-Item "$work\payload.exe" "$work\other\Redaxa.exe" -Force
  Remove-Item "$work\result.txt" -ErrorAction SilentlyContinue
}
function Run-Case([string]$name, [scriptblock]$setup) {
  Reset-Inst
  $procs = & $setup
  $decoy = Start-Process "$work\other\Redaxa.exe" -ArgumentList '-n 120 127.0.0.1' -WindowStyle Hidden -PassThru
  Start-Sleep -Milliseconds 800
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process "$work\hooktest.exe" -PassThru -Wait
  $sw.Stop()
  $result = if (Test-Path "$work\result.txt") { Get-Content "$work\result.txt" -Raw } else { 'NO RESULT' }
  $closed = @($procs | Where-Object { $_ -and -not $_.HasExited }).Count -eq 0
  $decoyAlive = -not $decoy.HasExited
  "{0,-34} files replaced: {1,-4} stand-ins closed: {2,-5} unrelated same-name process untouched: {3,-5} {4:n1} s" -f $name, $result.Trim(), $closed, $decoyAlive, $sw.Elapsed.TotalSeconds
  if (-not $decoy.HasExited) { Stop-Process -Id $decoy.Id -Force }
  foreach ($x in $procs) { if ($x -and -not $x.HasExited) { Stop-Process -Id $x.Id -Force } }
}

Run-Case 'nothing running' { @() }
Run-Case 'app and scanner open (manual install)' {
  @( (Start-Process "$work\inst\Redaxa.exe" -ArgumentList '-n 120 127.0.0.1' -WindowStyle Hidden -PassThru),
     (Start-Process "$work\inst\repository-runtime\node.exe" -ArgumentList '-n 120 127.0.0.1' -WindowStyle Hidden -PassThru) )
}
Run-Case 'app still exiting (update)' {
  @( (Start-Process "$work\inst\Redaxa.exe" -ArgumentList '-n 4 127.0.0.1' -WindowStyle Hidden -PassThru) )
}
