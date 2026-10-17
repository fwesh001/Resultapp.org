"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Home, Undo2 } from "lucide-react";

/**
 * First path segments that are global routes — never tenant subdomains.
 * Combines middleware bypass paths, global pages, and backend RESERVED_SUBDOMAINS.
 */
const RESERVED_SEGMENTS = new Set([
  "superadmin",
  "api",
  "_next",
  "login",
  "register",
  "dashboard",
  "pricing",
  "support",
  "contact",
  "privacy",
  "terms",
  "refund-policy",
  "www",
  "admin",
  "app",
  "resultapp",
  "mail",
  "help",
  "billing",
  "ops",
  "status",
]);

export default function NotFound() {
  const router = useRouter();
  const pathname = usePathname();

  // Tenant-aware 404: first path segment is the subdomain unless reserved.
  // No live tenant lookup — keeps this page instant and offline-safe.
  const segment = (pathname.split("/")[1] || "").toLowerCase();
  const subdomain = segment && !RESERVED_SEGMENTS.has(segment) ? segment : null;
  // Layout protection: subdomains run to 30 chars — clamp the giant
  // watermark to 4 chars so it can never force horizontal scrolling.
  const watermark = subdomain ? subdomain.slice(0, 4).toUpperCase() : "404";

  // A 404 under a subdomain can mean two different things. If the school is
  // live, the visitor simply mistyped a sub-page and `/{subdomain}` is the
  // right way home. If the school is NOT live (never provisioned, purged, or
  // soft-deleted), that link would land on this very same 404 page — a dead
  // end. So confirm with the availability endpoint and fall back to the
  // marketing homepage when there is nothing to go back to.
  const [tenantGone, setTenantGone] = useState(false);
  useEffect(() => {
    if (!subdomain) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tenant/${encodeURIComponent(subdomain)}`, {
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as { available?: boolean };
        // available:true means the registry has no such subdomain.
        if (!cancelled && data.available === true) setTenantGone(true);
      } catch {
        /* offline: keep the tenant link, it is the better default */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subdomain]);

  const homeHref = subdomain && !tenantGone ? `/${subdomain}` : "/";

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-surface-0 p-4 text-text-1">
      {/* Ambient depth */}
      <div
        className="pointer-events-none absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-accent-soft blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-success-soft blur-3xl"
        aria-hidden="true"
      />
      {/* Ghost watermark (large screens only) */}
      <span
        className="pointer-events-none absolute max-w-full select-none text-[20rem] font-extrabold leading-none text-text-1/[0.03] max-md:hidden"
        aria-hidden="true"
      >
        {watermark}
      </span>

      {/* Focused card */}
      <div className="relative w-full max-w-sm rounded-3xl border border-line-1 bg-surface-1 p-8 text-center shadow-2xl shadow-black/20">
        <p className="text-[clamp(4.5rem,20vw,7rem)] font-extrabold leading-none tracking-tight text-text-1 drop-shadow-[0_0_28px_rgba(147,51,234,0.45)]">
          404
        </p>

        {/* Teacher's stamp */}
        <div className="mt-3 flex justify-center">
          <span className="inline-block -rotate-3 rounded-md border border-danger/40 bg-danger-soft px-3 py-1 text-xs font-bold tracking-widest text-danger">
            F9 • NOT FOUND
          </span>
        </div>

        <p className="mt-4 text-sm text-text-2">
          {subdomain && tenantGone
            ? `There is no school at ${subdomain}.resultapp.org — it may never have been registered, or it may have been removed.`
            : "This page isn't on the register."}
        </p>

        <Link
          href={homeHref}
          className="mt-6 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-fg shadow-lg shadow-accent/20 transition hover:bg-accent-hover"
        >
          <Home className="h-4 w-4 shrink-0" />
          Back to homepage
        </Link>
        <button
          type="button"
          onClick={() => router.back()}
          className="mt-2 inline-flex min-h-[48px] items-center justify-center gap-2 px-4 text-sm text-text-3 transition hover:text-text-1"
        >
          <Undo2 className="h-4 w-4 shrink-0" />
          Go back
        </button>

        <p className="mt-4 text-xs text-text-3">
          If you typed this address, check the spelling.
        </p>
      </div>
    </div>
  );
}
