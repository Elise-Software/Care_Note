const engine = window.WaveLabEngine;
let currentItems = [];
let currentConflicts = [];
let currentSourceDocuments = [];
let evaluationSamples = [];
let aiCapabilities = { available: false, provider: "rule-based", capabilities: { text: false, image: false, audio: false } };
let mediaRecorder = null;
let recordingStream = null;
let recordingChunks = [];
let recordingStartedAt = 0;
let recordingTimer = null;
let recordingTimeout = null;

const assetState = {
  image: { file: null, previewUrl: "", confirmed: false },
  audio: { blob: null, previewUrl: "", confirmed: false },
};

const demoSamples = [
  {
    label: "약과 다음 진료",
    text: "혈압약은 아침 식후 계속 복용. 7월 28일 오전에 다시 방문. 어지러우면 바로 병원에 연락. 다음에는 약을 줄일 수 있는지 질문.",
  },
  {
    label: "내시경 준비",
    text: "대장내시경 전날 저녁부터 안내된 장정결제 복용. 검사 당일 오전에는 금식하고 물도 금지. 보호자는 검사 후 운전하지 않도록 확인.",
  },
  {
    label: "연락처가 있는 기록",
    text: "가상 보호자 연락처 010-1234-5678로 안내문 공유 예정. 이메일 test-care@example.com은 샘플 주소. 약은 점심 식후 복용하고 8월 4일 재방문.",
  },
];

const TAB_HASHES = { write: "#write", board: "#result", share: "#share", evaluation: "#evaluation" };
const SOURCE_TYPE_LABELS = { manual: "글로 적은 내용", vision: "사진에서 읽은 내용", audio_transcript: "말로 남긴 내용", ocr: "사진에서 읽은 내용" };
const PRIVACY_LABELS = { rrn: "주민등록번호", email: "이메일 주소", mobile: "휴대전화 번호", phone: "전화번호", long_number: "긴 숫자" };
const UI_CATEGORY_LABELS = {
  medication: "약 챙기기",
  revisit: "다시 가는 날",
  exam_prep: "검사 준비",
  precautions: "주의할 점",
  questions: "물어볼 것",
};

function $(id) {
  return document.getElementById(id);
}

function sourceId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function tabFromHash() {
  return Object.entries(TAB_HASHES).find(([, hash]) => hash === location.hash)?.[0] || "write";
}

function activateTab(tab, syncHistory = true) {
  if (!TAB_HASHES[tab]) return;
  document.querySelectorAll(".main-tab").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    const active = panel.dataset.panel === tab;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
  if (syncHistory && location.hash !== TAB_HASHES[tab]) {
    history.pushState(null, "", `${location.pathname}${location.search}${TAB_HASHES[tab]}`);
  }
  window.scrollTo(0, 0);
}

