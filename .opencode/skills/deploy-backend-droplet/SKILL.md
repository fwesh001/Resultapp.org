---
name: deploy-backend-droplet
description: Use when connecting to, inspecting, deploying to, or verifying the ResultApp FastAPI backend droplet (resultapp-droplet, 159.223.178.34), or checking the Vercel frontend deploy. Triggers on "deploy", "droplet", "ssh resultapp-droplet", "update the backend", "backend is down", "check production", "/api/version", "resultapp-provision".
---

# Backend Droplet Operations

The FastAPI backend runs on a DigitalOcean droplet. The Next.js frontend is
separate and runs on Vercel. They deploy from the same git repo but are
independent — a push ships the backend only after `update.sh` runs on the
droplet.

## Topology

| Thing | Value |
|---|---|
| SSH alias | `resultapp-droplet` (defined in `~/.ssh/config`) |
| Hostname | `159.223.178.34`, user `root`, key `~/.ssh/id_njpst` |
| App checkout | `/var/www/resultapp-backend` |
| Service | `resultapp-provision.service` (uvicorn `main:app` on `:8000`) |
| Python | `./venv/bin/python` — **not** the system `python3` |
| Env file | `./.env` (mode 600, never print its contents) |
| Health | `curl -s http://127.0.0.1:8000/api/version` |
| DB | PostgreSQL 16, local, reached via `_connect_as_superuser()` |
| Vercel scope | `zabdiels-projects-64fe2e61`, project `resultapp-org` |

**Always use the `resultapp-droplet` alias.** Do not pass the raw IP — the
alias carries the identity file and `IdentitiesOnly yes`, and hardcoding the IP
invites a password prompt that will hang the shell.

## Two traps that will bite you

### 1. PowerShell mangles remote commands

The shell is Windows PowerShell. It strips quotes out of `ssh host '...'` and
`curl -w "..."`, so pipes, `&&`, globs and `%{http_code}` break in confusing
ways ("command not found" for words that were inside your quotes).

- **Multi-line or quote-heavy remote work: write a script locally, `scp` it,
  then run it.** This is the reliable path and what to reach for by default.
  ```powershell
  Get-Content "$env:TEMP\probe.sh" -Raw | ssh resultapp-droplet 'bash -s'
  scp probe.sh resultapp-droplet:/tmp/probe.sh; ssh resultapp-droplet 'bash /tmp/probe.sh'
  ```
- **For pipes on the remote side, avoid quoted alternation patterns.** Use
  `journalctl -p err` / `-p warning` instead of `grep -Ei "error|traceback"`.
- **For local npm/node commands, use `cmd /c "..."`** — see the
  `terminal-commands` skill. Plain `npm ... | Select-Object` fails with
  "Cannot run a document in the middle of a pipeline".

### 2. The system `python3` has no `psycopg2`

Only `./venv/bin/python` can import `services.db_manager`. A script run with
bare `python3` fails on `import psycopg2`, which in a shell pipeline often
produces an **empty result rather than an obvious error** — a failed DB lookup
then looks like "no such row", and a subsequent API call 404s on an empty UUID.

This is how a real staff account was once left on a throwaway test password:
the restore step silently no-op'd and nobody noticed for several minutes.

**Rule: any remote script that touches the DB must pin `./venv/bin/python`, and
any script that MUTATES production state must verify the restore actually
happened before you report success.**

## Deploying

Always `bash ./update.sh` from the checkout. Never hand-roll `git pull` +
`systemctl restart` — the script does the things that make a deploy safe:

1. pull-safety check (aborts only on genuinely conflicting dirty files)
2. `git pull --stat`
3. pip install
4. **byte-compiles the backend before touching the live process**
5. kill-before-start restart (no `EADDRINUSE` roulette)
6. **proves** `/api/version` reports the freshly pulled commit — exits 1 on mismatch
7. prints the verified commit

```powershell
ssh resultapp-droplet 'cd /var/www/resultapp-backend && bash ./update.sh'
```

Env overrides: `DEPLOY_UNIT`, `DEPLOY_PORT`, `SKIP_DEPS=1`, `GIT_BRANCH`.

## Before deploying a change that alters the schema

Migrations run in the FastAPI **lifespan** (`init_roster_registry()` in
`backend/main.py`), which means the restart applies them automatically.

The trap: each `init_*` call is wrapped in a `try/except` that only **logs a
warning**. A failed migration therefore starts a healthy-looking server whose
queries then 500 on the missing column. After any schema-changing deploy,
confirm the warning did not fire:

```powershell
ssh resultapp-droplet 'journalctl -u resultapp-provision -p warning --since -40min --no-pager | tail -20'
```

Check row counts and PG version first. On PG 11+ `ADD COLUMN` with a default is
metadata-only, so it is cheap regardless of table size.

## Verifying a deploy

```powershell
# serving commit matches the checkout
ssh resultapp-droplet 'curl -s http://127.0.0.1:8000/api/version'

# nothing broke
ssh resultapp-droplet 'journalctl -u resultapp-provision -p err --since -40min --no-pager | tail -20'
ssh resultapp-droplet 'systemctl is-active resultapp-provision'
```

`/api/version` returning `status:ok` is necessary but not sufficient — it
reports the commit, not that your endpoint works. Exercise the endpoint you
changed with `curl` against `127.0.0.1:8000`.

## Reading the database

```powershell
Get-Content probe.py -Raw | ssh resultapp-droplet 'cd /var/www/resultapp-backend && set -a && . ./.env && set +a && ./venv/bin/python -'
```

The `set -a && . ./.env` prefix is required — the systemd unit loads those
vars, a bare `python` invocation does not, and you get
`PG_SUPERUSER_PASSWORD is empty`.

Keep probes read-only (`information_schema`, `SELECT`). Never `cat .env`.

## Vercel (frontend)

The CLI is **already authenticated** at
`%APPDATA%\com.vercel.cli\Data\auth.json` — no token in env, nothing to rotate.

```powershell
cmd /c "vercel whoami"
cmd /c "vercel --scope zabdiels-projects-64fe2e61 list resultapp-org"
cmd /c "vercel --scope zabdiels-projects-64fe2e61 inspect <deployment-url>"
```

**Always pass `--scope zabdiels-projects-64fe2e61`.** The vercel MCP tools are
wired to a *different* team (`team_1raAX6wKJJoPoKAnm4fnXCgL`) and return
`403 forbidden` for this project — fall back to the CLI, which uses the local
auth. Deployments auto-build on push to `main`; confirm the one you want with
`gitSource.sha` rather than trusting the "20m ago" column, whose timezone is
not the same as the droplet's.

## Reporting

State the serving commit you verified, the checks you ran, and anything you
could not test. If a probe mutated production, say which account it touched and
confirm the restore — do not report success on the strength of a 200 alone.
