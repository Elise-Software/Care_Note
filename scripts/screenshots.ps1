param([int]$Port = 8787)

$edgeCandidates = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)
$browser = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browser) {
  Write-Error "Headless browser not found. Microsoft Edge or Chrome is required for screenshots."
  exit 1
}

New-Item -ItemType Directory -Force -Path "artifacts/screenshots" | Out-Null
$serverJob = Start-Job -ScriptBlock {
  param($Workspace, $Port)
  Set-Location $Workspace
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts/start.ps1" -Port $Port
} -ArgumentList (Get-Location).Path, $Port

Start-Sleep -Seconds 2

$targets = @(
  @{ name = "01_main.png"; query = "shot=main" },
  @{ name = "02_input.png"; query = "shot=input" },
  @{ name = "03_checkboard.png"; query = "shot=checkboard" },
  @{ name = "04_share_message.png"; query = "shot=share" },
  @{ name = "05_privacy_warning.png"; query = "shot=privacy" },
  @{ name = "06_evaluation_dashboard.png"; query = "shot=evaluation" },
  @{ name = "07_image_upload.png"; query = "shot=image-upload" },
  @{ name = "08_image_extraction.png"; query = "shot=image-review" },
  @{ name = "09_audio_transcript.png"; query = "shot=audio" },
  @{ name = "10_conflict_warning.png"; query = "shot=conflict" }
)

try {
  foreach ($target in $targets) {
    $out = (Resolve-Path "artifacts/screenshots").Path + "\" + $target.name
    $url = "http://localhost:$Port/app/index.html?$($target.query)"
    $args = @(
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--window-size=1365,1000",
      "--virtual-time-budget=5000",
      "--screenshot=$out",
      $url
    )
    $process = Start-Process -FilePath $browser -ArgumentList $args -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit(15000)) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      throw "Browser screenshot timed out for $($target.name)"
    }
    if ($process.ExitCode -ne 0) { throw "Browser screenshot failed for $($target.name)" }
    $waitUntil = (Get-Date).AddSeconds(3)
    while ((-not (Test-Path -LiteralPath $out)) -and (Get-Date) -lt $waitUntil) { Start-Sleep -Milliseconds 100 }
    if (-not (Test-Path -LiteralPath $out) -or (Get-Item -LiteralPath $out).Length -lt 10000) {
      throw "Screenshot file is missing or too small: $($target.name)"
    }
  }
} finally {
  Stop-Job $serverJob -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $serverJob -Force -ErrorAction SilentlyContinue | Out-Null
}

Write-Host "Screenshots created in artifacts/screenshots."






