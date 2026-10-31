#Requires -Version 5.1
# axcrop.ps1 — 截全屏并裁剪指定区域、按倍数放大，用于精确读取控件坐标。
param(
    [int]$X = 0, [int]$Y = 0, [int]$W = 300, [int]$H = 400,
    [double]$Scale = 3.0,
    [string]$Name = 'crop',
    [string]$OutDir = 'C:\Users\xiaos\AppData\Local\Temp\axshots'
)
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$full = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g0 = [System.Drawing.Graphics]::FromImage($full)
$g0.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$g0.Dispose()
Write-Host "screen=$($b.Width)x$($b.Height)"
$rect = New-Object System.Drawing.Rectangle($X, $Y, $W, $H)
$crop = $full.Clone($rect, $full.PixelFormat)
$nw = [int]($W * $Scale); $nh = [int]($H * $Scale)
$out = New-Object System.Drawing.Bitmap($nw, $nh)
$g = [System.Drawing.Graphics]::FromImage($out)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$g.DrawImage($crop, 0, 0, $nw, $nh)
$g.Dispose()
$p = Join-Path $OutDir ("{0}_x{1}y{2}_{3}x{4}_s{5}.png" -f $Name, $X, $Y, $W, $H, $Scale)
$out.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
$crop.Dispose(); $out.Dispose(); $full.Dispose()
Write-Host "saved: $p"
Write-Host ("-> 图中任意点 (px,py) 对应的屏幕坐标 = ({0} + px/{1}, {2} + py/{1})" -f $X, $Scale, $Y)
