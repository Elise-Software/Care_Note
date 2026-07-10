param([int]$Port = 8791)

$browserCandidates = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)
$browser = $browserCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browser) {
  Write-Error "Headless browser not found for browser engine contract tests."
  exit 1
}

$serverJob = Start-Job -ScriptBlock {
  param($Workspace, $ServerPort)
  Set-Location $Workspace
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts/start.ps1" -Port $ServerPort
} -ArgumentList (Get-Location).Path, $Port

Start-Sleep -Seconds 2
try {
  $dom = & $browser --headless --disable-gpu --dump-dom "http://localhost:$Port/tests/browser-engine.html" 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $dom -notmatch '"result":"pass"') {
    Write-Error "Browser engine contract test failed: $dom"
    exit 1
  }
} finally {
  Stop-Job $serverJob -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $serverJob -Force -ErrorAction SilentlyContinue | Out-Null
}

Write-Host "Browser schema, grounding, conflict, and privacy contract tests passed."
