import Link from "next/link";
import { PauseCircle, CreditCard } from "lucide-react";
import { toTitleCase } from "@/lib/format";

interface Props {
  schoolName?: string | null;
  subdomain: string;
  /** Shown when the viewer holds a valid admin_session (billing escape hatch). */
  showBillingLink?: boolean;
}

/**
 * Full-page state for suspended tenants. Public, staff, and report surfaces
 * render this instead of content. Tenant admins keep /admin/billing reachable
 * (see showBillingLink) so they can self-serve top-ups to restore service.
 */
export default function SuspendedPortal({ schoolName, subdomain, showBillingLink = false }: Props) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0B0514] px-4 py-10">
      <div className="w-full max-w-md rounded-[1.6rem] border border-amber-500/20 bg-purple-900/[0.07] p-6 text-center backdrop-blur-xl sm:p-8">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 ring-1 ring-amber-500/30">
          <PauseCircle className="h-6 w-6 text-amber-400" />
        </div>
        <h1 className="mt-4 text-xl font-bold tracking-tight text-white">Portal Suspended</h1>
        <p className="mt-2 text-sm leading-6 text-purple-200/70">
          {schoolName ? `${toTitleCase(schoolName)}’s portal` : "This school portal"} is temporarily
          suspended. Please contact the school administration to restore access.
        </p>
        {showBillingLink && (
          <Link
            href={`/${subdomain}/admin/billing`}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-purple-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-purple-500"
          >
            <CreditCard className="h-4 w-4" /> Top up to restore access
          </Link>
        )}
        <p className="mt-4 text-xs text-purple-300/30">
          ResultApp • <span className="font-mono">{subdomain}</span>
        </p>
      </div>
    </div>
  );
}
