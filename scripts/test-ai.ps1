$key = Join-Path $HOME ".ssh\id_ed25519"
if (-not (Test-Path -LiteralPath $key)) {
  Write-Error "Gemma 4 live test requires the configured SSH identity file."
  exit 1
}

$remoteHost = $env:WAVELAB_AI_HOST
$remotePort = if ($env:WAVELAB_AI_SSH_PORT) { [int]$env:WAVELAB_AI_SSH_PORT } else { 22 }
$remoteUser = if ($env:WAVELAB_AI_USER) { $env:WAVELAB_AI_USER } else { "root" }
if (-not $remoteHost) {
  Write-Error "Set WAVELAB_AI_HOST before running the private live AI test."
  exit 1
}

$remoteDir = "/tmp/wavelab-live-test-$PID"
$localResult = Join-Path $env:TEMP "wavelab-live-ai-result-$PID.json"
$remote = "$remoteUser@$remoteHost"
try {
  & ssh -o BatchMode=yes -o ConnectTimeout=20 -p $remotePort -i $key $remote "mkdir -p $remoteDir"
  if ($LASTEXITCODE -ne 0) { throw "Unable to prepare the private live test directory." }
  & scp -P $remotePort -i $key "cloud/live_fixture_test.py" "data/fixtures/images/IMG02_ct_notice.png" "data/fixtures/audio/AUD02_exam_prep.wav" "${remote}:$remoteDir/"
  if ($LASTEXITCODE -ne 0) { throw "Unable to copy synthetic live test fixtures." }
  # Persist the compact synthetic-only result remotely, then retrieve it with SCP.
  # Capturing a long-lived SSH stdout stream directly is unreliable in Windows PowerShell 5.1.
  & ssh -o BatchMode=yes -o ConnectTimeout=20 -p $remotePort -i $key $remote "/opt/wavelab-ai/venv/bin/python $remoteDir/live_fixture_test.py $remoteDir/IMG02_ct_notice.png $remoteDir/AUD02_exam_prep.wav > $remoteDir/result.json"
  if ($LASTEXITCODE -ne 0) { throw "The private AI gateway did not complete the synthetic live test." }
  & scp -P $remotePort -i $key "${remote}:$remoteDir/result.json" $localResult
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $localResult)) { throw "Unable to retrieve the private live test result." }
  $response = Get-Content -LiteralPath $localResult -Raw | ConvertFrom-Json
  if ($response.provider -ne "gemma4" -or -not ([string]$response.model).StartsWith("gemma4:") -or [int]$response.textItemCount -lt 1 -or [int]$response.imageTextLength -lt 20 -or [int]$response.audioTextLength -lt 1) {
    throw "Gemma 4, vision, or speech provider did not return the expected live fixture result."
  }
  Write-Host "Gemma 4 live test passed: $($response.model), text/vision/speech fixture pipeline verified."
} finally {
  Remove-Item -LiteralPath $localResult -Force -ErrorAction SilentlyContinue
  if ($remoteHost) { & ssh -o BatchMode=yes -o ConnectTimeout=10 -p $remotePort -i $key $remote "rm -rf $remoteDir" 2>$null | Out-Null }
}
