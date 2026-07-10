# 멀티모달 입력 파이프라인

## 입력 소스

`새 기록` 탭 안에서 다음 입력 방식을 조합할 수 있다.

| 입력 | 브라우저 처리 | 서버 처리 | 분석 포함 조건 |
|---|---|---|---|
| 직접 입력 | 메모·안내문 작성, 즉시 개인정보 패턴 검사 | 없음 | 즉시 포함 |
| 사진 | JPG/PNG/WebP 검증, 미리보기, 모바일 camera hint | Gemma 4 Vision 텍스트 추출 | 사용자가 추출문을 검토·수정·확정 |
| 음성 | MediaRecorder 녹음(최대 30초), 재생, 파일 업로드 | Faster-Whisper 전사 | 사용자가 전사문을 검토·수정·확정 |

`SourceDocument`는 `id`, `type`, `label`, `text`, `confidence`, `confirmed`를 가진다. 사진·음성의 원본 파일은 최종 구조화 전에 직접 근거로 쓰지 않으며, 사용자가 확정한 텍스트만 합쳐진다.

## 사진

1. 브라우저가 MIME(JPEG/PNG/WebP)와 10MB 제한을 검사한다.
2. 사용자는 사진 미리보기를 확인한다.
3. Gemma 4 Vision은 보이는 문장·날짜·시간·검사 준비·주의사항만 JSON으로 추출한다.
4. 사용자는 추출문을 편집하고 `이 추출문 사용`으로 확정한다.
5. 확정문은 `vision` source로 hybrid pipeline에 들어간다.

HEIC/PDF는 현재 검증된 변환기가 없으므로 지원한다고 표시하지 않는다. 텍스트 붙여넣기 경로는 항상 남겨 둔다.

## 음성

1. 지원 브라우저는 `getUserMedia`와 `MediaRecorder`로 최대 30초를 녹음한다.
2. MediaRecorder MIME은 WebM/Opus, MP4, OGG 순으로 기능 탐지한다.
3. 마이크를 지원하지 않거나 권한이 거부되면 오디오 파일 업로드를 사용할 수 있다.
4. Gateway의 Faster-Whisper가 전사하고 임시 파일을 즉시 삭제한다.
5. 사용자가 전사문을 편집·확정한 뒤에만 `audio_transcript` source가 된다.

전사 결과는 의료 사실로 취급하지 않는다. 사용자가 확인하지 않은 전사문은 최종 분석에 포함되지 않는다.

## 충돌

서로 다른 source에서 재방문 또는 검사 날짜가 다르면 `src/engine.js`가 `Conflict`를 만든다. 체크보드는 두 근거를 모두 표시하고, 공유문에는 `확인 필요`를 덧붙인다. 시스템이 임의로 하나를 선택하지 않는다.

## 합성 fixture

- 이미지 5개: `data/fixtures/images/`
- 음성 3개: `data/fixtures/audio/`
- manifest: 각 폴더의 `manifest.json`

모든 fixture는 합성 데이터이며 실제 병원 문서·실제 음성·실제 개인정보를 사용하지 않는다.
