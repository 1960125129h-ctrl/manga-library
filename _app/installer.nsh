; Extra cleanup on uninstall (electron-builder doesn't remove these by default).
; ASCII only on purpose: makensis may read this file with the system code page.

!macro customUnInstall
  ; Fallback profile: only used when the install dir is not writable
  RMDir /r "$APPDATA\shuku-app"
  ; .cbz association is written to HKCU\Software\Classes\.cbz on install
  DeleteRegKey HKCU "Software\Classes\.cbz"
  ; NOTE: "$INSTDIR\data" (settings, cache, reading progress) is kept on purpose.
  ; NSIS only removes files it installed, so an app-created data dir survives.
  ; The manga library directory is never touched by the uninstaller.
!macroend
