#!/usr/bin/env bash
# Run from WSL. The optional PowerShell phase exercises the Windows-installed
# headless browser for screenshot-backed end-to-end verification.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

python3 scripts/wsl_check.py

if command -v powershell.exe >/dev/null 2>&1; then
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1
else
  echo "Windows PowerShell was not found; browser screenshot verification was skipped." >&2
  echo "Run this command from WSL on a Windows host to execute the full check." >&2
fi
