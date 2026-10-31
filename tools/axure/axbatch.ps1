#Requires -Version 5.1
<#
    axbatch.ps1 v2 — 批量把 legacy .rp 用 Axure RP 9 发布成 HTML，产物归集到 -OutRoot。

    单文件流程:
      清残留进程与 *.PID → 启动 AxureRP9 <file>
      → 【阶段A】等主窗口标题包含文件名（= 文件真的加载完）★v2
      → 【阶段B】弹窗清理窗口期：标题 OK 后再观察 MinWaitSec 秒，期间点掉
              「您的项目已载入完成」/「未正常关闭」等弹窗，连续 4 轮干净才退出 ★v2
      → Ctrl+Shift+O 打开发布对话框 → 定位对话框 → 取消「发布之后在浏览器中打开」→ 点发布
      → 轮询 index.html 写入时间 > 本次开始时间且文件数稳定 → 关 Axure → 产物移动到 -OutRoot

    v2 修复的关键 bug:
      旧版 Dismiss-Popups 一上来就「连续 3 轮干净就退出」（约 6 秒），
      但「项目已载入完成」弹窗是在文件加载【之后】才弹出，恰好在检测窗口之后出现，
      于是 Ctrl+Shift+O 全被弹窗吃掉 → 发布从没发生（截图实证 rp5__学习事例__3publishing.png）。
      修法：① 只有标题已含文件名后才开始计 clean（确保加载完成）；
           ② 标题 OK 后仍强制观察 MinWaitSec 秒，覆盖弹窗延迟；
           ③ 弹窗检测范围从「主窗口后代」扩展到「该 PID 的所有顶层窗口」（原生模态框）。

    v2 其它加固:
      - Get-Main 取面积最大的同 PID 窗口，避免把模态弹窗误当主窗口。
      - Find-ByText + Get-Ancestor + Click-Button-In：先找到弹窗文本锚点，
        爬到对话框容器，只在该容器内点按钮，避免误点工具栏上的同名按钮。
      - 发布按钮同理限定在发布对话框容器内，避免误点主菜单「发布(U)」。
      - 每步写日志到 -LogFile，长跑时可离线查看进度。
