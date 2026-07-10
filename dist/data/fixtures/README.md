# 멀티모달 가상 테스트 자료

이 폴더의 이미지와 오디오 파일은 WaveLab의 업로드·추출·전사·개인정보 경고·충돌 표시를 검증하기 위해 만든 합성 자료입니다. 실제 병원 문서, 실제 음성, 실제 개인정보를 포함하지 않습니다.

- `images/`: Windows PowerShell의 `scripts/generate-fixtures.ps1`로 생성한 한국어 가상 안내문 PNG 5개
- `images/manifest.json`: 각 이미지의 예상 추출문·범주·개인정보 경고 조건
- `audio/`: 합성 음성 파일과 전사문 manifest를 저장하는 위치

이미지는 입력 검토 후에만 최종 분석 자료에 포함됩니다. 원본은 클라우드 AI gateway에서 요청 처리 직후 삭제하도록 구현되어 있습니다.
