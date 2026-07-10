param(
  [string]$SamplesPath = "data/evaluation/samples.json",
  [string]$OutDir = "artifacts/evaluation"
)

. "$PSScriptRoot/WaveLab.Engine.ps1"

function Test-KeywordMatch($Text, $Expected) {
  $normalized = ($Text -replace "\s+", "")
  foreach ($kw in $Expected.keywords) {
    if ($normalized.Contains((([string]$kw) -replace "\s+", ""))) { return $true }
  }
  return $false
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$samples = Get-Content -Encoding UTF8 -Raw -LiteralPath $SamplesPath | ConvertFrom-Json
$byCategory = @{}
foreach ($c in $Global:WaveLabCategoryOrder) { $byCategory[$c] = [ordered]@{ tp = 0; fp = 0; fn = 0 } }

$totalExpected = 0
$correct = 0
$sampleSuccess = 0
$privacyExpected = 0
$privacyCorrect = 0
$rows = New-Object System.Collections.Generic.List[object]

foreach ($sample in $samples) {
  $result = Invoke-StructurePipeline $sample.input
  $used = @{}
  $sampleCorrect = 0
  foreach ($expected in $sample.expectedItems) {
    $totalExpected += 1
    $matchIndex = -1
    for ($i = 0; $i -lt $result.actionItems.Count; $i++) {
      if ($used.ContainsKey($i)) { continue }
      $item = $result.actionItems[$i]
      if ($item.category -eq $expected.category -and (Test-KeywordMatch ($item.sourceText + " " + $item.title) $expected)) {
        $matchIndex = $i
        break
      }
    }
    if ($matchIndex -ge 0) {
      $used[$matchIndex] = $true
      $correct += 1
      $sampleCorrect += 1
      $byCategory[$expected.category].tp += 1
    } else {
      $byCategory[$expected.category].fn += 1
    }
  }
  for ($i = 0; $i -lt $result.actionItems.Count; $i++) {
    if (-not $used.ContainsKey($i)) { $byCategory[$result.actionItems[$i].category].fp += 1 }
  }
  if ($sample.PSObject.Properties.Name -contains "expectedPrivacyWarnings") {
    $privacyExpected += $sample.expectedPrivacyWarnings.Count
    $found = @($result.privacyWarnings | ForEach-Object { $_.patternType })
    foreach ($type in $sample.expectedPrivacyWarnings) {
      if ($found -contains $type) { $privacyCorrect += 1 }
    }
  }
  $rate = $sampleCorrect / $sample.expectedItems.Count
  if ($rate -ge 0.8) { $sampleSuccess += 1 }
  $rows.Add([pscustomobject]@{
    id = $sample.id
    scenarioName = $sample.scenarioName
    expected = $sample.expectedItems.Count
    correct = $sampleCorrect
    structureRate = [math]::Round($rate * 100, 2)
    detectedItems = $result.actionItems.Count
    privacyWarnings = $result.privacyWarnings.Count
  })
}

$categoryMetrics = [ordered]@{}
foreach ($category in $Global:WaveLabCategoryOrder) {
  $v = $byCategory[$category]
  $precision = if (($v.tp + $v.fp) -gt 0) { $v.tp / ($v.tp + $v.fp) } else { 0 }
  $recall = if (($v.tp + $v.fn) -gt 0) { $v.tp / ($v.tp + $v.fn) } else { 0 }
  $f1 = if (($precision + $recall) -gt 0) { (2 * $precision * $recall) / ($precision + $recall) } else { 0 }
  $categoryMetrics[$category] = [ordered]@{
    label = $Global:WaveLabCategories[$category]
    truePositive = $v.tp
    falsePositive = $v.fp
    falseNegative = $v.fn
    precision = [math]::Round($precision, 4)
    recall = [math]::Round($recall, 4)
    f1 = [math]::Round($f1, 4)
  }
}

$overallRate = $correct / $totalExpected
$sampleRate = $sampleSuccess / $samples.Count
$privacyRate = if ($privacyExpected -gt 0) { $privacyCorrect / $privacyExpected } else { 1 }

$metrics = [ordered]@{
  generatedAt = (Get-Date).ToString("o")
  sampleCount = $samples.Count
  totalExpectedItems = $totalExpected
  correctlyMatchedItems = $correct
  overallStructureRate = [math]::Round($overallRate, 4)
  overallStructureRatePercent = [math]::Round($overallRate * 100, 2)
  sampleLevelSuccessRate = [math]::Round($sampleRate, 4)
  sampleLevelSuccessRatePercent = [math]::Round($sampleRate * 100, 2)
  privacyWarningDetectionRate = [math]::Round($privacyRate, 4)
  privacyWarningDetectionRatePercent = [math]::Round($privacyRate * 100, 2)
  categoryMetrics = $categoryMetrics
  sampleResults = $rows.ToArray()
}

$metrics | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $OutDir "evaluation.json")
$rows | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath (Join-Path $OutDir "evaluation.csv")

