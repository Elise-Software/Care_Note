#!/usr/bin/env python3
"""Send only synthetic local fixtures to the private WaveLab AI gateway."""

from __future__ import annotations

import base64
import json
from pathlib import Path
import sys
from urllib.request import Request, urlopen


def post(path: str, payload: dict) -> dict:
    request = Request(
        f"http://127.0.0.1:8000{path}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=240) as response:
        return json.load(response)


def encoded_asset(path: Path, mime_type: str) -> dict:
    return {"mimeType": mime_type, "dataBase64": base64.b64encode(path.read_bytes()).decode("ascii")}


if __name__ == "__main__":
    image = Path(sys.argv[1])
    audio = Path(sys.argv[2])
    text = post("/v1/analyze", {"sources": [{"id": "fixture-text", "type": "manual", "text": "혈압약은 아침 식후 복용. 7월 28일 오전에 다시 방문."}]})
    vision = post("/v1/extract/image", encoded_asset(image, "image/png"))
    transcript = post("/v1/transcribe/audio", encoded_asset(audio, "audio/wav"))
    print(json.dumps({
        "provider": text.get("provider"),
        "model": text.get("model"),
        "textItemCount": len(text.get("draft", {}).get("actionItems", [])),
        "imageTextLength": len(str(vision.get("text", ""))),
        "audioTextLength": len(str(transcript.get("text", ""))),
    }, ensure_ascii=False))
