#!/usr/bin/env python3
"""WSL same-origin server and private AI gateway proxy for WaveLab.

The browser only talks to this process on localhost. Gemma remains on the
private GPU host and is normally reachable through an SSH local forward.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent.parent
AI_URL = os.environ.get("WAVELAB_AI_URL", "").rstrip("/")
MAX_API_BODY = 28 * 1024 * 1024
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
    ".mp3": "audio/mpeg",
}
API_ROUTES = {
    "/api/analyze": "/v1/analyze",
    "/api/extract/image": "/v1/extract/image",
    "/api/transcribe/audio": "/v1/transcribe/audio",
}


def write_json(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def remote_json(path: str, payload: dict[str, Any] | None = None, timeout: int = 185) -> tuple[int, dict[str, Any]]:
    if not AI_URL:
        return HTTPStatus.SERVICE_UNAVAILABLE, {
            "error": "ai_unavailable",
            "message": "AI 분석 서버 연결이 설정되지 않았습니다.",
        }
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        f"{AI_URL}{path}",
        data=body,
        headers={"Content-Type": "application/json"} if body else {},
        method="POST" if body else "GET",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            payload = {"error": "ai_request_failed", "message": "AI 분석 요청이 실패했습니다."}
        return exc.code, payload
    except (URLError, TimeoutError, OSError):
        return HTTPStatus.SERVICE_UNAVAILABLE, {
            "error": "ai_unavailable",
            "message": "AI 분석 서버에 연결할 수 없습니다. 규칙 기반 분석을 계속 사용할 수 있습니다.",
        }


class WaveLabHandler(BaseHTTPRequestHandler):
    server_version = "WaveLabLocal/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        # Do not write request URLs or payload-associated data to logs.
        return

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] == "/api/capabilities":
            status, remote = remote_json("/health", timeout=5)
            if status == HTTPStatus.OK:
                write_json(self, HTTPStatus.OK, {"available": bool(remote.get("ready")), **remote})
            else:
                write_json(
                    self,
                    HTTPStatus.OK,
                    {
                        "available": False,
                        "provider": "rule-based",
                        "model": None,
                        "capabilities": {"text": False, "image": False, "audio": False},
                        "message": remote.get("message", "AI 분석 서버에 연결할 수 없습니다."),
                    },
                )
            return
        self.serve_static()

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        remote_path = API_ROUTES.get(path)
        if not remote_path:
            write_json(self, HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > MAX_API_BODY:
                raise ValueError("요청 크기가 올바르지 않습니다.")
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("JSON 객체가 필요합니다.")
        except (ValueError, json.JSONDecodeError):
            write_json(self, HTTPStatus.BAD_REQUEST, {"error": "invalid_request", "message": "요청 형식이 올바르지 않습니다."})
            return
        status, response = remote_json(remote_path, payload)
        write_json(self, status, response)

    def serve_static(self) -> None:
        raw_path = self.path.split("?", 1)[0]
        relative = "app/index.html" if raw_path in {"", "/"} else raw_path.lstrip("/")
        candidate = (ROOT / relative).resolve()
        try:
            candidate.relative_to(ROOT)
        except ValueError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not candidate.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        data = candidate.read_bytes()
        content_type = MIME_TYPES.get(candidate.suffix.lower()) or mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store" if candidate.suffix.lower() in {".html", ".js", ".css"} else "public, max-age=3600")
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    print(f"WaveLab local server: http://{args.host}:{args.port}/app/index.html")
    ThreadingHTTPServer((args.host, args.port), WaveLabHandler).serve_forever()


if __name__ == "__main__":
    main()
