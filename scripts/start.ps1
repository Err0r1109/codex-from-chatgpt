param([switch]$Status)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $env:LOCALAPPDATA 'CodexMcpBridge'
$configFile = Join-Path $runtime 'config.json'
if (!(Test-Path -LiteralPath $configFile)) { throw 'Missing operator configuration: see README.md' }
$config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
if ($Status) { Invoke-RestMethod "http://127.0.0.1:$($config.port)/readyz"; exit }
$env:CODEX_WORKSPACE_ROOT = $config.workspaceRoot
$env:CODEX_AGENT_STATE_FILE = Join-Path $runtime 'state.json'
$env:CODEX_AGENT_MAX_TURNS = [string]$config.maxTurns
$env:CODEX_AGENT_TURN_TIMEOUT_MS = [string]$config.turnTimeoutMs
$env:PORT = [string]$config.port
$env:HOST = '127.0.0.1'
$env:CODEX_BIN = $config.codexBin
$lockFile = "$env:CODEX_AGENT_STATE_FILE.lock"
if (Test-Path -LiteralPath $lockFile) {
  $ownerPid = [int](Get-Content -LiteralPath $lockFile -Raw)
  if (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue) { throw "Bridge lock owned by live process $ownerPid; inspect before starting another instance." }
  # This exact file is inside the private runtime directory; no recursive cleanup.
  Remove-Item -LiteralPath $lockFile
}
Write-Host 'Codex MCP Bridge operator console. Ctrl+C or type stop to shut down.'
& $config.nodeBin (Join-Path $project 'dist\src\index.js')
exit $LASTEXITCODE
