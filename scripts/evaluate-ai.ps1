param(
  [string]$OutDir = "artifacts/evaluation"
)

function Normalize-ForGrounding([string]$Text) {
  return (($Text -replace "\s+", "") -replace "[\.,!?。]", "").ToLowerInvariant()
}

function Test-AIContract($Case) {
  $draft = $Case.draft
  if ($null -eq $draft -or $draft.actionItems -is [string]) { return $false }
  $allowedCategories = @("medication", "revisit", "exam_prep", "precautions", "questions")
  $allowedPriorities = @("low", "medium", "high")
  foreach ($item in @($draft.actionItems)) {
    if ($allowedCategories -notcontains [string]$item.category) { return $false }
    if ($allowedPriorities -notcontains [string]$item.priority) { return $false }
    if ([string]::IsNullOrWhiteSpace([string]$item.sourceText)) { return $false }
    if ([string]::IsNullOrWhiteSpace([string]$item.sourceDocumentId)) { return $false }
    $confidence = [double]$item.confidence
    if ($confidence -lt 0 -or $confidence -gt 1) { return $false }
    if (-not (Normalize-ForGrounding $Case.sourceText).Contains((Normalize-ForGrounding $item.sourceText))) { return $false }
  }
  return $true
}

function Test-Grounding([string]$SourceText, [string]$Candidate) {
  $source = Normalize-ForGrounding $SourceText
  $candidate = Normalize-ForGrounding $Candidate
  return $candidate.Length -gt 0 -and $source.Contains($candidate)
}

function Get-ConflictField($Sources) {
  $dates = @()
  foreach ($source in @($Sources)) {
    $match = [regex]::Match([string]$source.text, "(\d{1,2})\s*월\s*(\d{1,2})\s*일")
    if ($match.Success) { $dates += "{0:00}-{1:00}" -f [int]$match.Groups[1].Value, [int]$match.Groups[2].Value }
  }
  if (@($dates | Select-Object -Unique).Count -gt 1) { return "dueDate" }
  return $null
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$contractCases = Get-Content -Raw -Encoding UTF8 "data/evaluation/ai-contract-cases.json" | ConvertFrom-Json
$groundingCases = Get-Content -Raw -Encoding UTF8 "data/evaluation/grounding-cases.json" | ConvertFrom-Json
$conflictCases = Get-Content -Raw -Encoding UTF8 "data/evaluation/conflict-cases.json" | ConvertFrom-Json
$imageFixtures = Get-Content -Raw -Encoding UTF8 "data/fixtures/images/manifest.json" | ConvertFrom-Json
$audioFixtures = Get-Content -Raw -Encoding UTF8 "data/fixtures/audio/manifest.json" | ConvertFrom-Json

$contractRows = @($contractCases | ForEach-Object {
  $actual = Test-AIContract $_
  [pscustomobject]@{ kind = "schema"; id = $_.id; expected = [bool]$_.expectedValid; actual = $actual; passed = ($actual -eq [bool]$_.expectedValid) }
})
$groundingRows = @($groundingCases | ForEach-Object {
  $actual = Test-Grounding $_.sourceText $_.candidate
  [pscustomobject]@{ kind = "grounding"; id = $_.id; expected = [bool]$_.expectedGrounded; actual = $actual; passed = ($actual -eq [bool]$_.expectedGrounded) }
})
$conflictRows = @($conflictCases | ForEach-Object {
  $actual = Get-ConflictField $_.sources
  [pscustomobject]@{ kind = "conflict"; id = $_.id; expected = $_.expectedConflict; actual = $actual; passed = ($actual -eq $_.expectedConflict) }
})
$fixtureRows = @($imageFixtures | ForEach-Object {
  $path = Join-Path "data/fixtures/images" $_.file
  [pscustomobject]@{ kind = "image_fixture"; id = $_.id; expected = $true; actual = (Test-Path -LiteralPath $path); passed = (Test-Path -LiteralPath $path) }
}) + @($audioFixtures | ForEach-Object {
  $path = Join-Path "data/fixtures/audio" $_.file
  [pscustomobject]@{ kind = "audio_fixture"; id = $_.id; expected = $true; actual = (Test-Path -LiteralPath $path); passed = (Test-Path -LiteralPath $path) }
})

$rows = @($contractRows + $groundingRows + $conflictRows + $fixtureRows)
function Get-Rate($Rows) { if (@($Rows).Count -eq 0) { return 1 }; return [math]::Round((@($Rows | Where-Object { $_.passed }).Count / @($Rows).Count), 4) }
$schemaRate = Get-Rate $contractRows
$groundingRate = Get-Rate $groundingRows
$conflictRate = Get-Rate $conflictRows
$fixtureRate = Get-Rate $fixtureRows
$metrics = [ordered]@{
  generatedAt = (Get-Date).ToString("o")
  evaluationType = "deterministic AI schema, grounding, conflict, and fixture contract"
  provider = "mock-contract"
  schemaValidityDetectionRate = $schemaRate
  groundingDetectionRate = $groundingRate
  conflictDetectionRate = $conflictRate
  fixtureAvailabilityRate = $fixtureRate
  imageFixtureCount = @($imageFixtures).Count
  audioFixtureCount = @($audioFixtures).Count
  rows = $rows
}

$metrics | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $OutDir "ai-evaluation.json")
$rows | Export-Csv -NoTypeInformation -Encoding UTF8 (Join-Path $OutDir "ai-evaluation.csv")
$report = @"
# AI 보조 파이프라인 계약 검증 보고서

생성 시각: $($metrics.generatedAt)

## 검증 범위

이 보고서는 외부 모델의 응답 품질 점수와 분리된 결정론적 계약 검증 결과다. Gemma 4 결과가 스키마·원문 근거·충돌 정책을 통과해야만 채택되도록 하는 로직과, 합성 이미지·음성 fixture의 준비 상태를 점검한다.

## 실제 결과

- 스키마 유효성 판별 정확도: $([math]::Round($schemaRate * 100, 2))%
- 원문 근거 판별 정확도: $([math]::Round($groundingRate * 100, 2))%
- 일정 충돌 판별 정확도: $([math]::Round($conflictRate * 100, 2))%
- 멀티모달 fixture 준비율: $([math]::Round($fixtureRate * 100, 2))%
- 합성 이미지 fixture: $($metrics.imageFixtureCount)개
- 합성 음성 fixture: $($metrics.audioFixtureCount)개

## 해석

이 수치는 기존 20개 텍스트 샘플의 구조화율과 합산하지 않는다. Gemma 4 live test는 별도 네트워크·모델 가용성에 의존하므로 `scripts/test-ai.ps1`에서 합성 자료만 보내 검증한다. 모델 응답이 형식·근거 검증에 실패하면 규칙 기반 fallback으로 전환한다.

## 산출물

- JSON: artifacts/evaluation/ai-evaluation.json
- CSV: artifacts/evaluation/ai-evaluation.csv
"@
$report | Set-Content -Encoding UTF8 "docs/AI_EVALUATION_REPORT.md"

if ($schemaRate -lt 1 -or $groundingRate -lt 1 -or $conflictRate -lt 1 -or $fixtureRate -lt 1) {
  Write-Error "AI contract evaluation did not reach 100%."
  exit 1
}
Write-Host "AI contract evaluation passed: schema, grounding, conflict, and fixture checks are all 100%."
