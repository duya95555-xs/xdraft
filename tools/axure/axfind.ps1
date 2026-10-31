#Requires -Version 5.1
# axfind.ps1 — 在指定屏幕区域内扫描"蓝色控件"，用于精确定位复选框 / 主按钮。
# 注意: PowerShell 变量名大小写不敏感，参数与循环变量必须用不同名字。
param(
    [int]$Rx = 830, [int]$Ry = 319, [int]$Rw = 260, [int]$Rh = 392,
    [int]$MinN = 3,
    [string]$OutDir = 'D:\KimiData\kimi\Workspaces\prototype-3in1\1.0.1\cook\_logs'
)
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$scr = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($scr.Width, $scr.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($scr.Location, [System.Drawing.Point]::Empty, $scr.Size)
$g.Dispose()
Write-Host "screen=$($scr.Width)x$($scr.Height) region=($Rx,$Ry) ${Rw}x${Rh}"
$lines = @()
$yEnd = [Math]::Min($Ry + $Rh, $bmp.Height)
$xEnd = [Math]::Min($Rx + $Rw, $bmp.Width)
for ($py = $Ry; $py -lt $yEnd; $py++) {
    $xs = New-Object System.Collections.Generic.List[int]
    for ($px = $Rx; $px -lt $xEnd; $px++) {
        $c = $bmp.GetPixel($px, $py)
        if ($c.B -gt 130 -and ($c.B - $c.R) -gt 45 -and $c.G -gt 80) { $xs.Add($px) }
    }
    if ($xs.Count -ge $MinN) {
        $lines += ("y={0} n={1} x=[{2}..{3}]" -f $py, $xs.Count, $xs[0], $xs[$xs.Count - 1])
    }
}
$p = Join-Path $OutDir 'blue_scan.txt'
$lines | Set-Content -Path $p -Encoding UTF8
Write-Host "blueRows=$($lines.Count) -> $p"
Write-Host "--- 全部行 ---"
$lines | ForEach-Object { Write-Host $_ }
$bmp.Dispose()
