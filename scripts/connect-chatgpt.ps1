param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$runtime = Join-Path $env:LOCALAPPDATA 'CodexMcpBridge'
$client = Join-Path $runtime 'tunnel\tunnel-client.exe'
if (!(Test-Path -LiteralPath $client)) { throw 'Official tunnel-client is missing from the private runtime directory' }
$config = Get-Content -LiteralPath (Join-Path $runtime 'config.json') -Raw | ConvertFrom-Json
if ($config.port -ne 18887) { throw 'Expected private bridge endpoint 127.0.0.1:18887' }
$ready = Invoke-RestMethod 'http://127.0.0.1:18887/readyz'
if (!$ready.ready) { throw 'Bridge is not ready' }
$keyFile = Join-Path $runtime 'tunnel-runtime-key.txt'
$authorizationFile = Join-Path $runtime 'tunnel-authorization.json'
$profiles = Join-Path $runtime 'tunnel-profiles'

# Inspect official state only, never another project's credentials.
& $client profiles list
& $client runtimes list
if (!(Test-Path -LiteralPath $keyFile) -or !(Test-Path -LiteralPath $authorizationFile)) {
  # A ChatGPT login is not a Platform admin credential. Never exchange it through
  # undocumented endpoints, invent a tunnel id, or enable API billing.
  & $client doctor --mcp.server-url 'http://127.0.0.1:18887/mcp' --explain
  Write-Output 'PLATFORM_AUTHORIZATION_REQUIRED: no verified tunnel-only runtime credential. The operator must authenticate at https://platform.openai.com/settings/organization/tunnels. No billing or model inference is enabled by this script.'
  exit 2
}
$authorization = Get-Content -LiteralPath $authorizationFile -Raw | ConvertFrom-Json
if ($authorization.tunnelId -notmatch '^tunnel_[A-Za-z0-9]+$') { throw 'Invalid tunnel ID' }
# Record this only after inspecting the actual Platform key/role permissions.
# Credential replacement invalidates that review.
$keyHash = (Get-FileHash -LiteralPath $keyFile -Algorithm SHA256).Hash
if ($authorization.credentialSha256 -ne $keyHash -or
    $authorization.modelInferenceAllowed -ne $false -or
    $authorization.paidApiActivationRequired -ne $false -or
    $authorization.tunnelsReadUseVerified -ne $true -or
    [string]::IsNullOrWhiteSpace($authorization.verificationSource)) {
  throw 'Actual tunnel-only permissions and no paid API activation must be verified before use'
}
& icacls.exe $keyFile /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):F" '*S-1-5-18:F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot protect runtime key ACL' }
if (!(Test-Path -LiteralPath (Join-Path $profiles 'codex-bridge.yaml'))) {
  & $client init --sample sample_mcp_remote_no_auth --profile codex-bridge --profile-dir $profiles --tunnel-id $authorization.tunnelId --mcp-server-url 'http://127.0.0.1:18887/mcp' --control-plane-api-key-ref "file:$keyFile" --health-listen-addr '127.0.0.1:18889'
  if ($LASTEXITCODE -ne 0) { throw 'Tunnel profile initialization failed' }
}
& $client doctor --profile codex-bridge --profile-dir $profiles --explain
if ($LASTEXITCODE -ne 0) { throw 'Tunnel doctor failed' }
if ($PrepareOnly) { exit 0 }
& $client runtimes connect --alias codex-bridge --profile codex-bridge --profile-dir $profiles --tunnel-id $authorization.tunnelId --mcp-server-url 'http://127.0.0.1:18887/mcp' --runtime-api-key "file:$keyFile"
if ($LASTEXITCODE -ne 0) { throw 'Tunnel runtime could not connect' }
& $client runtimes status codex-bridge --json
if ($LASTEXITCODE -ne 0) { throw 'Tunnel runtime status failed' }
