param([int]$IntervalSeconds = 30)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $env:LOCALAPPDATA 'CodexMcpBridge'
$configFile = Join-Path $runtime 'config.json'
$pauseFile = Join-Path $runtime 'supervisor-paused'
$logFile = Join-Path $runtime 'supervisor.log'
$startScript = Join-Path $PSScriptRoot 'start.ps1'
$connectScript = Join-Path $PSScriptRoot 'connect-chatgpt.ps1'
$client = Join-Path $runtime 'tunnel\tunnel-client.exe'
$powerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
if (!(Test-Path -LiteralPath $configFile)) { throw 'Missing bridge config' }
if (!(Test-Path -LiteralPath $client)) { throw 'Missing tunnel-client' }
$config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json

function Write-SupervisorLog([string]$Message) {
  if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 1MB) {
    Move-Item -Force $logFile "$logFile.1"
  }
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath $logFile -Value $line
}
function Test-BridgeReady {
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$($config.port)/readyz" -TimeoutSec 3
    return [bool]$response.ready
  } catch { return $false }
}

function Test-BridgeProcessAlive {
  $lockFile = Join-Path $runtime 'state.json.lock'
  if (!(Test-Path -LiteralPath $lockFile)) { return $false }
  try {
    $ownerPid = [int](Get-Content -LiteralPath $lockFile -Raw)
    return $null -ne (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue)
  } catch { return $false }
}

function Start-BridgeProcess {
  Write-SupervisorLog 'bridge process missing; starting'
  $argLine = '-NoProfile -ExecutionPolicy Bypass -File "' + $startScript + '"'
  Start-Process -FilePath $powerShell -ArgumentList $argLine -WindowStyle Hidden | Out-Null
}
function Get-TunnelStatus {
  try {
    $raw = & $client runtimes status codex-bridge --json 2>$null
    if ($LASTEXITCODE -ne 0 -or !$raw) { return $null }
    return ($raw | ConvertFrom-Json)
  } catch { return $null }
}

function Start-TunnelRuntime {
  Write-SupervisorLog 'tunnel runtime missing; reconnecting official runtime'
  & $powerShell -NoProfile -ExecutionPolicy Bypass -File $connectScript *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "tunnel reconnect failed with exit code $LASTEXITCODE"
  }
}

$lastBridgeReady = $null
$lastTunnelReady = $null
Write-SupervisorLog 'supervisor started'
while ($true) {
  if (Test-Path -LiteralPath $pauseFile) {
    Start-Sleep -Seconds $IntervalSeconds
    continue
  }
  try {
    $bridgeReady = Test-BridgeReady
    if (!$bridgeReady -and !(Test-BridgeProcessAlive)) {
      Start-BridgeProcess
      for ($i = 0; $i -lt 15 -and !(Test-BridgeReady); $i++) {
        Start-Sleep -Seconds 2
      }
      $bridgeReady = Test-BridgeReady
    }

    if ($bridgeReady -ne $lastBridgeReady) {
      Write-SupervisorLog "bridge ready=$bridgeReady"
      $lastBridgeReady = $bridgeReady
    }

    if ($bridgeReady) {
      $tunnel = Get-TunnelStatus
      if ($null -eq $tunnel -or !$tunnel.process_running) {
        Start-TunnelRuntime
        $tunnel = Get-TunnelStatus
      }
      $tunnelReady = $null -ne $tunnel -and [bool]$tunnel.process_running -and [bool]$tunnel.ready
      if ($tunnelReady -ne $lastTunnelReady) {
        Write-SupervisorLog "tunnel ready=$tunnelReady"
        $lastTunnelReady = $tunnelReady
      }
    }
  } catch {
    Write-SupervisorLog ("supervisor iteration error: " + $_.Exception.Message)
  }
  Start-Sleep -Seconds $IntervalSeconds
}
