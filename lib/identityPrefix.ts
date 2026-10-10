/**
 * Identity-prefix helpers.
 *
 * Students and staff sign in from a tenant's own subdomain (vhs.resultapp.org),
 * so the tenant prefix is already known to the page. They should not have to
 * retype it. This module expands a bare identifier ("001") into the full
 * stored form ("vhs/001" / "staff/001") exactly the way the backend does.
 *
 * WHY THESE FALLBACKS
 * --------------------
 * The prefixes are PER-TENANT SETTINGS, not a function of the subdomain:
 *
 *     schools.id_prefix       — e.g. vhs => "vhs", sha => NULL
 *     schools.staff_id_prefix — e.g. vhs => "staff", sha => "STAFF/"
 *
 * The backend resolves them at db_manager / allocations.py:
 *     student: COALESCE(id_prefix, subdomain)      allocations.py:462
 *     staff:   COALESCE(staff_id_prefix, 'STAFF/') allocations.py:551
 *
 * and lib/tenant.ts:81-82 mirrors that server-side for the frontend `School`
 * object. The callers below pass those already-normalized values in; the
 * fallbacks here are a second line of defence for the case where the parent
 * page could not load the school (demo tenants, transient lookup failure).
 *
 * WHY ONLY BARE NUMBERS ARE EXPANDED
 * ----------------------------------
 * Real, live counter-examples exist in the production DB:
 *
 *   vhs staff/001 … staff/004   (generated, prefixed)
 *   vhs stf001                  (legacy, NO prefix, contains letters)
 *
 * Blindly prepending would turn `stf001` into `staff/stf001` and lock that
 * account out of its own school. So the rule is deliberately conservative:
 *
 *   contains "@"  -> email login, leave alone
 *   contains "/"  -> user already typed the prefix (existing users!), leave alone
 *   /^\d+$/       -> unambiguous bare number, safe to expand
 *   anything else -> could be a real ID we would corrupt, leave alone
 *
 * A wrong guess here is a failed login with a visible error, never a
 * privilege or data problem — but it is still a regression, so we only expand
 * when the input is genuinely unambiguous.
 */

/** Join a configured prefix to a number, tolerating a trailing slash. */
export function joinIdentityPrefix(prefix: string | null | undefined, value: string): string {
  const p = (prefix || "").trim();
  if (!p) return value;
  return p.endsWith("/") ? `${p}${value}` : `${p}/${value}`;
}

/**
 * Expand a student admission number.
 * `idPrefix` is the tenant's id_prefix, already resolved to the subdomain by
 * lib/tenant.ts when unset. Falls back to `subdomain` if nothing was passed.
 */
export function expandStudentId(raw: string, idPrefix?: string | null, subdomain?: string | null): string {
  const v = (raw || "").replace(/\s+/g, "");
  if (!v) return v;
  if (v.includes("/") || v.includes("@")) return v;
  if (!/^\d+$/.test(v)) return v; // legacy/odd ID — do not guess
  return joinIdentityPrefix(idPrefix || subdomain, v);
}

/**
 * Expand a staff identifier.
 * Leaves emails and already-prefixed IDs untouched; expands bare numbers with
 * the tenant's staff_id_prefix (default "STAFF/", matching the backend).
 */
export function expandStaffId(raw: string, staffIdPrefix?: string | null): string {
  const v = (raw || "").trim();
  if (!v) return v;
  if (v.includes("@")) return v; // email login
  if (v.includes("/")) return v; // already prefixed
  if (!/^\d+$/.test(v)) return v; // e.g. legacy "stf001" — do not guess
  return joinIdentityPrefix(staffIdPrefix || "STAFF/", v);
}