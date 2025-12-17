!ifndef BUILD_UNINSTALLER
  !macro customFinishPage
    # Keep the default "Run" checkbox behavior.
    !ifndef HIDE_RUN_AFTER_FINISH
      Function StartApp
        ${if} ${isUpdated}
          StrCpy $1 "--updated"
        ${else}
          StrCpy $1 ""
        ${endif}
        ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
      FunctionEnd

      !define MUI_FINISHPAGE_RUN
      !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
    !endif

    # Add a desktop shortcut checkbox on the finish page.
    # Uses the "Show Readme" checkbox slot so it is grouped with "Run" and checked by default.
    Function CreateDesktopShortcut
      CreateShortCut "$DESKTOP\\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$DESKTOP\\${SHORTCUT_NAME}.lnk" "${APP_ID}"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    FunctionEnd

    !define MUI_FINISHPAGE_SHOWREADME
    !define MUI_FINISHPAGE_SHOWREADME_TEXT "Create desktop shortcut"
    !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "CreateDesktopShortcut"

    !insertmacro MUI_PAGE_FINISH
  !macroend
!endif
