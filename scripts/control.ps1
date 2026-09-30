param(
  [Parameter(Position=0)]
  [ValidateSet('status','inspect','approve','input','stop','wake_status','wake_pause','wake_resume')]
  [string]$Command = 'status',
  [Parameter(Position=1)]
  [string]$TaskId,
  [Parameter(Position=2)]
  [string]$RequestId,
  [Parameter(Position=3, ValueFromRemainingArguments=$true)]
  [string[]]$Payload
)
$ErrorActionPreference = 'Stop'
$runtime = Join-Path $env:LOCALAPPDATA 'CodexMcpBridge'
$config = Get-Content -LiteralPath (Join-Path $runtime 'config.json') -Raw | ConvertFrom-Json
$tokenFile = Join-Path $runtime 'operator-token.txt'
if (!(Test-Path -LiteralPath $tokenFile)) {
  throw 'Operator control is not initialized. Start the bridge once with scripts\start.ps1.'
}
$token = (Get-Content -LiteralPath $tokenFile -Raw).Trim()
if ($token.Length -lt 32) { throw 'Operator control token is invalid' }
$headers = @{ Authorization = "Bearer $token" }
$base = "http://127.0.0.1:$([int]$config.port + 1)"
function Parse-JsonOrString([string]$Value) {
  try { return ($Value | ConvertFrom-Json) }
  catch { return $Value }
}

if ($Command -eq 'status') {
  $result = Invoke-RestMethod -Method Get -Uri "$base/status" -Headers $headers
  $result | ConvertTo-Json -Depth 20
  exit
}

$body = [ordered]@{ command = $Command }
if ($Command -in @('inspect','approve','input')) {
  if ([string]::IsNullOrWhiteSpace($TaskId)) { throw 'TaskId is required' }
  $body.task_id = $TaskId
}
if ($Command -in @('approve','input')) {
  if ([string]::IsNullOrWhiteSpace($RequestId)) { throw 'RequestId is required' }
  $body.request_id = Parse-JsonOrString $RequestId
  $raw = ($Payload -join ' ').Trim()
  if ($raw.Length -eq 0) { throw 'A decision/answer payload is required' }
  $value = Parse-JsonOrString $raw
  if ($Command -eq 'approve') { $body.decision = $value }
  else { $body.answers = $value }
}
$json = $body | ConvertTo-Json -Depth 20 -Compress
$result = Invoke-RestMethod -Method Post -Uri "$base/control" -Headers $headers -ContentType 'application/json' -Body $json
$result | ConvertTo-Json -Depth 20
