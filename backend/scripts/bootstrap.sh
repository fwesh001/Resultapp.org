#!/usr/bin/env bash
# ResultApp Droplet Bootstrap — run as root on fresh Ubuntu 24.04 (Noble)
#
# This droplet runs the FastAPI backend and PostgreSQL ONLY. There is no PHP
# and no per-tenant web root: the Next.js app on Vercel serves every tenant
# subdomain (middleware rewrites the Host to /[subdomain]/...) and calls this
# API for data. Nginx exists solely to reverse-proxy api.resultapp.org to
# uvicorn.
set -euo pipefail

echo "=== ResultApp Droplet Bootstrap (API + Postgres only) ==="

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (sudo ./bootstrap.sh)"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "[1/6] apt update & base deps"
apt update && apt upgrade -y
# NOTE: no php* packages. They were only ever needed to run the abandoned
# RosarioSIS tenant apps and are deliberately absent.
apt install -y python3 python3-venv python3-pip postgresql postgresql-contrib \
  nginx certbot git ufw

echo "[2/6] Create system paths"
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
mkdir -p /var/www/certbot-webroot/.well-known/acme-challenge
# /var/www/vhosts is intentionally NOT created — no tenant is ever hosted here.

echo "[3/6] PostgreSQL — set superuser password (you will be prompted if not set)"
if [[ -n "${PG_SUPERUSER_PASSWORD:-}" ]]; then
  sudo -u postgres psql -c "ALTER USER postgres PASSWORD '$PG_SUPERUSER_PASSWORD';"
else
  echo "Set postgres password manually:"
  echo "  sudo -u postgres psql -c \"ALTER USER postgres PASSWORD 'your-strong-pw';\""
fi
systemctl enable --now postgresql

echo "[4/6] Nginx"
systemctl enable --now nginx

echo "[5/6] Python venv & deps"
BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [[ ! -d "$BACKEND_DIR" ]]; then BACKEND_DIR="$(pwd)"; fi
cd "$BACKEND_DIR"
if [[ ! -d ".venv" ]]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
echo "Python deps installed in $BACKEND_DIR/.venv"

echo "[6/6] .env"
if [[ ! -f ".env" ]]; then
  cp .env.example .env
  echo "Created .env from .env.example — EDIT IT NOW: nano $BACKEND_DIR/.env"
else
  echo ".env already exists — skipping"
fi

cat > /etc/systemd/system/resultapp-provision.service <<'UNIT'
[Unit]
Description=ResultApp Provisioning Service (FastAPI)
After=network.target postgresql.service nginx.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/resultapp.org/backend
Environment=PATH=/opt/resultapp.org/backend/.venv/bin
ExecStart=/opt/resultapp.org/backend/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload

echo ""
echo "=== Bootstrap done ==="
echo "Next: nano $BACKEND_DIR/.env  (set API_SECRET_KEY, PG_SUPERUSER_PASSWORD, BREVO_API_KEY)"
echo "Then: systemctl enable --now resultapp-provision"
echo "Check: systemctl status resultapp-provision && journalctl -u resultapp-provision -f"
echo ""
echo "DNS on the Cloudflare side:"
echo "  resultapp.org, www.resultapp.org, *.resultapp.org -> CNAME cname.vercel-dns.com (proxied)"
echo "  api.resultapp.org                             -> A <this-droplet-ip> (proxied)"
echo "Tenant portals are served by the Next.js app on Vercel — nothing to host here."