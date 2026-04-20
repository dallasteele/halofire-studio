#!/usr/bin/env bash
# OpenClaw-HaloFire — Linux / macOS install
# Prereqs: Python 3.12+, Node 22+, bun, Ollama
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[openclaw] root = $ROOT"

echo "[openclaw] pulling gemma3:4b via Ollama..."
ollama pull gemma3:4b >/dev/null

echo "[openclaw] installing Python deps..."
python3 -m pip install --quiet duckdb openpyxl pdfplumber beautifulsoup4

DB="$ROOT/../services/halofire-cad/pricing/supplies.duckdb"
if [[ ! -f "$DB" ]]; then
  echo "[openclaw] seeding pricing DB..."
  python3 "$ROOT/../services/halofire-cad/pricing/seed.py"
fi

echo "[openclaw] validating modules..."
python3 "$ROOT/bin/openclaw" --root "$ROOT" list

read -rp "Install as systemd service? (y/N) " SVC
if [[ "${SVC:-}" == "y" ]]; then
  SERVICE=/etc/systemd/system/openclaw-halofire.service
  sudo tee "$SERVICE" > /dev/null <<EOF
[Unit]
Description=OpenClaw-HaloFire autonomous runtime
After=network.target

[Service]
Type=simple
WorkingDirectory=$ROOT
ExecStart=/usr/bin/python3 $ROOT/bin/openclaw --root $ROOT start
Restart=on-failure
User=${SUDO_USER:-$USER}

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now openclaw-halofire
  echo "[openclaw] started via systemd: openclaw-halofire"
fi

echo "[openclaw] done."
