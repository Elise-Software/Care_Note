Add-Type -AssemblyName System.Drawing

$outputDir = Join-Path (Resolve-Path "$PSScriptRoot/..") "data/fixtures/images"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$fixtures = @(
  [pscustomobject]@{
    file = "IMG01_blood_test_notice.png"
    title = "가상 검사 안내문"
    subtitle = "아래 내용은 테스트용으로 만든 가상 안내입니다."
    lines = @("8월 2일 오전 9시 채혈 예약", "검사 전날 밤 10시부터 금식", "아침 인슐린은 안내에 따라 확인")
  },
  [pscustomobject]@{
    file = "IMG02_ct_notice.png"
    title = "가상 CT 검사 안내"
    subtitle = "아래 내용은 테스트용으로 만든 가상 안내입니다."
    lines = @("8월 20일 13:30 CT 검사", "검사 전 6시간 금식", "알레르기 증상이 있으면 미리 연락")
  },
  [pscustomobject]@{
    file = "IMG03_mri_notice.png"
    title = "가상 MRI 검사 안내"
    subtitle = "아래 내용은 테스트용으로 만든 가상 안내입니다."
    lines = @("MRI 전 금속 물품은 빼고 오기", "폐쇄공포가 있으면 검사 전에 알리기", "다음 주 오전 검사실 방문")
  },
  [pscustomobject]@{
    file = "IMG04_privacy_notice.png"
    title = "가상 보호자 연락 안내"
    subtitle = "개인정보 경고 검증을 위한 가상 값입니다."
    lines = @("가상 연락처 010-0000-0000", "가상 이메일 demo@example.test", "8월 4일 재방문 예정")
  },
  [pscustomobject]@{
    file = "IMG05_conflicting_revisit_notice.png"
    title = "가상 예약 변경 안내"
    subtitle = "입력 자료 간 일정 충돌 검증용 가상 안내입니다."
    lines = @("예약 날짜는 7월 29일 오전", "기존 메모의 7월 28일 일정과 다를 수 있음", "방문 전 날짜를 다시 확인")
  }
)

foreach ($fixture in $fixtures) {
  $bitmap = New-Object System.Drawing.Bitmap 1200, 680
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(248, 250, 248))
  $headerBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(34, 102, 80))
  $inkBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(40, 55, 47))
  $mutedBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(107, 122, 113))
  $linePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(211, 226, 217)), 2
  $accentBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(227, 241, 233))
  $titleFont = New-Object System.Drawing.Font "Malgun Gothic", 34, ([System.Drawing.FontStyle]::Bold)
  $subtitleFont = New-Object System.Drawing.Font "Malgun Gothic", 17
  $bodyFont = New-Object System.Drawing.Font "Malgun Gothic", 25
  $smallFont = New-Object System.Drawing.Font "Malgun Gothic", 14

  $graphics.FillRectangle($accentBrush, 0, 0, 1200, 104)
  $graphics.DrawString("엘리제소프트웨어 · TEST FIXTURE", $smallFont, $headerBrush, 78, 34)
  $graphics.DrawString($fixture.title, $titleFont, $inkBrush, 78, 151)
  $graphics.DrawString($fixture.subtitle, $subtitleFont, $mutedBrush, 80, 212)
  $graphics.DrawLine($linePen, 80, 265, 1120, 265)
  $y = 320
  foreach ($line in $fixture.lines) {
    $graphics.FillEllipse($headerBrush, 87, $y + 10, 12, 12)
    $graphics.DrawString($line, $bodyFont, $inkBrush, 124, $y)
    $y += 86
  }
  $graphics.DrawString("실제 병원 문서나 실제 개인정보를 사용하지 않은 테스트 자료입니다.", $smallFont, $mutedBrush, 80, 615)
  $bitmap.Save((Join-Path $outputDir $fixture.file), [System.Drawing.Imaging.ImageFormat]::Png)
  $smallFont.Dispose(); $bodyFont.Dispose(); $subtitleFont.Dispose(); $titleFont.Dispose()
  $accentBrush.Dispose(); $linePen.Dispose(); $mutedBrush.Dispose(); $inkBrush.Dispose(); $headerBrush.Dispose()
  $graphics.Dispose(); $bitmap.Dispose()
}

Write-Host "Generated $($fixtures.Count) synthetic image fixtures in $outputDir"
