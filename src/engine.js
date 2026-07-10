(function (root) {
  const CATEGORIES = {
    medication: "복약 확인",
    revisit: "재방문 일정",
    exam_prep: "검사 준비",
    precautions: "주의사항",
    questions: "다음 방문 질문",
  };

  const CATEGORY_ORDER = ["medication", "revisit", "exam_prep", "precautions", "questions"];

  const RULES = {
    medication: [/(?<!예)약|복용|먹|식후|식전|아침|점심|저녁|하루\s*\d+\s*회|중단|유지|감량|증량|처방|인슐린|연고|안약|항생제|진통제/],
    revisit: [/재방문|다시\s*방문|내원|예약|외래|다음\s*진료|추적\s*관찰|방문\s*예정|오전\s*외래|오후\s*외래|재활치료|검사실/],
    exam_prep: [/금식|검사|채혈|CT|MRI|초음파|내시경|물\s*금지|음식\s*금지|준비|조영제|검진|산동|렌즈|수면\s*검사|혈액|기록지|약\s*목록/],
    precautions: [/주의|증상|심해지면|어지러|통증|출혈|연락|응급|무리하지|피하|피하기|운전|샤워|음주|발열|붓|구토|복통|상처|찜질|딱딱한|씹지|긁지|눈부심|폐쇄공포|숨찬|과음/],
    questions: [/물어보|질문|확인하기|확인|가능한지|줄일\s*수|변경\s*가능|다음에\s*확인|상담|문의|여쭤|필요\s*여부|겹치는지|괜찮은지/],
  };

  const NEGATIVE_QUESTION_HINT = /연락|응급|금지|피하|주의|증상|심해지면/;

  function normalizeText(text) {
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/[•·]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/\s*([.!?。])\s*/g, "$1 ")
      .trim();
  }

  function splitSentences(text) {
    // Keep line boundaries until after splitting: hospital notices frequently use
    // bullet lists without punctuation.
    const prepared = String(text || "").replace(/\r\n/g, "\n").replace(/[•·]/g, "-");
    if (!prepared.trim()) return [];
    return prepared
      .split(/(?<=[.!?。])\s+|[\n;]+|(?:\s+-\s+)/)
      .map((s) => normalizeText(s))
      .filter(Boolean)
      .flatMap((s) => splitMultiActionSentence(s));
  }

  function splitMultiActionSentence(sentence) {
    const pieces = sentence
      .split(/\s*(?:그리고|또한|추가로|,)\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    return pieces.length > 1 ? pieces : [sentence];
  }

  function maskValue(type, value) {
    if (type === "rrn") return value.replace(/^(\d{6})-?(\d)/, "$1-*******");
    if (type === "email") return value.replace(/^(.{1,2}).*(@.*)$/, "$1***$2");
    if (type === "mobile") return value.replace(/(01[016789])-?(\d{3,4})-?(\d{4})/, "$1-****-$3");
    if (type === "phone") return value.replace(/(0\d{1,2})-?(\d{3,4})-?(\d{4})/, "$1-****-$3");
    if (type === "long_number") return value.slice(0, 3) + "****" + value.slice(-3);
    return value.replace(/.(?=.{2})/g, "*");
  }

  function detectPrivacyPatterns(text) {
    const patterns = [
      { type: "rrn", severity: "high", regex: /\b\d{6}-?[1-4]\d{6}\b/g },
      { type: "email", severity: "medium", regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
      { type: "mobile", severity: "medium", regex: /(?<!\d)01[016789]-?\d{3,4}-?\d{4}(?!\d)/g },
      { type: "phone", severity: "medium", regex: /(?<!\d)0(?:2|3[1-3]|4[1-4]|5[1-5]|6[1-4])-?\d{3,4}-?\d{4}(?!\d)/g },
      { type: "long_number", severity: "low", regex: /\b\d{10,}\b/g },
    ];
    const warnings = [];
    for (const p of patterns) {
      let match;
      while ((match = p.regex.exec(text || ""))) {
        if (p.type === "long_number" && warnings.some((w) => match.index >= w.startOffset && match.index < w.endOffset)) continue;
        warnings.push({
          id: `privacy-${warnings.length + 1}`,
          patternType: p.type,
          maskedValue: maskValue(p.type, match[0]),
          startOffset: match.index,
          endOffset: match.index + match[0].length,
          severity: p.severity,
        });
      }
    }
    return warnings;
  }

  function extractDate(text) {
    const nowYear = new Date().getFullYear();
    const iso = text.match(/\b(20\d{2})[-.\/](\d{1,2})[-.\/](\d{1,2})\b/);
    if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    const md = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (md) return `${nowYear}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
    const rel = text.match(/(다음\s*주|내일|모레|일주일\s*후|2주\s*후|한\s*달\s*후)/);
    if (rel) return rel[1].replace(/\s+/g, "");
    return "";
  }

  function extractTime(text) {
    const hour = text.match(/(?:오전|아침)\s*(\d{1,2})\s*시?/);
    if (hour) return `${String(Number(hour[1])).padStart(2, "0")}:00`;
    const pm = text.match(/오후\s*(\d{1,2})\s*시?/);
    if (pm) return `${String((Number(pm[1]) % 12) + 12).padStart(2, "0")}:00`;
    const night = text.match(/밤\s*(\d{1,2})\s*시/);
    if (night) return `${String((Number(night[1]) % 12) + 12).padStart(2, "0")}:00`;
    const colon = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (colon) return `${colon[1].padStart(2, "0")}:${colon[2]}`;
    return "";
  }

  function classifySentence(sentence) {
    const categories = [];
    for (const category of CATEGORY_ORDER) {
      if (RULES[category].some((rule) => rule.test(sentence))) categories.push(category);
    }
    if (categories.includes("questions") && NEGATIVE_QUESTION_HINT.test(sentence) && !/질문|물어보|여쭤|상담/.test(sentence)) {
      return categories.filter((c) => c !== "questions");
    }
    return categories;
  }

  function priorityFor(category, sentence) {
    if (/응급|바로|즉시|출혈|심해지면|호흡|고열/.test(sentence)) return "high";
    if (category === "exam_prep" || category === "revisit") return "medium";
    return "normal";
  }

  function titleFor(category, sentence) {
    const clean = sentence.replace(/[.!?。]$/g, "").trim();
    if (clean.length <= 42) return clean;
    return clean.slice(0, 39).trim() + "...";
  }

  function confidenceFor(category, sentence) {
    let score = 0.52;
    const ruleHits = RULES[category].filter((rule) => rule.test(sentence)).length;
    score += Math.min(ruleHits * 0.11, 0.28);
    if (extractDate(sentence)) score += 0.06;
    if (extractTime(sentence)) score += 0.04;
    if (/해야|예정|확인|연락|복용|방문|준비/.test(sentence)) score += 0.06;
    return Math.min(0.96, Number(score.toFixed(2)));
  }

  function dedupeItems(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = `${item.category}:${item.sourceText.replace(/\s+/g, "").slice(0, 36)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function extractActionItems(text) {
    const sentences = splitSentences(text);
    const items = [];
    for (const sentence of sentences) {
      const categories = classifySentence(sentence);
      for (const category of categories) {
        items.push({
          id: `item-${items.length + 1}`,
          category,
          title: titleFor(category, sentence),
          detail: sentence,
          dueDate: extractDate(sentence),
          dueTime: extractTime(sentence),
          status: "open",
          priority: priorityFor(category, sentence),
          sourceText: sentence,
          confidence: confidenceFor(category, sentence),
          assignee: "",
          completed: false,
        });
      }
    }
    return dedupeItems(items).map((item, index) => ({ ...item, id: `item-${index + 1}` }));
  }

  const SOURCE_TYPES = ["manual", "audio_transcript", "vision", "ocr"];
  const LLM_PRIORITIES = ["low", "medium", "high"];

  function normalizeSourceDocuments(sourceDocuments) {
    return (Array.isArray(sourceDocuments) ? sourceDocuments : [])
      .map((source, index) => ({
        id: String(source && source.id ? source.id : `source-${index + 1}`),
        type: SOURCE_TYPES.includes(source && source.type) ? source.type : "manual",
        label: String(source && source.label ? source.label : "입력 자료"),
        text: String(source && source.text ? source.text : "").trim(),
        confidence: Number.isFinite(Number(source && source.confidence)) ? Number(source.confidence) : null,
        confirmed: source && source.confirmed !== false,
      }))
      .filter((source) => source.text);
  }

  function compactText(text) {
    return normalizeText(text).replace(/\s+/g, "").toLowerCase();
  }

  function sourceOffset(source, sourceText) {
    const exact = source.text.indexOf(sourceText);
    if (exact >= 0) return { start: exact, end: exact + sourceText.length };
    const normalizedSource = normalizeText(source.text);
    const normalizedText = normalizeText(sourceText);
    const normalizedIndex = normalizedSource.indexOf(normalizedText);
    if (normalizedIndex < 0) return null;
    return { start: normalizedIndex, end: normalizedIndex + normalizedText.length };
  }

  function isSupportedDate(value, sourceText) {
    if (!value) return true;
    const extracted = extractDate(sourceText);
    return extracted === value || (typeof value === "string" && value.includes("-") && sourceText.includes(value));
  }

  function isSupportedTime(value, sourceText) {
    if (!value) return true;
    return extractTime(sourceText) === value || sourceText.includes(value);
  }

  function validateLLMAnalysis(rawAnalysis, sourceDocuments) {
    const sources = normalizeSourceDocuments(sourceDocuments);
    const diagnostics = [];
    if (!rawAnalysis || typeof rawAnalysis !== "object") {
      return { valid: false, actionItems: [], diagnostics: [{ type: "schema", message: "AI 결과가 객체가 아닙니다." }] };
    }
    if (!Array.isArray(rawAnalysis.actionItems)) {
      return { valid: false, actionItems: [], diagnostics: [{ type: "schema", message: "AI 결과에 actionItems 배열이 없습니다." }] };
    }
    const actionItems = [];
    rawAnalysis.actionItems.slice(0, 40).forEach((rawItem, index) => {
      if (!rawItem || typeof rawItem !== "object") {
        diagnostics.push({ type: "schema", message: `${index + 1}번째 항목 형식이 올바르지 않습니다.` });
        return;
      }
      const category = String(rawItem.category || "");
      const sourceText = String(rawItem.sourceText || "").trim();
      const source = sources.find((candidate) => candidate.id === rawItem.sourceDocumentId)
        || sources.find((candidate) => compactText(candidate.text).includes(compactText(sourceText)));
      if (!CATEGORY_ORDER.includes(category) || !sourceText || !source) {
        diagnostics.push({ type: "grounding", message: `${index + 1}번째 AI 항목에 원문 근거가 없습니다.` });
        return;
      }
      const offsets = sourceOffset(source, sourceText);
      if (!offsets) {
        diagnostics.push({ type: "grounding", message: `${index + 1}번째 AI 항목의 근거 문장을 찾지 못했습니다.` });
        return;
      }
      const dueDate = rawItem.dueDate ? String(rawItem.dueDate) : "";
      const dueTime = rawItem.dueTime ? String(rawItem.dueTime) : "";
      if (!isSupportedDate(dueDate, sourceText) || !isSupportedTime(dueTime, sourceText)) {
        diagnostics.push({ type: "grounding", message: `${index + 1}번째 AI 항목의 날짜 또는 시간이 원문과 맞지 않습니다.` });
        return;
      }
      const confidence = Number(rawItem.confidence);
      actionItems.push({
        id: `ai-item-${actionItems.length + 1}`,
        category,
        title: String(rawItem.title || sourceText).slice(0, 100),
        detail: String(rawItem.detail || sourceText).slice(0, 500),
        dueDate,
        dueTime,
        status: "open",
        priority: LLM_PRIORITIES.includes(rawItem.priority) ? rawItem.priority : "low",
        sourceText,
        sourceDocumentId: source.id,
        sourceStart: offsets.start,
        sourceEnd: offsets.end,
        confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0.5,
        assignee: "",
        completed: false,
        needsReview: false,
      });
    });
    return {
      valid: actionItems.length > 0 && diagnostics.length === 0,
      actionItems,
      summary: String(rawAnalysis.summary || "").slice(0, 300),
      ambiguities: Array.isArray(rawAnalysis.ambiguities) ? rawAnalysis.ambiguities.slice(0, 8) : [],
      safetyFlags: Array.isArray(rawAnalysis.safetyFlags) ? rawAnalysis.safetyFlags.slice(0, 8) : [],
      diagnostics,
    };
  }

  function extractDeterministicItemsFromSources(sourceDocuments) {
    const sources = normalizeSourceDocuments(sourceDocuments);
    const items = [];
    sources.forEach((source) => {
      extractActionItems(source.text).forEach((item) => {
        const offsets = sourceOffset(source, item.sourceText) || { start: null, end: null };
        items.push({
          ...item,
          id: `rule-item-${items.length + 1}`,
          sourceDocumentId: source.id,
          sourceStart: offsets.start,
          sourceEnd: offsets.end,
          needsReview: false,
        });
      });
    });
    return items;
  }

  function mergeActionItems(aiItems, ruleItems) {
    const merged = [];
    const indexByKey = new Map();
    [...(aiItems || []), ...(ruleItems || [])].forEach((item) => {
      const key = `${item.category}:${compactText(item.sourceText)}`;
      const existingIndex = indexByKey.get(key);
      if (existingIndex !== undefined) {
        const existing = merged[existingIndex];
        merged[existingIndex] = {
          ...existing,
          dueDate: existing.dueDate || item.dueDate || "",
          dueTime: existing.dueTime || item.dueTime || "",
          priority: existing.priority === "low" && item.priority ? item.priority : existing.priority,
          confidence: Math.max(Number(existing.confidence) || 0, Number(item.confidence) || 0),
          sourceStart: existing.sourceStart ?? item.sourceStart ?? null,
          sourceEnd: existing.sourceEnd ?? item.sourceEnd ?? null,
        };
        return;
      }
      indexByKey.set(key, merged.length);
      merged.push({ ...item, id: `item-${merged.length + 1}` });
    });
    return merged;
  }

  function detectConflicts(items) {
    const conflicts = [];
    ["revisit", "exam_prep"].forEach((category) => {
      const bucket = (items || []).filter((item) => item.category === category && item.dueDate);
      const dates = [...new Set(bucket.map((item) => item.dueDate))];
      if (dates.length > 1) {
        conflicts.push({
          field: "dueDate",
          values: dates,
          sourceIds: [...new Set(bucket.map((item) => item.sourceDocumentId).filter(Boolean))],
          message: `입력 자료 간 ${category === "revisit" ? "재방문" : "검사"} 날짜가 다릅니다. 원문을 확인해 주세요.`,
        });
      }
    });
    return conflicts;
  }

  function hybridStructurePipeline(sourceDocuments, rawAnalysis) {
    const sources = normalizeSourceDocuments(sourceDocuments);
    const sourceText = sources.map((source) => source.text).join("\n");
    const privacyWarnings = detectPrivacyPatterns(sourceText);
    const ruleItems = extractDeterministicItemsFromSources(sources);
    const validation = rawAnalysis ? validateLLMAnalysis(rawAnalysis, sources) : { valid: false, actionItems: [], diagnostics: [] };
    const actionItems = mergeActionItems(validation.valid ? validation.actionItems : [], ruleItems);
    const conflicts = detectConflicts(actionItems);
    return {
      case: {
        id: `case-${Date.now()}`,
        title: "진료 후 돌봄 기록",
        sourceType: "multimodal",
        rawText: sourceText,
        sanitizedPreview: sanitizePreview(sourceText),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      sourceDocuments: sources,
      actionItems,
      privacyWarnings,
      conflicts,
      analysisMode: validation.valid ? "gemma4-validated" : "rule-based-fallback",
      summary: validation.summary || "",
      ambiguities: validation.ambiguities || [],
      safetyFlags: validation.safetyFlags || [],
      diagnostics: validation.diagnostics || [],
    };
  }

  function sanitizePreview(text) {
    let safe = String(text || "");
    for (const warning of detectPrivacyPatterns(safe).sort((a, b) => b.startOffset - a.startOffset)) {
      safe = safe.slice(0, warning.startOffset) + warning.maskedValue + safe.slice(warning.endOffset);
    }
    return safe.slice(0, 180);
  }

  function structurePipeline(input, options) {
    const rawText = String(input || "");
    const normalized = normalizeText(rawText);
    const privacyWarnings = detectPrivacyPatterns(rawText);
    const items = extractActionItems(normalized);
    const now = new Date().toISOString();
    const caseRecord = {
      id: `case-${Date.now()}`,
      title: options && options.title ? options.title : "진료 후 기록",
      sourceType: options && options.sourceType ? options.sourceType : "memo",
      rawText,
      sanitizedPreview: sanitizePreview(rawText),
      createdAt: now,
      updatedAt: now,
    };
    return { case: caseRecord, actionItems: items, privacyWarnings };
  }

  function generateShareMessage(items, options) {
    const includeCompleted = !options || options.includeCompleted !== false;
    const lines = ["[진료 후 확인사항]", ""];
    for (const category of CATEGORY_ORDER) {
      const bucket = items.filter((item) => item.category === category && (includeCompleted || !item.completed));
      lines.push(`■ ${CATEGORIES[category]}`);
      if (bucket.length === 0) {
        lines.push("* 해당 항목 없음");
      } else {
        for (const item of bucket) {
          const done = item.completed ? "(완료) " : "";
          const due = [item.dueDate, item.dueTime].filter(Boolean).join(" ");
          const assignee = item.assignee ? ` / 담당: ${item.assignee}` : "";
          lines.push(`* ${done}${item.title}${due ? ` (${due})` : ""}${assignee}`);
        }
      }
      lines.push("");
    }
    lines.push("※ 본 내용은 입력된 문장을 정리한 것이며 의료적 진단이나 처방이 아닙니다.");
    return lines.join("\n").trim();
  }

  const api = {
    CATEGORIES,
    CATEGORY_ORDER,
    normalizeText,
    splitSentences,
    detectPrivacyPatterns,
    maskValue,
    extractDate,
    extractTime,
    classifySentence,
    extractActionItems,
    normalizeSourceDocuments,
    validateLLMAnalysis,
    extractDeterministicItemsFromSources,
    mergeActionItems,
    detectConflicts,
    hybridStructurePipeline,
    structurePipeline,
    generateShareMessage,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WaveLabEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
