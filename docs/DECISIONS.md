# 개발 의사결정 기록

## 정적 웹앱 선택

Windows 호스트에는 Node.js와 npm이 없지만 WSL Ubuntu에는 Python 3가 있다. 따라서 설치 의존성이 있는 풀스택 프레임워크 대신 HTML/CSS/JavaScript 정적 웹앱을 선택하고, WSL에서는 Python 표준 라이브러리 서버로 실행한다. Windows PowerShell 검증 스크립트는 Windows의 Edge/Chrome을 사용하는 스크린샷 E2E 경로로 유지한다. 이 선택은 로컬 단독 실행, 테스트 가능성, 화면 캡처 자동화 요구사항을 우선한 결정이다.

## Hybrid AI와 결정론적 fallback

핵심 기능은 API 키나 클라우드 연결이 없어도 동작해야 하므로 deterministic rule-based baseline을 계속 기본 안전망으로 유지한다. 다만 사진·음성·비정형 문장의 의미 구조화를 확장하기 위해 private cloud의 Gemma 4 E2B를 보조 provider로 연결했다. Gemma 결과는 JSON schema, 원문 grounding, 날짜·시간 규칙, 중복·충돌 검사를 거친 뒤에만 채택하며, 어느 단계든 실패하면 rule-based 결과로 전환한다. 원문에 없는 의료 판단을 생성하지 않는 안전성 측면에서도 이 hybrid 구조가 적합하다.

## 텍스트 붙여넣기 우선

OCR 의존성은 현재 실행 환경에서 안정적으로 보장하기 어렵다. 필수 요구사항인 안내문 텍스트 붙여넣기와 텍스트 파일 업로드를 우선 구현하고, OCR은 adapter 경계로 문서화했다.

## PowerShell 평가 도구

Node/npm 부재로 `npm run evaluate`를 직접 실행할 수 없는 환경이다. WSL의 `scripts/start.sh`와 `scripts/wsl_check.py`는 Python 3만으로 실행과 정적 계약 검증을 수행한다. `scripts/verify.sh`는 WSL에서 호출할 수 있으며, Windows PowerShell·Edge/Chrome이 있으면 기존 평가·테스트·build validation·screenshot automation까지 연결한다. Node가 설치된 환경에서는 `package.json` scripts를 통해 같은 명령을 호출할 수 있다.

## 탭 기반 작업 화면

새 기록, 체크보드, 공유문, 검증 정보를 한 화면에 세로로 계속 나열하면 실제 업무 흐름보다 데모 페이지처럼 보이고 필요한 화면으로 이동하는 비용이 커진다. 따라서 상단 고정 탭과 단일 작업 영역을 사용한다. 각 탭은 URL 해시와 연결되어 직접 접근과 브라우저 탐색도 지원하며, 키보드 화살표·Home·End 키로도 이동할 수 있다. 정보 밀도가 높은 B2B 고객센터의 상단 메뉴·콘텐츠 영역 구조를 참고하되, 색상·문구·자산은 독자적으로 구현했다.

## Private cloud Gemma 4 연결

제공된 GPU cloud는 RTX 5090 32GB를 제공하지만 컨테이너의 CUDA device mapping 문제로 Ollama가 GPU를 안정적으로 감지하지 못할 수 있다. 따라서 Gemma 4 E2B를 private loopback에 실행하고, WSL의 same-origin BFF가 SSH local forward로만 연결하도록 했다. 브라우저는 클라우드 주소나 SSH key를 알지 못한다. 12B 모델도 cloud에 보존하지만, CPU fallback 환경에서 응답 시간이 더 짧은 E2B를 UI의 기본 모델로 선택했다.

## 음성 전사 provider 분리

Gemma 4는 텍스트·이미지 의미 구조화에 사용하고, 브라우저 MediaRecorder 오디오의 안정적인 전사는 Faster-Whisper adapter에 맡겼다. 사용자는 전사문을 수정·확정해야 하며, 전사문이 확정되기 전에는 최종 구조화에 포함되지 않는다. 이 분리는 모델의 역할과 사용자 확인 책임을 명확히 한다.
