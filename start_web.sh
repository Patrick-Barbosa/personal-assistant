#!/bin/sh
# Uso diário (navegador): backend Python + frontend Vite, sem Tauri/Rust.
set -e
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env
if [ -x .venv/bin/python ]; then
  PY=.venv/bin/python
else
  PY=python3
fi
$PY -m backend.server &
BACK_PID=$!
# Abre o app no navegador assim que o Vite responder (portátil: macOS/Linux/Windows).
(
  for i in $(seq 1 30); do
    if curl -sf -o /dev/null http://localhost:1420/ 2>/dev/null; then break; fi
    sleep 1
  done
  URL=http://localhost:1420/
  case "$(uname -s)" in
    Darwin) open "$URL" ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT) start "" "$URL" ;;
    *) xdg-open "$URL" 2>/dev/null || echo "Abra $URL no navegador" ;;
  esac
) &
pnpm dev --port 1420
kill $BACK_PID
