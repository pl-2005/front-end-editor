param([string]$ReleaseId = ("step11-release-" + (Get-Date -Format 'yyyyMMdd-HHmmss')))
$ErrorActionPreference = 'Stop'
if ($ReleaseId -notmatch '^[A-Za-z0-9_-]+$') { throw 'Invalid release ID' }
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskBuild = Join-Path $taskRoot '.codex-build'
$taskFrontend = [IO.Path]::GetFullPath((Join-Path $taskBuild 'step11-frontend'))
if (-not $taskFrontend.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Build path escaped workspace' }
foreach ($taskPath in @($taskBuild, $taskFrontend)) {
    if ((Test-Path -LiteralPath $taskPath) -and ((Get-Item -LiteralPath $taskPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Build path cannot be a filesystem link' }
}
New-Item -ItemType Directory -Force -Path $taskBuild | Out-Null
function Check-Exit { if ($LASTEXITCODE -ne 0) { throw 'Step11 build/check failed' } }
Push-Location $taskRoot
try {
    Push-Location backend
    try { & mvn -o package "-Deditor.build.directory=$taskBuild/step11-backend"; Check-Exit } finally { Pop-Location }
    Push-Location frontend
    try {
        & npm test; Check-Exit
        & npm run lint; Check-Exit
        & node node_modules/typescript/bin/tsc -p tsconfig.app.json --tsBuildInfoFile "$taskBuild/step11-app.tsbuildinfo"; Check-Exit
        & node node_modules/typescript/bin/tsc -p tsconfig.node.json --tsBuildInfoFile "$taskBuild/step11-node.tsbuildinfo"; Check-Exit
        & node node_modules/vite/bin/vite.js build --configLoader runner --outDir $taskFrontend --emptyOutDir; Check-Exit
    } finally { Pop-Location }
    Push-Location collaboration
    try {
        & npm test; Check-Exit
        & node scripts/release.mjs pack "$taskBuild/$ReleaseId" '.codex-build/step11-backend/backend-0.1.0-SNAPSHOT.jar' $taskFrontend; Check-Exit
    } finally { Pop-Location }
} finally { Pop-Location }
