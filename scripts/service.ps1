param(
  [Parameter(Position=0)]
  [ValidateSet('install','start','stop','restart','status','uninstall')]
  [string]$Action = 'status'
)
$ErrorActionPreference = 'Stop'
$taskName = 'Codex MCP Bridge Supervisor'
$project = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $env:LOCALAPPDATA 'CodexMcpBridge'
$pauseFile = Join-Path $runtime 'supervisor-paused'
$supervisor = Join-Path $PSScriptRoot 'supervisor.ps1'
$control = Join-Path $PSScriptRoot 'control.ps1'
$client = Join-Path $runtime 'tunnel\tunnel-client.exe'
$config = Get-Content -LiteralPath (Join-Path $runtime 'config.json') -Raw | ConvertFrom-Json
$powerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

function Test-BridgeReady {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$($config.port)/readyz" -TimeoutSec 3
    return [bool]$r.ready
  } catch { return $false }
}
function Get-TunnelSummary {
  if (!(Test-Path -LiteralPath $client)) {
    return [ordered]@{ process_running = $false; ready = $false }
  }
  try {
    $raw = & $client runtimes status codex-bridge --json 2>$null
    if ($LASTEXITCODE -ne 0 -or !$raw) {
      return [ordered]@{ process_running = $false; ready = $false }
    }
    $status = $raw | ConvertFrom-Json
    return [ordered]@{
      process_running = [bool]$status.process_running
      ready = [bool]$status.ready
      runtime_state = $status.runtime_state
    }
  } catch {
    return [ordered]@{ process_running = $false; ready = $false }
  }
}

function Stop-BridgeExact {
  try {
    & $powerShell -NoProfile -ExecutionPolicy Bypass -File $control stop *> $null
    if ($LASTEXITCODE -eq 0) { return }
  } catch {}
  $lockFile = Join-Path $runtime 'state.json.lock'
  if (!(Test-Path -LiteralPath $lockFile)) { return }
  $ownerPid = [int](Get-Content -LiteralPath $lockFile -Raw)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction SilentlyContinue
  if ($null -eq $process) { return }
  if ($process.CommandLine -notmatch 'codex-from-chatgpt.+dist[\\/]src[\\/]index\.js') {
    throw "Refusing to terminate PID $ownerPid because it is not the bridge process"
  }
  Stop-Process -Id $ownerPid -Force
}

function Install-Autostart {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $argLine = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $supervisor + '"'
  $taskAction = New-ScheduledTaskAction -Execute $powerShell -Argument $argLine
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
  $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description 'Keeps the local Codex MCP Bridge and official Secure MCP Tunnel available.' -Force | Out-Null
}
function Stop-ServiceStack {
  New-Item -ItemType File -Path $pauseFile -Force | Out-Null
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $client) {
    & $client runtimes stop codex-bridge *> $null
  }
  Stop-BridgeExact
}

function Start-ServiceStack {
  if (Test-Path -LiteralPath $pauseFile) { Remove-Item -LiteralPath $pauseFile -Force }
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (!$task) { throw 'Autostart is not installed. Run scripts\service.ps1 install.' }
  Start-ScheduledTask -TaskName $taskName
}

function Show-Status {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  $tunnel = Get-TunnelSummary
  [ordered]@{
    autostart_installed = $null -ne $task
    supervisor_state = if ($task) { [string]$task.State } else { 'NotInstalled' }
    paused = Test-Path -LiteralPath $pauseFile
    bridge_ready = Test-BridgeReady
    tunnel_process_running = $tunnel.process_running
    tunnel_ready = $tunnel.ready
    tunnel_state = $tunnel.runtime_state
  } | ConvertTo-Json
}
switch ($Action) {
  'install' {
    Install-Autostart
    Start-ServiceStack
    Start-Sleep -Seconds 2
    Show-Status
  }
  'start' {
    Start-ServiceStack
    Start-Sleep -Seconds 2
    Show-Status
  }
  'stop' {
    Stop-ServiceStack
    Show-Status
  }
  'restart' {
    Stop-ServiceStack
    Start-Sleep -Seconds 1
    Start-ServiceStack
    Start-Sleep -Seconds 2
    Show-Status
  }
  'status' { Show-Status }
  'uninstall' {
    Stop-ServiceStack
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $pauseFile) { Remove-Item -LiteralPath $pauseFile -Force }
    Show-Status
  }
}
