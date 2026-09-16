import { NextRequest, NextResponse } from "next/server";

/**
 * Multi-tenant subdomain routing middleware (Edge Runtime).
 *
 * Intercepts incoming requests, extracts the tenant subdomain from the
 * hostname, and internally rewrites the URL to /[subdomain]/... so that
 * the app/[subdomain] route group handles the request — all without
 * changing the URL visible in the user's browser.
 *
 * Hostname parsing strategy:
 *   1. Read the `host` header (e.g. "vhs.localhost:3000", "vhs.resultapp.org").
 *   2. Strip any port suffix (":3000", ":443", etc.) by splitting on ":".
 *   3. Split the remaining hostname by "." into its parts.
 *   4. If there are 2 or fewer parts (e.g. "localhost", "resultapp.org")
 *      or the first part is "www", we treat it as a non-tenant request
 *      and let the default routes handle it.
 *   5. Otherwise, the first part is the tenant subdomain.
 *
 * Path exclusion strategy:
 *   - System paths: /_next/* (build output, assets)
 *   - API routes: /api/*
 *   - Static files: any path containing a file extension (e.g. .png, .css)
 *   - Special files: /favicon.ico
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- Bypass system paths, API routes, static assets, and files with extensions ---
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/favicon") ||
    /\.[a-zA-Z]+$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  // --- Extract hostname and strip port numbers ---
  // The "host" header may include a port (e.g. "vhs.localhost:3000" or "vhs.resultapp.org:443").
  const host = request.headers.get("host") || "";
  const hostname = host.split(":")[0];

  // --- Extract subdomain from hostname ---
  const parts = hostname.split(".");

  // Ignore bare domains (2 parts: "resultapp.org") and localhost (1 part: "localhost"),
  // as well as "www" prefixed hosts ("www.resultapp.org").
  if (parts.length <= 2 || parts[0] === "www") {
    return NextResponse.next();
  }

  const subdomain = parts[0];

  // --- Rewrite to the dynamic [subdomain] route group ---
  // The URL is internally rewritten to /[subdomain]/<original-path> without
  // changing what the user sees in their browser.
  // Example: vhs.resultapp.org/about → internally → /vhs/about → app/[subdomain]/about
  const url = request.nextUrl.clone();
  url.pathname = `/${subdomain}${pathname}`;

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
