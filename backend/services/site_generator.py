"""
Site generator for ResultApp Droplet.
- Copies RosarioSIS template to /var/www/vhosts/<subdomain>.resultapp.org
- Writes DB credentials into config.inc.php
- Generates Nginx server block, enables via symlink, tests and reloads
"""

import logging
import os
import shutil
import subprocess
import secrets
import string
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config from env
# ---------------------------------------------------------------------------

def _cfg(key: str, default: str) -> str:
    return os.getenv(key, default)

def _vhost_base() -> Path:
    return Path(_cfg("VHOST_BASE_DIR", "/var/www/vhosts"))

def _template_dir() -> Path:
    return Path(_cfg("ROSARIOSIS_TEMPLATE_DIR", "/opt/rosariosis-template"))

def _nginx_available() -> Path:
    return Path(_cfg("NGINX_SITES_AVAILABLE", "/etc/nginx/sites-available"))

def _nginx_enabled() -> Path:
    return Path(_cfg("NGINX_SITES_ENABLED", "/etc/nginx/sites-enabled"))

def _base_domain() -> str:
    return _cfg("BASE_DOMAIN", "resultapp.org")

def _config_rel_path() -> str:
    return _cfg("ROSARIOSIS_CONFIG_PATH", "config.inc.php")

# ---------------------------------------------------------------------------
# Domain & path helpers
# ---------------------------------------------------------------------------

def get_domain(subdomain: str) -> str:
    return f"{subdomain.lower().strip()}.{_base_domain()}"

def get_site_path(subdomain: str) -> Path:
    return _vhost_base() / get_domain(subdomain)

def get_nginx_conf_path(subdomain: str) -> Path:
    return _nginx_available() / get_domain(subdomain)

def get_nginx_enabled_path(subdomain: str) -> Path:
    return _nginx_enabled() / get_domain(subdomain)

# ---------------------------------------------------------------------------
# Template helpers
# ---------------------------------------------------------------------------

NGINX_TEMPLATE = """# ResultApp — auto-generated for {domain}
# Managed by provisioning service. Do not edit manually.
server {{
    listen 80;
    listen [::]:80;
    server_name {domain};

    root {site_path};
    index index.php index.html index.htm;

    access_log /var/log/nginx/{domain}.access.log;
    error_log /var/log/nginx/{domain}.error.log;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {{
        try_files $uri $uri/ /index.php?$args;
    }}

    location ~ \\.php$ {{
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php8.2-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
    }}

    location ~ /\\.ht {{
        deny all;
    }}

    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg)$ {{
        expires 1y;
        add_header Cache-Control "public, immutable";
    }}

    client_max_body_size 20M;
}}
"""

# RosarioSIS config template — covers typical keys
# If template already has config.inc.php with placeholders, we do string replacement
# Otherwise we generate a minimal one.
ROSARIOSIS_CONFIG_TEMPLATE = """<?php
// ResultApp — auto-generated config for {school_name} ({domain})
// Generated: {generated_at}
$DatabaseType = 'postgresql';
$DatabaseServer = '{db_host}';
$DatabasePort = '{db_port}';
$DatabaseUsername = '{db_user}';
$DatabasePassword = '{db_password}';
$DatabaseName = '{db_name}';
$DatabasePrefix = '';

// RosarioSIS specific
$DefaultSyear = date('Y');
$RosarioNotifyAddress = '{admin_email}';
?>
"""

# ---------------------------------------------------------------------------
# Core operations
# ---------------------------------------------------------------------------

def _ensure_no_existing_site(subdomain: str) -> None:
    site_path = get_site_path(subdomain)
    nginx_conf = get_nginx_conf_path(subdomain)
    if site_path.exists():
        raise RuntimeError(f"Site directory already exists: {site_path}")
    if nginx_conf.exists():
        raise RuntimeError(f"Nginx config already exists: {nginx_conf}")
    if get_nginx_enabled_path(subdomain).exists() or get_nginx_enabled_path(subdomain).is_symlink():
        raise RuntimeError(f"Nginx enabled symlink already exists for {get_domain(subdomain)}")

def _copy_template(subdomain: str) -> Path:
    src = _template_dir()
    dst = get_site_path(subdomain)
    if not src.exists():
        raise RuntimeError(f"RosarioSIS template not found at {src} — run bootstrap script on droplet first")
    if not src.is_dir():
        raise RuntimeError(f"Template path is not a directory: {src}")

    logger.info(f"[FS] Copying template {src} -> {dst}")
    try:
        # Use copytree with symlinks preserved
        shutil.copytree(src, dst, symlinks=True, dirs_exist_ok=False)
    except Exception as e:
        raise RuntimeError(f"Failed to copy template: {e}") from e

    # Set ownership if running as root (best effort)
    try:
        owner = _cfg("VHOST_OWNER", "www-data")
        group = _cfg("VHOST_GROUP", "www-data")
        subprocess.run(["chown", "-R", f"{owner}:{group}", str(dst)], check=False, capture_output=True)
        subprocess.run(["chmod", "-R", "755", str(dst)], check=False, capture_output=True)
    except Exception as chown_e:
        logger.warning(f"[FS] chown failed (non-fatal): {chown_e}")

    return dst