function activateSourceTab(tab) {
  document.querySelectorAll(".source-tab").forEach((button) => {
    const active = button.dataset.sourceTab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-source-panel]").forEach((panel) => {
    const active = panel.dataset.sourcePanel === tab;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
}

function confirmedSourceDocuments() {
  const sources = [];
  const memo = $("memo").value.trim();
  const notice = $("notice").value.trim();
  const imageText = $("imageText").value.trim();
  const transcriptText = $("transcriptText").value.trim();
  if (memo) sources.push({ id: "manual-memo", type: "manual", label: "진료 후 메모", text: memo, confirmed: true, confidence: 1 });
  if (notice) sources.push({ id: "manual-notice", type: "manual", label: "안내자료 텍스트", text: notice, confirmed: true, confidence: 1 });
  if (assetState.image.confirmed && imageText) sources.push({ id: "vision-image", type: "vision", label: "안내문 사진", text: imageText, confirmed: true, confidence: 0.8 });
  if (assetState.audio.confirmed && transcriptText) sources.push({ id: "audio-transcript", type: "audio_transcript", label: "음성 전사", text: transcriptText, confirmed: true, confidence: 0.7 });
  return sources;
}

function allVisibleSourceText() {
  return [$("memo").value, $("notice").value, $("imageText").value, $("transcriptText").value].filter(Boolean).join("\n");
}

function renderPrivacy() {
  const warnings = engine.detectPrivacyPatterns(allVisibleSourceText());
  const box = $("privacyWarnings");
  if (!warnings.length) {
    box.className = "warning-list empty";
    box.textContent = "지금은 가려야 할 정보가 보이지 않아요.";
    return;
  }
  box.className = "warning-list";
  box.innerHTML = warnings
    .map((warning) => `<div class="warning"><strong>보내기 전에 확인해 주세요</strong><br>${escapeHtml(warning.maskedValue)}<br><small>${PRIVACY_LABELS[warning.patternType] || "개인정보"}처럼 보이는 내용이 있어요.</small></div>`)
    .join("");
}

function renderSources() {
  const sources = confirmedSourceDocuments();
  const list = $("sourceList");
  const drafts = [];
  if (assetState.image.file && !assetState.image.confirmed) drafts.push("사진에서 읽은 내용");
  if (assetState.audio.blob && !assetState.audio.confirmed) drafts.push("말로 남긴 내용");
  $("sourceSummary").textContent = sources.length
    ? `함께 정리할 기록 ${sources.length}개${drafts.length ? ` · ${drafts.length}개는 확인이 필요해요` : ""}`
    : (drafts.length ? `${drafts.length}개 내용을 먼저 확인해 주세요` : "함께 정리할 기록이 아직 없어요");
  $("analysisMode").textContent = aiCapabilities.available
    ? "내용을 꼼꼼하게 살펴볼 준비가 되었어요"
    : "기본 정리 방식으로 차근차근 도와드릴게요";
  if (!sources.length && !drafts.length) {
    list.className = "source-list empty";
    list.textContent = "글, 사진, 음성 중 편한 방법으로 기록해 보세요.";
    return;
  }
  list.className = "source-list";
  list.innerHTML = [
    ...sources.map((source) => `<div><span class="source-state confirmed">준비됨</span><strong>${escapeHtml(source.label)}</strong><small>${SOURCE_TYPE_LABELS[source.type] || source.type}</small></div>`),
    ...drafts.map((draft) => `<div><span class="source-state review">확인 전</span><strong>${escapeHtml(draft)}</strong><small>내용을 확인하면 함께 정리할 수 있어요.</small></div>`),
  ].join("");
}

function renderConflictBox() {
  const box = $("conflictBox");
  if (!currentConflicts.length) {
    box.hidden = true;
    box.textContent = "";
    return;
  }
  box.hidden = false;
  box.innerHTML = `<strong>서로 다른 내용이 있어요</strong>${currentConflicts.map((conflict) => `<p>${escapeHtml(conflict.message)}</p>`).join("")}<small>어느 내용이 맞는지 병원 안내나 원문을 확인해 주세요.</small>`;
}

function renderCheckboard() {
  const board = $("checkboard");
  board.innerHTML = engine.CATEGORY_ORDER.map((category) => {
    const items = currentItems.filter((item) => item.category === category);
    const body = items.length
      ? items.map(renderItem).join("")
      : `<div class="empty-state">이번 기록에는 따로 챙길 내용이 없어요.</div>`;
    return `<section class="category-column"><h3><span>${UI_CATEGORY_LABELS[category]}</span><small>${items.length}</small></h3>${body}</section>`;
  }).join("");
  $("resultSummary").textContent = currentItems.length
    ? `${currentItems.length}가지 할 일을 보기 쉽게 나눴어요.${currentConflicts.length ? " 서로 다른 내용은 한 번 더 확인해 주세요." : ""}`
    : "기록을 정리하면 해야 할 일을 보기 좋게 나눠 드려요.";
  board.querySelectorAll("[data-complete]").forEach((element) => {
    element.addEventListener("change", (event) => {
      const item = currentItems.find((candidate) => candidate.id === event.target.dataset.complete);
      if (!item) return;
      item.completed = event.target.checked;
      renderCheckboard();
      renderShare();
    });
  });
  board.querySelectorAll("[data-assignee]").forEach((element) => {
    element.addEventListener("input", (event) => {
      const item = currentItems.find((candidate) => candidate.id === event.target.dataset.assignee);
      if (!item) return;
      item.assignee = event.target.value;
      renderShare();
    });
  });
}

function renderItem(item) {
  const priorityLabel = item.priority === "high" ? "먼저 챙겨요" : item.priority === "medium" ? "한 번 더 봐요" : "챙길 일";
  const source = currentSourceDocuments.find((candidate) => candidate.id === item.sourceDocumentId);
  const sourceLabel = source ? ` · ${escapeHtml(source.label)}` : "";
  return `<article class="item ${item.completed ? "completed" : ""} ${item.needsReview ? "needs-review" : ""}">
    <label class="item-title"><input type="checkbox" data-complete="${item.id}" ${item.completed ? "checked" : ""}><span>${escapeHtml(item.title)}</span></label>
    <div class="meta">
      <span class="pill ${item.priority}">${priorityLabel}</span>
      ${item.dueDate ? `<span class="pill">${escapeHtml(item.dueDate)}</span>` : ""}
      ${item.dueTime ? `<span class="pill">${escapeHtml(item.dueTime)}</span>` : ""}
      ${item.needsReview ? `<span class="pill review">내용 확인하기</span>` : ""}
    </div>
    <input type="text" data-assignee="${item.id}" value="${escapeAttr(item.assignee)}" placeholder="누가 챙길까요? 이름을 적어 주세요">
    <details><summary>어디에서 가져온 내용인가요?${sourceLabel}</summary>${escapeHtml(item.sourceText)}</details>
  </article>`;
}

function renderShare() {
  const includeCompleted = $("includeCompleted").checked;
  const lines = ["[오늘 함께 챙길 내용]", ""];
  let visibleCount = 0;
  engine.CATEGORY_ORDER.forEach((category) => {
    const items = currentItems.filter((item) => item.category === category && (includeCompleted || !item.completed));
    if (!items.length) return;
    visibleCount += items.length;
    lines.push(UI_CATEGORY_LABELS[category]);
    items.forEach((item) => {
      const done = item.completed ? "챙김 · " : "";
      const due = [item.dueDate, item.dueTime].filter(Boolean).join(" ");
      const assignee = item.assignee ? ` · ${item.assignee}님이 챙겨요` : "";
      lines.push(`- ${done}${item.title}${due ? ` (${due})` : ""}${assignee}`);
    });
    lines.push("");
  });
  if (!visibleCount) lines.push("아직 함께 챙길 내용이 없어요.", "");
  lines.push("※ 병원에서 들은 내용을 옮겨 적은 기록이에요. 치료나 약에 관한 결정은 의료진과 상의해 주세요.");
  let message = lines.join("\n").trim();
  if (currentConflicts.length) {
    message += `\n\n[한 번 더 확인해 주세요]\n${currentConflicts.map((conflict) => `- ${conflict.message}`).join("\n")}`;
  }
  $("shareText").value = message;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function keywordMatch(text, expected) {
  const normalized = text.replace(/\s+/g, "");
  return expected.keywords.some((keyword) => normalized.includes(String(keyword).replace(/\s+/g, "")));
}

function evaluateSamples(samples) {
  const byCategory = {};
  engine.CATEGORY_ORDER.forEach((category) => (byCategory[category] = { tp: 0, fp: 0, fn: 0 }));
  let totalExpected = 0;
  let correct = 0;
  let sampleSuccess = 0;
  let privacyExpected = 0;
  let privacyCorrect = 0;
  const rows = samples.map((sample) => {
    const result = engine.structurePipeline(sample.input);
    const used = new Set();
    let sampleCorrect = 0;
    for (const expected of sample.expectedItems) {
      totalExpected += 1;
      const matchIndex = result.actionItems.findIndex((item, index) => !used.has(index) && item.category === expected.category && keywordMatch(`${item.sourceText} ${item.title}`, expected));
      if (matchIndex >= 0) {
        used.add(matchIndex);
        correct += 1;
        sampleCorrect += 1;
        byCategory[expected.category].tp += 1;
      } else {
        byCategory[expected.category].fn += 1;
      }
    }
    result.actionItems.forEach((item, index) => {
      if (!used.has(index)) byCategory[item.category].fp += 1;
    });
    if (sample.expectedPrivacyWarnings) {
      privacyExpected += sample.expectedPrivacyWarnings.length;
      const found = result.privacyWarnings.map((warning) => warning.patternType);
      privacyCorrect += sample.expectedPrivacyWarnings.filter((type) => found.includes(type)).length;
    }
    const rate = sampleCorrect / sample.expectedItems.length;
    if (rate >= 0.8) sampleSuccess += 1;
    return { id: sample.id, scenarioName: sample.scenarioName, correct: sampleCorrect, total: sample.expectedItems.length, rate };
  });
  const categoryMetrics = Object.fromEntries(Object.entries(byCategory).map(([category, values]) => {
    const precision = values.tp + values.fp ? values.tp / (values.tp + values.fp) : 0;
    const recall = values.tp + values.fn ? values.tp / (values.tp + values.fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return [category, { ...values, precision, recall, f1 }];
  }));
  return {
    sampleCount: samples.length,
    totalExpected,
    correct,
    overallStructureRate: correct / totalExpected,
    sampleLevelSuccessRate: sampleSuccess / samples.length,
    privacyWarningDetectionRate: privacyExpected ? privacyCorrect / privacyExpected : 1,
    categoryMetrics,
    rows,
  };
}

function renderEvaluation(metrics) {
  $("evalDashboard").innerHTML = `<div class="metric-grid">
    <div class="metric"><span>내용 정리 정확도</span><strong>${(metrics.overallStructureRate * 100).toFixed(1)}%</strong></div>
    <div class="metric"><span>확인한 가상 사례</span><strong>${metrics.sampleCount}</strong></div>
    <div class="metric"><span>사례별 통과</span><strong>${(metrics.sampleLevelSuccessRate * 100).toFixed(1)}%</strong></div>
    <div class="metric"><span>민감정보 안내</span><strong>${(metrics.privacyWarningDetectionRate * 100).toFixed(1)}%</strong></div>
  </div>
  <table><thead><tr><th>구분</th><th>정확히 찾음</th><th>빠짐없이 찾음</th><th>종합</th></tr></thead><tbody>
  ${engine.CATEGORY_ORDER.map((category) => `<tr><td>${UI_CATEGORY_LABELS[category]}</td><td>${(metrics.categoryMetrics[category].precision * 100).toFixed(1)}%</td><td>${(metrics.categoryMetrics[category].recall * 100).toFixed(1)}%</td><td>${(metrics.categoryMetrics[category].f1 * 100).toFixed(1)}%</td></tr>`).join("")}
  </tbody></table>`;
}

function base64FromFile(file) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    const chunks = [];
    for (let index = 0; index < bytes.length; index += 0x8000) {
      chunks.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)));
    }
    return btoa(chunks.join(""));
  });
}

