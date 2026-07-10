# 한라대학교 WAVE_Lab 실전 창업 지원 활동 결과보고서 증빙

## 1. 웹 기반 MVP 구현

- 구현 완료 여부: 완료
- 서비스: 엘리제소프트웨어 돌봄 체크보드
- 실행: WSL에서 `./scripts/start.sh`
- 접속: `http://localhost:8787/app/index.html`
- 화면: 상단 탭 기반의 새 기록·체크보드·공유문·검증 정보

## 2. 핵심 기능 5종

| 기능 | 구현 위치 | 검증 방법 |
|---|---|---|
| 진료 후 메모 입력 | `app/index.html`, `app/app.js` | 예제·빈 입력·초기화·분석 단위/통합 테스트 |
| 안내자료 입력 | `app/index.html`, `cloud/wavelab_ai_service.py` | 텍스트, 사진 업로드/카메라 hint, 추출문 수정, 이미지 fixture |
| 가족용 체크보드 | `src/engine.js`, `app/app.js` | 5개 범주, 완료·담당자·근거·충돌 UI 및 E2E 캡처 |
| 보호자 공유문 | `src/engine.js`, `app/app.js` | 완료 상태 반영, 복사, 다운로드, 통합 테스트 |
| 개인정보 유사 패턴 경고 | `src/engine.js`, `scripts/WaveLab.Engine.ps1` | 전화·이메일·주민번호 유사·마스킹 테스트 |

## 3. 추가 AI·멀티모달 기능

- LLM 구조화: private cloud의 Ollama `gemma4:e2b`가 compact semantic JSON을 생성한다.
- 이미지 인식: Gemma 4 Vision으로 JPG/PNG/WebP 안내문에서 보이는 텍스트를 추출한다.
- 음성 인식: Browser MediaRecorder/파일 업로드와 Faster-Whisper 전사를 제공한다.
- 사용자 검토: 사진 추출문과 전사문은 수정·확정 전까지 최종 분석 source에 포함되지 않는다.
- grounding: `sourceText`가 실제 입력에 존재하고 날짜/시간이 규칙 추출과 맞는지 검사한다.
- fallback: AI tunnel·provider·schema·grounding 실패 시 rule-based baseline으로 전환한다.
- 충돌: source 간 재방문/검사 날짜가 다르면 임의 선택하지 않고 `확인 필요`로 표시한다.

## 4. 가상 샘플 및 fixture

- 텍스트 평가 샘플: `data/evaluation/samples.json`, 20건
- 구성: 고혈압, 당뇨 검사, 내시경, CT, MRI, 수술 후, 피부과, 안과, 치과, 개인정보 경고, 복수 일정, 모호한 표현 등
- 이미지 fixture: `data/fixtures/images/`, 합성 안내문 5개
- 음성 fixture: `data/fixtures/audio/`, 합성 한국어 음성 3개
- 모든 자료는 실제 병원 문서·실제 개인 정보·실제 음성을 사용하지 않는다.

## 5. 구조화율 및 AI 계약 검증

### 결정론적 텍스트 구조화

- 정의: 올바른 category와 키워드 근거로 매칭된 expected action item 수 / 전체 expected action item 수
- 실제 결과: 63 / 66 = **95.45%**
- 개인정보 유사 패턴 경고 탐지율: 100%
- 평가 명령: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/evaluate.ps1`
- 산출물: `artifacts/evaluation/evaluation.json`, `artifacts/evaluation/evaluation.csv`, `docs/EVALUATION_REPORT.md`

### AI 보조 파이프라인

- 검증 범위: schema, grounding, source conflict, 합성 fixture 준비
- 실제 계약 검증: 각 항목 100%
- 명령: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/evaluate-ai.ps1`
- live Gemma 확인: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-ai.ps1`
- 산출물: `artifacts/evaluation/ai-evaluation.json`, `artifacts/evaluation/ai-evaluation.csv`, `docs/AI_EVALUATION_REPORT.md`

두 평가 수치는 목적이 다르므로 합산하지 않는다.

## 6. 정성적 성과와 보호자 중심 개선 방향

- 한 번의 진료 후 메모를 가족이 확인할 5개 항목으로 분리해 반복 설명 부담을 낮출 수 있다.
- 사진·음성 자료도 사용자가 추출문·전사문을 확인한 후에만 분석에 포함해 고령자 보호자의 검토 부담을 줄인다.
- 완료 체크, 담당자, 공유문으로 가족 간 역할과 전달 내용을 한 곳에서 정리할 수 있다.
- 서로 다른 입력 자료의 일정이 다르면 숨기지 않고 근거와 함께 확인 요청을 표시한다.

## 7. 시제품 화면

- `01_main.png`: 탭 기반 메인·직접 입력 진입
- `02_input.png`: 메모와 안내문 텍스트 입력
- `03_checkboard.png`: 구조화된 5개 범주 체크보드
- `04_share_message.png`: 보호자 공유문·복사·다운로드
- `05_privacy_warning.png`: 개인정보 유사 패턴 마스킹 경고
- `06_evaluation_dashboard.png`: 20개 텍스트 샘플 평가 대시보드
- `07_image_upload.png`: 합성 안내문 이미지 업로드·미리보기
- `08_image_extraction.png`: Gemma Vision 추출문 검토·수정
- `09_audio_transcript.png`: 음성 녹음/파일·전사문 검토
- `10_conflict_warning.png`: 자료 간 재방문 일정 충돌 경고
