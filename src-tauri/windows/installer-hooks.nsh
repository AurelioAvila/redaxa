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

; Up to 0.5.5 Redaxa installed for the signed-in user only, in %LocalAppData%\Redaxa,
; as redaxa-desktop.exe. It now installs for all users in Program Files\Redaxa, as
; Redaxa.exe. The per-user copy of the person running this setup is closed first and
; replaced afterwards (RedaxaMigratePerUser). $LOCALAPPDATA has to be read in the
; user's own context: in the all-users context it names ProgramData.
Var RedaxaOldDir
!macro RedaxaFindPerUser
  SetShellVarContext current
  StrCpy $RedaxaOldDir "$LOCALAPPDATA\Redaxa"
  !insertmacro SetContext
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro RedaxaCloseRunning
  !insertmacro RedaxaFindPerUser
  StrCmp $RedaxaOldDir $INSTDIR redaxa_old_closed
  !insertmacro RedaxaCloseByPath "$RedaxaOldDir\redaxa-desktop.exe"
  !insertmacro RedaxaCloseByPath "$RedaxaOldDir\repository-runtime\node.exe"
  !insertmacro RedaxaCloseByPath "$RedaxaOldDir\repository-runtime\git\bin\git.exe"
  !insertmacro RedaxaCloseByPath "$RedaxaOldDir\repository-runtime\git\bin\git-remote-https.exe"
  !insertmacro RedaxaWaitWritable "$RedaxaOldDir\redaxa-desktop.exe"
  redaxa_old_closed:
!macroend

; Removes the per-user installation this setup replaces, only when its own uninstall
; entry says it is the standard one in %LocalAppData%\Redaxa: the program files (by name,
; never the whole folder), its Installed apps entry, its Start menu shortcut and the
; redaxa:// link it registered. A desktop shortcut it had moves to the all-users desktop,
; where uninstalling removes it; a taskbar pin is pointed at the new program. Settings,
; history and the saved sign-in are stored by identifier (com.aurelioavila.redaxa, the
; Windows Credential Manager) and are not touched.
!macro RedaxaMigratePerUser
  StrCmp $RedaxaOldDir $INSTDIR redaxa_migrate_done
  ReadRegStr $R9 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Redaxa" "UninstallString"
  StrCmp $R9 '"$RedaxaOldDir\uninstall.exe"' 0 redaxa_migrate_done
  Delete "$RedaxaOldDir\redaxa-desktop.exe"
  Delete "$RedaxaOldDir\uninstall.exe"
  RMDir /r "$RedaxaOldDir\repository-runtime"
  RMDir "$RedaxaOldDir"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Redaxa"
  ; The app registers its own link again when it starts; until then the all-users one applies.
  ReadRegStr $R9 HKCU "Software\Classes\redaxa\shell\open\command" ""
  StrCmp $R9 '"$RedaxaOldDir\redaxa-desktop.exe" "%1"' 0 +2
  DeleteRegKey HKCU "Software\Classes\redaxa"
  SetShellVarContext current
  StrCpy $R8 0
  !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$RedaxaOldDir\redaxa-desktop.exe"
  Pop $0
  ${If} $0 = 1
    Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  ${EndIf}
  !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$RedaxaOldDir\redaxa-desktop.exe"
  Pop $0
  ${If} $0 = 1
    Delete "$DESKTOP\${PRODUCTNAME}.lnk"
    StrCpy $R8 1
  ${EndIf}
  StrCpy $R7 "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${PRODUCTNAME}.lnk"
  !insertmacro IsShortcutTarget "$R7" "$RedaxaOldDir\redaxa-desktop.exe"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$R7" "$INSTDIR\${MAINBINARYNAME}.exe"
  ${EndIf}
  !insertmacro SetContext
  ; An update skips the shortcuts of a fresh install: these replace the ones removed above.
  ${IfNot} ${FileExists} "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  ${EndIf}
  ${If} $R8 = 1
  ${AndIfNot} ${FileExists} "$DESKTOP\${PRODUCTNAME}.lnk"
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
  ${EndIf}
  redaxa_migrate_done:
!macroend

; Redaxa was called PromptShield before 0.2.0 (identifier com.aurelioavila.promptshield).
; Some PromptShield installations lost their program files but kept their uninstaller and
; their entry in Installed apps, which then shows an app that is no longer there. When Redaxa
; installs or updates, that broken leftover is removed. A PromptShield installation that still
; has its program is left as it is, and no app data is touched.
!macro NSIS_HOOK_POSTINSTALL
  !insertmacro RedaxaMigratePerUser
  ; PromptShield only ever installed for one user: its paths are the user's own.
  SetShellVarContext current
  ReadRegStr $R9 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PromptShield" "UninstallString"
  StrCmp $R9 '"$LOCALAPPDATA\PromptShield\uninstall.exe"' 0 promptshield_done
  IfFileExists "$LOCALAPPDATA\PromptShield\promptshield-desktop.exe" promptshield_done 0
  Delete "$LOCALAPPDATA\PromptShield\uninstall.exe"
  RMDir "$LOCALAPPDATA\PromptShield"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PromptShield"
  Delete "$SMPROGRAMS\PromptShield.lnk"
  Delete "$DESKTOP\PromptShield.lnk"
  promptshield_done:
  !insertmacro SetContext
!macroend
