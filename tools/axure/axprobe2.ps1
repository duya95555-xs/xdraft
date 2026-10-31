#Requires -Version 5.1
<#
    axprobe2.ps1 — 一次性探测 Axure 发布链路的真实结构。
    输出: UIA 控件树 dump + 每一步截图 + 控制台日志。

    探测点:
      1) 启动 Axure 打开文件，等标题正确
      2) 弹窗清理：逐轮记录检测到的弹窗文本与点击结果
      3) 【硬焦点】SetForegroundWindow + TOPMOST 强制 Axure 上前台，校验前台 PID
      4) Ctrl+Shift+O → 截图 + dump 主窗口控件树（找发布对话框）
      5) dump 所有出现过的窗口（含独立弹窗）
#>
param(
    [string]$File = 'D:\KimiData\kimi\Workspaces\prototype-3in1\1.0.1\cook\_one\t01.rp',
    [string]$OutDir = 'D:\KimiData\kimi\Workspaces\prototype-3in1\1.0.1\cook\_logs',
    [int]$WaitSec = 240,
    [string]$AxureExe = 'D:\Program Files (x86)\Axure\Axure RP 9\AxureRP9.exe',
    [string]$AxureData = 'C:\Users\xiaos\AppData\Local\Axure\Axure-9-0',
    [string]$ShotDir = 'C:\Users\xiaos\AppData\Local\Temp\axshots'
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, Microsoft.VisualBasic, System.Windows.Forms, System.Drawing

if (-not ('AxW.U' -as [type])) {
    Add-Type -Namespace AxW -Name U -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hAfter, int X, int Y, int W, int H, uint flags);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int pid);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
'@
}

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$TC = [System.Windows.Automation.Condition]::TrueCondition
$WALK = [System.Windows.Automation.TreeWalker]::ControlViewWalker
New-Item -ItemType Directory -Force -Path $OutDir, $ShotDir | Out-Null
$LOG = Join-Path $OutDir 'probe2.log'
Remove-Item $LOG -Force -EA SilentlyContinue
function Log($m) { $l = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m; Write-Host $l; Add-Content -Path $LOG -Value $l -Encoding UTF8 }

