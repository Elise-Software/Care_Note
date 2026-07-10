Set-StrictMode -Version 2.0

$Global:WaveLabCategories = [ordered]@{
  medication = "복약 확인"
  revisit = "재방문 일정"
  exam_prep = "검사 준비"
  precautions = "주의사항"
  questions = "다음 방문 질문"
}

$Global:WaveLabCategoryOrder = @("medication", "revisit", "exam_prep", "precautions", "questions")

function Normalize-Text([string]$Text) {
  if ($null -eq $Text) { return "" }
  return (($Text -replace "`r`n", "`n") -replace "[•·]", "-" -replace "\s+", " ").Trim()
}

function Split-Sentences([string]$Text) {
  # Preserve line boundaries while splitting because many hospital notices are
  # bullet lists with no sentence-ending punctuation.
  $prepared = (($Text -replace "`r`n", "`n") -replace "[•·]", "-")
  if (-not $prepared.Trim()) { return @() }
  $rough = [regex]::Split($prepared, "(?<=[.!?。])\s+|[\n;]+|\s+-\s+")
  $result = New-Object System.Collections.Generic.List[string]
  foreach ($part in $rough) {
    $piece = Normalize-Text $part
    if (-not $piece) { continue }
    $sub = @([regex]::Split($piece, "\s*(?:그리고|또한|추가로|,)\s*") | Where-Object { $_.Trim() })
    if ($sub.Count -gt 1) { foreach ($s in $sub) { $result.Add($s.Trim()) } } else { $result.Add($piece) }
  }
  return $result.ToArray()
}

function Mask-PrivacyValue([string]$Type, [string]$Value) {
  switch ($Type) {
    "rrn" { return ($Value -replace "^(\d{6})-?(\d).*$", '$1-*******') }
    "email" { return ($Value -replace "^(.{1,2}).*(@.*)$", '$1***$2') }
    "mobile" { return ($Value -replace "(01[016789])-?(\d{3,4})-?(\d{4})", '$1-****-$3') }
    "phone" { return ($Value -replace "(0\d{1,2})-?(\d{3,4})-?(\d{4})", '$1-****-$3') }
    "long_number" { if ($Value.Length -gt 6) { return $Value.Substring(0,3) + "****" + $Value.Substring($Value.Length - 3) } }
  }
  return $Value
}

function Detect-PrivacyPatterns([string]$Text) {
  $specs = @(
    @{ type = "rrn"; severity = "high"; regex = "\b\d{6}-?[1-4]\d{6}\b" },
    @{ type = "email"; severity = "medium"; regex = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}" },
    @{ type = "mobile"; severity = "medium"; regex = "(?<!\d)01[016789]-?\d{3,4}-?\d{4}(?!\d)" },
    @{ type = "phone"; severity = "medium"; regex = "(?<!\d)0(?:2|3[1-3]|4[1-4]|5[1-5]|6[1-4])-?\d{3,4}-?\d{4}(?!\d)" },
    @{ type = "long_number"; severity = "low"; regex = "\b\d{10,}\b" }
  )
  $warnings = New-Object System.Collections.Generic.List[object]
  foreach ($spec in $specs) {
    foreach ($m in [regex]::Matches($Text, $spec.regex)) {
      if ($spec.type -eq "long_number") {
        $covered = $false
        foreach ($w in $warnings) { if ($m.Index -ge $w.startOffset -and $m.Index -lt $w.endOffset) { $covered = $true } }
        if ($covered) { continue }
      }
      $warnings.Add([pscustomobject]@{
        id = "privacy-$($warnings.Count + 1)"
        patternType = $spec.type
        maskedValue = Mask-PrivacyValue $spec.type $m.Value
        startOffset = $m.Index
        endOffset = $m.Index + $m.Length
        severity = $spec.severity
      })
    }
  }
  return $warnings.ToArray()
}

function Extract-Date([string]$Text) {
  $year = (Get-Date).Year
  $iso = [regex]::Match($Text, "\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b")
  if ($iso.Success) { return "{0}-{1:00}-{2:00}" -f $iso.Groups[1].Value, [int]$iso.Groups[2].Value, [int]$iso.Groups[3].Value }
  $md = [regex]::Match($Text, "(\d{1,2})\s*월\s*(\d{1,2})\s*일")
  if ($md.Success) { return "{0}-{1:00}-{2:00}" -f $year, [int]$md.Groups[1].Value, [int]$md.Groups[2].Value }
  $rel = [regex]::Match($Text, "(다음\s*주|내일|모레|일주일\s*후|2주\s*후|한\s*달\s*후|1주\s*후)")
  if ($rel.Success) { return ($rel.Groups[1].Value -replace "\s+", "") }
  return ""
}

function Extract-Time([string]$Text) {
  $am = [regex]::Match($Text, "(?:오전|아침)\s*(\d{1,2})\s*시?")
  if ($am.Success) { return "{0:00}:00" -f [int]$am.Groups[1].Value }
  $pm = [regex]::Match($Text, "오후\s*(\d{1,2})\s*시?")
  if ($pm.Success) { return "{0:00}:00" -f ((([int]$pm.Groups[1].Value) % 12) + 12) }
  $night = [regex]::Match($Text, "밤\s*(\d{1,2})\s*시")
  if ($night.Success) { return "{0:00}:00" -f ((([int]$night.Groups[1].Value) % 12) + 12) }
  $colon = [regex]::Match($Text, "\b([01]?\d|2[0-3]):([0-5]\d)\b")
  if ($colon.Success) { return "{0:00}:{1}" -f [int]$colon.Groups[1].Value, $colon.Groups[2].Value }
  return ""
}

