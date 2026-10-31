#Requires -Version 5.1
# 测试：在干净环境下 Add-Type -MemberDefinition 能否编译成功（本机环境块 339KB 超限）
Add-Type -Namespace AxW -Name U -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
[DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, System.UIntPtr dwExtraInfo);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hAfter, int X, int Y, int W, int H, uint flags);
'@
Write-Host "PInvoke OK"
Write-Host ("fg=" + [AxW.U]::GetForegroundWindow())
[AxW.U]::SetCursorPos(100, 100) | Out-Null
Write-Host "cursormove OK"