#>
param(
    [string[]]$Files = @(),
    [string]$Dir = '',
    [string]$Filter = '*.rp',
    [string]$OutRoot = '',
    [int]$PerFileTimeout = 300,
    [int]$MinWaitSec = 8,
    [int]$MaxDismissSec = 75,
    [string]$AxureExe = 'D:\Program Files (x86)\Axure\Axure RP 9\AxureRP9.exe',
    [string]$AxureData = 'C:\Users\xiaos\AppData\Local\Axure\Axure-9-0',
    [string]$PublishRoot = 'C:\Users\xiaos\Documents\Axure\HTML',
    [string]$ShotDir = 'C:\Users\xiaos\AppData\Local\Temp\axshots',
    [string]$LogFile = '',
    [switch]$Shots,
    [switch]$SkipExisting
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, Microsoft.VisualBasic, System.Windows.Forms, System.Drawing
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$TC = [System.Windows.Automation.Condition]::TrueCondition
$WVS = [System.Windows.Automation.WindowVisualState]
$WALK = [System.Windows.Automation.TreeWalker]::ControlViewWalker

New-Item -ItemType Directory -Force -Path $ShotDir | Out-Null
if ($OutRoot) { New-Item -ItemType Directory -Force -Path $OutRoot | Out-Null }
$script:LogPath = $LogFile
if ($LogFile) { New-Item -ItemType Directory -Force -Path (Split-Path $LogFile -Parent) | Out-Null }

function Log([string]$msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg
    Write-Host $line
    if ($script:LogPath) { Add-Content -Path $script:LogPath -Value $line -Encoding UTF8 -EA SilentlyContinue }
}

# ── 窗口/元素基础 ────────────────────────────────────────────────────────────
function Get-TopWindows($ProcId) {
    $res = @()
    foreach ($e in $AE::RootElement.FindAll($TS::Children, $TC)) {
        try { if ($e.Current.ProcessId -eq $ProcId) { $res += $e } } catch { }
    }
    , $res
}
# 面积最大的同 PID 窗口 = 主窗口（模态弹窗面积小，不会被误选）
function Get-Main($ProcId) {
    $best = $null; $bestArea = -1.0
    foreach ($e in $AE::RootElement.FindAll($TS::Children, $TC)) {
        try {
            if ($e.Current.ProcessId -ne $ProcId) { continue }
            $r = $e.Current.BoundingRectangle
            $a = [double]$r.Width * [double]$r.Height
            if ($a -gt $bestArea) { $bestArea = $a; $best = $e }
        } catch { }
    }
    $best
}
function All-Desc($root) { if (-not $root) { return @() }; try { return $root.FindAll($TS::Descendants, $TC) } catch { return @() } }
# 检测范围 = 主窗口 + 该 PID 的其它顶层窗口（原生模态框）
function Get-Scopes($ProcId, $main) {
    $res = @()
    if ($main) { $res += $main }
    foreach ($e in (Get-TopWindows $ProcId)) {
        try {
            if ($main -and $e.Current.NativeWindowHandle -eq $main.Current.NativeWindowHandle) { continue }
            $res += $e
        } catch { }
    }
    , $res
}
function Find-ByText($root, [string]$Pattern) {
    foreach ($e in (All-Desc $root)) {
        try { $n = $e.Current.Name; if ($n -and $n -match $Pattern) { return $e } } catch { }
    }
    $null
}
function Get-Ancestor($el, [int]$Levels) {
    $cur = $el
    for ($i = 1; $i -le $Levels; $i++) {
        try { $p = $WALK.GetParent($cur) } catch { $p = $null }
        if (-not $p) { break }
        try { if ($p.Current.ProgrammaticName -eq 'ControlType.Window') { break } } catch { }
        $cur = $p
    }
    $cur
}
# 在 scope 内点按钮：优先 ControlType=Button，其次任意匹配元素
function Click-Button-In($scope, [string]$Pattern) {
    if (-not $scope) { return 'NO_SCOPE' }
    $btn = @(); $oth = @()
    foreach ($e in (All-Desc $scope)) {
        try {
            $n = $e.Current.Name
            if (-not $n -or $n -notmatch $Pattern) { continue }
            if ($e.Current.ControlType.ProgrammaticName -match 'Button') { $btn += $e } else { $oth += $e }
        } catch { }
    }
    foreach ($e in (@($btn) + @($oth))) {
        try { $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); return "INVOKED:$($e.Current.Name)" } catch { }
        try { $e.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern).DoDefaultAction(); return "DOACTION:$($e.Current.Name)" } catch { }
        try { $e.SetFocus(); Start-Sleep -Milliseconds 250; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}'); return "FOCUS_ENTER:$($e.Current.Name)" } catch { }
    }
    'NONE'
}
# 定位弹窗文本锚点 → 爬到容器 → 只在该容器内点按钮
function Dismiss-Alert($scopes, [string]$TextPat, [string]$BtnPat) {
    foreach ($s in $scopes) {
        $anchor = Find-ByText $s $TextPat
        if (-not $anchor) { continue }
        $dlg = Get-Ancestor $anchor 7
        $r = Click-Button-In $dlg $BtnPat
        if ($r -notmatch '^(NONE|NO_SCOPE)') { return $r }
        $r2 = Click-Button-In $s $BtnPat
        if ($r2 -notmatch '^(NONE|NO_SCOPE)') { return "WIN:$r2" }
        return 'FAIL'
    }
    'NO_ANCHOR'
}

