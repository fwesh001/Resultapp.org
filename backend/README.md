# ResultApp Droplet — Provisioning Service

Automated FastAPI service that runs on a **DigitalOcean Ubuntu Droplet** (Ubuntu 22.04+) to provision **isolated RosarioSIS instances** per school after Flutterwave payment.

```
Next.js (Vercel) --X-API-SECRET-KEY--> FastAPI Droplet (8000) --> PostgreSQL + RosarioSIS + Nginx + Brevo
```

Each paid school gets:
- Dedicated PostgreSQL database + user (e.g. `vhs_db` / `vhs_user`)
- Dedicated filesystem at `/var/www/vhosts/vhs.resultapp.org/` (clone of RosarioSIS template)
- Dedicated Nginx server block `vhs.resultapp.org` with PHP-FPM
- Welcome email via Brevo with temp credentials + login URL `https://vhs.resultapp.org`

---

## Project Structure

```
backend/
├── main.py                 # FastAPI entrypoint — POST /api/v1/provision + header verification + rollback
├── services/
│   ├── __init__.py
│   ├── db_manager.py       # PostgreSQL automation (CREATE DATABASE/USER, rollback)
│   ├── site_generator.py   # RosarioSIS clone, config.inc.php templating, Nginx generation
│   └── notifier.py         # Brevo API welcome email
├── requirements.txt
├── .env.example
├── README.md               # this file
└── scripts/
    ├── bootstrap.sh        # One-time droplet setup (postgres, php, nginx, template)
    └── resultapp-provision.service  # systemd unit
```

---

## 1) Droplet Bootstrap (run once as root on fresh Ubuntu)

```bash
# On Droplet as root
apt update && apt upgrade -y
apt install -y python3 python3-venv python3-pip postgresql postgresql-contrib nginx php8.2 php8.2-fpm php8.2-pgsql php8.2-mbstring php8.2-xml php8.2-curl php8.2-zip certbot python3-certbot-nginx git

# Create deploy user (optional)
# adduser deploy

# Clone repo
git clone https://github.com/your-org/resultapp.org.git /opt/resultapp.org
cd /opt/resultapp.org/backend

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Prepare filesystem
mkdir -p /opt/rosariosis-template   # <-- put clean RosarioSIS here
# e.g. wget https://www.rosariosis.org/...zip && unzip to /opt/rosariosis-template
chown -R www-data:www-data /opt/rosariosis-template
chmod -R 755 /opt/rosariosis-template

mkdir -p /var/www/vhosts
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled

# PostgreSQL superuser setup
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'super-strong-pw';"
# then fill .env (see .env.example)
cp .env.example .env
nano .env  # set API_SECRET_KEY, PG_SUPERUSER_PASSWORD, BREVO_API_KEY, etc.

# Test health
python -c "from services.db_manager import test_connection; print(test_connection())"

# Systemd
cp scripts/resultapp-provision.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now resultapp-provision
systemctl status resultapp-provision

# Nginx reverse proxy for the API itself (optional but recommended)
# see scripts/nginx-api-proxy.conf

# DNS wildcard: in DigitalOcean Networking → resultapp.org → add A record *.resultapp.org → Droplet IP
# Then certbot wildcard (requires DNS challenge) or per-subdomain certbot after each provision if AUTO_SSL=true
```

---

## 2) Environment (.env)

See `.env.example`. Critical:

```
API_SECRET_KEY=long_random_32+  # same as NEXTJS env X_API_SECRET_KEY
PG_SUPERUSER_PASSWORD=...
ROSARIOSIS_TEMPLATE_DIR=/opt/rosariosis-template
VHOST_BASE_DIR=/var/www/vhosts
BREVO_API_KEY=xkeysib-...
```

Generate secret: `openssl rand -hex 32`

---

## 3) Run

```bash
# dev
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# prod (systemd)
systemctl restart resultapp-provision
journalctl -u resultapp-provision -f

# health
curl http://localhost:8000/health
curl http://localhost:8000/
```

---

## 4) API

### `POST /api/v1/provision`
**Header:** `X-API-SECRET-KEY: <API_SECRET_KEY>`

**Body:**
```json
{
  "school_name": "Victory High School",
  "subdomain": "vhs",
  "admin_email": "admin@victoryhigh.edu.ng",
  "admin_name": "Mrs. Adaeze Okafor",
  "phone_number": "+2348012345678",
  "student_count": 150
}
```

**Success 200:**
```json
{
  "success": true,
  "message": "Successfully provisioned vhs.resultapp.org for Victory High School",
  "deployed_url": "https://vhs.resultapp.org",
  "domain": "vhs.resultapp.org",
  "subdomain": "vhs",
  "student_count": 150,
  "total_amount_ngn": 15000,
  "timestamp": "2026-09-15T12:00:00+00:00",
  "provisioning_ms": 3421,
  "database": {"db_name":"vhs_db","db_user":"vhs_user","db_host":"localhost","db_port":"5432"}
}
```