async function postAI(path, payload, timeoutMs = 190000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "AI 분석 요청에 실패했습니다.");
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadCapabilities() {
  try {
    const response = await fetch("/api/capabilities", { cache: "no-store" });
    aiCapabilities = await response.json();
  } catch {
    aiCapabilities = { available: false, provider: "rule-based", capabilities: { text: false, image: false, audio: false } };
  }
  renderSources();
}

function isAllowedImage(file) {
  return file && ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 10 * 1024 * 1024;
}

function isAllowedAudio(file) {
  return file && ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav"].includes(file.type) && file.size <= 20 * 1024 * 1024;
}

function clearObjectUrl(type) {
  if (assetState[type].previewUrl) URL.revokeObjectURL(assetState[type].previewUrl);
  assetState[type].previewUrl = "";
}

function resetImageState() {
  clearObjectUrl("image");
  assetState.image = { file: null, previewUrl: "", confirmed: false };
  $("imageInput").value = "";
  $("imagePreview").className = "asset-preview empty";
  $("imagePreview").textContent = "선택한 사진이 없습니다.";
  $("extractImageBtn").disabled = true;
  $("imageReview").hidden = true;
  $("imageText").value = "";
  $("imageStatus").textContent = "";
}

function resetAudioState() {
  stopRecording(false);
  clearObjectUrl("audio");
  assetState.audio = { blob: null, previewUrl: "", confirmed: false };
  $("audioInput").value = "";
  $("audioPlayback").pause();
  $("audioPlayback").removeAttribute("src");
  $("audioPlayback").hidden = true;
  $("transcribeBtn").disabled = true;
  $("transcriptReview").hidden = true;
  $("transcriptText").value = "";
  $("transcriptStatus").textContent = "";
}