function Shot($name, $tag) {
    if (-not $Shots) { return }
    try {
        $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
        $p = Join-Path $ShotDir ("{0}__{1}.png" -f $name, $tag)
        $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose(); $bmp.Dispose()
    } catch { }
}
function Test-Focused($ProcId) {
    try { $f = $AE::FocusedElement; if ($f -and $f.Current.ProcessId -eq $ProcId) { return $true } } catch { }
    $false
}
function Focus-Ax($ProcId) {
    $main = Get-Main $ProcId
    if (-not $main) { return $false }
    try { [Microsoft.VisualBasic.Interaction]::AppActivate($ProcId) | Out-Null } catch { }
    Start-Sleep -Milliseconds 400
    if (Test-Focused $ProcId) { return $true }
    try {
        $wp = $main.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
        $wp.SetWindowVisualState($WVS::Minimized); Start-Sleep -Milliseconds 400
        $wp.SetWindowVisualState($WVS::Maximized); Start-Sleep -Milliseconds 600
    } catch { }
    if (Test-Focused $ProcId) { return $true }
    try { [Microsoft.VisualBasic.Interaction]::AppActivate($ProcId) | Out-Null } catch { }
    Start-Sleep -Milliseconds 600
    Test-Focused $ProcId
}
function Send-Keys($ProcId, [string]$Keys) {
    if (-not (Focus-Ax $ProcId)) { return 'NO_FOCUS' }
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait($Keys)
    'OK'
}

# ── 弹窗清理（v2 核心）──────────────────────────────────────────────────────
function Dismiss-Popups($ProcId, [string]$Name, [int]$MinWait, [int]$MaxWait) {
    $log = @()
    $t0 = Get-Date
    $clean = 0
    while ($true) {
        $el = ((Get-Date) - $t0).TotalSeconds
        if ($el -gt $MaxWait) { $log += 'timeout'; break }
        Start-Sleep -Milliseconds 1200
        $main = Get-Main $ProcId
        if (-not $main) { continue }
        $title = ''
        try { $title = $main.Current.Name } catch { }
        $scopes = Get-Scopes $ProcId $main

        $names = @()
        foreach ($s in $scopes) { foreach ($e in (All-Desc $s)) { try { $n = $e.Current.Name; if ($n) { $names += $n } } catch { } } }
        $joined = $names -join "`n"
        $did = $false
        if ($joined -match 'shut down properly|auto-saved|未正常关闭|异常关闭') {
            $log += "recovery=" + (Dismiss-Alert $scopes 'shut down properly|auto-saved|未正常关闭|异常关闭' '否|No|不恢复|取消|Cancel')
            $did = $true
        }
        if ($joined -match '载入完成|已载入') {
            $log += "loaded=" + (Dismiss-Alert $scopes '载入完成|已载入' '关闭|确定|OK|Close|知道了')
            $did = $true
        }
        if ($did) { $clean = 0; Start-Sleep -Milliseconds 1500; continue }

        $titleOk = ($Name -and $title -and $title.Contains($Name))
        if ($titleOk -and $el -ge $MinWait) {
            $clean++
            if ($clean -ge 4) { $log += ("clean@{0}s" -f [int]$el); break }
        } else {
            $clean = 0
        }
    }
    @($log)
}
function Reset-AxureState {
    Get-Process AxureRP9 -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
    Start-Sleep -Seconds 2
    # 关键：清掉崩溃恢复标记，否则下次启动弹告警并忽略命令行里的文件参数
    Get-ChildItem -Path (Join-Path $AxureData '*.PID') -File -EA SilentlyContinue |
        Remove-Item -Force -EA SilentlyContinue
}
function Stop-Ax($ProcId) {
    Focus-Ax $ProcId | Out-Null
    Start-Sleep -Milliseconds 400
    [System.Windows.Forms.SendKeys]::SendWait('%{F4}')
    Start-Sleep -Seconds 3
    $p = Get-Process -Id $ProcId -EA SilentlyContinue
    if ($p) {
        $main = Get-Main $ProcId
        if ($main) {
            $scopes = Get-Scopes $ProcId $main
            Dismiss-Alert $scopes '保存|Save|更改' '否|不保存|No|Don' | Out-Null
            Start-Sleep -Seconds 2
        }
        $p = Get-Process -Id $ProcId -EA SilentlyContinue
        if ($p) { $p | Stop-Process -Force }
    }
}

