"use client";

import Link from "next/link";
import { FlaskConical } from "lucide-react";

/**
 * Persistent demo banner. Rendered for demo tenants only, above all portal
 * content. Pushes content down (never overlays) and links out to real
 * registration — the demo's job is to convert, not to trap.
 */
export function DemoBanner({ subdomain }: { subdomain: string }) {
  return (
    <div
      role="status"
      className="flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-400 px-4 py-2 text-center text-sm font-medium text-[#0B0514]"
    >
      <span className="inline-flex items-center gap-1.5">
        <FlaskConical className="h-4 w-4" aria-hidden />
        Demo mode — explore freely, this classroom resets automatically.
      </span>
      <Link
        href="/register"
        className="underline underline-offset-4 hover:opacity-80"
      >
        Get your own portal ({subdomain})
      </Link>
    </div>
  );
}
