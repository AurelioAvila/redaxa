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