function renderImagePreview(file) {
  clearObjectUrl("image");
  assetState.image.previewUrl = URL.createObjectURL(file);
  $("imagePreview").className = "asset-preview";
  $("imagePreview").innerHTML = `<img src="${assetState.image.previewUrl}" alt="선택한 안내자료 사진 미리보기"><span>${escapeHtml(file.name || "카메라 촬영 이미지")}</span>`;
}

async function extractImage() {
  const file = assetState.image.file;
  if (!file) return;
  if (!aiCapabilities.capabilities?.image) {
    $("imageStatus").textContent = "지금은 사진을 읽을 수 없어요. 안내문 내용을 글로 적어 주세요.";
    return;
  }
  $("extractImageBtn").disabled = true;
  $("imageStatus").textContent = "사진 속 글자를 읽고 있어요...";
  $("imageReview").hidden = false;
  try {
    const result = await postAI("/api/extract/image", { mimeType: file.type, dataBase64: await base64FromFile(file) });
    $("imageText").value = String(result.text || "");
    $("imageStatus").textContent = result.text ? "읽어 온 내용이 맞는지 살펴본 뒤 함께 정리하기를 눌러 주세요." : "사진의 글자를 또렷하게 읽지 못했어요. 보이는 내용을 직접 적어 주세요.";
  } catch (error) {
    $("imageStatus").textContent = error.name === "AbortError" ? "사진을 읽는 데 시간이 오래 걸리고 있어요. 다시 시도해 주세요." : "사진을 읽지 못했어요. 보이는 내용을 직접 적어도 괜찮아요.";
  } finally {
    $("extractImageBtn").disabled = false;
  }
}

