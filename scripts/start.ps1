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
$tokenFile = Join-Path $runtime 'operator-token.txt'
if (!(Test-Path -LiteralPath $tokenFile)) {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $token = ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
  [IO.File]::WriteAllText($tokenFile, $token, [Text.UTF8Encoding]::new($false))
}
& icacls.exe $tokenFile /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):F" '*S-1-5-18:F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot protect operator control token ACL' }
$env:CODEX_OPERATOR_TOKEN_FILE = $tokenFile
$env:CODEX_OPERATOR_PORT = [string]([int]$config.port + 1)
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
