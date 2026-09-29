$ErrorActionPreference = 'Stop'
$runtime = Join-Path $env:LOCALAPPDATA 'CodexMcpBridge'
$client = Join-Path $runtime 'tunnel\tunnel-client.exe'
$config = Get-Content -LiteralPath (Join-Path $runtime 'config.json') -Raw | ConvertFrom-Json
Invoke-RestMethod "http://127.0.0.1:$($config.port)/readyz" | Out-Null
Write-Host 'OpenAI Tunnel setup: credentials remain on this computer, outside the programming workspace.'
Write-Host 'Create a tunnel associated with your ChatGPT workspace at https://platform.openai.com/settings/organization/tunnels'
$tunnelId = Read-Host 'Tunnel ID'
if ($tunnelId -notmatch '^tunnel_[A-Za-z0-9]+$') { throw 'Invalid tunnel ID' }
$keyFile = Join-Path $runtime 'tunnel-runtime-key.txt'
if (!(Test-Path -LiteralPath $keyFile)) {
  $secureKey = Read-Host 'Runtime API key with Tunnels Read + Use (hidden; transport only)' -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  try { [IO.File]::WriteAllText($keyFile, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  & icacls.exe $keyFile /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):F" '*S-1-5-18:F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Cannot protect runtime key ACL' }
}
$profiles = Join-Path $runtime 'tunnel-profiles'
if (!(Test-Path -LiteralPath (Join-Path $profiles 'codex-bridge.yaml'))) {
  & $client init --sample sample_mcp_remote_no_auth --profile codex-bridge --profile-dir $profiles --tunnel-id $tunnelId --mcp-server-url "http://127.0.0.1:$($config.port)/mcp" --control-plane-api-key-ref "file:$keyFile" --health-listen-addr '127.0.0.1:18889'
  if ($LASTEXITCODE -ne 0) { throw 'Tunnel profile initialization failed' }
}
& $client doctor --profile codex-bridge --profile-dir $profiles --explain
if ($LASTEXITCODE -ne 0) { throw 'Tunnel doctor failed; keep its diagnostic for Codex' }
Write-Host "Connect ChatGPT Plugins > + > Tunnel > $tunnelId, then create/install the private plugin. Keep this console running."
Write-Host "Acceptance prompt: $(Join-Path $PSScriptRoot 'chatgpt-acceptance.txt')"
& $client run --profile codex-bridge --profile-dir $profiles
