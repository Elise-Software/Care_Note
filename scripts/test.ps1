. "$PSScriptRoot/WaveLab.Engine.ps1"

$Global:Failures = New-Object System.Collections.Generic.List[string]

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { $Global:Failures.Add($Message) }
}

function Assert-Contains($Collection, $Value, [string]$Message) {
  Assert-True (@($Collection) -contains $Value) $Message
}

function Save-Case($Case, $Items, $Warnings, [string]$Path) {
  $db = [pscustomobject]@{
    cases = @($Case)
    actionItems = @($Items)
    privacyWarnings = @($Warnings)
  }
  $db | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 -LiteralPath $Path
}

$warnings = Detect-PrivacyPatterns "연락처 010-1234-5678, 병원 02-123-4567, test@example.com, 900101-1234567, 번호 12345678901"
Assert-Contains (@($warnings | ForEach-Object { $_.patternType }) ) "mobile" "휴대전화번호 탐지 실패"
Assert-Contains (@($warnings | ForEach-Object { $_.patternType }) ) "phone" "일반 전화번호 탐지 실패"
Assert-Contains (@($warnings | ForEach-Object { $_.patternType }) ) "email" "이메일 탐지 실패"
Assert-Contains (@($warnings | ForEach-Object { $_.patternType }) ) "rrn" "주민등록번호 유사 패턴 탐지 실패"
Assert-Contains (@($warnings | ForEach-Object { $_.patternType }) ) "long_number" "긴 숫자 식별번호 탐지 실패"
Assert-True ((Mask-PrivacyValue "mobile" "010-1234-5678") -eq "010-****-5678") "휴대전화 마스킹 실패"
Assert-True ((Mask-PrivacyValue "rrn" "900101-1234567") -eq "900101-*******") "주민번호 유사 패턴 마스킹 실패"

Assert-Contains (Get-CategoryMatches "혈압약은 아침 식후 복용") "medication" "복약 분류 실패"
Assert-Contains (Get-CategoryMatches "7월 28일 다시 방문") "revisit" "재방문 분류 실패"
Assert-Contains (Get-CategoryMatches "검사 전날 밤 10시부터 금식") "exam_prep" "검사 준비 분류 실패"
Assert-Contains (Get-CategoryMatches "어지러우면 바로 병원에 연락") "precautions" "주의사항 분류 실패"
Assert-Contains (Get-CategoryMatches "다음에는 약을 줄일 수 있는지 질문") "questions" "질문 분류 실패"
Assert-True (-not (@(Get-CategoryMatches "7월 29일 예약").Contains("medication"))) "예약을 복약으로 오분류"
Assert-True ((Extract-Date "7월 28일 오전 방문") -match "-07-28$") "날짜 추출 실패"
Assert-True ((Extract-Time "밤 10시부터 금식") -eq "22:00") "시간 추출 실패"

$items = @(Extract-ActionItems "혈압약은 아침 식후 복용. 혈압약은 아침 식후 복용.")
Assert-True ($items.Count -eq 1) "중복 제거 실패"

$bulletItems = @(Extract-ActionItems "- 혈압약은 아침 식후 복용`n- 8월 2일 오전 재방문")
Assert-True (@($bulletItems | Where-Object { $_.category -eq "medication" }).Count -eq 1) "불릿형 복약 문장 분리 실패"
Assert-True (@($bulletItems | Where-Object { $_.category -eq "revisit" }).Count -eq 1) "불릿형 재방문 문장 분리 실패"

$pipeline = Invoke-StructurePipeline "혈압약은 아침 식후 복용. 7월 28일 오전 다시 방문. 어지러우면 연락. 다음 방문 때 약 감량 가능한지 질문."
Assert-True ($pipeline.actionItems.Count -ge 4) "입력 → 구조화 결과 통합 테스트 실패"

$privacyPipeline = Invoke-StructurePipeline "가상 연락처 010-1234-5678. 약은 점심 식후 복용."
Assert-True ($privacyPipeline.privacyWarnings.Count -ge 1) "입력 → 개인정보 경고 통합 테스트 실패"

$share = New-ShareMessage $pipeline.actionItems $true
Assert-True ($share.Contains("[진료 후 확인사항]") -and $share.Contains("복약 확인")) "구조화 → 공유문 통합 테스트 실패"
Assert-True (-not $share.Contains("약을 끊으세요")) "공유문 안전성 문구 실패"

New-Item -ItemType Directory -Force -Path "artifacts/test" | Out-Null
$dbPath = "artifacts/test/local-db.json"
Save-Case $pipeline.case $pipeline.actionItems $pipeline.privacyWarnings $dbPath
$loaded = Get-Content -Encoding UTF8 -Raw -LiteralPath $dbPath | ConvertFrom-Json
Assert-True ($loaded.cases.Count -eq 1 -and $loaded.actionItems.Count -ge 4) "DB 저장 및 조회 테스트 실패"

if ($Global:Failures.Count -gt 0) {
  Write-Host "Test failures:" -ForegroundColor Red
  $Global:Failures | ForEach-Object { Write-Host "- $_" -ForegroundColor Red }
  exit 1
}

Write-Host "All unit and integration tests passed."






