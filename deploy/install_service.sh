#!/usr/bin/env bash
# Run this ON the Raspberry Pi, from inside the project folder, after
# creating a venv and installing requirements.txt.
set -euo pipefail

SERVICE_SRC="$(dirname "$0")/meatsentinel.service"
SERVICE_DST="/etc/systemd/system/meatsentinel.service"

sudo cp "$SERVICE_SRC" "$SERVICE_DST"
sudo systemctl daemon-reload
sudo systemctl enable meatsentinel.service
sudo systemctl restart meatsentinel.service

echo "Installed. Check status with: sudo systemctl status meatsentinel.service"
echo "Tail logs with:               journalctl -u meatsentinel.service -f"
