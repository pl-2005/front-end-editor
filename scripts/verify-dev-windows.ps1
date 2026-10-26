$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class TaskbarProbe {
 public delegate bool Callback(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback c, IntPtr p);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder b,int n);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder b,int n);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int n);
 [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h,uint n);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 public static IntPtr Find(string title) { IntPtr found=IntPtr.Zero; EnumWindows((h,p)=>{var b=new StringBuilder(512);GetWindowText(h,b,512);var c=new StringBuilder(256);GetClassName(h,c,256);if(b.ToString()==title&&c.ToString()=="CASCADIA_HOSTING_WINDOW_CLASS"){found=h;return false;}return true;},IntPtr.Zero);return found; }
}
'@
$root = Split-Path $PSScriptRoot -Parent
$helper = Join-Path $root 'scripts/set-dev-window.ps1'
& $helper -Title 'Editor-taskbar-test' -TitleOnly
$testRoot = Join-Path $root ".codex-build/terminal-stop-check-$PID"
[void](New-Item -ItemType Directory -Path $testRoot -Force)
$stub = Join-Path $testRoot 'start-dev.ps1'
$stop = Join-Path $testRoot 'stop-dev.ps1'
[IO.File]::WriteAllText($stub, 'param([string]$Service); Start-Sleep -Seconds 60')
Copy-Item -LiteralPath (Join-Path $root 'stop-dev.ps1') -Destination $stop
$helperDirectory = Join-Path $testRoot 'scripts'
[void](New-Item -ItemType Directory -Path $helperDirectory -Force)
Copy-Item -LiteralPath $helper -Destination (Join-Path $helperDirectory 'set-dev-window.ps1')
$sessionDirectory = Join-Path $testRoot '.codex-build/dev-sessions'
[void](New-Item -ItemType Directory -Path $sessionDirectory -Force)
$sessionFile = Join-Path $sessionDirectory 'test.json'
$records = @()
$wt = Join-Path $env:LOCALAPPDATA 'Microsoft/WindowsApps/wt.exe'
$shell = (Get-Command pwsh.exe).Source
$windows = @()
try {
    foreach ($service in 'backend','initializer','gateway') {
        $title = "Editor-taskbar-check-$PID-$service"
        $command = "& '$($stub.Replace("'", "''"))' -Service '$service'"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        Start-Process -FilePath $wt -ArgumentList @('-w','new','new-tab','--title',$title,'--suppressApplicationTitle',"`"$shell`"",'-NoLogo','-NoExit','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded)
        $handle = & $helper -MinimizeTitle $title -PassThru
        $window = [TaskbarProbe]::Find($title)
        if ($window -eq [IntPtr]::Zero) { throw 'No visible terminal host created.' }
        $windows += [pscustomobject]@{ Handle=$window; Title=$title }
        $hostProcess = Get-Process -Id ([EditorDev.ConsoleWindow]::OwnerId([IntPtr][long]$handle))
        $records += [pscustomobject]@{ Handle=[string]$handle; Title=$title; OwnerId=$hostProcess.Id; OwnerStartTicks=[string]$hostProcess.StartTime.ToUniversalTime().Ticks }
        ConvertTo-Json -InputObject $records | Set-Content -LiteralPath $sessionFile -Encoding UTF8
        $visible = [TaskbarProbe]::IsWindowVisible($window)
        $minimized = [TaskbarProbe]::IsIconic($window)
        $owner = [TaskbarProbe]::GetWindow($window,4)
        $toolWindow = ([TaskbarProbe]::GetWindowLongPtr($window,-20).ToInt64() -band 128) -ne 0
        Write-Output "$service : visible=$visible; minimized=$minimized; owner=$owner; toolWindow=$toolWindow"
        if (-not $visible -or -not $minimized -or $owner -ne [IntPtr]::Zero -or $toolWindow) { throw 'Terminal not eligible for taskbar.' }
    }
    & $stop
    Start-Sleep -Seconds 2
    foreach ($entry in $windows) {
        if ([TaskbarProbe]::Find($entry.Title) -ne [IntPtr]::Zero) { throw 'Terminal window remained after stop-dev.' }
    }
    Write-Output 'PASS: three service windows have taskbar entries and stop-dev closes them.'
} finally {
    foreach ($entry in $windows) { [void][TaskbarProbe]::PostMessage($entry.Handle,16,[IntPtr]::Zero,[IntPtr]::Zero) }
    Remove-Item -LiteralPath $stub,$stop,$sessionFile,(Join-Path $helperDirectory 'set-dev-window.ps1') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $sessionDirectory,(Join-Path $testRoot '.codex-build'),$helperDirectory -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $testRoot -ErrorAction SilentlyContinue
}
