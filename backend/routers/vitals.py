"""
Platform Vitals — live server telemetry for the superadmin Command Center.

Prefix: /api/v1/admin/vitals

Protected by the same system-to-system X-API-SECRET-KEY gate as the other
admin routers. The browser never talks to this endpoint directly: the Next.js
proxy at app/api/admin/vitals/route.ts first verifies the signed superadmin
session cookie, then calls here with the shared secret injected server-side.

Metrics (the six agreed for Phase 4):
  1. OS name + version      (from /etc/os-release)
  2. Kernel version         (uname -r equivalent)
  3. Disk space             (total / used / free for the deployment mount)
  4. Memory usage           (total / used / available from /proc/meminfo)
  5. PostgreSQL connections (backends, current total, and by-state breakdown)
  6. System uptime          (from /proc/uptime)

Implementation notes:
  - Deliberately reads /proc directly instead of adding psutil. The target is a
    fixed Ubuntu host, and adding a native dependency to a deploy that runs
    `pip install` on every update is a worse trade than ~40 lines of parsing.
  - Every collector is independently guarded. A single unreadable metric
    degrades that field to null with an `error` note; it never fails the
    whole response. Telemetry must not be able to take the API down.
"""

import os
import platform
import shutil
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel

import logging

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Shared-secret gate (mirrors routers/admin.py so behaviour is identical).
# ---------------------------------------------------------------------------


async def _verify_superadmin_secret(
    x_api_secret_key: Optional[str] = Header(None, alias="X-API-SECRET-KEY"),
):
    try:
        from main import verify_api_secret

        return await verify_api_secret(x_api_secret_key)
    except Exception:
        import hmac

        API_SECRET = os.getenv("API_SECRET_KEY", "")
        ENV = os.getenv("ENV", "production")
        if not API_SECRET:
            if ENV != "production":
                logger.warning("API_SECRET_KEY missing but ENV!=production — allowing (dev mode)")
                return True
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Server misconfigured: API_SECRET_KEY not set",
            )
        if not x_api_secret_key:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing X-API-SECRET-KEY header")
        if not hmac.compare_digest(x_api_secret_key, API_SECRET):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid API secret")
        return True


router = APIRouter(
    prefix="/api/v1/admin/vitals",
    tags=["admin", "vitals"],
    dependencies=[Depends(_verify_superadmin_secret)],
)


class VitalsResponse(BaseModel):
    """Everything the dashboard renders. Fields may be null if a collector failed."""

    os_name: Optional[str] = None
    os_version: Optional[str] = None
    kernel: Optional[str] = None
    disk_total_bytes: Optional[int] = None
    disk_used_bytes: Optional[int] = None
    disk_free_bytes: Optional[int] = None
    disk_percent_used: Optional[float] = None
    mem_total_bytes: Optional[int] = None
    mem_available_bytes: Optional[int] = None
    mem_used_bytes: Optional[int] = None
    mem_percent_used: Optional[float] = None
    pg_connections: Optional[int] = None
    pg_max_connections: Optional[int] = None
    pg_connections_percent: Optional[float] = None
    pg_by_state: Dict[str, int] = {}
    uptime_seconds: Optional[float] = None
    hostname: Optional[str] = None
    collected_at: str = ""
    warnings: List[str] = []


# ---------------------------------------------------------------------------
# Collectors
# ---------------------------------------------------------------------------


def _collect_os() -> Dict[str, Optional[str]]:
    """OS pretty name + version from /etc/os-release (Ubuntu target)."""
    out: Dict[str, Optional[str]] = {"name": None, "version": None}
    try:
        fields: Dict[str, str] = {}
        with open("/etc/os-release", "r", encoding="utf-8") as fh:
            for line in fh:
                if "=" not in line:
                    continue
                key, _, val = line.strip().partition("=")
                fields[key.strip()] = val.strip().strip('"').strip("'")
        out["name"] = fields.get("PRETTY_NAME") or fields.get("NAME")
        out["version"] = fields.get("VERSION_ID") or fields.get("VERSION")
    except Exception as e:
        logger.warning(f"[vitals] os-release unreadable: {e}")
        # Fall back to platform so the card is never blank on non-/etc systems.
        out["name"] = platform.system() or None
        out["version"] = platform.release()
    return out


def _collect_kernel() -> Optional[str]:
    try:
        return platform.release() or platform.version()
    except Exception as e:
        logger.warning(f"[vitals] kernel unavailable: {e}")
        return None


def _collect_disk() -> Dict[str, Optional[float]]:
    """Disk usage for the filesystem holding the working directory (the deploy)."""
    out: Dict[str, Optional[float]] = {
        "total": None,
        "used": None,
        "free": None,
        "percent": None,
    }
    try:
        usage = shutil.disk_usage(os.getcwd())
        total = float(usage.total)
        used = float(usage.used)
        free = float(usage.free)
        out["total"] = int(total)
        out["used"] = int(used)
        out["free"] = int(free)
        out["percent"] = round((used / total) * 100, 1) if total > 0 else None
    except Exception as e:
        logger.warning(f"[vitals] disk usage unavailable: {e}")
    return out


