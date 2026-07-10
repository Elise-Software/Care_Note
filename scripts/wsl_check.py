#!/usr/bin/env python3
"""Dependency-free checks that can run inside a clean WSL distribution."""

from __future__ import annotations

import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent.parent
REQUIRED_FILES = (
    "app/index.html",
    "app/app.js",
    "app/styles.css",
    "src/engine.js",
    "data/evaluation/samples.json",
)
HTML_CONTRACT = (
    "src/engine.js",
    "app.js",
    "styles.css",
    'id="memo"',
    'id="analyzeBtn"',
    'id="checkboard"',
    'id="shareText"',
    'id="evalDashboard"',
    "의료적 진단이나 처방",
)
ENGINE_CONTRACT = (
    "structurePipeline",
    "detectPrivacyPatterns",
    "extractActionItems",
    "generateShareMessage",
)


def fail(message: str) -> None:
    print(f"WSL check failed: {message}", file=sys.stderr)
    raise SystemExit(1)


for relative_path in REQUIRED_FILES:
    if not (ROOT / relative_path).is_file():
        fail(f"missing required file: {relative_path}")

html = (ROOT / "app/index.html").read_text(encoding="utf-8")
for value in HTML_CONTRACT:
    if value not in html:
        fail(f"index.html is missing its required contract: {value}")

engine = (ROOT / "src/engine.js").read_text(encoding="utf-8")
for value in ENGINE_CONTRACT:
    if value not in engine:
        fail(f"engine.js is missing its required API: {value}")

samples = json.loads((ROOT / "data/evaluation/samples.json").read_text(encoding="utf-8"))
if not isinstance(samples, list) or len(samples) != 20:
    fail("evaluation dataset must contain exactly 20 samples")
if any(not sample.get("input") or not sample.get("expectedItems") for sample in samples):
    fail("every evaluation sample needs input and expectedItems")

print("WSL static checks passed: UTF-8 assets, UI contract, engine API, and 20 evaluation samples.")
