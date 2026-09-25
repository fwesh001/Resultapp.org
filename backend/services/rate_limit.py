"""
In-process sliding-window throttle (stdlib only, no new dependencies).

Used by the superadmin ledger CSV export (M2 perf fix): at most 3 export
starts per 60s sliding window per key (caller IP + filter tuple).

Accepted limitation: buckets live per uvicorn worker process, so an
N-worker deployment allows up to N×3 starts/min in the pathological case.
Proportionate for a superadmin-only endpoint operated by one human; move to
a Redis-backed bucket if abuse is ever observed.
"""

import threading
import time
from collections import deque
from typing import Dict, Tuple

WINDOW_S = 60
MAX_STARTS = 3
MAX_KEYS = 1000

_buckets: Dict[str, deque] = {}
_lock = threading.Lock()


def check(key: str) -> Tuple[bool, int]:
    """Sliding-window admission check.

    Returns (allowed, retry_after_s): allowed=True with retry_after 0 on
    success; allowed=False with seconds until the oldest slot frees up.
    """
    now = time.monotonic()
    with _lock:
        q = _buckets.get(key)
        if q is None:
            q = _buckets[key] = deque()
        while q and q[0] <= now - WINDOW_S:
            q.popleft()
        if len(q) >= MAX_STARTS:
            return False, int(q[0] + WINDOW_S - now) + 1
        q.append(now)
        if len(_buckets) > MAX_KEYS:
            # Bound memory: drop the oldest-tracked key.
            _buckets.pop(next(iter(_buckets)))
        return True, 0
