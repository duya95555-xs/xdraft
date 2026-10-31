#Requires -Version 5.1
<#
    axkey.ps1 — 对已在运行的 Axure 发送按键序列，每步截图。
    -Keys 里用 ; 分隔多个按键组合，如 "%u;{ENTER}"
#>
param(
    [string]$Keys = '%u',
    [int]$StepWaitMs = 1500,
    [string]$ShotDir = 'C:\Users\xiaos\AppData\Local\Temp\axshots',
    [string]$Tag = 'key'
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName Microsoft.VisualBasic, System.Windows.Forms, System.Drawing

New-Item -ItemType Directory -Force -Path $ShotDir | Out-Null

$proc = Get-Process AxureRP9 -EA SilentlyContinue | Select-Object -First 1
if (-not $proc) { 'NO_AXURE_RUNNING'; exit 2 }
"axure pid=$($proc.Id) title=[$($proc.MainWindowTitle)]"

[Microsoft.VisualBasic.Interaction]::AppActivate($proc.Id) | Out-Null
Start-Sleep -Milliseconds 800
$proc.Refresh()
[Microsoft.VisualBasic.Interaction]::AppActivate($proc.Id) | Out-Null
Start-Sleep -Milliseconds 500

$i = 0
foreach ($k in ($Keys -split ';')) {
    $k = $k.Trim()
    if (-not $k) { continue }
    $i++
    "send [$k]"
    [System.Windows.Forms.SendKeys]::SendWait($k)
    Start-Sleep -Milliseconds $StepWaitMs
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $p = Join-Path $ShotDir ("$Tag`_$i.png")
    $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    "shot=$p"
}
'DONE'