# ── 单文件发布 ───────────────────────────────────────────────────────────────
function Publish-One([string]$File, [string]$Name) {
    $result = [ordered]@{ file = $File; name = $Name; status = '?'; out = ''; note = '' }
    $startTime = Get-Date

    Reset-AxureState
    $proc = Start-Process -FilePath $AxureExe -ArgumentList ('"{0}"' -f $File) -PassThru
    $axPid = $proc.Id
    $dl = (Get-Date).AddSeconds($PerFileTimeout)
    $main = $null
    while ((Get-Date) -lt $dl) {
        Start-Sleep -Milliseconds 1500
        $proc.Refresh()
        if ($proc.HasExited) { $result.status = 'EXIT_EARLY'; return $result }
        $main = Get-Main $axPid
        if ($main) { break }
    }
    if (-not $main) { Stop-Ax $axPid; $result.status = 'NO_WINDOW'; return $result }

    # 阶段 B：等标题正确 + 观察窗口期清弹窗
    $dlog = Dismiss-Popups $axPid $Name $MinWaitSec $MaxDismissSec
    $result.note += 'dismiss=' + ($dlog -join ',') + ';'
    $main = Get-Main $axPid
    $title = ''
    if ($main) { try { $title = $main.Current.Name } catch { } }
    $result.note += "title=[$title];"
    Log ("  {0}: {1}" -f $Name, $result.note)

    $opened = ($title -and $title.Contains($Name))
    if (-not $opened) {
        # 再给一次机会（有的文件加载特别慢）
        $dlog2 = Dismiss-Popups $axPid $Name 4 40
        $result.note += 'dismiss2=' + ($dlog2 -join ',') + ';'
        $main = Get-Main $axPid
        if ($main) { try { $title = $main.Current.Name } catch { } }
        $opened = ($title -and $title.Contains($Name))
    }
    if (-not $opened) {
        Shot $Name '0notopen'
        Stop-Ax $axPid
        $result.status = 'NOT_OPENED'
        $result.note += "final_title=[$title];"
        Log ("  {0}: NOT_OPENED title=[{1}]" -f $Name, $title)
        return $result
    }
    Shot $Name '1loaded'

    # 打开发布对话框
    $k = Send-Keys $axPid '^+o'
    $result.note += "cso=$k;"
    $dlgAnchor = $null
    $ddl = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $ddl) {
        Start-Sleep -Seconds 1
        $main = Get-Main $axPid
        if (-not $main) { break }
        $dlgAnchor = Find-ByText $main '生成 HTML|Publish Locally|发布到本地|输出文件夹|HTML 文件'
        if ($dlgAnchor) { break }
    }
    Shot $Name '2pubdlg'
    $result.note += 'dlg=' + $(if ($dlgAnchor) { 'found' } else { 'NONE' }) + ';'

    if ($dlgAnchor) {
        $dlg = Get-Ancestor $dlgAnchor 9
        # 取消「发布之后在浏览器中打开」
        foreach ($e in (All-Desc $dlg)) {
            try {
                if ($e.Current.Name -match '浏览器中打开|Open in browser') {
                    try {
                        $tp = $e.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
                        if ($tp.Current.ToggleState -ne 'Off') { $tp.Toggle(); $result.note += 'uncheck;' }
                    } catch {
                        try { $e.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern).DoDefaultAction(); $result.note += 'uncheck2;' } catch { }
                    }
                }
            } catch { }
        }
        $r = Click-Button-In $dlg 'Publish Locally|发布到本地|生成|Publish'
        $result.note += "publish=$r;"
        Log ("  {0}: dlg found, publish={1}" -f $Name, $r)
    } else {
        Stop-Ax $axPid
        $result.status = 'NO_PUBDLG'
        Log ("  {0}: NO_PUBDLG" -f $Name)
        return $result
    }
    Start-Sleep -Seconds 5
    Shot $Name '3publishing'

    # 产物识别：index.html 写入时间必须晚于本次开始
    $target = $null; $stableHits = 0; $lastSig = ''
    $deadline = (Get-Date).AddSeconds($PerFileTimeout)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 4
        if (-not (Test-Path $PublishRoot)) { continue }
        $fresh = @()
        foreach ($d in (Get-ChildItem $PublishRoot -Directory -EA SilentlyContinue)) {
            $idx = Join-Path $d.FullName 'index.html'
            if (Test-Path $idx) {
                if ((Get-Item $idx).LastWriteTime -gt $startTime) { $fresh += $d }
            }
        }
        if ($fresh.Count -eq 0) { continue }
        $cand = $fresh | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        $fileCount = (Get-ChildItem $cand.FullName -Recurse -File -EA SilentlyContinue | Measure-Object).Count
        if ("$fileCount" -eq $lastSig) { $stableHits++ } else { $stableHits = 0; $lastSig = "$fileCount" }
        $target = $cand
        if ($stableHits -ge 2 -and $fileCount -gt 3) { break }
    }
    Shot $Name '4done'

    if (-not $target) {
        $result.status = 'NO_OUTPUT'
        Stop-Ax $axPid
        Log ("  {0}: NO_OUTPUT" -f $Name)
        return $result
    }

    Stop-Ax $axPid

    if ($OutRoot) {
        $dest = Join-Path $OutRoot $target.Name
        if (Test-Path $dest) { Remove-Item $dest -Recurse -Force -EA SilentlyContinue }
        try {
            Move-Item -Path $target.FullName -Destination $dest -Force
            $result.out = $dest; $result.status = 'OK'
        } catch {
            try {
                Copy-Item -Path $target.FullName -Destination $dest -Recurse -Force
                $result.out = $dest; $result.status = 'OK_COPY'
            } catch { $result.status = 'MOVE_FAIL'; $result.note += $_.Exception.Message }
        }
    } else {
        $result.out = $target.FullName; $result.status = 'OK'
    }
    $result
}

