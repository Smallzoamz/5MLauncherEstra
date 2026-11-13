$ErrorActionPreference = 'Stop'
try {
    $payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ESTRA_LAUNCH_PAYLOAD)) | ConvertFrom-Json
    # Arguments contain only the validated target, build, pure level and CL2.
    # Never evaluate the payload or interpolate a path into PowerShell source.
    if ([IO.Path]::GetFileName($payload.exe) -ine 'FiveM.exe' -or !(Test-Path -LiteralPath $payload.exe -PathType Leaf)) { throw 'FiveM.exe not found' }
    foreach ($argument in $payload.args) {
        if ($argument -cne '-cl2' -and $argument -cnotmatch '^-b[1-9][0-9]{3,4}$' -and $argument -cnotmatch '^-pure_[012]$' -and $argument -cnotmatch '^fivem://connect/[a-z0-9.:/-]+$') { throw 'Invalid FiveM argument' }
    }
    $shell = New-Object -ComObject Shell.Application
    $desktopHandle = 0
    $desktop = $shell.Windows().FindWindowSW(0, 0, 8, [ref]$desktopHandle, 1)
    if (!$desktop) { throw 'Windows Explorer desktop is unavailable' }
    $desktop.Document.Application.ShellExecute([string]$payload.exe, [string]($payload.args -join ' '), [string]$payload.cwd, 'open', 1)
} catch {
    [Console]::Error.WriteLine('Windows could not open FiveM through Explorer: ' + $_.Exception.Message)
    exit 1
}
