#!/usr/bin/env bash
# ResultApp Droplet Bootstrap — run as root on fresh Ubuntu 22.04
set -euo pipefail

echo "=== ResultApp Droplet Bootstrap ==="

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root (sudo ./bootstrap.sh)"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "[1/7] apt update & base deps"
apt update && apt upgrade -y
apt install -y python3 python3-venv python3-pip postgresql postgresql-contrib nginx \
  php8.2 php8.2-fpm php8.2-pgsql php8.2-mbstring php8.2-xml php8.2-curl php8.2-zip php8.2-gd \
  certbot python3-certbot-nginx git ufw

echo "[2/7] Create system paths"
mkdir -p /opt/rosariosis-template
mkdir -p /var/www/vhosts
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
chown -R www-data:www-data /var/www/vhosts || true
chmod 755 /var/www/vhosts

echo "[3/7] PostgreSQL — set superuser password (you will be prompted if not set)"
# If PG_SUPERUSER_PASSWORD already exported, use it
if [[ -n "${PG_SUPERUSER_PASSWORD:-}" ]]; then
  sudo -u postgres psql -c "ALTER USER postgres PASSWORD '$PG_SUPERUSER_PASSWORD';"
else
  echo "Set postgres password manually:"
  echo "  sudo -u postgres psql -c \"ALTER USER postgres PASSWORD 'your-strong-pw';\""
fi
systemctl enable --now postgresql

echo "[4/7] PHP-FPM & Nginx"
systemctl enable --now php8.2-fpm
systemctl enable --now nginx
# Ensure php sock exists
ls -l /var/run/php/php8.2-fpm.sock || echo "php-fpm sock not found yet — check php8.2-fpm status"

echo "[5/7] Python venv & deps"
# Assume repo cloned to /opt/resultapp.org or current dir
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

echo "[6/7] .env"
if [[ ! -f ".env" ]]; then
  cp .env.example .env
  echo "Created .env from .env.example — EDIT IT NOW: nano $BACKEND_DIR/.env"
else
  echo ".env already exists — skipping"
fi

echo "[7/7] systemd service"
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

# Adjust WorkingDirectory if your clone path differs
# Update path if you cloned elsewhere

systemctl daemon-reload
echo "Enable with: systemctl enable --now resultapp-provision"
echo "Check: systemctl status resultapp-provision && journalctl -u resultapp-provision -f"

echo ""
echo "=== Bootstrap done ==="
echo "Next: nano $BACKEND_DIR/.env  (set API_SECRET_KEY, PG_SUPERUSER_PASSWORD, BREVO_API_KEY)"
echo "Then: systemctl enable --now resultapp-provision"
echo "And:  Add DNS wildcard *.resultapp.org -> $(curl -s ifconfig.me || echo '<droplet-ip>')"