# ── 驱动 ─────────────────────────────────────────────────────────────────────
if ($Dir) { $Files = @($Files) + @(Get-ChildItem $Dir -Filter $Filter -File -EA SilentlyContinue | ForEach-Object { $_.FullName }) }
$Files = @($Files | Where-Object { $_ -and (Test-Path $_) })
if ($Files.Count -eq 0) { 'NO_INPUT_FILES'; exit 1 }

Log "=== AXBATCH v2: $($Files.Count) 个文件 → OutRoot=$OutRoot ==="
$results = @()
$i = 0
foreach ($f in $Files) {
    $i++
    $n = [System.IO.Path]::GetFileNameWithoutExtension($f)
    if ($SkipExisting -and $OutRoot -and (Test-Path (Join-Path $OutRoot $n))) {
        Log "[$i/$($Files.Count)] $n  SKIP(exists)"
        $results += [ordered]@{ file = $f; name = $n; status = 'SKIP'; out = (Join-Path $OutRoot $n); note = ''; sec = 0 }
        continue
    }
    Log "[$i/$($Files.Count)] $n"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try { $r = Publish-One $f $n }
    catch { $r = [ordered]@{ file = $f; name = $n; status = 'EXCEPTION'; out = ''; note = $_.Exception.Message } }
    $sw.Stop()
    $r['sec'] = [int]$sw.Elapsed.TotalSeconds
    $results += $r
    Log ("    -> {0}  {1}s  {2}" -f $r.status, $r.sec, $r.out)
}

Log ""
Log "=== 汇总 ==="
$results | ForEach-Object { Log ("{0,-12} {1,-30} {2,4}s  {3}" -f $_.status, $_.name, $_.sec, $_.note) }
$ok = @($results | Where-Object { $_.status -like 'OK*' }).Count
Log ""
Log "成功 $ok / $($results.Count)"

if ($OutRoot) {
    $rp = Join-Path $OutRoot '_report.json'
    $results | ConvertTo-Json -Depth 4 | Set-Content -Path $rp -Encoding UTF8
    Log "报告: $rp"
}