function useImageText() {
  if (!$("imageText").value.trim()) {
    $("imageStatus").textContent = "함께 정리할 내용을 먼저 확인해 주세요.";
    return;
  }
  assetState.image.confirmed = true;
  $("imageStatus").textContent = "사진에서 읽은 내용을 함께 정리할게요.";
  renderPrivacy();
  renderSources();
}

function updateRecordingTimer() {
  const elapsed = Math.min(30, Math.floor((Date.now() - recordingStartedAt) / 1000));
  $("recordingTimer").textContent = `00:${String(elapsed).padStart(2, "0")}`;
}

function finishAudioBlob(blob) {
  clearObjectUrl("audio");
  assetState.audio = { blob, previewUrl: URL.createObjectURL(blob), confirmed: false };
  $("audioPlayback").src = assetState.audio.previewUrl;
  $("audioPlayback").hidden = false;
  $("transcribeBtn").disabled = false;
  $("recordingState").textContent = "녹음 준비 완료";
  $("recordingTimer").textContent = "00:00";
  renderSources();
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    $("recordingState").textContent = "이 브라우저에서는 녹음을 지원하지 않습니다. 오디오 파일을 업로드해 주세요.";
    return;
  }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined);
    mediaRecorder = recorder;
    recordingChunks = [];
    recorder.addEventListener("dataavailable", (event) => { if (event.data.size) recordingChunks.push(event.data); });
    recorder.addEventListener("stop", () => {
      const blob = new Blob(recordingChunks, { type: recorder.mimeType || "audio/webm" });
      recordingStream?.getTracks().forEach((track) => track.stop());
      recordingStream = null;
      if (recorder.datasetSave !== false && blob.size) finishAudioBlob(blob);
      else {
        $("recordingState").textContent = "녹음 대기";
        $("recordingTimer").textContent = "00:00";
      }
    }, { once: true });
    recorder.start();
    recordingStartedAt = Date.now();
    recordingTimer = setInterval(updateRecordingTimer, 250);
    recordingTimeout = setTimeout(() => stopRecording(), 30000);
    $("recordingState").textContent = "녹음 중 (최대 30초)";
    $("recordBtn").disabled = true;
    $("stopRecordBtn").disabled = false;
  } catch {
    $("recordingState").textContent = "마이크 권한을 확인해 주세요. 오디오 파일 업로드도 가능합니다.";
  }
}