def _write_rosariosis_config(subdomain: str, db_creds: Dict[str, str], school_name: str, admin_email: str) -> Path:
    site_path = get_site_path(subdomain)
    config_rel = _config_rel_path()
    config_path = site_path / config_rel
    domain = get_domain(subdomain)

    # If template already shipped a config.inc.php, try to patch it
    # Otherwise generate from template
    content: Optional[str] = None
    template_config_candidate = _template_dir() / config_rel
    if template_config_candidate.exists():
        try:
            original = template_config_candidate.read_text(encoding="utf-8", errors="ignore")
            # Replace common placeholders if present, else fallback to full generation
            placeholders = {
                "{{DB_HOST}}": db_creds["db_host"],
                "{{DB_NAME}}": db_creds["db_name"],
                "{{DB_USER}}": db_creds["db_user"],
                "{{DB_PASSWORD}}": db_creds["db_password"],
                "{{DB_PORT}}": db_creds["db_port"],
                "{{ADMIN_EMAIL}}": admin_email,
            }
            content = original
            for k, v in placeholders.items():
                content = content.replace(k, v)
            # If file had no placeholders, we may need to inject DB lines via regex
            # Simple heuristic: if content still lacks db_name, append our template
            if db_creds["db_name"] not in content:
                logger.info("[FS] Template config has no placeholders — generating fresh config")
                content = None
        except Exception as e:
            logger.warning(f"[FS] Failed to patch existing config, will generate fresh: {e}")
            content = None

    if content is None:
        from datetime import datetime, timezone
        content = ROSARIOSIS_CONFIG_TEMPLATE.format(
            school_name=school_name.replace("'", "\\'"),
            domain=domain,
            db_host=db_creds["db_host"],
            db_port=db_creds["db_port"],
            db_user=db_creds["db_user"],
            db_password=db_creds["db_password"].replace("'", "\\'"),
            db_name=db_creds["db_name"],
            admin_email=admin_email,
            generated_at=datetime.now(timezone.utc).isoformat(),
        )

    # Ensure parent dir exists
    config_path.parent.mkdir(parents=True, exist_ok=True)

    # Write with restrictive perms (640) — contains password
    config_path.write_text(content, encoding="utf-8")
    try:
        subprocess.run(["chmod", "640", str(config_path)], check=False, capture_output=True)
        owner = _cfg("VHOST_OWNER", "www-data")
        group = _cfg("VHOST_GROUP", "www-data")
        subprocess.run(["chown", f"{owner}:{group}", str(config_path)], check=False, capture_output=True)
    except Exception:
        pass

    logger.info(f"[FS] Wrote RosarioSIS config to {config_path}")
    return config_path

def _generate_nginx_config(subdomain: str) -> Path:
    domain = get_domain(subdomain)
    site_path = get_site_path(subdomain)
    conf_path = get_nginx_conf_path(subdomain)

    conf_content = NGINX_TEMPLATE.format(domain=domain, site_path=str(site_path))

    # Ensure nginx available exists
    conf_path.parent.mkdir(parents=True, exist_ok=True)
    conf_path.write_text(conf_content, encoding="utf-8")
    logger.info(f"[NGINX] Wrote server block {conf_path}")

    # Permissions 644
    try:
        subprocess.run(["chmod", "644", str(conf_path)], check=False, capture_output=True)
    except Exception:
        pass

    return conf_path

def _enable_site(subdomain: str) -> None:
    src = get_nginx_conf_path(subdomain)
    dst = get_nginx_enabled_path(subdomain)
    if dst.exists() or dst.is_symlink():
        raise RuntimeError(f"Enabled symlink already exists: {dst}")
    try:
        dst.symlink_to(src)
        logger.info(f"[NGINX] Enabled site {dst} -> {src}")
    except Exception as e:
        raise RuntimeError(f"Failed to enable site (symlink): {e}") from e

