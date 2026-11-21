; Extra steps for OpenW's setup (electron-builder includes this in its NSIS script).
; The setup runs with administrator rights, so the controller drivers OpenW comes with go in
; here, silently, and the app never has to ask. Each one is skipped when Windows already
; has it, so a reinstall or update never repairs or removes it. Exit code 3010 means the
; driver wants a restart; the setup then offers one at the end.

!macro openwDriver SERVICE FILE
  ClearErrors
  ReadRegDWORD $R0 HKLM "SYSTEM\CurrentControlSet\Services\${SERVICE}" "Type"
  ${If} ${Errors}
    DetailPrint "Setting up ${SERVICE}..."
    ExecWait '"$INSTDIR\resources\app\drivers\${FILE}" /exenoui /qn /norestart' $R1
    DetailPrint "${SERVICE} setup finished with code $R1"
    ${If} $R1 == 3010
    ${OrIf} $R1 == 1641
      SetRebootFlag true
    ${EndIf}
  ${Else}
    DetailPrint "${SERVICE} is already installed"
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro openwDriver "ViGEmBus" "ViGEmBus_1.22.0_x64_x86_arm64.exe"
  !insertmacro openwDriver "HidHide" "HidHide_1.5.230_x64.exe"
!macroend

; Uninstalling OpenW leaves the drivers: other apps (DS4Windows, for one) may use them.
; They can be removed under Windows Settings, Apps.
