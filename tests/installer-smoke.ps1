param([string]$Version = '1.7.0')
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid version' }
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$qaBase = Join-Path $workspace '.installer-qa'
$qaRoot = [IO.Path]::GetFullPath((Join-Path $qaBase ('v' + $Version)))
if (-not $qaRoot.StartsWith($qaBase + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected QA path' }
$registryPaths = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
function FindLauncher { @(Get-ItemProperty $registryPaths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^(Estra )?FiveM Launcher( \d.*)?$' }) }
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Estra FiveM Launcher.lnk'
$startLink = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Estra FiveM Launcher.lnk'
$legacyDesktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'FiveM Launcher.lnk'
$legacyStartLink = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\FiveM Launcher.lnk'
if ((FindLauncher).Count -gt 0 -or (Test-Path -LiteralPath $desktopLink) -or (Test-Path -LiteralPath $startLink) -or (Test-Path -LiteralPath $legacyDesktopLink) -or (Test-Path -LiteralPath $legacyStartLink) -or (Test-Path -LiteralPath $qaRoot)) { throw 'Existing install, shortcut or QA directory; refusing to overwrite it' }
$setupPath = Join-Path $workspace ('release\Estra-FiveM-Launcher-Setup-' + $Version + '-x64.exe')
$setup = Start-Process -FilePath $setupPath -ArgumentList '/S', ('/D=' + $qaRoot) -WindowStyle Hidden -Wait -PassThru
if ($setup.ExitCode -ne 0) { throw ('Setup failed: ' + $setup.ExitCode) }
try {
  $exe = Join-Path $qaRoot 'Estra FiveM Launcher.exe'
  $shortcuts = New-Object -ComObject WScript.Shell
  $desktopTarget = $shortcuts.CreateShortcut($desktopLink).TargetPath
  $startTarget = $shortcuts.CreateShortcut($startLink).TargetPath
  if (-not (Test-Path -LiteralPath $exe) -or $desktopTarget -ne $exe -or $startTarget -ne $exe) { throw 'Missing app or incorrect shortcuts' }
  [ordered]@{ Version=$Version; ExitCode=$setup.ExitCode; AppExists=$true; DesktopTarget=$desktopTarget; StartMenuTarget=$startTarget } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot ('artifacts\installer-' + $Version + '.json')) -Encoding utf8
  $env:LAUNCHER_PACKAGED_EXE = $exe
  $env:LAUNCHER_DESKTOP_STAGE = 'installed-' + $Version
  $env:LAUNCHER_EXPECT_BANNER = '1'
  Push-Location $workspace
  try { node tests/desktop-smoke.cjs; if ($LASTEXITCODE -ne 0) { throw 'Installed app smoke failed' } } finally { Pop-Location }
} finally {
  $uninstaller = Join-Path $qaRoot 'Uninstall Estra FiveM Launcher.exe'
  $entries = @(FindLauncher)
  $expected = '"' + $uninstaller + '" /currentuser'
  if ($entries.Count -ne 1 -or $entries[0].UninstallString -ne $expected) { throw 'Registry does not match QA installation; refusing uninstall' }
  $remove = Start-Process -FilePath $uninstaller -ArgumentList '/S', ('_?=' + $qaRoot) -WindowStyle Hidden -Wait -PassThru
  $result = [ordered]@{ Version=$Version; UninstallerExitCode=$remove.ExitCode; AppRemoved=(-not (Test-Path -LiteralPath (Join-Path $qaRoot 'Estra FiveM Launcher.exe'))); DesktopShortcutRemoved=(-not (Test-Path -LiteralPath $desktopLink)); StartMenuShortcutRemoved=(-not (Test-Path -LiteralPath $startLink)); UninstallEntryRemoved=((FindLauncher).Count -eq 0) }
  $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot ('artifacts\installer-uninstall-' + $Version + '.json')) -Encoding utf8
  $result | ConvertTo-Json
  if ($remove.ExitCode -ne 0 -or -not $result.AppRemoved -or -not $result.DesktopShortcutRemoved -or -not $result.StartMenuShortcutRemoved -or -not $result.UninstallEntryRemoved) { throw 'Uninstall verification failed' }
}
