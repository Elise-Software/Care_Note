#!/usr/bin/env python3
"""Private Gemma 4 gateway for WaveLab.

This service is intended to bind only to 127.0.0.1 on the GPU host and be
reached through an SSH tunnel. It deliberately keeps no request payloads,
uploaded files, transcripts, or model responses on disk after a request.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import tempfile
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


HOST = os.environ.get("WAVELAB_AI_HOST", "127.0.0.1")
PORT = int(os.environ.get("WAVELAB_AI_PORT", "8000"))
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.environ.get("WAVELAB_GEMMA_MODEL", "gemma4:e2b")
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_AUDIO_BYTES = 20 * 1024 * 1024
ALLOWED_IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_AUDIO_MIMES = {
    "audio/webm",
    "audio/webm;codecs=opus",
    "audio/ogg",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
}
CATEGORY_ALIASES = {
    "medication": "medication", "복약": "medication", "약": "medication",
    "revisit": "revisit", "재방문": "revisit", "일정": "revisit", "예약": "revisit",
    "exam_prep": "exam_prep", "검사준비": "exam_prep", "검사 준비": "exam_prep",
    "precautions": "precautions", "주의사항": "precautions", "주의": "precautions",
    "questions": "questions", "질문": "questions", "다음방문질문": "questions",
}


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    try:
        handler.wfile.write(body)
    except BrokenPipeError:
        pass


def post_ollama(payload: dict[str, Any], timeout: int = 180) -> dict[str, Any]:
    request = Request(
        f"{OLLAMA_URL}/api/chat",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise RuntimeError(f"Gemma 요청이 실패했습니다 ({exc.code}).") from exc
    except (URLError, OSError) as exc:
        raise RuntimeError("Gemma 서버에 연결할 수 없습니다.") from exc


def parse_json_content(content: str) -> dict[str, Any]:
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
    value = json.loads(cleaned.strip())
    if not isinstance(value, dict):
        raise ValueError("모델 결과가 JSON 객체가 아닙니다.")
    return value


def gemma_json(messages: list[dict[str, Any]], num_predict: int = 160) -> dict[str, Any]:
    payload = {
        "model": MODEL,
        "messages": messages,
        "stream": False,
        "format": "json",
        "think": False,
        "options": {"temperature": 0.1, "top_p": 0.8, "num_predict": num_predict},
    }
    first = post_ollama(payload)
    content = str(first.get("message", {}).get("content", ""))
    try:
        return parse_json_content(content)
    except (TypeError, ValueError, json.JSONDecodeError):
        repair = messages + [
            {
                "role": "user",
                "content": "이전 결과를 버리고, 설명 없이 유효한 JSON 객체만 다시 반환하세요.",
            }
        ]
        second = post_ollama({**payload, "messages": repair})
        return parse_json_content(str(second.get("message", {}).get("content", "")))


def normalize_sources(raw_sources: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_sources, list):
        raise ValueError("sources 배열이 필요합니다.")
    sources: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_sources[:12]):
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("text", "")).strip()
        if not text:
            continue
        sources.append(
            {
                "id": str(raw.get("id") or f"source-{index + 1}"),
                "type": str(raw.get("type") or "manual"),
                "text": text[:16000],
            }
        )
    if not sources:
        raise ValueError("분석할 확인된 텍스트가 없습니다.")
    return sources


def analyze_text(raw_sources: Any) -> dict[str, Any]:
    sources = normalize_sources(raw_sources)
    source_block = "\n\n".join(
        f"[SOURCE id={source['id']} type={source['type']}]\n{source['text']}" for source in sources
    )
    system = """당신은 한국어 진료 후 안내문을 가족이 확인할 항목으로 분류하는 보조 도구다.
의료 진단, 처방 변경, 약 중단 권고, 응급 판단을 절대 추가하지 말라. 입력에 실제로 있는 문장만
선택하고 추측하지 말라. JSON 외의 문장을 출력하지 마라."""
    user = f"""다음 입력 자료를 분석해 JSON으로 반환하라.
