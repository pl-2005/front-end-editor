param(
    [string]$Title,
    [switch]$TitleOnly,
    [string]$MinimizeTitle,
    [IntPtr[]]$ExistingWindows = @(),
    [switch]$PassThru,
    [ValidateRange(1, 60363)]
    [int]$FrontendCount = 2,
    [ValidateRange(-1, 60362)]
    [int]$FrontendIndex = -1
)

if (-not ('EditorDev.ConsoleWindow' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Text;
using System.Collections.Generic;
namespace EditorDev {
    public static class ConsoleWindow {
        private static Timer titleTimer;
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern bool SetConsoleTitle(string title);
        public static void KeepTitle(string title) {
            if (titleTimer != null) titleTimer.Dispose();
            SetConsoleTitle(title);
            // Native commands may replace the shared console title while PowerShell waits.
            titleTimer = new Timer(_ => SetConsoleTitle(title), null, 0, 250);
        }
        [StructLayout(LayoutKind.Sequential)]
        public struct Rect { public int Left, Top, Right, Bottom; }
        private delegate bool WindowCallback(IntPtr window, IntPtr parameter);
        [DllImport("user32.dll")]
        private static extern bool EnumWindows(WindowCallback callback, IntPtr parameter);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr window, StringBuilder title, int length);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr window, StringBuilder name, int length);
        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        public static uint OwnerId(IntPtr window) {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            return owner;
        }
        [DllImport("user32.dll")]
        public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr window);
        [DllImport("user32.dll")]
        public static extern bool ShowWindowAsync(IntPtr window, int command);
        public static IntPtr[] FindHostWindows(string title) {
            var windows = new List<IntPtr>();
            EnumWindows((window, parameter) => {
                if (!IsWindowVisible(window)) return true;
                var text = new StringBuilder(1024);
                GetWindowText(window, text, text.Capacity);
                if (!text.ToString().EndsWith(title, StringComparison.Ordinal)) return true;
                var name = new StringBuilder(256);
                GetClassName(window, name, name.Capacity);
                if (name.ToString() == "CASCADIA_HOSTING_WINDOW_CLASS") windows.Add(window);
                else if (name.ToString() == "ConsoleWindowClass") {
                    // A PowerShell-owned console HWND can be a non-taskbar proxy.
                    // Only a conhost-owned classic window is an actual console UI.
                    uint owner;
                    GetWindowThreadProcessId(window, out owner);
                    try {
                        using (var process = System.Diagnostics.Process.GetProcessById((int)owner)) {
                            if (process.ProcessName == "conhost") windows.Add(window);
                        }
                    } catch (ArgumentException) { }
                }
                return true;
            }, IntPtr.Zero);
            return windows.ToArray();
        }
        [DllImport("kernel32.dll")]
        public static extern IntPtr GetConsoleWindow();
        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr window, int command);
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool MoveWindow(IntPtr window, int x, int y, int width, int height, bool repaint);
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SystemParametersInfo(uint action, uint parameter, out Rect area, uint flags);
    }
}
'@
}

if ($MinimizeTitle) {
    $deadline = (Get-Date).AddSeconds(20)
    $window = [IntPtr]::Zero
    do {
        $found = @([EditorDev.ConsoleWindow]::FindHostWindows($MinimizeTitle) | Where-Object { $_ -notin $ExistingWindows })
        if ($found.Count -gt 0) { $window = $found[0]; break }
        Start-Sleep -Milliseconds 100
    } while ((Get-Date) -lt $deadline)
    if ($window -eq [IntPtr]::Zero) {
        Write-Warning "未找到 $MinimizeTitle 的实际终端窗口，请检查任务栏。"
        return
    }
    # Terminal initialization can restore a window after its first minimize request.
    $deadline = (Get-Date).AddSeconds(5)
    do {
        [void][EditorDev.ConsoleWindow]::ShowWindowAsync($window, 6)
        Start-Sleep -Milliseconds 500
    } while (-not [EditorDev.ConsoleWindow]::IsIconic($window) -and (Get-Date) -lt $deadline)
    if (-not [EditorDev.ConsoleWindow]::IsIconic($window)) {
        Write-Warning "$MinimizeTitle 已打开，请手动最小化窗口。"
    }
    if ($PassThru) { return $window.ToInt64() }
    return
}
if ($Title) { [EditorDev.ConsoleWindow]::KeepTitle($Title) }
if ($TitleOnly) { return }
$window = [EditorDev.ConsoleWindow]::GetConsoleWindow()
if ($window -eq [IntPtr]::Zero) { return }
if ($FrontendIndex -lt 0) {
    [void][EditorDev.ConsoleWindow]::ShowWindow($window, 6) # SW_MINIMIZE
    return
}
if ($FrontendIndex -ge $FrontendCount) { throw '前端窗口序号超出实例数量。' }

$area = New-Object EditorDev.ConsoleWindow+Rect
if (-not [EditorDev.ConsoleWindow]::SystemParametersInfo(48, 0, [ref]$area, 0)) {
    Write-Warning '无法读取屏幕可用区域，请手动排列前端窗口。'
    return
}
$columns = [int][Math]::Ceiling([Math]::Sqrt($FrontendCount))
$rows = [int][Math]::Ceiling($FrontendCount / [double]$columns)
$column = $FrontendIndex % $columns
$row = [int][Math]::Floor($FrontendIndex / [double]$columns)
$cellWidth = ($area.Right - $area.Left) / [double]$columns
$cellHeight = ($area.Bottom - $area.Top) / [double]$rows
$left = $area.Left + [int][Math]::Floor($column * $cellWidth)
$top = $area.Top + [int][Math]::Floor($row * $cellHeight)
$width = [Math]::Max(1, [int][Math]::Floor(($column + 1) * $cellWidth) - ($left - $area.Left) - 8)
$height = [Math]::Max(1, [int][Math]::Floor(($row + 1) * $cellHeight) - ($top - $area.Top) - 8)
[void][EditorDev.ConsoleWindow]::ShowWindow($window, 9) # SW_RESTORE
if (-not [EditorDev.ConsoleWindow]::MoveWindow($window, $left, $top, $width, $height, $true)) {
    Write-Warning '无法调整前端窗口位置，请手动排列窗口。'
}
