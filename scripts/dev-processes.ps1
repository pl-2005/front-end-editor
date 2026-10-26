function Get-DevServiceStates {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [int]$FrontendCount = 2,
        [object[]]$ProcessSnapshot,
        [object[]]$ListeningSnapshot,
        [hashtable]$Ports
    )
    if (-not $Ports) {
        $envPath = Join-Path $Root '.env'
        # Return only port numbers; root configuration and credentials stay inside Node.
        $portJson = & node --input-type=module -e "import {readFileSync} from 'node:fs'; import {parseEnv} from 'node:util'; const c=parseEnv(readFileSync(process.argv[1],'utf8')); const p=(key,fallback,node)=>{const value=Number(node?(process.env[key]??c[key]??fallback):(c[key]??process.env[key]??fallback)); if(!Number.isInteger(value)||value<1||value>65535) throw new Error('Invalid service port configuration'); return value}; process.stdout.write(JSON.stringify({backend:p('SERVER_PORT',8080,false),initializer:p('COLLAB_INITIALIZER_PORT',8091,true),gateway:p('COLLAB_GATEWAY_PORT',8092,true)}));" $envPath
        if ($LASTEXITCODE -ne 0) { throw '无法读取服务端口，请检查根目录 .env。' }
        $portConfig = $portJson | ConvertFrom-Json
        $Ports = @{ backend=[int]$portConfig.backend; initializer=[int]$portConfig.initializer; gateway=[int]$portConfig.gateway }
    }
    if (-not $PSBoundParameters.ContainsKey('ProcessSnapshot')) {
        try { $ProcessSnapshot = @(Get-CimInstance Win32_Process) }
        catch { throw '无法检测已运行的服务进程，请使用启动服务时的 Windows 账号运行。' }
    }
    if (-not $PSBoundParameters.ContainsKey('ListeningSnapshot')) {
        $ListeningSnapshot = @(Get-NetTCPConnection -State Listen -ErrorAction Stop)
    }
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $startPath = (Join-Path $rootPath 'start-dev.ps1').Replace("'", "''")
    $workerPattern = '^' + [regex]::Escape("& '$startPath' -Service '") +
        "(?<service>backend|initializer|gateway|frontend-[0-9]{4,5})'(?: -FrontendCount [0-9]+ -FrontendIndex [0-9]+)?$"
    $vitePath = [IO.Path]::GetFullPath((Join-Path $rootPath 'frontend/node_modules/vite/bin/vite.js'))
    $vitePattern = '^(?:"[^"]+"|\S+)\s+"?' + [regex]::Escape($vitePath) + '"? --host localhost --port (?<port>[0-9]{4,5}) --strictPort(?: --open)?$'
    $owned = @{}
    $services = @('backend', 'initializer', 'gateway') + @(5173..(5172 + $FrontendCount) | ForEach-Object { "frontend-$_" })
    foreach ($name in $services) { $owned[$name] = [System.Collections.Generic.HashSet[int]]::new() }
    foreach ($process in $ProcessSnapshot) {
        $command = [string]$process.CommandLine
        $service = $null
        if ($process.Name -in @('pwsh.exe','powershell.exe')) {
            $encoded = [regex]::Match($command, '(?i)-EncodedCommand\s+"?([A-Za-z0-9+/=]+)"?')
            if ($encoded.Success) {
                try { $decoded = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($encoded.Groups[1].Value)) }
                catch { continue }
                $match = [regex]::Match($decoded, $workerPattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
                if ($match.Success) {
                    $candidate = $match.Groups['service'].Value
                    # -NoExit keeps failed shells alive. Only a worker with a real
                    # child command (or one just created) means the service is starting.
                    $children = @($ProcessSnapshot | Where-Object {
                        $_.ParentProcessId -eq $process.ProcessId -and $_.Name -notin @('conhost.exe','OpenConsole.exe','WindowsTerminal.exe')
                    })
                    $recent = $process.CreationDate -and ((Get-Date) - $process.CreationDate).TotalSeconds -lt 30
                    if ($children.Count -gt 0 -or $recent) { $service = $candidate }
                }
            }
        } elseif ($process.Name -eq 'node.exe') {
            $match = [regex]::Match($command, $vitePattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase)
            if ($match.Success) { $service = "frontend-$($match.Groups['port'].Value)" }
            foreach ($entry in @{initializer='server.js'; gateway='gateway-main.js'}.GetEnumerator()) {
                $path = [IO.Path]::GetFullPath((Join-Path $rootPath "collaboration/dist/$($entry.Value)"))
                if ($command.IndexOf($path, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $service = $entry.Key }
            }
        } elseif ($process.Name -eq 'java.exe' -and $command.Contains('com.webeditor.EditorApplication') -and
            $command.IndexOf((Join-Path $rootPath 'backend'), [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            $service = 'backend'
        }
        if ($service -and $owned.ContainsKey($service)) { [void]$owned[$service].Add([int]$process.ProcessId) }
    }
    foreach ($name in $services) {
        # Include Java/Node grandchildren launched through Maven/npm and cmd.exe.
        do {
            $changed = $false
            foreach ($process in $ProcessSnapshot) {
                if ($owned[$name].Contains([int]$process.ParentProcessId) -and $owned[$name].Add([int]$process.ProcessId)) { $changed = $true }
            }
        } while ($changed)
        $port = if ($name.StartsWith('frontend-')) { [int]$name.Substring(9) } else { [int]$Ports[$name] }
        $listeners = @($ListeningSnapshot | Where-Object { $_.LocalPort -eq $port })
        $foreign = @($listeners | Where-Object { -not $owned[$name].Contains([int]$_.OwningProcess) })
        $state = if ($foreign.Count -gt 0) { 'Conflict' } elseif ($listeners.Count -gt 0) { 'Running' } elseif ($owned[$name].Count -gt 0) { 'Starting' } else { 'Stopped' }
        $label = switch ($name) {
            'backend' { '后端服务' }
            'initializer' { '协作初始化服务' }
            'gateway' { '协作网关' }
            default { "前端实例（端口 $port）" }
        }
        [pscustomobject]@{ Name=$name; Label=$label; Port=$port; State=$state }
    }
}
