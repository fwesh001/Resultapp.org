import { redirect } from "next/navigation";
import { requireSuperadmin, resolveSuperadminAccess } from "@/lib/superadminAuth";
import SuperadminShell from "@/components/superadmin/SuperadminShell";

export const dynamic = "force-dynamic";

/**
 * Guarded superadmin section.
 *
 * Two guards, in order:
 * 1. `requireSuperadmin` — verifies the HMAC signature before reading any
 *    claim (LEGAL_REMEDIATION.md P0-0) and that the session says superadmin.
 *    Rejection redirects to login (a Server Component cannot apply the
 *    deleting Set-Cookie header that guard issues).
 * 2. `resolveSuperadminAccess` — resolves WHO is signed in and WHICH Command
 *    Center pages they hold (platform RBAC, P1 item 21). The resolved list is
 *    handed to the shell so the sidebar shows exactly the allocated sections,
 *    and every page re-checks itself server-side via lib/superadminGuard.
 */
export default async function SuperadminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (await requireSuperadmin()) {
    redirect("/superadmin/login");
  }
  const access = await resolveSuperadminAccess();

  return (
    <SuperadminShell
      allowedPages={access?.pages ?? null}
      viewerLabel={access?.degraded ? `${access.email ?? "unknown"} (scope unresolved)` : (access?.email ?? null)}
    >
      {children}
    </SuperadminShell>
  );
}
