param(
    [switch]$Check,
    [ValidateRange(1, 60363)]
    [int]$FrontendCount = 2,
    [ValidateRange(1, 1800)]
    [int]$StartupTimeoutSeconds = 180,
    [ValidateRange(0, 60362)]
    [int]$FrontendIndex = 0,
    [ValidatePattern('^(backend|initializer|gateway|frontend-[0-9]{4,5})$')]
    [string]$Service
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
if (-not $Service.StartsWith('frontend-')) { [Console]::OutputEncoding = $utf8 }
$OutputEncoding = $utf8

if ($Service) {
    $serviceLabel = switch ($Service) {
        'backend' { '后端服务' }
        'initializer' { '协作初始化' }
        'gateway' { '协作网关' }
        default { "前端 $($FrontendIndex + 1)（端口 $($Service.Substring('frontend-'.Length))）" }
    }
    if (-not $Service.StartsWith('frontend-')) {
        $windowTitle = "编辑器 | $serviceLabel"
        $Host.UI.RawUI.WindowTitle = $windowTitle
        $windowHelper = Join-Path $PSScriptRoot 'scripts/set-dev-window.ps1'
        & $windowHelper -Title $windowTitle -TitleOnly
    }
    if ($Service -eq 'backend') {
        Set-Location $PSScriptRoot
        # Capture parsed values directly; never print credentials or embed them in commands.
        $configJson = & node --input-type=module -e "import {readFileSync} from 'node:fs'; import {parseEnv} from 'node:util'; process.stdout.write(JSON.stringify(parseEnv(readFileSync('.env', 'utf8'))));"
        if ($LASTEXITCODE -ne 0) { throw '无法读取仓库根目录的 .env 配置文件。' }
        $config = $configJson | ConvertFrom-Json
        foreach ($property in $config.PSObject.Properties) {
            [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'Process')
        }
        Remove-Variable configJson, config
        Set-Location (Join-Path $PSScriptRoot 'backend')
        & mvn.cmd spring-boot:run '-Dspring-boot.run.main-class=com.webeditor.EditorApplication'
    } elseif ($Service -in 'initializer', 'gateway') {
        Set-Location (Join-Path $PSScriptRoot 'collaboration')
        if ($Service -eq 'initializer') { & npm.cmd run start }
        else { & npm.cmd run start:gateway }
    } else {
        Set-Location (Join-Path $PSScriptRoot 'frontend')
        $port = $Service.Substring('frontend-'.Length)
        if ([int]$port -lt 5173 -or [int]$port -gt 65535) { throw '前端端口必须在 5173 到 65535 之间。' }
        # Vite opens the default browser only after it has bound the requested port.
        # Frontend output is discarded rather than written to a file or a console.
        & npm.cmd run dev -- --host localhost --port $port --strictPort --open *> $null
    }
    if ($LASTEXITCODE -ne 0) { throw "$serviceLabel 已退出，退出码：$LASTEXITCODE。" }
    return
}

$startupParameters = $PSBoundParameters
function Invoke-DevLauncher {
foreach ($command in 'node', 'npm.cmd', 'mvn.cmd', 'java') {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "未找到命令：$command，请先安装并添加到 PATH 环境变量。"
    }
}
foreach ($path in '.env', 'frontend/node_modules', 'collaboration/node_modules') {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $path))) {
        throw "缺少 $path，请先配置根目录 .env，并在 frontend 和 collaboration 目录分别执行 npm ci。"
    }
}
if (-not $Check) {
    & (Join-Path $PSScriptRoot 'scripts/set-dev-window.ps1') -Title '编辑器 | 启动器' -TitleOnly
}
Push-Location $PSScriptRoot
try {
    & node --input-type=module -e "import {readFileSync} from 'node:fs'; import {parseEnv} from 'node:util'; parseEnv(readFileSync('.env', 'utf8'));"
    if ($LASTEXITCODE -ne 0) { throw '无法读取仓库根目录的 .env 配置文件。' }
    if ($Check) {
        Write-Host '检查通过：启动命令、根目录 .env 和模块依赖均已就绪。本次未启动服务。'
        return
    }
    if (-not $startupParameters.ContainsKey('FrontendCount')) {
        do {
            $answer = Read-Host '请输入前端实例数量（默认 2 个，直接回车使用默认值）'
            if ([string]::IsNullOrWhiteSpace($answer)) {
                $FrontendCount = 2
                break
            }
            $parsedCount = 0
            $validCount = [int]::TryParse($answer, [ref]$parsedCount) -and $parsedCount -ge 1 -and $parsedCount -le 60363
            if ($validCount) { $FrontendCount = $parsedCount }
            else { Write-Host '输入无效，请输入 1 到 60363 之间的整数。' }
        } while (-not $validCount)
    }
    . (Join-Path $PSScriptRoot 'scripts/dev-processes.ps1')
    $states = @(Get-DevServiceStates -Root $PSScriptRoot -FrontendCount $FrontendCount)
    $stateMap = @{}
    foreach ($state in $states) {
        $stateMap[$state.Name] = $state
        if ($state.State -eq 'Conflict') { throw "端口 $($state.Port) 已被其他程序占用，无法启动$($state.Label)。" }
    }
    if ($stateMap.initializer.State -eq 'Stopped' -or $stateMap.gateway.State -eq 'Stopped') {
        Set-Location (Join-Path $PSScriptRoot 'collaboration')
        Write-Host '正在构建协作模块……'
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw '协作模块构建失败，请查看上方错误信息。' }
    } else {
        Write-Host '协作服务已启动，跳过重复构建。'
    }
} finally {
    Pop-Location
}

