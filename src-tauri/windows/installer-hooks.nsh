; Before any file is replaced, Redaxa and the local repository scanner it runs
; (node.exe and Git from repository-runtime) are closed without asking:
;  - by the updater, the app closes itself as it starts this installer, but its
;    program file can stay locked for a moment while it exits;
;  - when someone runs the downloaded installer with Redaxa open, it is still
;    running, and a scan may have the scanner open too.
; Restart Manager matches processes by their exact program file, so only copies
; started from this installation folder are closed, never another program that
; happens to share a file name. Redaxa is asked to close first, the way Windows
; closes apps for an update, and stopped only if it does not respond. Then the
; installer waits until each file can be replaced, so it never shows "Error
; opening file for writing". An update started by the app reopens it when done
; (/R); the normal installer offers "Run Redaxa" on its last page.

!macro RedaxaCloseByPath path
  !define RedaxaClose_ID ${__LINE__}
  Push $R8
  Push $0
  IfFileExists "${path}" 0 redaxa_close_done_${RedaxaClose_ID}
  !insertmacro RestartManager_StartSession $R8
  StrCmp $R8 "" redaxa_close_done_${RedaxaClose_ID}
  !insertmacro RestartManager_RegisterFile $R8 "${path}"
  ${If} $0 = 0
    System::Call 'RSTRTMGR::RmGetList(i$R8, *i .r1, *i .r2, p 0, *i .r3) i .r0'
    ${If} $0 = ${ERROR_MORE_DATA}
      ; Ask first; stop only an app that does not respond.
      System::Call 'RSTRTMGR::RmShutdown(i$R8, i0, p0) i .r0'
      ${If} $0 <> 0
        System::Call 'RSTRTMGR::RmShutdown(i$R8, i${RmForceShutdown}, p0) i .r0'
      ${EndIf}
    ${EndIf}
  ${EndIf}
  !insertmacro RestartManager_EndSession $R8
  redaxa_close_done_${RedaxaClose_ID}:
  Pop $0
  Pop $R8
  !undef RedaxaClose_ID
!macroend

; Waits up to 20 seconds for a program file to be replaceable. Opening it for
; appending fails while any process still runs it, and changes nothing.
!macro RedaxaWaitWritable path
  !define RedaxaWait_ID ${__LINE__}
  Push $R7
  Push $R6
  StrCpy $R7 0
  redaxa_wait_${RedaxaWait_ID}:
  IfFileExists "${path}" 0 redaxa_wait_done_${RedaxaWait_ID}
  ClearErrors
  FileOpen $R6 "${path}" a
  IfErrors redaxa_wait_locked_${RedaxaWait_ID}
  FileClose $R6
  Goto redaxa_wait_done_${RedaxaWait_ID}
  redaxa_wait_locked_${RedaxaWait_ID}:
  IntOp $R7 $R7 + 1
  IntCmp $R7 40 redaxa_wait_done_${RedaxaWait_ID} 0 redaxa_wait_done_${RedaxaWait_ID}
  Sleep 500
  Goto redaxa_wait_${RedaxaWait_ID}
  redaxa_wait_done_${RedaxaWait_ID}:
  Pop $R6
  Pop $R7
  !undef RedaxaWait_ID
!macroend

!macro RedaxaCloseRunning
  !insertmacro RedaxaCloseByPath "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro RedaxaCloseByPath "$INSTDIR\repository-runtime\node.exe"
  !insertmacro RedaxaCloseByPath "$INSTDIR\repository-runtime\git\bin\git.exe"
  !insertmacro RedaxaCloseByPath "$INSTDIR\repository-runtime\git\bin\git-remote-https.exe"
  !insertmacro RedaxaWaitWritable "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro RedaxaWaitWritable "$INSTDIR\repository-runtime\node.exe"
  !insertmacro RedaxaWaitWritable "$INSTDIR\repository-runtime\git\bin\git.exe"
  !insertmacro RedaxaWaitWritable "$INSTDIR\repository-runtime\git\bin\git-remote-https.exe"
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro RedaxaCloseRunning
!macroend

; Redaxa was called PromptShield before 0.2.0 (identifier com.aurelioavila.promptshield).
; Some PromptShield installations lost their program files but kept their uninstaller and
; their entry in Installed apps, which then shows an app that is no longer there. When Redaxa
; installs or updates, that broken leftover is removed. A PromptShield installation that still
; has its program is left as it is, and no app data is touched.
!macro NSIS_HOOK_POSTINSTALL
  ReadRegStr $R9 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PromptShield" "UninstallString"
  StrCmp $R9 '"$LOCALAPPDATA\PromptShield\uninstall.exe"' 0 promptshield_done
  IfFileExists "$LOCALAPPDATA\PromptShield\promptshield-desktop.exe" promptshield_done 0
  Delete "$LOCALAPPDATA\PromptShield\uninstall.exe"
  RMDir "$LOCALAPPDATA\PromptShield"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PromptShield"
  Delete "$SMPROGRAMS\PromptShield.lnk"
  Delete "$DESKTOP\PromptShield.lnk"
  promptshield_done:
!macroend