function Get-TopWindows($ProcId) {
    $r = @()
    foreach ($e in $AE::RootElement.FindAll($TS::Children, $TC)) { try { if ($e.Current.ProcessId -eq $ProcId) { $r += $e } } catch { } }
    , $r
}
function Get-Main($ProcId) {
    $best = $null; $area = -1.0
    foreach ($e in $AE::RootElement.FindAll($TS::Children, $TC)) {
        try {
            if ($e.Current.ProcessId -ne $ProcId) { continue }
            $r = $e.Current.BoundingRectangle
            $a = [double]$r.Width * [double]$r.Height
            if ($a -gt $area) { $area = $a; $best = $e }
        } catch { }
    }
    $best
}
function All-Desc($root) { if (-not $root) { return @() }; try { return $root.FindAll($TS::Descendants, $TC) } catch { return @() } }
function Find-ByText($root, $pat) { foreach ($e in (All-Desc $root)) { try { $n = $e.Current.Name; if ($n -and $n -match $pat) { return $e } } catch { } }; $null }
function Get-Ancestor($el, $lv) {
    $c = $el
    for ($i = 1; $i -le $lv; $i++) {
        try { $p = $WALK.GetParent($c) } catch { $p = $null }
        if (-not $p) { break }
        try { if ($p.Current.ProgrammaticName -eq 'ControlType.Window') { break } } catch { }
        $c = $p
    }
    $c
}
function Click-Button-In($scope, $pat) {
    if (-not $scope) { return 'NO_SCOPE' }
    $b = @(); $o = @()
    foreach ($e in (All-Desc $scope)) {
        try {
            $n = $e.Current.Name
            if (-not $n -or $n -notmatch $pat) { continue }
            if ($e.Current.ControlType.ProgrammaticName -match 'Button') { $b += $e } else { $o += $e }
        } catch { }
    }
    foreach ($e in (@($b) + @($o))) {
        try { $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); return "INVOKED:$($e.Current.Name)" } catch { }
        try { $e.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern).DoDefaultAction(); return "DOACTION:$($e.Current.Name)" } catch { }
        try { $e.SetFocus(); Start-Sleep -Milliseconds 250; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); return "FOCUS_ENTER:$($e.Current.Name)" } catch { }
    }
    'NONE'
}
function Shot($name) {
    try {
        $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
        $p = Join-Path $ShotDir ($name + '.png')
        $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose(); $bmp.Dispose()
        Log "  shot -> $p"
    } catch { Log "  shot FAIL: $($_.Exception.Message)" }
}
function Get-FgPid {
    $fg = [AxW.U]::GetForegroundWindow()
    $pid2 = 0
    [AxW.U]::GetWindowThreadProcessId($fg, [ref]$pid2) | Out-Null
    $pid2
}
# ★ 硬焦点：恢复 + 置顶 + SetForegroundWindow，并校验前台 PID
function Force-Foreground($ProcId, $tag) {
    $main = Get-Main $ProcId
    if (-not $main) { Log "  [$tag] no main window"; return $false }
    $h = [IntPtr]$main.Current.NativeWindowHandle
    Log "  [$tag] hwnd=$h fore_before_pid=$(Get-FgPid)"
    [AxW.U]::ShowWindow($h, 9) | Out-Null                                    # SW_RESTORE
    Start-Sleep -Milliseconds 400
    [AxW.U]::SetWindowPos($h, [IntPtr]::new(-1), 0, 0, 0, 0, 0x0003) | Out-Null   # HWND_TOPMOST, NOSIZE|NOMOVE
    [AxW.U]::SetForegroundWindow($h) | Out-Null
    Start-Sleep -Milliseconds 700
    $f = Get-FgPid
    Log "  [$tag] fore_after_pid=$f target=$ProcId ok=$($f -eq $ProcId)"
    ($f -eq $ProcId)
}
function Dump-Tree($root, $path, $label) {
    $lines = @()
    $i = 0
    foreach ($e in (All-Desc $root)) {
        $i++
        try {
            $c = $e.Current
            $r = $c.BoundingRectangle
            $lines += ("{0}|{1}|{2}|{3}|{4}|{5}|{6}|{7},{8} {9}x{10}" -f $i, $c.ControlType.ProgrammaticName, $c.ClassName, $c.AutomationId, ($c.Name -replace "`r?`n", ' '), $c.IsEnabled, $c.IsOffscreen, [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height)
        } catch { }
    }
    $lines | Set-Content -Path $path -Encoding UTF8
    Log "  dump[$label] $($lines.Count) elements -> $path"
}

# ── 主流程 ───────────────────────────────────────────────────────────────────
Log "=== PROBE2 启动 ==="
Get-Process AxureRP9 -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
Start-Sleep -Seconds 2
Get-ChildItem (Join-Path $AxureData '*.PID') -File -EA SilentlyContinue | Remove-Item -Force -EA SilentlyContinue

$proc = Start-Process -FilePath $AxureExe -ArgumentList ('"{0}"' -f $File) -PassThru
$axPid = $proc.Id
Log "started pid=$axPid file=$File"
$name = [System.IO.Path]::GetFileNameWithoutExtension($File)

$dl = (Get-Date).AddSeconds($WaitSec)
$main = $null
while ((Get-Date) -lt $dl) {
    Start-Sleep -Milliseconds 1500
    $proc.Refresh(); if ($proc.HasExited) { Log "EXITED early"; exit 1 }
    $main = Get-Main $axPid
    if ($main) { Log "main window appeared: $($main.Current.Name)"; break }
}
if (-not $main) { Log "NO_WINDOW"; exit 1 }

# ── 阶段 B：弹窗清理 + 逐轮记录
Log "--- phase B: popup dismiss ---"
$t0 = Get-Date; $clean = 0
while ($true) {
    $el = ((Get-Date) - $t0).TotalSeconds
    if ($el -gt 90) { Log "  timeout"; break }
    Start-Sleep -Milliseconds 1200
    $main = Get-Main $axPid; if (-not $main) { continue }
    $title = ''; try { $title = $main.Current.Name } catch { }
    $scopes = @($main) + @(Get-TopWindows $axPid | Where-Object { $_.Current.NativeWindowHandle -ne $main.Current.NativeWindowHandle })
    $names = @()
    foreach ($s in $scopes) { foreach ($e in (All-Desc $s)) { try { $n = $e.Current.Name; if ($n) { $names += $n } } catch { } } }
    $joined = $names -join "`n"
    $hit = @()
    if ($joined -match '载入完成|已载入') { $hit += 'LOADED' }
    if ($joined -match '未正常关闭|异常关闭|shut down properly') { $hit += 'RECOVERY' }
    if ($hit.Count -gt 0) {
        Log "  t=$([int]$el)s HIT=[$($hit -join ',')] topwins=$($scopes.Count) names=$($names.Count)"
        $anchor = Find-ByText $main '载入完成|已载入|未正常关闭|异常关闭|shut down properly'
        if ($anchor) {
            $dlg = Get-Ancestor $anchor 7
            $ar = $anchor.Current.BoundingRectangle
            Log "    anchor='$($anchor.Current.Name)' type=$($anchor.Current.ControlType.ProgrammaticName) rect=$([int]$ar.X),$([int]$ar.Y) $([int]$ar.Width)x$([int]$ar.Height)"
            $dr = $dlg.Current.BoundingRectangle
            Log "    container=$($dlg.Current.ControlType.ProgrammaticName) cls=$($dlg.Current.ClassName) rect=$([int]$dr.X),$([int]$dr.Y) $([int]$dr.Width)x$([int]$dr.Height)"
            Dump-Tree $dlg (Join-Path $OutDir 'probe2_dialog.txt') 'dialog'
            $r = Click-Button-In $dlg '关闭|确定|OK|Close|知道了'
            Log "    click=$r"
        } else { Log "    no anchor?" }
        $clean = 0
    } else {
        $titleOk = ($title -and $title.Contains($name))
        if ($titleOk -and $el -ge 8) {
            $clean++
            Log "  t=$([int]$el)s clean=$clean title=[$title]"
            if ($clean -ge 4) { break }
        } else { $clean = 0 }
    }
}
Log "phase B done. title=[$((Get-Main $axPid).Current.Name)]"

# ── 硬焦点 + 截图
Force-Foreground $axPid 'pre-shot' | Out-Null
Shot 'probe2_after_dismiss'

# ── Ctrl+Shift+O
$ok = Force-Foreground $axPid 'before-cso'
if ($ok) {
    [System.Windows.Forms.SendKeys]::SendWait('^+o')
    Log "  sent ^+o  fore_pid_now=$(Get-FgPid)"
} else { Log "  SKIP ^+o (no focus)" }
Start-Sleep -Seconds 6
Force-Foreground $axPid 'after-cso' | Out-Null
Shot 'probe2_pubdlg'

# ── dump
$main = Get-Main $axPid
Dump-Tree $main (Join-Path $OutDir 'probe2_main.txt') 'main'
foreach ($w in (Get-TopWindows $axPid)) {
    Log "  topwin: name=[$($w.Current.Name)] cls=$($w.Current.ClassName) hwnd=$($w.Current.NativeWindowHandle)"
}
Log "=== PROBE2 结束 (Axure 保持运行，pid=$axPid) ==="
