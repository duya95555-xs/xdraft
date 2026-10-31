#Requires -Version 5.1
<#
    axpilot.ps1 — Axure RP 9 单文件格式升级 (v4)

    实测流程（RP8 样本）：
      1) 双击/命令行打开 legacy .rp
      2) 弹出"您的项目已载入完成"提示层 -> 回车关掉
      3) Ctrl+S -> Axure 直接弹「另存为」对话框（默认同名同目录）
      4) 用 UIAutomation 点「保存(S)」-> 若问覆盖 -> 点「是(Y)」
      5) Alt+F4 关窗（若问保存 -> 否）

    v4 改动：不再用 SendKeys 盲打对话框（对话框拿不到焦点），改为 UIAutomation 直接 Invoke 按钮。

    .EXAMPLE
    .\axpilot.ps1 -File "...\work_rp8.rp"
#>
param(
    [Parameter(Mandatory = $true)][string]$File,
    [int]$OpenWaitSec = 60,
    [switch]$KeepOpen,
    [string]$ShotDir = 'C:\Users\xiaos\AppData\Local\Temp\axshots'
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$exe = 'D:\Program Files (x86)\Axure\Axure RP 9\AxureRP9.exe'
if (-not (Test-Path $exe)) { throw 'NO_AXURE_EXE' }
if (-not (Test-Path $File)) { throw 'NO_FILE' }
New-Item -ItemType Directory -Force -Path $ShotDir | Out-Null

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, Microsoft.VisualBasic,
                       System.Windows.Forms, System.Drawing, System.IO.Compression.FileSystem

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]

function Act([int]$ProcId) { $null = [Microsoft.VisualBasic.Interaction]::AppActivate($ProcId); Start-Sleep -Milliseconds 600 }
function Keys([string]$k) { [System.Windows.Forms.SendKeys]::SendWait($k); Start-Sleep -Milliseconds 900 }

function Get-TopWindows([int]$ProcId) {
    $out = @()
    foreach ($e in $AE::RootElement.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
        try { if ($e.Current.ProcessId -eq $ProcId) { $out += $e } } catch { }
    }
    , $out
}

function Get-Names([int]$ProcId) {
    @(Get-TopWindows $ProcId | ForEach-Object { try { $_.Current.Name } catch { } } | Where-Object { $_ })
}

function Wait-Window([int]$ProcId, [string]$Pattern, [int]$TimeoutSec) {
    $dl = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $dl) {
        foreach ($w in (Get-TopWindows $ProcId)) {
            try { if ($w.Current.Name -match $Pattern) { return $w } } catch { }
        }
        Start-Sleep -Milliseconds 700
    }
    return $null
}

# 在标题匹配 $WinPattern 的顶层窗口里，点名字匹配 $BtnPattern 的按钮
function Invoke-Btn([int]$ProcId, [string]$WinPattern, [string]$BtnPattern) {
    $bc = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Button)
    foreach ($w in (Get-TopWindows $ProcId)) {
        try { if ($w.Current.Name -notmatch $WinPattern) { continue } } catch { continue }
        foreach ($b in $w.FindAll($TS::Descendants, $bc)) {
            try {
                if ($b.Current.Name -match $BtnPattern) {
                    $b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
                    return "$($w.Current.Name) / $($b.Current.Name)"
                }
            } catch { }
        }
    }
    return $null
}

function Snap([string]$Tag) {
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
    $p = Join-Path $ShotDir "$Tag.png"
    $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $p
}

function Get-Meta([string]$Path) {
    $f = Get-Item $Path
    $r = [ordered]@{ bytes = $f.Length; mtime = $f.LastWriteTime.ToString('HH:mm:ss') }
    try {
        $z = [System.IO.Compression.ZipFile]::OpenRead($Path)
        $names = @($z.Entries.FullName); $z.Dispose()
        $r.entries = $names.Count
        $r.document_data = @($names | Where-Object { $_ -like 'document_data/*' }).Count
        $r.data = @($names | Where-Object { $_ -like 'data/*' }).Count
        $r.pages_json = @($names | Where-Object { $_ -like '*pages*' }).Count
        $r.rppkg = @($names | Where-Object { $_ -like '*.rppkg' }).Count
        $r.top = (($names | ForEach-Object { $_.Split('/')[0] } | Sort-Object -Unique) -join ',')
    } catch { $r.err = 'LOCKED_OR_BADZIP' }
    return [pscustomobject]$r
}

$name = [System.IO.Path]::GetFileNameWithoutExtension($File)
"=== PILOT v4: $name ==="
$before = Get-Meta $File
"before: entries=$($before.entries) rppkg=$($before.rppkg) bytes=$($before.bytes)"

$proc = Start-Process -FilePath $exe -ArgumentList ('"{0}"' -f $File) -PassThru
"pid=$($proc.Id)"

$dl = (Get-Date).AddSeconds($OpenWaitSec)
while ((Get-Date) -lt $dl) {
    Start-Sleep -Milliseconds 1000
    $proc.Refresh()
    if ($proc.HasExited) { 'EXITED_EARLY'; break }
    if ((Get-Names $proc.Id).Count -gt 0) { break }
}
"windows_open: " + ((Get-Names $proc.Id) -join ' | ')

# --- 2. 关掉"载入完成"提示层 ---
Start-Sleep -Seconds 4
Act $proc.Id
Keys '{ENTER}'
Start-Sleep -Seconds 1
"windows_after_enter: " + ((Get-Names $proc.Id) -join ' | ')

# --- 3. Ctrl+S 触发另存为 ---
Act $proc.Id
Keys '^s'
$dlg = Wait-Window $proc.Id '另存为|Save As' 25
if ($dlg) {
    "saveas_dialog=$($dlg.Current.Name)"
    "shot_saveas=" + (Snap "${name}__saveas")
    $hit = Invoke-Btn $proc.Id '另存为|Save As' '保存|^Save'
    if (-not $hit) { $hit = Invoke-Btn $proc.Id '另存为|Save As' '.' }
    "clicked=$hit"
    Start-Sleep -Seconds 3
    # 覆盖确认
    $cf = Wait-Window $proc.Id '确认另存为|文件已存在|Confirm Save As' 8
    if ($cf) {
        "overwrite_dialog=$($cf.Current.Name)"
        $hit2 = Invoke-Btn $proc.Id '确认另存为|文件已存在|Confirm Save As' '是|^Yes'
        "clicked_overwrite=$hit2"
    }
    Start-Sleep -Seconds 6
} else {
    'no_saveas_dialog'
    "shot_nodlg=" + (Snap "${name}__nosaveas")
}

"windows_after_save: " + ((Get-Names $proc.Id) -join ' | ')
"shot_after_save=" + (Snap "${name}__aftersave")

# --- 5. 关窗 ---
if (-not $KeepOpen) {
    Act $proc.Id
    Keys '%{F4}'
    Start-Sleep -Seconds 2
    $sv = Wait-Window $proc.Id 'Axure|保存' 4
    if ($sv) { Keys 'n' }   # 问是否保存 -> 否
    Start-Sleep -Seconds 2
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -EA SilentlyContinue }
    Start-Sleep -Seconds 3
}

'--- AFTER ---'
Get-Meta $File | Format-List | Out-String
