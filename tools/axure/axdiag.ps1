#Requires -Version 5.1
# 诊断：Axure 打开 legacy rp 后，「另存为」对话框到底属于哪个进程 / 叫什么名字
param(
    [Parameter(Mandatory = $true)][string]$File,
    [int]$OpenWaitSec = 60
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$exe = 'D:\Program Files (x86)\Axure\Axure RP 9\AxureRP9.exe'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, Microsoft.VisualBasic, System.Windows.Forms

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]

function DumpAll([string]$Tag) {
    "----- $Tag -----"
    foreach ($e in $AE::RootElement.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
        try {
            $n = $e.Current.Name
            $p = $e.Current.ProcessId
            $c = $e.Current.ClassName
            if ($n -or $c -match 'Dialog|#32770') {
                "  pid=$p  class=$c  name=[$n]"
            }
        } catch { }
    }
}

$proc = Start-Process -FilePath $exe -ArgumentList ('"{0}"' -f $File) -PassThru
"axure pid=$($proc.Id)"
$dl = (Get-Date).AddSeconds($OpenWaitSec)
while ((Get-Date) -lt $dl) {
    Start-Sleep -Milliseconds 1000
    $proc.Refresh()
    if ($proc.HasExited) { break }
    $any = $false
    foreach ($e in $AE::RootElement.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
        try { if ($e.Current.ProcessId -eq $proc.Id -and $e.Current.Name) { $any = $true; break } } catch { }
    }
    if ($any) { break }
}
Start-Sleep -Seconds 4
DumpAll 'after open'

$null = [Microsoft.VisualBasic.Interaction]::AppActivate($proc.Id)
Start-Sleep -Milliseconds 700
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Seconds 2
DumpAll 'after ENTER'

$null = [Microsoft.VisualBasic.Interaction]::AppActivate($proc.Id)
Start-Sleep -Milliseconds 700
[System.Windows.Forms.SendKeys]::SendWait('^s')
Start-Sleep -Seconds 6
DumpAll 'after ctrl+s'

Start-Sleep -Seconds 3
DumpAll 'after +3s'

# 不杀，留给人看
"DONE  (pid=$($proc.Id) 仍在运行)"