$metricTableRows = New-Object System.Collections.Generic.List[string]
foreach ($category in $Global:WaveLabCategoryOrder) {
  $m = $metrics.categoryMetrics[$category]
  $metricTableRows.Add("| $($m.label) | $([math]::Round($m.precision * 100, 2))% | $([math]::Round($m.recall * 100, 2))% | $([math]::Round($m.f1 * 100, 2))% |")
}
$metricTable = $metricTableRows -join "`n"

$report = @"
# 정량 검증 보고서

생성 시각: $($metrics.generatedAt)

## 평가 목적

20개의 명백한 가상 진료 후 시나리오를 사용해 입력 문장이 복약, 재방문, 검사 준비, 주의사항, 다음 방문 질문으로 올바르게 구조화되는지 검증했다.

## 구조화율 정의

구조화율 = 올바른 범주와 키워드 근거로 매칭된 expected action item 수 / 전체 expected action item 수 * 100

## 실제 실행 결과

- 샘플 수: $($metrics.sampleCount)
- 전체 기대 항목: $($metrics.totalExpectedItems)
- 올바르게 매칭된 항목: $($metrics.correctlyMatchedItems)
- 전체 구조화율: $($metrics.overallStructureRatePercent)%
- 샘플 단위 성공률: $($metrics.sampleLevelSuccessRatePercent)%
- 개인정보 유사 패턴 경고 탐지율: $($metrics.privacyWarningDetectionRatePercent)%

## 범주별 지표

| 범주 | Precision | Recall | F1 |
|---|---:|---:|---:|
$metricTable

## 오류 분석 및 개선 내용

초기 규칙은 단순 키워드 탐지에 가까워 다중 범주 문장, 반복 일정, '확인'이 질문인지 주의사항인지 구분하는 사례에서 오탐 가능성이 있었다. 최종 엔진은 문장 분리 후 쉼표/접속어 단위 세분화, 범주별 정규식, 개인정보 마스킹, 날짜/시간 추출, 중복 제거를 적용했다.

## 산출물

- JSON: artifacts/evaluation/evaluation.json
- CSV: artifacts/evaluation/evaluation.csv
- 샘플: data/evaluation/samples.json

## AI 보조 평가와의 구분

이 보고서는 API·모델 가용성과 무관한 결정론적 텍스트 구조화 평가다. Gemma 4의 schema, grounding, conflict, 멀티모달 fixture 계약 검증은 별도 `scripts/evaluate-ai.ps1`과 `docs/AI_EVALUATION_REPORT.md`에서 기록하며, 두 수치를 합산하지 않는다.
"@
$report | Set-Content -Encoding UTF8 -LiteralPath "docs/EVALUATION_REPORT.md"

if ($metrics.overallStructureRatePercent -lt 80) {
  Write-Error "Structure rate is below target: $($metrics.overallStructureRatePercent)%"
  exit 1
}

Write-Host "Evaluation passed: structure rate $($metrics.overallStructureRatePercent)% across $($metrics.sampleCount) samples."






