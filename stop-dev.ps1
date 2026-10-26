[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$Host.UI.RawUI.WindowTitle = '编辑器 | 关闭服务'

# Identify only workers started by this repository's launcher, including older
# launches. Do not match window titles or kill every Java/Node/PowerShell process.
$scriptPath = (Join-Path $PSScriptRoot 'start-dev.ps1').Replace("'", "''")
$workerPattern = '^' + [regex]::Escape("& '$scriptPath' -Service '") +
    "(?<service>backend|initializer|gateway|frontend-[0-9]{4,5})'(?: -FrontendCount [0-9]+ -FrontendIndex [0-9]+)?$"
$targets = @{}
$vitePath = Join-Path $PSScriptRoot 'frontend/node_modules/vite/bin/vite.js'
$vitePathPattern = [regex]::Escape([IO.Path]::GetFullPath($vitePath))
$frontendPattern = '^(?:"[^"]+"|\S+)\s+"?' + $vitePathPattern +
    '"? --host localhost --port (?<port>[0-9]{4,5}) --strictPort --open$'
try {
    $workers = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe' OR Name = 'node.exe'"
} catch {
    throw '无法读取服务进程信息，请使用启动服务时的 Windows 账号运行此脚本。'
}
foreach ($worker in $workers) {
    if ($worker.Name -eq 'node.exe') {
        $frontendMatch = [regex]::Match([string]$worker.CommandLine, $frontendPattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
        if ($frontendMatch.Success) {
            $targets[[int]$worker.ProcessId] = "frontend-$($frontendMatch.Groups['port'].Value)"
        }
        continue
    }
    $encoded = [regex]::Match([string]$worker.CommandLine, '(?i)(?:^|\s)-EncodedCommand\s+"?([A-Za-z0-9+/=]+)"?(?:\s|$)')
    if (-not $encoded.Success) { continue }
    try {
        $command = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($encoded.Groups[1].Value))
    } catch { continue }
    $match = [regex]::Match($command, $workerPattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $match.Success) { continue }

    $targetId = [int]$worker.ProcessId
    $parent = Get-Process -Id $worker.ParentProcessId -ErrorAction SilentlyContinue
    if ($parent -and $parent.ProcessName -eq 'conhost') {
        # Include the dedicated console so its window closes along with all descendants.
        $targetId = $parent.Id
    }
    $targets[$targetId] = $match.Groups['service'].Value
}

$sessionFiles = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '.codex-build/dev-sessions') -Filter '*.json' -File -ErrorAction SilentlyContinue)
if ($targets.Count -eq 0 -and $sessionFiles.Count -eq 0) {
    Write-Host '未发现本仓库启动的服务窗口，无需关闭。'
    return
}
$failed = @()
foreach ($entry in $targets.GetEnumerator()) {
    $targetId = [int]$entry.Key
    $label = switch -Regex ($entry.Value) {
        '^backend$' { '后端服务' }
        '^initializer$' { '协作初始化' }
        '^gateway$' { '协作网关' }
        '^frontend-(\d+)$' { "前端（端口 $($Matches[1])）" }
    }
    if (-not $PSCmdlet.ShouldProcess("$label（进程 $targetId）", '关闭窗口及全部子进程')) { continue }
    # Only the validated integer PID is interpolated into this fixed command.
    & $env:ComSpec /d /c "taskkill /PID $targetId /T /F >nul 2>&1"
    if ($LASTEXITCODE -eq 0 -or -not (Get-Process -Id $targetId -ErrorAction SilentlyContinue)) {
        Write-Host "已关闭：$label"
    } else {
        $failed += $label
        Write-Warning "关闭失败：$label，请检查是否以其他账号或管理员权限启动。"
    }
}
if ($sessionFiles.Count -gt 0) {
    & (Join-Path $PSScriptRoot 'scripts/set-dev-window.ps1') -TitleOnly
    foreach ($file in $sessionFiles) {
        try { $windows = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json }
        catch { Write-Warning "无法读取窗口记录：$($file.Name)"; $failed += $file.Name; continue }
        $fileFailed = $false
        $fileSkipped = $false
        foreach ($entry in $windows) {
            $owner = Get-Process -Id $entry.OwnerId -ErrorAction SilentlyContinue
            if (-not $owner -or [string]$owner.StartTime.ToUniversalTime().Ticks -ne [string]$entry.OwnerStartTicks) { continue }
            $window = [IntPtr][long]$entry.Handle
            if ([EditorDev.ConsoleWindow]::OwnerId($window) -ne $entry.OwnerId -or $window -notin @([EditorDev.ConsoleWindow]::FindHostWindows($entry.Title))) { continue }
            if (-not $PSCmdlet.ShouldProcess($entry.Title, '关闭服务终端窗口')) { $fileSkipped = $true; continue }
            [void][EditorDev.ConsoleWindow]::PostMessage($window, 16, [IntPtr]::Zero, [IntPtr]::Zero)
            $deadline = (Get-Date).AddSeconds(5)
            while ($window -in @([EditorDev.ConsoleWindow]::FindHostWindows($entry.Title)) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
            if ($window -in @([EditorDev.ConsoleWindow]::FindHostWindows($entry.Title))) {
                $fileFailed = $true
                $failed += $entry.Title
                Write-Warning "终端窗口未能关闭：$($entry.Title)"
            }
        }
        if (-not $fileFailed -and -not $fileSkipped -and -not $WhatIfPreference) { Remove-Item -LiteralPath $file.FullName }
    }
}
if ($failed.Count -gt 0) { throw "有 $($failed.Count) 个服务未能关闭，请查看上方提示。" }
if ($WhatIfPreference) {
    Write-Host "预览完成，共找到 $($targets.Count) 个服务窗口，本次未关闭任何服务。"
} else {
    Write-Host '全部服务窗口已关闭。'
}
