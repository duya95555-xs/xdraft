#Requires -Version 5.1
<#
    axstep.ps1 v2 — 纯键盘驱动单步验证器。

    为什么不用 UIA 控件定位: Axure RP 9 主窗口是 WinForms，但内容区完全自绘，
      整个窗口的 UIA 树只有 ~15 个元素，「您的项目已载入完成」这类弹窗在其中
      完全不可见 → Press-ByName / Find-ByText 那条路是死的。
    为什么不用 Add-Type P/Invoke: 本机环境块 339KB 远超 csc 的 64KB 上限，
      Add-Type -MemberDefinition 编译必然失败 → 改用 .NET 内置 AppActivate。

    用法:
      axstep.ps1 -Seq "{ENTER}|^+o" -Delay 3 -ShotPrefix k1
      （Seq 用 | 分隔多步，因为 -File 传参时逗号数组会串味）

    每步: AppActivate 目标进程 → SendKeys → 等 Delay → 截图（截图是最终真相）
#>
param(
    [int]$Pid_ = 0,
    [string]$Seq = '{ENTER}',
    [int]$Delay = 3,
    [string]$ShotPrefix = 'k',
    [string]$ShotDir = 'C:\Users\xiaos\AppData\Local\Temp\axshots',
    [string]$LogFile = 'D:\KimiData\kimi\Workspaces\prototype-3in1\1.0.1\cook\_logs\axstep.log'
)
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, Microsoft.VisualBasic, System.Windows.Forms, System.Drawing
New-Item -ItemType Directory -Force -Path $ShotDir, (Split-Path $LogFile -Parent) | Out-Null
function Log($m) { $l = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m; Write-Host $l; Add-Content -Path $LogFile -Value $l -Encoding UTF8 -EA SilentlyContinue }
function Shot($n) {
    try {
        $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
        $p = Join-Path $ShotDir ($n + '.png'); $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose(); $bmp.Dispose(); Log "  shot -> $n.png"
    } catch { Log "  shot FAIL $($_.Exception.Message)" }
}
function Get-TopWins($procId) {
    $res = @()
    $AE = [System.Windows.Automation.AutomationElement]
    foreach ($e in $AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
        try { if ($e.Current.ProcessId -eq $procId) { $res += $e } } catch { }
    }
    , $res
}
# 当前前台窗口 PID（用 UIA FocusedElement 反推，避免 P/Invoke）
function Get-FgPidViaUia {
    try {
        $f = [System.Windows.Automation.AutomationElement]::FocusedElement
        if ($f) { return $f.Current.ProcessId }
    } catch { }
    -1
}

$proc = if ($Pid_ -gt 0) { Get-Process -Id $Pid_ -EA SilentlyContinue } else { Get-Process AxureRP9 -EA SilentlyContinue | Select-Object -First 1 }
if (-not $proc) { Log 'NO AXURE PROCESS'; exit 1 }
$procId = $proc.Id
$wins = Get-TopWins $procId
Log "axure pid=$procId topwindows=$($wins.Count) fgPid(before)=$(Get-FgPidViaUia)"
foreach ($w in $wins) {
    try { $r = $w.Current.BoundingRectangle; Log ("  win hwnd={0} cls={1} rect={2},{3} {4}x{5} name=[{6}]" -f $w.Current.NativeWindowHandle, $w.Current.ClassName, [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height, $w.Current.Name) } catch { }
}

Shot ($ShotPrefix + '_0before')
$i = 0
foreach ($k in ($Seq -split '\|')) {
    $i++
    $ok = $false
    try { $ok = [Microsoft.VisualBasic.Interaction]::AppActivate($procId) } catch { $ok = $false }
    Start-Sleep -Milliseconds 900
    $fg = Get-FgPidViaUia
    Log "--- step#$i keys=[$k] appActivate=$ok fgPid=$fg target=$procId match=$($fg -eq $procId)"
    [System.Windows.Forms.SendKeys]::SendWait($k)
    Start-Sleep -Seconds $Delay
    Shot ("{0}_{1}_fg{2}" -f $ShotPrefix, ($k -replace '[^\w]', ''), $fg)
}
Log 'done'
