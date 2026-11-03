$ErrorActionPreference = 'Stop'
$publisherRoot = $PSScriptRoot
$publisherUrl = 'http://127.0.0.1:4188/'
$publisherRunning = $false
try {
    $publisherHealth = Invoke-RestMethod ($publisherUrl + 'api/health') -TimeoutSec 2
    if ($publisherHealth.app -ne 'rednote-publisher') { throw 'Port 4188 is used by a different application.' }
    $publisherRunning = $true
} catch {
    if ($_.Exception.Message -like '*different application*') { throw }
}
if (-not $publisherRunning) {
    $publisherNode = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $publisherNode) {
        $publisherNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    }
    if (-not (Test-Path -LiteralPath $publisherNode)) { throw 'Node.js is required. Please install Node.js 22 or newer.' }
    $publisherWork = Join-Path $publisherRoot 'work'
    New-Item -ItemType Directory -Force -Path $publisherWork | Out-Null
    $publisherServer = Join-Path $publisherRoot 'server.mjs'
    $publisherProcess = Start-Process -FilePath $publisherNode -ArgumentList ('"' + $publisherServer + '"') -WorkingDirectory $publisherRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $publisherWork 'server.stdout.log') -RedirectStandardError (Join-Path $publisherWork 'server.stderr.log') -PassThru
    $publisherProcess.Id | Set-Content -LiteralPath (Join-Path $publisherWork 'server.pid')
    for ($publisherTry = 0; $publisherTry -lt 20; $publisherTry++) {
        Start-Sleep -Milliseconds 400
        try { $publisherHealth = Invoke-RestMethod ($publisherUrl + 'api/health') -TimeoutSec 1; if ($publisherHealth.app -eq 'rednote-publisher') { $publisherRunning = $true; break } } catch {}
    }
    if (-not $publisherRunning) { throw 'The publisher did not start. See work/server.stderr.log.' }
}
Start-Process $publisherUrl