**Error 401/403:** invalid/missing secret  
**409:** subdomain already provisioned  
**500:** detailed `detail` + server logs; if DB succeeded but Nginx failed, DB is rolled back (no orphan).

**cURL example:**
```bash
curl -X POST http://droplet-ip:8000/api/v1/provision \
  -H "Content-Type: application/json" \
  -H "X-API-SECRET-KEY: $API_SECRET_KEY" \
  -d '{"school_name":"Victory High School","subdomain":"vhs","admin_email":"admin@victoryhigh.edu.ng","student_count":150}'
```

### Async variant
`POST /api/v1/provision/async` — queues BackgroundTasks, returns `202 queued`, poll `GET /api/v1/provision/status/{subdomain}` or provide `callback_url`.

---

## 5) Next.js Integration (Flutterwave flow)

`lib/flutterwave.ts` already validates payment on Next.js. After `FlutterwaveCheckout` callback confirms `transaction_id`, Next.js should **server-side** call the Droplet:

```ts
// app/api/provision/route.ts (Next.js, runs server-side so secret not exposed)
const res = await fetch(`${process.env.PROVISION_API_URL}/api/v1/provision`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-SECRET-KEY': process.env.PROVISION_API_SECRET!,
  },
  body: JSON.stringify({ school_name, subdomain, admin_email, student_count }),
});
// Handle 409 (already exists), 401 (secret misconfigured), etc.
```

**Do NOT call Droplet directly from the browser** — secret would leak. Always proxy via Next.js API route.

---

## 6) Rollback & Logging

Every step is `try/except` with dedicated rollback:

- If `deploy_site` throws (copy fails, nginx `nginx -t` fails), `rollback_site` is called (removes symlink, conf, directory, reloads nginx).
- If `deploy_site` succeeds but earlier `create_school_database` succeeded, failure in `deploy_site` triggers `rollback_database` (DROP DATABASE + DROP USER).
- Email failures are **non-fatal** (logged, provision still considered success).
- All handlers log to `logs/provisioning.log` + stdout (journalctl).

Check logs:
```bash
tail -f logs/provisioning.log
journalctl -u resultapp-provision -f -o cat
cat /var/log/nginx/vhs.resultapp.org.error.log
```

**Manual rollback (if needed):**
```bash
# As root
rm /etc/nginx/sites-enabled/vhs.resultapp.org
rm /etc/nginx/sites-available/vhs.resultapp.org
nginx -t && systemctl reload nginx
rm -rf /var/www/vhosts/vhs.resultapp.org
sudo -u postgres psql -c "DROP DATABASE IF EXISTS vhs_db;"
sudo -u postgres psql -c "DROP USER IF EXISTS vhs_user;"
```

---

## 7) Nginx & SSL

- Each provision creates `/etc/nginx/sites-available/<domain>` from `NGINX_TEMPLATE` in `site_generator.py`.
- `client_max_body_size 20M`, `php8.2-fpm` via `unix:/var/run/php/php8.2-fpm.sock`
- For SSL, set `AUTO_SSL=true` in `.env` and install certbot; after `deploy_site` succeeds, run:
  `certbot --nginx -d vhs.resultapp.org --non-interactive --agree-tos -m admin@resultapp.org`
  Or use wildcard: DigitalOcean DNS plugin `certbot certonly --dns-digitalocean`

---

## 8) Security Hardening

- Header `X-API-SECRET-KEY` uses `hmac.compare_digest`
- Subdomain regex `^[a-z0-9-]{3,30}$`, reserved list, length <63 for PG identifiers, hyphen→underscore conversion
- DB passwords `secrets.token` 24 chars with upper/lower/digit
- `config.inc.php` written `640` + `www-data:www-data`
- Never return `db_password` in API response (only emailed)
- CORS allowlist via `CORS_ORIGINS`

---

## 9) Testing locally (without root/PostgreSQL/Nginx)

Set in `.env` for Windows dev:

```
PG_HOST=localhost
PG_SUPERUSER_PASSWORD=postgres
ROSARIOSIS_TEMPLATE_DIR=C:\tmp\rosariosis-template
VHOST_BASE_DIR=C:\tmp\vhosts
NGINX_SITES_AVAILABLE=C:\tmp\nginx\available
NGINX_SITES_ENABLED=C:\tmp\nginx\enabled
NGINX_TEST_CMD=echo nginx -t mock
NGINX_RELOAD_CMD=echo reload mock
BREVO_API_KEY=
ENV=development
API_SECRET_KEY=dev-secret-123
```

Then:
```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
curl -H "X-API-SECRET-KEY: dev-secret-123" -H "Content-Type: application/json" -d "{\"school_name\":\"Test\",\"subdomain\":\"test123\",\"admin_email\":\"test@test.com\",\"student_count\":10}" http://localhost:8000/api/v1/provision
```

In dev, Brevo key missing → email is logged only (no external call), Nginx commands mocked → you can verify filesystem side effects in `C:\tmp`.
