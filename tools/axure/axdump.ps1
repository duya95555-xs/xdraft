#Requires -Version 5.1
# 快速 dump：当前 Axure 所有顶层窗口 + 全部后代（含对话框控件），找可编程元素。
param(
    [string]$OutDir = 'D:\KimiData\kimi\Workspaces\prototype-3in1\1.0.1\cook\_logs'
)
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$TC = [System.Windows.Automation.Condition]::TrueCondition
$WALK = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$proc = Get-Process AxureRP9 -EA SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Host 'NO AXURE'; exit 1 }
$procId = $proc.Id
Write-Host "axure pid=$procId"
$out = @()
$wi = 0
foreach ($w in $AE::RootElement.FindAll($TS::Children, $TC)) {
    $wpid = $null
    try { $wpid = $w.Current.ProcessId } catch { }
    if ($wpid -ne $procId) { continue }
    $wi++
    $r = $w.Current.BoundingRectangle
    $out += ("=== WINDOW #{0} hwnd={1} cls={2} rect={3},{4} {5}x{6} name=[{7}] ===" -f $wi, $w.Current.NativeWindowHandle, $w.Current.ClassName, [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height, $w.Current.Name)
    $i = 0
    foreach ($e in $w.FindAll($TS::Descendants, $TC)) {
        $i++
        try {
            $c = $e.Current
            $rr = $c.BoundingRectangle
            $pats = @()
            foreach ($p in $e.GetSupportedPatterns()) { $pats += $p.ProgrammaticName }
            $out += ("  {0}|{1}|cls={2}|aid={3}|name=[{4}]|rect={5},{6} {7}x{8}|off={9}|pats={10}" -f `
                    $i, $c.ControlType.ProgrammaticName, $c.ClassName, $c.AutomationId, ($c.Name -replace "`r?`n", ' '), `
                    [int]$rr.X, [int]$rr.Y, [int]$rr.Width, [int]$rr.Height, $c.IsOffscreen, ($pats -join ','))
        } catch { }
    }
}
$p = Join-Path $OutDir 'axdump_now.txt'
$out | Set-Content -Path $p -Encoding UTF8
Write-Host "windows=$wi elements=$($out.Count) -> $p"
$out | Select-Object -First 60 | ForEach-Object { Write-Host $_ }
