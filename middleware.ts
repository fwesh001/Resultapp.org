import { NextRequest, NextResponse } from "next/server";

/**
 * Multi-tenant subdomain routing middleware (Edge Runtime).
 *
 * Intercepts incoming requests, extracts the tenant subdomain from the
 * hostname, and internally rewrites the URL to /[subdomain]/... so that
 * the app/[subdomain] route group handles the request — all without
 * changing the URL visible in the user's browser.
 *
 * Hostname parsing:
 *   1. Read the `host` header and strip any port ("vhs.localhost:3000").
 *   2. In development only, an explicit override wins: `?__tenant=<slug>`
 *      or the `x-tenant-subdomain` header. This lets a developer exercise the
 *      tenant routes from a bare http://localhost:3000 without editing /etc/hosts.
 *   3. `<slug>.localhost` and `<slug>.127.0.0.1` are tenant hosts — note these
 *      are only two labels, so they must be checked BEFORE the "two labels or
 *      fewer means bare domain" rule or local testing silently falls through to
 *      the marketing site.
 *   4. Otherwise a hostname with more than two labels is a tenant, and the
 *      first label is the subdomain ("vhs.resultapp.org" -> "vhs").
 *   5. Everything else (the apex, "www", bare "localhost") is not a tenant.
 *
 * Path normalization:
 *   The subdomain is derived from the HOST, never from the path. But developers
 *   habitually type the slug as well ("vhs.resultapp.org/vhs"), and the old
 *   rewrite turned that into /vhs/vhs -> 404. A leading "/<subdomain>" segment
 *   is therefore stripped before the rewrite, so both /vhs and /vhs/admin work.
 *
 * Bypass list (applied first, defense in depth):
 *   /_next/*, /api/*, /superadmin/*, /favicon*, and anything with a file
 *   extension — these must never be rewritten into the tenant tree.
 */

const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN || "resultapp.org";

function extractTenant(request: NextRequest): string | null {
  // --- Explicit development override ---
  if (process.env.NODE_ENV !== "production") {
    const header = request.headers.get("x-tenant-subdomain");
    const query = request.nextUrl.searchParams.get("__tenant");
    const forced = (header || query || "").trim().toLowerCase();
    if (forced && /^[a-z0-9][a-z0-9-]*$/.test(forced)) {
      return forced;
    }
  }

  const host = request.headers.get("host") || "";
  const hostname = host.split(":")[0].toLowerCase();
  if (!hostname) return null;

  const labels = hostname.split(".");

  // <slug>.localhost / <slug>.127.0.0.1 — two labels, so handle before the
  // bare-domain check below. This is what makes `vhs.localhost:3000` work.
  if (labels.length === 2 && (labels[1] === "localhost" || labels[1] === "127.0.0.1")) {
    const slug = labels[0];
    return slug && slug !== "www" ? slug : null;
  }

  // Bare apex / www — not a tenant.
  if (hostname === BASE_DOMAIN || hostname === `www.${BASE_DOMAIN}`) {
    return null;
  }

  // Anything with 3+ labels is a tenant subdomain.
  if (labels.length > 2) {
    const slug = labels[0];
    return slug && slug !== "www" ? slug : null;
  }

  return null;
}

/**
 * Collapse a route that has been doubled.
 *
 * A pasted or redirected URL can arrive as two identical halves —
 * "/admin/login/admin/login". Left alone that rewrites to
 * "/<sub>/admin/login/admin/login", which matches no route and 404s even though
 * the tenant is perfectly reachable. When the path is exactly two copies of the
 * same segment list, keep one.
 *
 * Only an exact "X + X" is collapsed. A single repeated segment that is a
 * genuine part of a deeper route (e.g. "/vhs/admin/vhs") is left alone, because
 * guessing there would silently change real URLs.
 */
export function dedupeRepeatedPrefix(pathname: string): string {
  const trimmed = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return "/";

  const segments = trimmed.split("/");
  if (segments.length < 2 || segments.length % 2 !== 0) return pathname;

  const half = segments.length / 2;
  const first = segments.slice(0, half);
  const second = segments.slice(half);
  if (first.join("/") === second.join("/")) {
    return `/${first.join("/")}`;
  }
  return pathname;
}

/**
 * Strip a leading "/<subdomain>" so "/vhs" and "/vhs/admin" become
 * "/" and "/admin" respectively. Without this the rewrite produced
 * "/vhs/vhs" and the tenant 404'd.
 */
export function normalizePath(pathname: string, subdomain: string): string {
  const prefix = `/${subdomain}`;
  if (pathname === prefix) return "/";
  if (pathname.startsWith(`${prefix}/`)) {
    return pathname.slice(prefix.length) || "/";
  }
  return pathname;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- Bypass system paths, API routes, static assets, and files with extensions ---
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/superadmin") ||
    pathname.startsWith("/favicon") ||
    /\.[a-zA-Z]+$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  const subdomain = extractTenant(request);
  if (!subdomain) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  // Order matters. Strip the tenant slug the developer may also have typed
  // FIRST, then collapse a doubled route — otherwise a slug left on the front
  // makes the segment count odd and the halving no longer lines up.
  //   /vhs/admin/login/admin/login -> strip slug -> /admin/login/admin/login
  //                                -> dedupe     -> /admin/login
  const withoutSlug = normalizePath(pathname, subdomain);
  url.pathname = `/${subdomain}${dedupeRepeatedPrefix(withoutSlug)}`;

  return NextResponse.rewrite(url);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     *  - _next/static  (static files)
     *  - _next/image  (image optimization)
     *  - favicon.ico  (favicon)
     *  - public files (images with extensions)
     *
     * API and other system paths are also excluded inside the middleware function
     * for defense-in-depth.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\..*).*)",
  ],
};