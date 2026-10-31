#Requires -Version 5.1
<#
    axpublish.ps1 (v2) — 一键：打开 legacy .rp → UIA 关掉「项目已载入完成」弹窗
    → Ctrl+Shift+O 发布 HTML → UIA 点「Publish Locally」→ 等待产出。
    关键点：所有弹窗都通过 UI Automation 点击，不依赖键盘焦点（焦点不可靠）。
    用法: axpublish.ps1 -File "x.rp" [-WaitSec 90] [-AfterPubWaitSec 90]
#>
param(
    [Parameter(Mandatory = $true)][string]$File,
    [int]$WaitSec = 90,
    [int]$AfterPubWaitSec = 90,
    [string]$ShotDir = 'C:\Users\xiaos\AppData\Local\Temp\axshots'
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$exe = 'D:\Program Files (x86)\Axure\Axure RP 9\AxureRP9.exe'
New-Item -ItemType Directory -Force -Path $ShotDir | Out-Null
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, Microsoft.VisualBasic, System.Windows.Forms, System.Drawing

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$TC = [System.Windows.Automation.Condition]::TrueCondition

function Get-Main($ProcId) {
    foreach ($e in $AE::RootElement.FindAll($TS::Children, $TC)) {
        try { if ($e.Current.ProcessId -eq $ProcId) { return $e } } catch { }
    }
    $null
}
function All-Desc($root) {
    try { $root.FindAll($TS::Descendants, $TC) } catch { @() }
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
# 点击第一个名字匹配 pattern 的元素（先 Invoke，再 LegacyIAccessible，最后 SetFocus+Enter）
function Press-ByName($root, [string]$Pattern) {
    $found = @()
    foreach ($e in (All-Desc $root)) {
        try { if ($e.Current.Name -match $Pattern) { $found += $e } } catch { }
    }
    if ($found.Count -eq 0) { return "NOT_FOUND[$Pattern]" }
    foreach ($e in $found) {
        $ct = ''; try { $ct = $e.Current.ControlType.ProgrammaticName } catch { }
        try { $ip = $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); $ip.Invoke(); return "INVOKED[$Pattern]" } catch { }
        try { $lp = $e.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern); $lp.DoDefaultAction(); return "DOACTION[$Pattern]" } catch { }
        try { $e.SetFocus(); Start-Sleep -Milliseconds 400; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); return "FOCUS_ENTER[$Pattern]" } catch { }
    }
    return "ALL_FAILED[$Pattern]"
}
function Has-Text($root, [string]$Pattern) {
    foreach ($e in (All-Desc $root)) {
        try { if ($e.Current.Name -match $Pattern) { return $true } } catch { }
    }
    $false
}
# 循环关掉所有提示框（最多 6 轮）
function Dismiss-Popups($procId, [int]$MaxRounds = 6) {
    $done = @()
    for ($i = 1; $i -le $MaxRounds; $i++) {
        $main = Get-Main $procId
        if (-not $main) { break }
        Start-Sleep -Seconds 2
        if (Has-Text $main '载入完成|已载入') {
            $r = Press-ByName $main '关\s*闭'
            $done += "loaded-popup:$r"
            Start-Sleep -Seconds 2
            continue
        }
        if (Has-Text $main '另存为|不是有效的|无法打开|损坏') {
            $done += "other-popup-detected"
            break
        }
        break
    }
    $done
}

$name = [System.IO.Path]::GetFileNameWithoutExtension($File)
"=== PUBLISH v2: $name ==="
$proc = Start-Process -FilePath $exe -ArgumentList ('"{0}"' -f $File) -PassThru
"pid=$($proc.Id)"

$dl = (Get-Date).AddSeconds($WaitSec); $main = $null
while ((Get-Date) -lt $dl) {
    Start-Sleep -Milliseconds 1500
    $proc.Refresh(); if ($proc.HasExited) { 'EXITED_EARLY'; exit 3 }
    $main = Get-Main $proc.Id; if ($main) { break }
}
if (-not $main) { 'NO_WINDOW'; Stop-Process -Id $proc.Id -Force -EA SilentlyContinue; exit 2 }
"title=[$($main.Current.Name)]"
Start-Sleep -Seconds 8

"--- 关弹窗 ---"
Dismiss-Popups $proc.Id | ForEach-Object { "  $_" }
Shot '1loaded'

# 触发发布
[Microsoft.VisualBasic.Interaction]::AppActivate($proc.Id) | Out-Null
Start-Sleep -Milliseconds 800
[System.Windows.Forms.SendKeys]::SendWait('^+o')
Start-Sleep -Seconds 5
Shot '2pubdlg'

"press_publish : " + (Press-ByName (Get-Main $proc.Id) 'Publish Locally|发布')
Start-Sleep -Seconds 6
Shot '3publishing'

Start-Sleep -Seconds $AfterPubWaitSec
Shot '4done'
"main_now=[$((Get-Main $proc.Id).Current.Name)]"
"DONE"
