Var ProjectSyncInstallProbe
Var ProjectSyncInstallCandidate
Var ProjectSyncInstallSuffix
Var ProjectSyncInstallEntry
Var ProjectSyncInstallFindHandle
Var ProjectSyncInstallIsEmpty
Var ProjectSyncInstallIsExisting

Function ProjectSyncCheckExistingInstallation
  StrCpy $ProjectSyncInstallIsExisting 0
  IfFileExists "$ProjectSyncInstallProbe\${MAINBINARYNAME}.exe" 0 ProjectSyncCheckExistingInstallationDone
  IfFileExists "$ProjectSyncInstallProbe\uninstall.exe" ProjectSyncCheckExistingInstallationFound

  ReadRegStr $0 HKCU "Software\projectsync\ProjectSync" "InstallDir"
  StrCmp $0 "$ProjectSyncInstallProbe" ProjectSyncCheckExistingInstallationFound
  StrCmp $0 "$ProjectSyncInstallProbe\" ProjectSyncCheckExistingInstallationFound
  ReadRegStr $0 HKLM "Software\projectsync\ProjectSync" "InstallDir"
  StrCmp $0 "$ProjectSyncInstallProbe" ProjectSyncCheckExistingInstallationFound
  StrCmp $0 "$ProjectSyncInstallProbe\" ProjectSyncCheckExistingInstallationFound
  Goto ProjectSyncCheckExistingInstallationDone

  ProjectSyncCheckExistingInstallationFound:
    StrCpy $ProjectSyncInstallIsExisting 1
  ProjectSyncCheckExistingInstallationDone:
FunctionEnd

Function ProjectSyncCheckInstallDirectoryEmpty
  StrCpy $ProjectSyncInstallIsEmpty 1
  FindFirst $ProjectSyncInstallFindHandle $ProjectSyncInstallEntry "$ProjectSyncInstallProbe\*.*"
  ProjectSyncCheckInstallDirectoryEmptyLoop:
    StrCmp $ProjectSyncInstallEntry "" ProjectSyncCheckInstallDirectoryEmptyDone
    StrCmp $ProjectSyncInstallEntry "." ProjectSyncCheckInstallDirectoryEmptyNext
    StrCmp $ProjectSyncInstallEntry ".." ProjectSyncCheckInstallDirectoryEmptyNext
    StrCpy $ProjectSyncInstallIsEmpty 0
    Goto ProjectSyncCheckInstallDirectoryEmptyDone
  ProjectSyncCheckInstallDirectoryEmptyNext:
    FindNext $ProjectSyncInstallFindHandle $ProjectSyncInstallEntry
    Goto ProjectSyncCheckInstallDirectoryEmptyLoop
  ProjectSyncCheckInstallDirectoryEmptyDone:
    FindClose $ProjectSyncInstallFindHandle
FunctionEnd

Function ProjectSyncResolveInstallDirectory
  ; Keep an existing ProjectSync installation in place for upgrades.
  StrCpy $ProjectSyncInstallProbe "$INSTDIR"
  Call ProjectSyncCheckExistingInstallation
  StrCmp $ProjectSyncInstallIsExisting 1 ProjectSyncResolveInstallDirectoryDone

  ; A missing or empty destination can be used directly.
  IfFileExists "$INSTDIR\." 0 ProjectSyncResolveInstallDirectoryDone
  StrCpy $ProjectSyncInstallProbe "$INSTDIR"
  Call ProjectSyncCheckInstallDirectoryEmpty
  StrCmp $ProjectSyncInstallIsEmpty 1 ProjectSyncResolveInstallDirectoryDone

  ; Keep existing user files untouched by installing into a dedicated child directory.
  StrCpy $ProjectSyncInstallCandidate "$INSTDIR\${PRODUCTNAME}"
  StrCpy $ProjectSyncInstallSuffix 2
  ProjectSyncResolveInstallDirectoryCandidateLoop:
    StrCpy $ProjectSyncInstallProbe "$ProjectSyncInstallCandidate"
    Call ProjectSyncCheckExistingInstallation
    StrCmp $ProjectSyncInstallIsExisting 1 ProjectSyncResolveInstallDirectoryUseCandidate
    IfFileExists "$ProjectSyncInstallCandidate\." 0 ProjectSyncResolveInstallDirectoryUseCandidate
    StrCpy $ProjectSyncInstallProbe "$ProjectSyncInstallCandidate"
    Call ProjectSyncCheckInstallDirectoryEmpty
    StrCmp $ProjectSyncInstallIsEmpty 1 ProjectSyncResolveInstallDirectoryUseCandidate
    IntOp $ProjectSyncInstallSuffix $ProjectSyncInstallSuffix + 1
    StrCpy $ProjectSyncInstallCandidate "$INSTDIR\${PRODUCTNAME} ($ProjectSyncInstallSuffix)"
    Goto ProjectSyncResolveInstallDirectoryCandidateLoop

  ProjectSyncResolveInstallDirectoryUseCandidate:
    StrCpy $INSTDIR "$ProjectSyncInstallCandidate"
    SetOutPath "$INSTDIR"
    IfSilent ProjectSyncResolveInstallDirectoryDone
    MessageBox MB_OK|MB_ICONINFORMATION "所选目录非空，ProjectSync 将安装到： $INSTDIR"

  ProjectSyncResolveInstallDirectoryDone:
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  Call ProjectSyncResolveInstallDirectory
!macroend