허용 category: medication, revisit, exam_prep, precautions, questions
반환 스키마는 반드시 아래처럼 짧게 유지한다.
{{"items":[{{"category":"medication","sourceDocumentId":"manual-1","sourceText":"입력에서 그대로 복사한 한 문장"}}]}}
항목은 최대 8개다. sourceText는 반드시 SOURCE에 있는 문장을 그대로 복사하고, sourceDocumentId는 해당 SOURCE의 id= 뒤 값을 그대로 사용한다.

{source_block}"""
    compact = gemma_json([{"role": "system", "content": system}, {"role": "user", "content": user}])
    source_by_id = {source["id"]: source for source in sources}
    action_items = []
    for item in compact.get("items", compact.get("actionItems", []))[:8]:
        if not isinstance(item, dict):
            continue
        source_text = str(item.get("sourceText", "")).strip()
        source = source_by_id.get(str(item.get("sourceDocumentId", "")))
        if source is None and source_text:
            compact_source_text = "".join(source_text.split())
            source = next((candidate for candidate in sources if compact_source_text in "".join(candidate["text"].split())), None)
        category = CATEGORY_ALIASES.get(str(item.get("category", "")).replace(" ", "").lower(), str(item.get("category", "")))
        if source is None or not source_text or category not in {"medication", "revisit", "exam_prep", "precautions", "questions"}:
            continue
        action_items.append(
            {
                "category": category,
                "title": source_text,
                "detail": source_text,
                "dueDate": "",
                "dueTime": "",
                "priority": "low",
                "confidence": 0.72,
                "sourceText": source_text,
                "sourceDocumentId": source["id"],
            }
        )
    draft = {"summary": "입력 자료의 확인사항을 정리했습니다.", "actionItems": action_items, "ambiguities": [], "safetyFlags": []}
    return {"provider": "gemma4", "model": MODEL, "draft": draft}


def decode_asset(payload: dict[str, Any], allowed_mimes: set[str], max_bytes: int) -> tuple[bytes, str]:
    mime_type = str(payload.get("mimeType", "")).lower()
    if mime_type not in allowed_mimes:
        raise ValueError("지원하지 않는 파일 형식입니다.")
    encoded = payload.get("dataBase64")
    if not isinstance(encoded, str) or not encoded:
        raise ValueError("파일 데이터가 없습니다.")
    try:
        data = base64.b64decode(encoded, validate=True)
    except ValueError as exc:
        raise ValueError("파일 데이터를 읽을 수 없습니다.") from exc
    if not data or len(data) > max_bytes:
        raise ValueError("파일 크기 제한을 초과했습니다.")
    return data, mime_type


def extract_image(payload: dict[str, Any]) -> dict[str, Any]:
    data, mime_type = decode_asset(payload, ALLOWED_IMAGE_MIMES, MAX_IMAGE_BYTES)
    prompt = """이 이미지는 병원 방문 후 안내자료 또는 의료 문서다. 이미지에서 실제로 보이는 한글/숫자
