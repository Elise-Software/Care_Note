param([int]$Port = 8788)

Write-Host "Running browser smoke flow and screenshot-backed E2E check..."
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts/screenshots.ps1" -Port $Port

$expected = @(
  "01_main.png",
  "02_input.png",
  "03_checkboard.png",
  "04_share_message.png",
  "05_privacy_warning.png",
  "06_evaluation_dashboard.png",
  "07_image_upload.png",
  "08_image_extraction.png",
  "09_audio_transcript.png",
  "10_conflict_warning.png"
)

foreach ($file in $expected) {
  $path = Join-Path "artifacts/screenshots" $file
  if (-not (Test-Path -LiteralPath $path)) {
    Write-Error "Missing E2E screenshot: $file"
    exit 1
  }
  if ((Get-Item -LiteralPath $path).Length -lt 10000) {
    Write-Error "E2E screenshot appears invalid: $file"
    exit 1
  }
}

$html = Get-Content -Encoding UTF8 -Raw -LiteralPath "app/index.html"
foreach ($id in @("memo", "imageInput", "audioInput", "analyzeBtn", "checkboard", "shareText", "evalDashboard", "conflictBox")) {
  if (-not $html.Contains($id)) {
    Write-Error "E2E DOM contract missing: $id"
    exit 1
  }
}

Write-Host "E2E smoke flow passed: text, image, audio, checkboard, share, privacy, conflict, and evaluation screenshots exist."