def _collect_memory() -> Dict[str, Optional[float]]:
    """Memory from /proc/meminfo.

    `available` is preferred over free+buffers+cache because it accounts for
    reclaimable slab, which is what actually matters when deciding if the box
    is under pressure.
    """
    out: Dict[str, Optional[float]] = {
        "total": None,
        "available": None,
        "used": None,
        "percent": None,
    }
    try:
        info: Dict[str, int] = {}
        with open("/proc/meminfo", "r", encoding="utf-8") as fh:
            for line in fh:
                key, _, rest = line.partition(":")
                parts = rest.strip().split()
                if parts and parts[0].isdigit():
                    # Values in /proc/meminfo are reported in kB.
                    info[key.strip()] = int(parts[0]) * 1024
        total = info.get("MemTotal")
        available = info.get("MemAvailable", info.get("MemFree"))
        if total:
            used = total - (available or 0)
            out["total"] = int(total)
            out["available"] = int(available) if available is not None else None
            out["used"] = int(used)
            out["percent"] = round((used / total) * 100, 1)
    except Exception as e:
        logger.warning(f"[vitals] meminfo unreadable: {e}")
    return out


def _collect_pg() -> Dict[str, Any]:
    """Live connection counts from the platform registry DB.

    Uses the same superuser connection as the rest of db_manager. Two queries:
    the actual client backends (what we care about operationally) and the
    configured ceiling, so the dashboard can show headroom.
    """
    out: Dict[str, Any] = {
        "connections": None,
        "max_connections": None,
        "percent": None,
        "by_state": {},
    }
    try:
        from services.db_manager import _connect_as_superuser

        conn = None
        try:
            conn = _connect_as_superuser()
            cur = conn.cursor()
            cur.execute(
                "SELECT state, COUNT(*) FROM pg_stat_activity "
                "WHERE backend_type = 'client backend' GROUP BY state;"
            )
            by_state: Dict[str, int] = {}
            total = 0
            for row in cur.fetchall():
                state = str(row[0] or "unknown")
                count = int(row[1] or 0)
                by_state[state] = count
                total += count
            out["by_state"] = by_state
            out["connections"] = total

            cur.execute("SHOW max_connections;")
            row = cur.fetchone()
            if row:
                max_conn = int(row[0])
                out["max_connections"] = max_conn
                if max_conn > 0:
                    out["percent"] = round((total / max_conn) * 100, 1)
        finally:
            if conn:
                conn.close()
    except Exception as e:
        logger.warning(f"[vitals] postgres stats unavailable: {e}")
    return out


#: Captured at import so the non-/proc uptime fallback reports real elapsed
#: wall-clock time. (Subtracting process_time from time.time() would mix the
#: epoch with CPU time and yield a nonsense multi-decade value.)
_PROCESS_START_WALL = time.time()


def _collect_uptime() -> Optional[float]:
    try:
        with open("/proc/uptime", "r", encoding="utf-8") as fh:
            return round(float(fh.read().split()[0]), 1)
    except Exception:
        # Non-Linux (or unreadable /proc): report how long this process has run.
        return round(max(0.0, time.time() - _PROCESS_START_WALL), 1)


def _collect_hostname() -> Optional[str]:
    try:
        import socket

        return socket.gethostname()
    except Exception as e:
        logger.warning(f"[vitals] hostname unavailable: {e}")
        return None


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.get("", response_model=VitalsResponse, summary="Live platform/server vitals (superadmin)")
@router.get("/", response_model=VitalsResponse, include_in_schema=False)
def get_vitals() -> VitalsResponse:
    """Return the six server metrics in a single round trip.

    Each collector is isolated — a failure yields a null field plus a warning
    entry rather than a 500, so a partial failure still leaves a usable
    dashboard.
    """
    warnings: List[str] = []

    os_info = _collect_os()
    if not os_info.get("name"):
        warnings.append("OS details unavailable")
    disk = _collect_disk()
    if disk["total"] is None:
        warnings.append("Disk usage unavailable")
    mem = _collect_memory()
    if mem["total"] is None:
        warnings.append("Memory usage unavailable")
    pg = _collect_pg()
    if pg["connections"] is None:
        warnings.append("PostgreSQL connection stats unavailable")
    uptime = _collect_uptime()
    if uptime is None:
        warnings.append("Uptime unavailable")
    kernel = _collect_kernel()
    if not kernel:
        warnings.append("Kernel version unavailable")

    # Booted-at is derived client-side from uptime, but exposing the raw
    # uptime here keeps the arithmetic in one place.
    return VitalsResponse(
        os_name=os_info.get("name"),
        os_version=os_info.get("version"),
        kernel=kernel,
        disk_total_bytes=int(disk["total"]) if disk["total"] is not None else None,
        disk_used_bytes=int(disk["used"]) if disk["used"] is not None else None,
        disk_free_bytes=int(disk["free"]) if disk["free"] is not None else None,
        disk_percent_used=disk["percent"],
        mem_total_bytes=int(mem["total"]) if mem["total"] is not None else None,
        mem_available_bytes=int(mem["available"]) if mem["available"] is not None else None,
        mem_used_bytes=int(mem["used"]) if mem["used"] is not None else None,
        mem_percent_used=mem["percent"],
        pg_connections=pg["connections"],
        pg_max_connections=pg["max_connections"],
        pg_connections_percent=pg["percent"],
        pg_by_state=pg["by_state"],
        uptime_seconds=uptime,
        hostname=_collect_hostname(),
        collected_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        warnings=warnings,
    )
