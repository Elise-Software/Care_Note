#!/usr/bin/env bash
# WSL-native same-origin server. When the SSH key is available, it opens a
# local-only tunnel to the private Gemma 4 gateway before serving the app.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-8787}"
TUNNEL_PORT="${WAVELAB_TUNNEL_PORT:-11435}"
REMOTE_HOST="${WAVELAB_AI_HOST:-}"
REMOTE_PORT="${WAVELAB_AI_SSH_PORT:-22}"
REMOTE_USER="${WAVELAB_AI_USER:-}"
TUNNEL_PID=""
SSH_KEY_TEMP=""

find_ssh_key() {
  for candidate in "${WAVELAB_SSH_KEY:-}" "$HOME/.ssh/id_ed25519" "/mnt/c/Users/${USER:-user}/.ssh/id_ed25519"; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

cleanup() {
  if [[ -n "$TUNNEL_PID" ]] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    kill "$TUNNEL_PID" 2>/dev/null || true
    wait "$TUNNEL_PID" 2>/dev/null || true
  fi
  if [[ -n "$SSH_KEY_TEMP" ]]; then
    rm -f "$SSH_KEY_TEMP"
  fi
}
trap cleanup EXIT INT TERM

if [[ "${WAVELAB_ENABLE_AI:-1}" != "0" ]] && [[ -n "$REMOTE_HOST" && -n "$REMOTE_USER" ]] && command -v ssh >/dev/null 2>&1 && SSH_KEY="$(find_ssh_key 2>/dev/null)"; then
  # OpenSSH in WSL refuses keys on the Windows-mounted filesystem because its
  # permissions appear as 0777. Keep a short-lived 0600 copy outside the repo.
  if [[ "$SSH_KEY" == /mnt/* ]]; then
    SSH_KEY_TEMP="$(mktemp "${TMPDIR:-/tmp}/wavelab-key.XXXXXX")"
    cp "$SSH_KEY" "$SSH_KEY_TEMP"
    chmod 600 "$SSH_KEY_TEMP"
    SSH_KEY="$SSH_KEY_TEMP"
  fi
  echo "Connecting to the private Gemma 4 analysis gateway..."
  ssh -N \
    -o BatchMode=yes \
    -o ConnectTimeout=15 \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=2 \
    -o StrictHostKeyChecking=accept-new \
    -p "$REMOTE_PORT" \
    -i "$SSH_KEY" \
    -L "127.0.0.1:${TUNNEL_PORT}:127.0.0.1:8000" \
    "${REMOTE_USER}@${REMOTE_HOST}" &
  TUNNEL_PID=$!
  sleep 2
  if kill -0 "$TUNNEL_PID" 2>/dev/null; then
    export WAVELAB_AI_URL="http://127.0.0.1:${TUNNEL_PORT}"
    echo "Gemma 4 gateway connected through a local-only SSH tunnel."
  else
    echo "Gemma 4 gateway is unavailable; deterministic fallback remains available." >&2
  fi
else
  echo "Gemma 4 tunnel was not started; deterministic fallback remains available." >&2
fi

echo "WaveLab is available at http://localhost:${PORT}/app/index.html"
echo "Press Ctrl+C to stop."
cd "$ROOT"
python3 scripts/wavelab_server.py --port "$PORT"