function stopRecording(save = true) {
  clearInterval(recordingTimer);
  clearTimeout(recordingTimeout);
  recordingTimer = null;
  recordingTimeout = null;
  $("recordBtn").disabled = false;
  $("stopRecordBtn").disabled = true;
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    const recorder = mediaRecorder;
    recorder.datasetSave = save;
    if (!save) recordingChunks = [];
    mediaRecorder = null;
    recorder.stop();
  } else {
    recordingStream?.getTracks().forEach((track) => track.stop());
    recordingStream = null;
  }
  mediaRecorder = null;
}

async function transcribeAudio() {
  const audio = assetState.audio.blob;
  if (!audio) return;
  if (!aiCapabilities.capabilities?.audio) {
    $("transcriptStatus").textContent = "음성 전사 서버에 연결할 수 없습니다. 직접 메모를 입력해 주세요.";
    return;
  }
  $("transcribeBtn").disabled = true;
  $("transcriptReview").hidden = false;
  $("transcriptStatus").textContent = "말한 내용을 글로 바꾸고 있어요...";
  try {
    const result = await postAI("/api/transcribe/audio", { mimeType: audio.type || "audio/webm", dataBase64: await base64FromFile(audio) }, 240000);
    $("transcriptText").value = String(result.text || "");
    $("transcriptStatus").textContent = result.text ? "글로 바뀐 내용이 맞는지 살펴본 뒤 함께 정리하기를 눌러 주세요." : "말한 내용을 또렷하게 옮기지 못했어요. 기억나는 내용을 직접 적어 주세요.";
  } catch (error) {
    $("transcriptStatus").textContent = error.name === "AbortError" ? "음성 전사 시간이 초과되었습니다." : "음성 전사를 완료하지 못했습니다. 직접 메모를 입력할 수 있습니다.";
  } finally {
    $("transcribeBtn").disabled = false;
  }
}

function useTranscript() {
  if (!$("transcriptText").value.trim()) {
    $("transcriptStatus").textContent = "함께 정리할 내용을 먼저 확인해 주세요.";
    return;
  }
  assetState.audio.confirmed = true;
  $("transcriptStatus").textContent = "말로 남긴 내용을 함께 정리할게요.";
  renderPrivacy();
  renderSources();
}

async function analyze(noNavigate = false, forceFallback = false) {
  $("error").textContent = "";
  const sources = confirmedSourceDocuments();
  if (!sources.length) {
    $("error").textContent = "먼저 기억나는 내용을 적거나, 사진·음성 내용을 확인해 주세요.";
    return;
  }
  $("status").textContent = "적어 주신 내용을 하나씩 살펴보고 있어요...";
  try {
    let rawAnalysis = null;
    let providerError = "";
    if (!forceFallback && aiCapabilities.available && aiCapabilities.capabilities?.text) {
      try {
        const response = await postAI("/api/analyze", { sources });
        rawAnalysis = response.draft;
      } catch (error) {
        providerError = "잠시 기본 방식으로 정리했어요. 결과는 원문과 다시 확인했어요.";
      }
    }
    const result = engine.hybridStructurePipeline(sources, rawAnalysis);
    currentItems = result.actionItems;
    currentConflicts = result.conflicts;
    currentSourceDocuments = result.sourceDocuments;
    renderPrivacy();
    renderCheckboard();
    renderConflictBox();
    renderShare();
    const aiValidated = result.analysisMode === "gemma4-validated";
    $("status").textContent = `${currentItems.length}가지 할 일로 정리했어요${currentConflicts.length ? " · 서로 다른 내용은 확인해 주세요" : ""}`;
    $("analysisMode").textContent = aiValidated ? "적어 주신 원문과 한 번 더 맞춰 봤어요" : (providerError || "적어 주신 내용 안에서만 정리했어요");
    if (!noNavigate) activateTab("board");
  } catch {
    $("error").textContent = "지금은 내용을 정리하지 못했어요. 잠시 후 다시 눌러 주세요.";
    $("status").textContent = "";
  }
}

