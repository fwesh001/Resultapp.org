"""
In-process sliding-window throttle (stdlib only, no new dependencies).

Used by the superadmin ledger CSV export (M2 perf fix): at most 3 export
starts per 60s sliding window per key (caller IP + filter tuple), and by the
public support-ticket endpoint (a looser window — see `check`'s `max_hits` /
`window_s` arguments).

Accepted limitation: buckets live per uvicorn worker process, so an
N-worker deployment allows up to N×max_hits starts/window in the pathological
case. Proportionate for a superadmin-only endpoint operated by one human, and
still useful as a spam brake on a public form; move to a Redis-backed bucket
if abuse is ever observed.
"""

import threading
import time
from collections import deque
from typing import Dict, Tuple, Deque

WINDOW_S = 60
MAX_STARTS = 3
MAX_KEYS = 1000

#: Bucket deque length is globally bounded to keep memory flat.
MAX_KEYS = 1000

_buckets: Dict[str, Deque[float]] = {}
_lock = threading.Lock()


def check(
    key: str,
    max_hits: int = MAX_STARTS,
    window_s: int = WINDOW_S,
) -> Tuple[bool, int]:
    """Sliding-window admission check.

    Returns (allowed, retry_after_s): allowed=True with retry_after 0 on
    success; allowed=False with seconds until the oldest slot frees up.

    `max_hits` / `window_s` default to the legacy 3-per-60s. Buckets are
    namespaced by (max_hits, window_s) so different limits never share a deque.
    """
    max_hits = max(1, int(max_hits))
    window_s = max(1, int(window_s))
    bucket = f"{max_hits}:{window_s}:{key}"
    now = time.monotonic()
    with _lock:
        q = _buckets.get(bucket)
        if q is None:
            q = _buckets[bucket] = deque()
        while q and q[0] <= now - window_s:
            q.popleft()
        if len(q) >= max_hits:
            return False, int(q[0] + window_s - now) + 1
        q.append(now)
        if len(_buckets) > MAX_KEYS:
            # Bound memory: drop the oldest-tracked key.
            _buckets.pop(next(iter(_buckets)))
        return True, 0
