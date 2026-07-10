# 엘리제소프트웨어 돌봄 체크보드

고령 부모의 진료 후 내용을 가족 보호자가 함께 확인할 수 있도록 정리하는 웹 서비스 MVP입니다. 직접 메모, 안내문 사진, 음성 기록을 입력해 복약·재방문·검사 준비·주의사항·다음 방문 질문으로 구조화하고, 가족용 체크보드와 공유문을 만듭니다.

이 서비스는 의료적 진단이나 처방을 제공하지 않습니다. 입력되거나 제공된 자료를 정리하고 공유하기 위한 정보지원 도구입니다.

## 핵심 기능

1. 직접 텍스트 입력: 메모·안내문 붙여넣기·텍스트 파일 업로드·예제·초기화·빈 입력 방지
2. 사진 입력: JPG/PNG/WebP 업로드 및 모바일 카메라 촬영, Gemma 4 Vision 추출문 수정·확정
3. 음성 입력: 브라우저 녹음 또는 파일 업로드, Faster-Whisper 전사문 수정·확정
4. 가족 체크보드: 5개 범주, 완료·담당자·날짜/시간·중요도·원문 근거·입력 충돌 표시
5. 공유문과 개인정보 경고: 복사·다운로드·완료 항목 반영, 개인정보 유사 패턴 마스킹 경고

## 기술 구성

- UI: 정적 HTML/CSS/JavaScript, 탭 기반 작업 화면
- 결정론적 core: `src/engine.js`의 한국어 규칙·날짜/시간·개인정보·중복·충돌 엔진
- AI gateway: private cloud의 Ollama `gemma4:e2b` (텍스트 구조화와 이미지 문서 추출)
- 음성 전사: same gateway의 Faster-Whisper
- 보안 경로: Windows browser → WSL same-origin BFF → SSH local tunnel → private cloud loopback
- fallback: AI/tunnel이 없거나 schema·grounding 검증에 실패하면 규칙 기반 분석 계속

Gemma 4는 원문 근거가 있는 compact JSON 초안만 만들며, 브라우저가 schema와 grounding을 검증한 뒤 규칙 결과와 병합합니다. 자세한 내용은 [AI_PIPELINE.md](docs/AI_PIPELINE.md), [MULTIMODAL_PIPELINE.md](docs/MULTIMODAL_PIPELINE.md)를 참고하세요.

## 실행

WSL에서 실행합니다. private Gemma 4 gateway를 설정한 경우 SSH tunnel을 함께 연결하며, 연결하지 않아도 텍스트 규칙 fallback은 실행됩니다.

Gemma 4를 연결하려면 실행 전 개인 환경에 `WAVELAB_AI_HOST`, `WAVELAB_AI_SSH_PORT`, `WAVELAB_AI_USER`를 설정하세요. 예시는 `.env.example`에 있으며, 실제 호스트·키·토큰은 저장소에 넣지 않습니다.

```bash
chmod +x scripts/start.sh scripts/verify.sh
./scripts/start.sh
```

브라우저에서 `http://localhost:8787/app/index.html`을 엽니다.

AI tunnel 없이 실행:

```bash
WAVELAB_ENABLE_AI=0 ./scripts/start.sh
```

Windows PowerShell의 `scripts/start.ps1`은 정적 fallback 화면 전용입니다. 사진·음성 AI까지 사용하려면 WSL `scripts/start.sh`를 사용하세요.

## 검증 명령

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-browser.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/evaluate.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/evaluate-ai.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-e2e.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1
```

Gemma 4 live self-test은 합성 문장만 클라우드에 보내며 기본 `verify`와 분리되어 있습니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-ai.ps1
```

Node 환경에서는 다음 wrapper도 사용할 수 있습니다.

```bash
npm run test
npm run test:browser
npm run evaluate
npm run evaluate:ai
npm run test:ai
npm run screenshots
npm run verify
```

## 실제 평가 결과

- 텍스트 가상 샘플: 20건 (`data/evaluation/samples.json`)
- 결정론적 구조화율: 95.45% (`artifacts/evaluation/evaluation.json`)
- 개인정보 유사 패턴 경고 탐지율: 100%
- AI 계약 검증: schema·grounding·충돌·fixture 준비율 100% (`artifacts/evaluation/ai-evaluation.json`)
- Gemma 4 live self-test: `gemma4:e2b`가 합성 문장에 대해 실제 항목을 반환하는지 별도 확인

AI 계약 수치와 텍스트 구조화율은 서로 다른 검증 목적이므로 합산하지 않습니다.

## 합성 멀티모달 fixture와 캡처

- 이미지 5개: `data/fixtures/images/`
- 음성 3개: `data/fixtures/audio/`
- 화면 캡처 10개: `artifacts/screenshots/`

모든 fixture는 테스트용 합성 자료이며 실제 병원 문서·실제 개인 정보·실제 음성을 포함하지 않습니다.

## 프로젝트 구조

```text
app/                         한국어 탭 UI와 멀티모달 입력
src/engine.js                규칙 fallback, schema, grounding, conflict
cloud/wavelab_ai_service.py  private Gemma 4 / Whisper gateway
scripts/wavelab_server.py    WSL same-origin BFF
scripts/start.sh             SSH tunnel + BFF 실행
data/evaluation/             20개 텍스트 및 AI 계약 평가 자료
data/fixtures/               합성 이미지·음성 fixture
schemas/                     CaseAnalysis JSON schema
artifacts/                   평가 결과와 실제 화면 캡처
docs/                        아키텍처·안전성·증빙 문서
```

## 실제 한계

- HEIC/PDF는 검증된 변환기가 없어 현재 지원하지 않습니다.
- 음성 전사는 말하기 속도·녹음 품질에 영향을 받으므로 전사문 확인이 필수입니다.
- 원격 GPU 컨테이너의 CUDA device mapping이 정상화되기 전까지 Gemma 4는 CPU fallback으로 구동될 수 있습니다. 이 경우 응답이 느려질 수 있으나, AI 실패 시 규칙 기반 fallback은 즉시 동작합니다.
