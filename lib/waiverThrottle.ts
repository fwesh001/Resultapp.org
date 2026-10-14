/**
 * Best-effort in-process throttle for the public waiver endpoints.
 *
 * WHY THIS EXISTS NEXT TO THE BACKEND'S OWN LIMITER
 * --------------------------------------------------
 * `routers/waivers.py` already rate limits preview and reserve. That is the
 * real guard — the token lives there and only it can be raced meaningfully.
 *
 * This is a second, cheaper guard one layer earlier. Its job is not to stop an
 * attacker (it cannot — see the caveat below) but to stop a school hammering
 * "Pay" from causing an unbounded number of Next invocations *and* backend
 * requests from a single tab. Amplification is the thing worth removing.
 *
 * THE CAVEAT, STATED PLAINLY
 * --------------------------
 * This state is per serverless instance, so N concurrent instances allow up to
 * N times the limit. It is NOT a security boundary and must never be described
 * as one. The security boundary is `services.rate_limit.check()` inside the
 * backend process, which is single and authoritative.
 *
 * `services/rate_limit.py` documents the same trade-off at its own layer, and
 * the house has already decided this is proportionate for an operator-run
 * admin surface. It is proportionate here too — but the waiver endpoints are
 * publicly reachable, so the real limiter had better be the backend's.
 */

const WINDOW_MS = 60_000;

interface Bucket {
  hits: number[];
  timer?: ReturnType<typeof setTimeout>;
}

const buckets = new Map<string, Bucket>();

/** Bound memory the same way services/rate_limit.py does. */
const MAX_BUCKETS = 2_000;

/**
 * @param scope Namespace so "preview:1.2.3.4" and "reserve:1.2.3.4" are
 *   independent budgets.
 * @param key   Caller identity — IP, or anything else that partitions callers.
 * @returns seconds until the next slot frees, or 0 when allowed.
 */
export function throttle(scope: string, key: string, maxHits: number): number {
  const now = Date.now();
  const bucketKey = `${scope}:${key}`;
  let bucket = buckets.get(bucketKey);

  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(bucketKey, bucket);
    if (buckets.size > MAX_BUCKETS) {
      // Evict the oldest-inserted entry. Map preserves insertion order.
      const oldest = buckets.keys().next();
      if (!oldest.done) buckets.delete(oldest.value);
    }
  }

  bucket.hits = bucket.hits.filter((t) => now - t < WINDOW_MS);

  if (bucket.hits.length >= maxHits) {
    const retryAfter = Math.ceil((bucket.hits[0] + WINDOW_MS - now) / 1000);
    return Math.max(1, retryAfter);
  }

  bucket.hits.push(now);

  // Opportunistic cleanup: a bucket nobody touches again would otherwise pin
  // an array of timestamps for the life of the instance.
  if (!bucket.timer) {
    bucket.timer = setTimeout(() => {
      buckets.delete(bucketKey);
    }, WINDOW_MS);
    // Never hold the process open for a throttle bucket.
    if (typeof bucket.timer === "object" && "unref" in bucket.timer) {
      (bucket.timer as { unref: () => void }).unref();
    }
  }

  return 0;
}

/**
 * Caller identity from proxy headers.
 *
 * `x-forwarded-for` is client-controlled in general, but Vercel overwrites it,
 * and this is a rate limiter rather than an authorization check — spoofing it
 * buys an attacker N times the budget, not unlimited budget, and the backend
 * limiter is unaffected either way.
 */
export function callerIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return req.headers.get("x-real-ip")?.slice(0, 64) || "anon";
}
