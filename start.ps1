$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
    $runtime = $nodeCommand.Source
} else {
    $bundledRuntime = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $bundledRuntime) {
        $runtime = $bundledRuntime
    } else {
        Write-Host 'Node.js 22+ is required. Install Node.js, then run this launcher again.'
        Read-Host 'Press Enter to close'
        exit 1
    }
}
$majorVersion = [int]((& $runtime -p 'process.versions.node').Split('.')[0])
if ($majorVersion -lt 22) { throw 'Node.js 22+ is required.' }
& $runtime scripts/serve.mjs