function clearAll() {
  $("memo").value = "";
  $("notice").value = "";
  resetImageState();
  resetAudioState();
  currentItems = [];
  currentConflicts = [];
  currentSourceDocuments = [];
  $("shareStatus").textContent = "";
  $("status").textContent = "";
  $("error").textContent = "";
  renderPrivacy();
  renderSources();
  renderCheckboard();
  renderConflictBox();
  renderShare();
}

function bindTabs() {
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.tab)));
  document.querySelectorAll(".main-tab").forEach((button, index, tabs) => {
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[nextIndex].focus();
      activateTab(tabs[nextIndex].dataset.tab);
    });
  });
  document.querySelectorAll(".source-tab").forEach((button, index, tabs) => {
    button.addEventListener("click", () => activateSourceTab(button.dataset.sourceTab));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const next = tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      next.focus();
      activateSourceTab(next.dataset.sourceTab);
    });
  });
  window.addEventListener("hashchange", () => activateTab(tabFromHash(), false));
  window.addEventListener("popstate", () => activateTab(tabFromHash(), false));
}

function bindInputs() {
  $("sampleButtons").innerHTML = demoSamples.map((sample, index) => `<button type="button" data-sample="${index}">${sample.label}</button>`).join("");
  $("sampleButtons").addEventListener("click", (event) => {
    if (event.target.dataset.sample === undefined) return;
    $("memo").value = demoSamples[Number(event.target.dataset.sample)].text;
    renderPrivacy();
    renderSources();
  });
  ["memo", "notice", "imageText", "transcriptText"].forEach((id) => {
    $(id).addEventListener("input", () => {
      if (id === "imageText") assetState.image.confirmed = false;
      if (id === "transcriptText") assetState.audio.confirmed = false;
      renderPrivacy();
      renderSources();
    });
  });
  $("analyzeBtn").addEventListener("click", () => analyze());
  $("clearBtn").addEventListener("click", clearAll);
  $("includeCompleted").addEventListener("change", renderShare);
  $("copyBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("shareText").value);
      $("shareStatus").textContent = "공유문을 클립보드에 복사했습니다.";
    } catch {
      $("shareStatus").textContent = "클립보드 복사 권한이 없습니다. 공유문을 직접 선택해 복사해 주세요.";
    }
  });
  $("downloadBtn").addEventListener("click", () => {
    const blob = new Blob([$("shareText").value], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "care-share-message.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
    $("shareStatus").textContent = "공유문 텍스트 파일을 준비했습니다.";
  });
  $("fileInput").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    $("notice").value = await file.text();
    renderPrivacy();
    renderSources();
  });
  $("imageInput").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!isAllowedImage(file)) {
      $("imageStatus").textContent = "10MB 이하의 JPG, PNG, WebP 파일만 사용할 수 있습니다.";
      return;
    }
    assetState.image.file = file;
    assetState.image.confirmed = false;
    $("imageText").value = "";
    $("imageReview").hidden = true;
    $("extractImageBtn").disabled = false;
    renderImagePreview(file);
    renderSources();
  });
  $("extractImageBtn").addEventListener("click", extractImage);
  $("useImageTextBtn").addEventListener("click", useImageText);
  $("recordBtn").addEventListener("click", startRecording);
  $("stopRecordBtn").addEventListener("click", () => stopRecording());
  $("audioInput").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!isAllowedAudio(file)) {
      $("transcriptStatus").textContent = "20MB 이하의 WebM, OGG, M4A, MP3, WAV 파일만 사용할 수 있습니다.";
      return;
    }
    stopRecording(false);
    finishAudioBlob(file);
    $("transcriptText").value = "";
    $("transcriptReview").hidden = true;
  });
  $("transcribeBtn").addEventListener("click", transcribeAudio);
  $("useTranscriptBtn").addEventListener("click", useTranscript);
}

