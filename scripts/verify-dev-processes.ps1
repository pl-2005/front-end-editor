$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'dev-processes.ps1')
$root = Split-Path $PSScriptRoot -Parent
$ports = @{ backend=8080; initializer=8091; gateway=8092 }
$start = (Join-Path $root 'start-dev.ps1').Replace("'", "''")
function Worker([int]$id, [string]$service) {
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("& '$start' -Service '$service'"))
    [pscustomobject]@{ProcessId=$id; ParentProcessId=1; Name='pwsh.exe'; CommandLine="pwsh.exe -EncodedCommand $encoded"; CreationDate=(Get-Date).AddMinutes(-5)}
}
function Process([int]$id, [int]$parent, [string]$name, [string]$command) {
    [pscustomobject]@{ProcessId=$id; ParentProcessId=$parent; Name=$name; CommandLine=$command; CreationDate=(Get-Date).AddMinutes(-5)}
}
function States($processes, $listeners) {
    $map = @{}
    Get-DevServiceStates -Root $root -FrontendCount 2 -Ports $ports -ProcessSnapshot $processes -ListeningSnapshot $listeners |
        ForEach-Object { $map[$_.Name] = $_.State }
    return $map
}
function Assert-State($states, $name, $expected) {
    if ($states[$name] -ne $expected) { throw "$name expected $expected, got $($states[$name])" }
}
$processes = @(
    (Worker 100 'backend'),
    (Process 101 100 'cmd.exe' 'mvn.cmd spring-boot:run'),
    (Process 102 101 'java.exe' "java -cp `"$root/backend/target/classes`" com.webeditor.EditorApplication"),
    (Worker 200 'initializer'),
    (Process 201 200 'cmd.exe' 'npm run start'),
    (Process 202 201 'node.exe' "node `"$(Join-Path $root 'collaboration/dist/server.js')`""),
    (Worker 300 'gateway'),
    (Process 301 300 'node.exe' "node `"$(Join-Path $root 'collaboration/dist/gateway-main.js')`""),
    (Process 401 1 'node.exe' "node `"$(Join-Path $root 'frontend/node_modules/vite/bin/vite.js')`" --host localhost --port 5173 --strictPort --open")
)
$listeners = @(
    [pscustomobject]@{LocalPort=8080; OwningProcess=102},
    [pscustomobject]@{LocalPort=8091; OwningProcess=202},
    [pscustomobject]@{LocalPort=8092; OwningProcess=301},
    [pscustomobject]@{LocalPort=5173; OwningProcess=401}
)
$states = States $processes $listeners
foreach ($name in 'backend','initializer','gateway','frontend-5173') { Assert-State $states $name 'Running' }
Assert-State $states 'frontend-5174' 'Stopped'
Assert-State (States $processes @()) 'backend' 'Starting'
Assert-State (States @((Worker 100 'backend')) @()) 'backend' 'Stopped'
Assert-State (States @() @([pscustomobject]@{LocalPort=8080; OwningProcess=999})) 'backend' 'Conflict'
$otherProject = @(Process 401 1 'node.exe' 'node C:\other-project\vite.js --host localhost --port 5173 --strictPort --open')
Assert-State (States $otherProject $listeners) 'frontend-5173' 'Conflict'
Assert-State (States @() @()) 'frontend-5173' 'Stopped'
Write-Output 'PASS: running services, startup in progress, failed shells, missing instances and foreign ports are distinguished.'

# Exercise the real launcher with a running-process snapshot. Native launches are
# intercepted so this verification never starts/stops application services.
$global:devReuseProcesses = $processes + @(Process 402 1 'node.exe' "node `"$(Join-Path $root 'frontend/node_modules/vite/bin/vite.js')`" --host localhost --port 5174 --strictPort --open")
$global:devReuseListeners = $listeners + @([pscustomobject]@{LocalPort=5174; OwningProcess=402})
$global:devReuseEvents = [System.Collections.Generic.List[string]]::new()
$global:devReuseNode = (Get-Command node.exe).Source
function Get-CimInstance { $global:devReuseProcesses }
function Get-NetTCPConnection { param($State); $global:devReuseListeners }
function Start-Process { param($FilePath,$WorkingDirectory,$ArgumentList,$WindowStyle); $global:devReuseEvents.Add('window') }
function npm.cmd { throw 'Already running collaboration services must not be rebuilt.' }
function node {
    if ($args[0] -like '*wait-dev-ready.mjs') { $global:devReuseEvents.Add('wait'); $global:LASTEXITCODE = 0 }
    elseif ($args[0] -like '*start-dev-frontend.mjs') { $global:devReuseEvents.Add("frontend-$($args[1])"); $global:LASTEXITCODE = 0 }
    else { & $global:devReuseNode @args }
}
try {
    & (Join-Path $root 'start-dev.ps1') -FrontendCount 2
    if (($global:devReuseEvents -join ',') -ne 'wait') { throw 'Repeated startup launched duplicate services.' }
    $global:devReuseEvents.Clear()
    & (Join-Path $root 'start-dev.ps1') -FrontendCount 3
    if (($global:devReuseEvents -join ',') -ne 'wait,frontend-5175') { throw 'Increasing frontend count did not start exactly one new instance.' }
    Write-Output 'PASS: repeat launch creates no windows/processes; increasing frontend count only starts the additional instance.'
} finally {
    Remove-Item Function:Get-CimInstance,Function:Get-NetTCPConnection,Function:Start-Process,Function:npm.cmd,Function:node
    Remove-Variable devReuseProcesses,devReuseListeners,devReuseEvents,devReuseNode -Scope Global
}
