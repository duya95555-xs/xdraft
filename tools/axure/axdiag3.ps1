#Requires -Version 5.1
# 诊断3：列出 Axure 主窗口所有有名字的后代元素 + 当前前台窗口是谁
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$TC = [System.Windows.Automation.Condition]::TrueCondition

"--- 当前前台窗口 ---"
try {
    $fg = $AE::FocusedElement
    "focused: pid=$($fg.Current.ProcessId) name=[$($fg.Current.Name)] type=$($fg.Current.ControlType.ProgrammaticName)"
} catch { "focused_err: $($_.Exception.Message)" }

"--- 所有顶层窗口（pid/name）---"
foreach ($e in $AE::RootElement.FindAll($TS::Children, $TC)) {
    try {
        $n = $e.Current.Name
        if ($n) { "  pid=$($e.Current.ProcessId) class=$($e.Current.ClassName) [$n]" }
    } catch { }
}

$p = Get-Process AxureRP9 -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { 'NO_AXURE_RUNNING'; exit 1 }
"axure pid=$($p.Id)"
$main = $null
foreach ($e in $AE::RootElement.FindAll($TS::Children, $TC)) {
    try { if ($e.Current.ProcessId -eq $p.Id) { $main = $e; break } } catch { }
}
if (-not $main) { 'NO_MAIN'; exit 1 }
"main=[$($main.Current.Name)]"

$all = $main.FindAll($TS::Descendants, $TC)
"descendants=$($all.Count)"
"--- 所有有名字的后代 ---"
foreach ($e in $all) {
    try {
        $n = $e.Current.Name
        if ($n) {
            "  [$($e.Current.ControlType.ProgrammaticName -replace 'ControlType\.','')] hwnd=$($e.Current.NativeWindowHandle) '$n'"
        }
    } catch { }
}