if (@($states | Where-Object { $_.Name -in @('backend','initializer','gateway') -and $_.State -eq 'Stopped' }).Count -gt 0) {
    $powershellCommand = Get-Command pwsh.exe -ErrorAction SilentlyContinue
    if (-not $powershellCommand) { $powershellCommand = Get-Command powershell.exe }
    $powershell = $powershellCommand.Source
    $terminalCommand = Get-Command wt.exe -ErrorAction SilentlyContinue
    $terminal = if ($terminalCommand) { $terminalCommand.Source } else { Join-Path $env:LOCALAPPDATA 'Microsoft/WindowsApps/wt.exe' }
    $useTerminal = Test-Path -LiteralPath $terminal
}
$scriptPath = $PSCommandPath.Replace("'", "''")
$frontendPorts = 5173..(5172 + $FrontendCount)
$sessionDirectory = Join-Path $PSScriptRoot '.codex-build/dev-sessions'
[void](New-Item -ItemType Directory -Path $sessionDirectory -Force)
$sessionFile = Join-Path $sessionDirectory "$([guid]::NewGuid().ToString('N')).json"
$sessionWindows = @()
foreach ($name in 'backend', 'initializer', 'gateway') {
    if ($stateMap[$name].State -ne 'Stopped') {
        Write-Host "$($stateMap[$name].Label)已运行或正在启动（端口 $($stateMap[$name].Port)），跳过重复启动。"
        continue
    }
    # EncodedCommand preserves paths with spaces/quotes and contains no configuration values.
    $windowCommand = "& '$scriptPath' -Service '$name'"
    $serviceLabel = switch ($name) {
        'backend' { '后端服务' }
        'initializer' { '协作初始化' }
        'gateway' { '协作网关' }
    }
    $windowTitle = "编辑器 | $serviceLabel"
    $existingWindows = @([EditorDev.ConsoleWindow]::FindHostWindows($windowTitle))
    $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($windowCommand))
    if ($useTerminal) {
        # Open an actual terminal window first. Starting minimized PowerShell can
        # leave only a console proxy that has no taskbar entry under terminal delegation.
        Start-Process -FilePath $terminal -WorkingDirectory $PSScriptRoot -ArgumentList @(
            '-w', 'new', 'new-tab', '--title', "`"$windowTitle`"", '--suppressApplicationTitle',
            '--startingDirectory', "`"$PSScriptRoot`"", "`"$powershell`"",
            '-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encodedCommand
        )
    } else {
        Start-Process -FilePath $powershell -WorkingDirectory $PSScriptRoot -WindowStyle Normal `
            -ArgumentList @('-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encodedCommand)
    }
    $windowHandle = & (Join-Path $PSScriptRoot 'scripts/set-dev-window.ps1') -MinimizeTitle $windowTitle -ExistingWindows $existingWindows -PassThru
    if ($windowHandle) {
        $windowOwner = Get-Process -Id ([EditorDev.ConsoleWindow]::OwnerId([IntPtr][long]$windowHandle))
        $sessionWindows += [pscustomobject]@{
            Handle = [string]$windowHandle
            Title = $windowTitle
            OwnerId = $windowOwner.Id
            OwnerStartTicks = [string]$windowOwner.StartTime.ToUniversalTime().Ticks
        }
        ConvertTo-Json -InputObject $sessionWindows | Set-Content -LiteralPath $sessionFile -Encoding UTF8
    }
}
Write-Host '后台服务检测完成：已启动的服务复用，缺少的服务已启动。'
& node (Join-Path $PSScriptRoot 'scripts/wait-dev-ready.mjs') $StartupTimeoutSeconds
if ($LASTEXITCODE -ne 0) { throw '后台服务尚未就绪，已取消前端启动和浏览器打开。' }
foreach ($port in $frontendPorts) {
    if ($stateMap["frontend-$port"].State -ne 'Stopped') {
        Write-Host "前端实例已运行或正在启动（端口 $port），跳过重复启动和浏览器打开。"
        continue
    }
    & node (Join-Path $PSScriptRoot 'scripts/start-dev-frontend.mjs') $port
    if ($LASTEXITCODE -ne 0) { throw "前端实例启动失败（端口 $port）。" }
}
Write-Host "后台服务已就绪，$FrontendCount 个前端实例已复用或启动，新实例就绪后自动打开默认浏览器。"
foreach ($port in $frontendPorts) { Write-Host "前端地址：http://localhost:$port" }
Write-Host '双击 stop-dev.bat 可关闭全部服务，包括后台前端实例。'
}

# Serialize launchers for this workspace; service workers bypass this lock above.
$hashAlgorithm = [Security.Cryptography.SHA256]::Create()
try {
    $rootBytes = [Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($PSScriptRoot).ToLowerInvariant())
    $lockId = ([BitConverter]::ToString($hashAlgorithm.ComputeHash($rootBytes))).Replace('-', '')
} finally { $hashAlgorithm.Dispose() }
$startupMutex = New-Object Threading.Mutex($false, "Local\EditorDevStartup-$lockId")
$ownsStartupLock = $false
try {
    try { $ownsStartupLock = $startupMutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $ownsStartupLock = $true }
    if (-not $ownsStartupLock) { Write-Host '本项目已有启动器正在运行，已跳过本次重复启动。'; return }
    Invoke-DevLauncher
} finally {
    if ($ownsStartupLock) { $startupMutex.ReleaseMutex() }
    $startupMutex.Dispose()
}