function Get-CategoryMatches([string]$Sentence) {
  $rules = @{
    medication = "(?<!예)약|복용|먹|식후|식전|아침|점심|저녁|하루\s*\d+\s*회|중단|유지|감량|증량|처방|인슐린|연고|안약|항생제|진통제"
    revisit = "재방문|다시\s*방문|내원|예약|외래|다음\s*진료|추적\s*관찰|방문\s*예정|오전\s*외래|오후\s*외래|재활치료|검사실"
    exam_prep = "금식|검사|채혈|CT|MRI|초음파|내시경|물\s*금지|음식\s*금지|준비|조영제|검진|산동|렌즈|수면\s*검사|혈액|기록지|약 목록"
    precautions = "주의|증상|심해지면|어지러|통증|출혈|연락|응급|무리하지|피하|피하기|운전|샤워|음주|발열|붓|구토|복통|상처|찜질|딱딱한|씹지|긁지|눈부심|폐쇄공포|숨찬|과음"
    questions = "물어보|질문|확인하기|확인|가능한지|줄일\s*수|변경\s*가능|다음에\s*확인|상담|문의|여쭤|필요\s*여부|겹치는지|괜찮은지"
  }
  $found = @()
  foreach ($category in $Global:WaveLabCategoryOrder) {
    if ($Sentence -match $rules[$category]) { $found += $category }
  }
  if ($found -contains "questions" -and $Sentence -match "연락|응급|금지|피하|주의|증상|심해지면" -and $Sentence -notmatch "질문|물어보|여쭤|상담") {
    $found = $found | Where-Object { $_ -ne "questions" }
  }
  return @($found)
}

function Get-Priority([string]$Category, [string]$Sentence) {
  if ($Sentence -match "응급|바로|즉시|출혈|심해지면|호흡|고열") { return "high" }
  if ($Category -eq "exam_prep" -or $Category -eq "revisit") { return "medium" }
  return "normal"
}

function Extract-ActionItems([string]$Text) {
  $items = New-Object System.Collections.Generic.List[object]
  foreach ($sentence in Split-Sentences $Text) {
    foreach ($category in Get-CategoryMatches $sentence) {
      $title = $sentence.TrimEnd(".!?。")
      if ($title.Length -gt 42) { $title = $title.Substring(0, 39).Trim() + "..." }
      $confidence = 0.72
      if (Extract-Date $sentence) { $confidence += 0.06 }
      if (Extract-Time $sentence) { $confidence += 0.04 }
      if ($sentence -match "해야|예정|확인|연락|복용|방문|준비") { $confidence += 0.06 }
      $items.Add([pscustomobject]@{
        id = "item-$($items.Count + 1)"
        category = $category
        title = $title
        detail = $sentence
        dueDate = Extract-Date $sentence
        dueTime = Extract-Time $sentence
        status = "open"
        priority = Get-Priority $category $sentence
        sourceText = $sentence
        confidence = [math]::Min(0.96, [math]::Round($confidence, 2))
        assignee = ""
        completed = $false
      })
    }
  }
  $seen = @{}
  $deduped = New-Object System.Collections.Generic.List[object]
  foreach ($item in $items) {
    $compact = ($item.sourceText -replace "\s+", "")
    $key = "$($item.category):$($compact.Substring(0, [Math]::Min(36, $compact.Length)))"
    if (-not $seen.ContainsKey($key)) {
      $seen[$key] = $true
      $item.id = "item-$($deduped.Count + 1)"
      $deduped.Add($item)
    }
  }
  return $deduped.ToArray()
}

function Invoke-StructurePipeline([string]$InputText) {
  $now = (Get-Date).ToString("o")
  return [pscustomobject]@{
    case = [pscustomobject]@{
      id = "case-$([DateTimeOffset]::Now.ToUnixTimeMilliseconds())"
      title = "진료 후 기록"
      sourceType = "memo"
      rawText = $InputText
      sanitizedPreview = (Normalize-Text $InputText).Substring(0, [Math]::Min(180, (Normalize-Text $InputText).Length))
      createdAt = $now
      updatedAt = $now
    }
    actionItems = @(Extract-ActionItems (Normalize-Text $InputText))
    privacyWarnings = @(Detect-PrivacyPatterns $InputText)
  }
}

function New-ShareMessage($Items, [bool]$IncludeCompleted = $true) {
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("[진료 후 확인사항]")
  $lines.Add("")
  foreach ($category in $Global:WaveLabCategoryOrder) {
    $lines.Add("■ $($Global:WaveLabCategories[$category])")
    $bucket = @($Items | Where-Object { $_.category -eq $category -and ($IncludeCompleted -or -not $_.completed) })
    if ($bucket.Count -eq 0) { $lines.Add("* 해당 항목 없음") }
    foreach ($item in $bucket) {
      $done = if ($item.completed) { "(완료) " } else { "" }
      $due = (($item.dueDate, $item.dueTime) | Where-Object { $_ }) -join " "
      $assignee = if ($item.assignee) { " / 담당: $($item.assignee)" } else { "" }
      $suffix = if ($due) { " ($due)" } else { "" }
      $lines.Add("* $done$($item.title)$suffix$assignee")
    }
    $lines.Add("")
  }
  $lines.Add("※ 본 내용은 입력된 문장을 정리한 것이며 의료적 진단이나 처방이 아닙니다.")
  return ($lines -join "`n").Trim()
}






