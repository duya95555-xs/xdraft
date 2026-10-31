#Requires -Version 5.1
# 诊断2：在正在运行的 Axure 窗口里，找"另存为"对话框及其按钮（它可能是子控件而非顶层窗口）
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]

$p = Get-Process AxureRP9 -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { 'NO_AXURE_RUNNING'; exit 1 }
"axure pid=$($p.Id)"

$main = $null
foreach ($e in $AE::RootElement.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
    try { if ($e.Current.ProcessId -eq $p.Id) { $main = $e; break } } catch { }
}
if (-not $main) { 'NO_MAIN_ELEMENT'; exit 1 }
"main name=[$($main.Current.Name)]  class=$($main.Current.ClassName)"

$all = $main.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
"descendants=$($all.Count)"

"--- 名字含 另存/保存/取消/文件名 的元素 ---"
foreach ($e in $all) {
    try {
        $n = $e.Current.Name
        if ($n -and ($n -match '另存|保存|取消|文件名|覆盖|替换|是\(|否\(')) {
            "  type=$($e.Current.ControlType.ProgrammaticName)  hwnd=$($e.Current.NativeWindowHandle)  name=[$n]  enabled=$($e.Current.IsEnabled)"
        }
    } catch { }
}

"--- 顶层 ControlType=Window 的后代（自绘对话框容器）---"
$wc = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
foreach ($e in $main.FindAll($TS::Descendants, $wc)) {
    try { "  hwnd=$($e.Current.NativeWindowHandle)  class=$($e.Current.ClassName)  name=[$($e.Current.Name)]" } catch { }
}

"--- Ctrl+S 试试：先看有没有 Button 名字是 保存(S) ---"
$bc = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$btns = $main.FindAll($TS::Descendants, $bc)
"buttons=$($btns.Count)"
foreach ($b in $btns) {
    try {
        $n = $b.Current.Name
        if ($n -match '保存|取消|是|否') { "  btn [$n] hwnd=$($b.Current.NativeWindowHandle)" }
    } catch { }
}