텍스트와 명시적 안내만 추출하라. 보이지 않는 의료 정보는 추론하지 말라. 날짜, 시간, 복약,
재방문, 검사 준비, 주의사항, 질문 관련 문장을 가능한 원문 그대로 보존하라.
반환 JSON: {"text":"추출된 텍스트", "confidence":0.0, "notes":["판독 시 주의점"]}."""
    messages = [
        {"role": "system", "content": "문서에서 보이는 내용만 추출하는 한국어 문서 인식 도구다."},
        {
            "role": "user",
            "content": prompt,
            "images": [base64.b64encode(data).decode("ascii")],
        },
    ]
    # Documents can contain multiple lines of source text. A short generation
    # cap can truncate the JSON string before its closing quote or brace.
    result = gemma_json(messages, num_predict=1200)
    text = str(result.get("text", "")).strip()
    return {
        "provider": "gemma4-vision",
        "model": MODEL,
        "text": text,
        "confidence": float(result.get("confidence", 0.0) or 0.0),
        "notes": result.get("notes", []),
        "mimeType": mime_type,
    }


def transcribe_audio(payload: dict[str, Any]) -> dict[str, Any]:
    data, mime_type = decode_asset(payload, ALLOWED_AUDIO_MIMES, MAX_AUDIO_BYTES)
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError("음성 전사 구성요소가 아직 준비되지 않았습니다.") from exc

    suffix = {
        "audio/webm": ".webm",
        "audio/webm;codecs=opus": ".webm",
        "audio/ogg": ".ogg",
        "audio/ogg;codecs=opus": ".ogg",
        "audio/mp4": ".m4a",
        "audio/mpeg": ".mp3",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
    }[mime_type]
    path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(prefix="wavelab-", suffix=suffix, delete=False) as temp_file:
            temp_file.write(data)
            path = Path(temp_file.name)
        # CPU mode remains available if the host's CUDA runtime is unavailable.
        model = WhisperModel(os.environ.get("WAVELAB_STT_MODEL", "base"), device="cpu", compute_type="int8")
        segments, info = model.transcribe(str(path), language="ko", vad_filter=True)
        rows = [{"start": round(segment.start, 2), "end": round(segment.end, 2), "text": segment.text.strip()} for segment in segments]
        return {
            "provider": "faster-whisper",
            "model": os.environ.get("WAVELAB_STT_MODEL", "base"),
            "text": " ".join(row["text"] for row in rows).strip(),
            "language": getattr(info, "language", "ko"),
            "confidence": None,
            "segments": rows,
        }
    finally:
        if path:
            path.unlink(missing_ok=True)


def health() -> dict[str, Any]:
    ready = False
    try:
        with urlopen(f"{OLLAMA_URL}/api/tags", timeout=4) as response:
            models = json.loads(response.read().decode("utf-8")).get("models", [])
            ready = any(str(model.get("name", "")).startswith(MODEL) for model in models)
    except (URLError, ValueError, OSError):
        pass
    try:
        import faster_whisper  # noqa: F401
        stt_ready = True
    except ImportError:
        stt_ready = False
    return {
        "ready": ready,
        "provider": "gemma4",
        "model": MODEL,
        "capabilities": {"text": ready, "image": ready, "audio": stt_ready},
    }


class WaveLabAIHandler(BaseHTTPRequestHandler):
    server_version = "WaveLabAI/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        # Avoid request paths with query strings and never log raw request data.
        return

    def do_GET(self) -> None:
        if self.path == "/health":
            json_response(self, HTTPStatus.OK, health())
            return
        if self.path == "/v1/self-test":
            try:
                result = analyze_text([
                    {
                        "id": "synthetic-self-test",
                        "type": "manual",
                        "text": "혈압약은 아침 식후 복용. 7월 28일 오전에 다시 방문.",
                    }
                ])
                json_response(
                    self,
                    HTTPStatus.OK,
                    {
                        "provider": result["provider"],
                        "model": result["model"],
                        "actionItemCount": len(result["draft"]["actionItems"]),
                    },
                )
            except Exception:
                json_response(self, HTTPStatus.BAD_GATEWAY, {"error": "self_test_failed"})
            return
        json_response(self, HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_POST(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > 28 * 1024 * 1024:
                raise ValueError("요청 크기가 올바르지 않습니다.")
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("JSON 객체가 필요합니다.")
            if self.path == "/v1/analyze":
                result = analyze_text(payload.get("sources"))
            elif self.path == "/v1/extract/image":
                result = extract_image(payload)
            elif self.path == "/v1/transcribe/audio":
                result = transcribe_audio(payload)
            else:
                json_response(self, HTTPStatus.NOT_FOUND, {"error": "not_found"})
                return
            json_response(self, HTTPStatus.OK, result)
        except (ValueError, RuntimeError, json.JSONDecodeError) as exc:
            json_response(self, HTTPStatus.BAD_REQUEST, {"error": "request_failed", "message": str(exc)})
        except Exception:
            json_response(self, HTTPStatus.BAD_GATEWAY, {"error": "provider_unavailable", "message": "AI 분석 서버를 일시적으로 사용할 수 없습니다."})


if __name__ == "__main__":
    print(f"WaveLab AI gateway listening on {HOST}:{PORT}; model={MODEL}")
    ThreadingHTTPServer((HOST, PORT), WaveLabAIHandler).serve_forever()
