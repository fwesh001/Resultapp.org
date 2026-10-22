"use client";

import Link from "next/link";
import { FlaskConical, KeyRound } from "lucide-react";
import { DEMO_GUIDE_EVENT } from "@/lib/demoPersonas";

/**
 * Persistent demo banner. Rendered for demo tenants only, above all portal
 * content. Pushes content down (never overlays) and links out to real
 * registration — the demo's job is to convert, not to trap.
 *
 * The "Credentials" control opens the DemoHelp guide (credentials card +
 * persona FAQs) from ANY page via the shared DEMO_GUIDE_EVENT — the banner is
 * the only demo chrome a prospect sees everywhere, so it doubles as the
 * always-available way back to the credentials card.
 *
 * The register link is absolute: a relative /register on the demo host
 * would be swallowed by path-based tenant routing.
 */
export function DemoBanner({ subdomain }: { subdomain: string }) {
  function openGuide() {
    window.dispatchEvent(new CustomEvent(DEMO_GUIDE_EVENT));
  }

  return (
    <div
      role="status"
      className="flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-400 px-4 py-2 text-center text-sm font-medium text-[#0B0514]"
    >
      <span className="inline-flex items-center gap-1.5">
        <FlaskConical className="h-4 w-4" aria-hidden />
        Demo mode — explore freely, this classroom resets automatically.
      </span>
      <button
        type="button"
        onClick={openGuide}
        className="inline-flex items-center gap-1.5 rounded-full bg-[#0B0514] px-2.5 py-0.5 text-xs font-semibold text-amber-300 transition hover:opacity-85"
      >
        <KeyRound className="h-3.5 w-3.5" aria-hidden />
        Demo credentials
      </button>
      <Link
        href="https://resultapp.org/register"
        className="underline underline-offset-4 hover:opacity-80"
      >
        Get your own portal ({subdomain})
      </Link>
    </div>
  );
}
