#Requires -Version 5.1
<#
    axopen.ps1 — 只测"能不能打开"，不保存。用来判断 Axure 是否接受某个版本的 legacy .rp。
    会把界面上出现的所有对话框文本读出来（被拒绝时能看到原因）。
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

$name = [System.IO.Path]::GetFileNameWithoutExtension($File)
"=== OPEN TEST: $name ==="
$proc = Start-Process -FilePath $exe -ArgumentList ('"{0}"' -f $File) -PassThru
$dl = (Get-Date).AddSeconds($WaitSec); $main = $null
while ((Get-Date) -lt $dl) {
    Start-Sleep -Milliseconds 1200
    $proc.Refresh(); if ($proc.HasExited) { 'EXITED_EARLY'; break }
    $main = Get-Main $proc.Id; if ($main) { break }
}
if (-not $main) { 'NO_WINDOW'; Stop-Process -Id $proc.Id -Force -EA SilentlyContinue; exit 2 }
"title=[$($main.Current.Name)]"
Start-Sleep -Seconds 7

# 读所有对话框（ControlType.Window 后代）
$wc = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Window)
$dlgs = $main.FindAll($TS::Descendants, $wc)
"dialogs=$($dlgs.Count)"
foreach ($d in $dlgs) {
    try {
        "  DIALOG name=[$($d.Current.Name)] class=$($d.Current.ClassName) hwnd=$($d.Current.NativeWindowHandle)"
        foreach ($t in $d.FindAll($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Text)))) {
            try { $s = $t.Current.Name; if ($s) { "      txt: $s" } } catch { }
        }
    } catch { }
}

# 读 tab 页签 / 页面列表，判断是否真的载入了内容
"--- 关键文本片段 ---"
$i = 0
foreach ($e in $main.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    try {
        $n = $e.Current.Name
        if ($n -and $n.Length -ge 2 -and $n.Length -le 60 -and $n -notmatch '^\s*$' -and $e.Current.ControlType.ProgrammaticName -match 'Text|ListItem|Tab') {
            "   [$($e.Current.ControlType.ProgrammaticName -replace 'ControlType\.','')] $n"
            $i++; if ($i -ge 40) { break }
        }
    } catch { }
}

$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$shot = Join-Path $ShotDir "$name`__openonly.png"
$bmp.Save($shot, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
"shot=$shot"

Stop-Process -Id $proc.Id -Force -EA SilentlyContinue
'KILLED'
