#Requires -Version 5.1
# 对运行中的 Axure「另存为」对话框执行"保存"，并处理覆盖确认
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]

function Get-Main([int]$ProcId) {
    foreach ($e in $AE::RootElement.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
        try { if ($e.Current.ProcessId -eq $ProcId) { return $e } } catch { }
    }
    return $null
}

# 在 main 的后代里找名字匹配的元素，尝试各种"按下"方式
function Press-ByName($Root, [string]$Pattern) {
    $found = @()
    foreach ($e in $Root.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
        try {
            if ($e.Current.Name -match $Pattern) { $found += $e }
        } catch { }
    }
    if ($found.Count -eq 0) { return "NOT_FOUND[$Pattern]" }

    foreach ($e in $found) {
        $ct = ''
        try { $ct = $e.Current.ControlType.ProgrammaticName } catch { }
        # 1) InvokePattern
        try {
            $ip = $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            $ip.Invoke(); return "INVOKED[$Pattern] ct=$ct"
        } catch { }
        # 2) LegacyIAccessible DoDefaultAction
        try {
            $lp = $e.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
            $lp.DoDefaultAction(); return "DEFAULT_ACTION[$Pattern] ct=$ct"
        } catch { }
        # 3) SetFocus + Enter
        try {
            $e.SetFocus(); Start-Sleep -Milliseconds 500
            [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
            return "FOCUS_ENTER[$Pattern] ct=$ct"
        } catch { }
    }
    return "ALL_METHODS_FAILED[$Pattern]"
}

$p = Get-Process AxureRP9 -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { 'NO_AXURE_RUNNING'; exit 1 }
$main = Get-Main $p.Id
if (-not $main) { 'NO_MAIN'; exit 1 }
"main=[$($main.Current.Name)]"

# 有没有另存为对话框
$dlg = $null
foreach ($e in $main.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    try {
        if ($e.Current.ControlType.ProgrammaticName -eq 'ControlType.Window' -and $e.Current.Name -eq '另存为') { $dlg = $e; break }
    } catch { }
}
if (-not $dlg) { 'NO_SAVEAS_DIALOG'; exit 2 }
"dialog hwnd=$($dlg.Current.NativeWindowHandle)"

"press_save : " + (Press-ByName $dlg '^保存')
Start-Sleep -Seconds 3

# 覆盖确认
"press_yes  : " + (Press-ByName $main '^是\(Y\)|^是$|确定$')
Start-Sleep -Seconds 2
"press_yes2 : " + (Press-ByName $main '^是\(Y\)|^是$')

# 重新找 main（现在名字应更新）
$main2 = Get-Main $p.Id
"main_now=[$($main2.Current.Name)]"
$left = @($main2.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition) |
    Where-Object { try { $_.Current.Name -match '另存为' } catch { $false } })
"remaining_dialogs=$($left.Count)"