def _test_and_reload_nginx() -> None:
    test_cmd = _cfg("NGINX_TEST_CMD", "nginx -t")
    reload_cmd = _cfg("NGINX_RELOAD_CMD", "systemctl reload nginx")

    logger.info(f"[NGINX] Testing config: {test_cmd}")
    result = subprocess.run(test_cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        logger.error(f"[NGINX] nginx -t failed: {result.stderr or result.stdout}")
        raise RuntimeError(f"Nginx config test failed: {result.stderr or result.stdout}")

    logger.info(f"[NGINX] Reloading: {reload_cmd}")
    reload_result = subprocess.run(reload_cmd, shell=True, capture_output=True, text=True)
    if reload_result.returncode != 0:
        # Some droplet images use `nginx -s reload` instead of systemctl
        fallback = "nginx -s reload"
        logger.warning(f"[NGINX] {reload_cmd} failed ({reload_result.stderr}), trying fallback: {fallback}")
        fb = subprocess.run(fallback, shell=True, capture_output=True, text=True)
        if fb.returncode != 0:
            raise RuntimeError(f"Nginx reload failed: primary={reload_result.stderr} fallback={fb.stderr}")

    logger.info("[NGINX] Reload successful")

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def deploy_site(subdomain: str, db_creds: Dict[str, str], school_name: str, admin_email: str) -> Dict[str, str]:
    """
    Full pipeline: template copy → config write → nginx generate → enable → test+reload

    Returns {"domain": "...", "site_path": "...", "nginx_conf": "...", "url": "https://..."}
    Raises RuntimeError on any step (caller should rollback)
    """
    subdomain = subdomain.lower().strip()
    domain = get_domain(subdomain)
    url = f"https://{domain}"

    logger.info(f"[DEPLOY] Starting deployment for '{subdomain}' ({school_name}) -> {domain}")

    # Fail fast if exists
    _ensure_no_existing_site(subdomain)

    try:
        site_path = _copy_template(subdomain)
        _write_rosariosis_config(subdomain, db_creds, school_name, admin_email)
        nginx_conf = _generate_nginx_config(subdomain)
        _enable_site(subdomain)
        _test_and_reload_nginx()

        logger.info(f"[DEPLOY] Successfully deployed {domain} at {site_path}")
        return {
            "domain": domain,
            "url": url,
            "site_path": str(site_path),
            "nginx_conf": str(nginx_conf),
        }

    except Exception as e:
        logger.exception(f"[DEPLOY] Deployment failed for {domain}: {e}")
        # Attempt rollback of files created so far (but NOT DB — that is caller's responsibility)
        try:
            rollback_site(subdomain)
        except Exception as rb_e:
            logger.error(f"[DEPLOY] Rollback of site files also failed: {rb_e}")
        raise

def rollback_site(subdomain: str) -> None:
    """
    Remove all filesystem/nginx artifacts for a subdomain.
    Idempotent — safe to call even if partially provisioned.
    """
    domain = get_domain(subdomain)
    site_path = get_site_path(subdomain)
    nginx_conf = get_nginx_conf_path(subdomain)
    nginx_enabled = get_nginx_enabled_path(subdomain)

    logger.warning(f"[ROLLBACK] Cleaning up site for {domain}")

    # Remove symlink first
    try:
        if nginx_enabled.is_symlink() or nginx_enabled.exists():
            nginx_enabled.unlink()
            logger.info(f"[ROLLBACK] Removed symlink {nginx_enabled}")
    except Exception as e:
        logger.error(f"[ROLLBACK] Failed to remove symlink {nginx_enabled}: {e}")

    # Remove conf
    try:
        if nginx_conf.exists():
            nginx_conf.unlink()
            logger.info(f"[ROLLBACK] Removed conf {nginx_conf}")
    except Exception as e:
        logger.error(f"[ROLLBACK] Failed to remove conf {nginx_conf}: {e}")

    # Test & reload nginx after removal (best effort, don't fail rollback on this)
    try:
        if nginx_conf.parent.exists():
            # Only reload if we removed something
            _test_and_reload_nginx()
    except Exception as e:
        logger.warning(f"[ROLLBACK] Nginx reload after removal failed (non-fatal): {e}")

    # Remove site directory
    try:
        if site_path.exists():
            shutil.rmtree(site_path)
            logger.info(f"[ROLLBACK] Removed site directory {site_path}")
    except Exception as e:
        logger.error(f"[ROLLBACK] Failed to remove site dir {site_path}: {e}")

def site_exists(subdomain: str) -> bool:
    return get_site_path(subdomain).exists() or get_nginx_conf_path(subdomain).exists()

def generate_temp_credentials(admin_email: str) -> Dict[str, str]:
    """
    Generate temporary RosarioSIS login.
    In a real template you might create the admin user via DB seeding;
    here we generate credentials to email.
    """
    # Use admin_email as username, generate temp password
    alphabet = string.ascii_letters + string.digits
    # 12 chars, ensure complexity
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(12))
        if any(c.islower() for c in pwd) and any(c.isupper() for c in pwd) and any(c.isdigit() for c in pwd):
            break
    return {"username": admin_email, "password": pwd, "email": admin_email}
