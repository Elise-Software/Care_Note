# AI 보조 파이프라인 계약 검증 보고서

생성 시각: 2026-07-10T13:50:04.7084375+09:00

## 검증 범위

이 보고서는 외부 모델의 응답 품질 점수와 분리된 결정론적 계약 검증 결과다. Gemma 4 결과가 스키마·원문 근거·충돌 정책을 통과해야만 채택되도록 하는 로직과, 합성 이미지·음성 fixture의 준비 상태를 점검한다.

## 실제 결과

- 스키마 유효성 판별 정확도: 100%
- 원문 근거 판별 정확도: 100%
- 일정 충돌 판별 정확도: 100%
- 멀티모달 fixture 준비율: 100%
- 합성 이미지 fixture: 5개
- 합성 음성 fixture: 3개

## 해석

이 수치는 기존 20개 텍스트 샘플의 구조화율과 합산하지 않는다. Gemma 4 live test는 별도 네트워크·모델 가용성에 의존하므로 scripts/test-ai.ps1에서 합성 자료만 보내 검증한다. 모델 응답이 형식·근거 검증에 실패하면 규칙 기반 fallback으로 전환한다.

## 산출물

- JSON: artifacts/evaluation/ai-evaluation.json
- CSV: artifacts/evaluation/ai-evaluation.csv
