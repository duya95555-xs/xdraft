#Requires -Version 5.1
<#
    axmenu.ps1 — 打开一个 .rp，关掉载入提示，然后枚举主窗口菜单树，
    找出「发布 / Publish」相关的菜单项及其快捷键，并尝试展开它。
#>
param(
    [Parameter(Mandatory = $true)][string]$File,
    [int]$WaitSec = 90,
    [string]$ShotDir = 'C:\Users\xiaos\AppData\Local\Temp\axshots'
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$exe = 'D:\Program Files (x86)\Axure\Axure RP 9\AxureRP9.exe'
New-Item -ItemType Directory -Force -Path $ShotDir | Out-Null
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, Microsoft.VisualBasic, System.Windows.Forms, System.Drawing

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]

function Get-Main($ProcId) {
    foreach ($e in $AE::RootElement.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
        try { if ($e.Current.ProcessId -eq $ProcId) { return $e } } catch { }
    }
    $null
}
function Shot($tag) {
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $p = Join-Path $ShotDir "$name`__$tag.png"
    $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    "shot=$p"
}
function Describe($e, $depth, [ref]$cnt) {
    if ($depth -gt 3) { return }
    try {
        $n = $e.Current.Name
        $ct = $e.Current.ControlType.ProgrammaticName -replace 'ControlType\.', ''
        $ak = $e.Current.AcceleratorKey
        $hw = $e.Current.NativeWindowHandle
        if ($n -or $ct -eq 'MenuItem') {
            "  $('  ' * $depth)[$ct] '$n' key=[$ak] hwnd=$hw"
            $cnt.Value++
        }
    } catch { }
}

$name = [System.IO.Path]::GetFileNameWithoutExtension($File)
"=== MENU PROBE: $name ==="
$proc = Start-Process -FilePath $exe -ArgumentList ('"{0}"' -f $File) -PassThru
$dl = (Get-Date).AddSeconds($WaitSec); $main = $null
while ((Get-Date) -lt $dl) {
    Start-Sleep -Milliseconds 1200
    $proc.Refresh(); if ($proc.HasExited) { 'EXITED_EARLY'; break }
    $main = Get-Main $proc.Id; if ($main) { break }
}
if (-not $main) { 'NO_WINDOW'; Stop-Process -Id $proc.Id -Force -EA SilentlyContinue; exit 2 }
"title=[$($main.Current.Name)]"
Start-Sleep -Seconds 8

# 关掉载入提示
[Microsoft.VisualBasic.Interaction]::AppActivate($proc.Id) | Out-Null
Start-Sleep -Milliseconds 600
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Seconds 2
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Seconds 2
Shot '1loaded'

# 枚举菜单项
"--- MenuItem 枚举 ---"
$mc = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::MenuItem)
$items = $main.FindAll($TS::Descendants, $mc)
"menuItems=$($items.Count)"
$cnt = 0
foreach ($e in $items) { Describe $e 0 ([ref]$cnt) }
"listed=$cnt"

# 统计所有 ControlType 分布
"--- ControlType 分布 ---"
$types = @{}
foreach ($e in $main.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    try { $t = $e.Current.ControlType.ProgrammaticName -replace 'ControlType\.', ''; $types[$t] = ($types[$t] + 1) } catch { }
}
$types.GetEnumerator() | Sort-Object -Property Value -Descending | ForEach-Object { "   $($_.Key) = $($_.Value)" }

# 找「发布 / Publish」
"--- 定位发布菜单 ---"
$hit = $null
foreach ($e in $items) {
    try {
        $n = $e.Current.Name
        if ($n -match '发布|Publish|生成') { $hit = $e; "HIT: '$n' key=[$($e.Current.AcceleratorKey)]" }
    } catch { }
}
if ($hit) {
    try {
        $p = $hit.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        if ($p) { $p.Expand(); 'EXPANDED' }
    } catch { "expand_err: $($_.Exception.Message)" }
    Start-Sleep -Seconds 2
    Shot '2pubmenu'
    "--- 展开后的子项 ---"
    $c = 0
    foreach ($e in $main.FindAll($TS::Descendants, $mc)) { Describe $e 1 ([ref]$c) }
}

Shot '3final'
'DONE_KEEP_OPEN'