function loadImageFixtureForShot(withReview) {
  const fixturePath = "../data/fixtures/images/IMG02_ct_notice.png";
  assetState.image = { file: null, previewUrl: fixturePath, confirmed: false };
  $("imagePreview").className = "asset-preview";
  $("imagePreview").innerHTML = `<img src="${fixturePath}" alt="가상 CT 검사 안내문 미리보기"><span>IMG02_ct_notice.png · 가상 테스트 자료</span>`;
  $("extractImageBtn").disabled = false;
  $("imageReview").hidden = !withReview;
  if (withReview) {
    $("imageText").value = "8월 20일 13:30 CT 검사. 검사 전 6시간 금식. 알레르기 증상이 있으면 미리 연락.";
    useImageText();
  }
  activateSourceTab("image");
  renderSources();
}

function loadAudioFixtureForShot() {
  const fixturePath = "../data/fixtures/audio/AUD02_exam_prep.wav";
  assetState.audio = { blob: null, previewUrl: fixturePath, confirmed: true };
  $("audioPlayback").src = fixturePath;
  $("audioPlayback").hidden = false;
  $("transcribeBtn").disabled = false;
  $("transcriptReview").hidden = false;
  $("transcriptText").value = "검사 전날 밤 10시부터 금식하고 물도 마시지 않습니다.";
  $("transcriptStatus").textContent = "글로 바뀐 내용을 확인한 예시 화면이에요.";
  activateSourceTab("audio");
  renderSources();
}

async function init() {
  const shot = new URLSearchParams(location.search).get("shot");
  bindTabs();
  bindInputs();
  renderCheckboard();
  renderShare();
  renderPrivacy();
  renderSources();
  loadCapabilities();
  try {
    evaluationSamples = await fetch("../data/evaluation/samples.json").then((response) => response.json());
    renderEvaluation(evaluateSamples(evaluationSamples));
  } catch {
    $("evalDashboard").textContent = "서비스 주소로 접속하면 점검 결과를 확인할 수 있어요.";
  }
  if (shot === "privacy") {
    $("memo").value = demoSamples[2].text;
    renderPrivacy();
    renderSources();
    analyze(true, true);
    activateTab("write", false);
  } else if (shot === "input" || shot === "main") {
    $("memo").value = demoSamples[0].text;
    renderPrivacy();
    renderSources();
    activateTab("write", false);
  } else if (shot === "checkboard") {
    $("memo").value = demoSamples[0].text;
    renderSources();
    analyze(true, true);
    activateTab("board", false);
  } else if (shot === "share") {
    $("memo").value = demoSamples[0].text;
    renderSources();
    analyze(true, true);
    activateTab("share", false);
  } else if (shot === "evaluation") {
    $("memo").value = demoSamples[0].text;
    renderSources();
    analyze(true, true);
    activateTab("evaluation", false);
  } else if (shot === "image-upload") {
    loadImageFixtureForShot(false);
    activateTab("write", false);
  } else if (shot === "image-review") {
    loadImageFixtureForShot(true);
    activateTab("write", false);
  } else if (shot === "audio") {
    loadAudioFixtureForShot();
    activateTab("write", false);
  } else if (shot === "conflict") {
    $("memo").value = "7월 28일 오전에 다시 방문.";
    $("imageText").value = "예약 날짜는 7월 29일 오전입니다.";
    assetState.image.confirmed = true;
    renderSources();
    analyze(true, true);
    activateTab("board", false);
  } else {
    $("memo").value = demoSamples[0].text;
    renderPrivacy();
    renderSources();
    activateTab(tabFromHash(), false);
  }
}

init();
