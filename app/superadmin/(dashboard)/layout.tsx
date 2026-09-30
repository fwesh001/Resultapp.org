import { redirect } from "next/navigation";
import { requireSuperadmin } from "@/lib/superadminAuth";
import SuperadminShell from "@/components/superadmin/SuperadminShell";

export const dynamic = "force-dynamic";

/**
 * Guarded superadmin section.
 *
 * Calls the shared `requireSuperadmin` guard, which verifies the HMAC
 * signature before reading any claim. The previous inline version did
 * `JSON.parse` on the raw cookie, so `{"superadmin":true}` was a complete
 * platform takeover with no credential (LEGAL_REMEDIATION.md P0-0).
 *
 * `requireSuperadmin` also issues a deleting Set-Cookie on rejection, but a
 * Server Component cannot apply it — that response header is dropped here, so
 * we redirect to login and the login page overwrites the stale cookie.
 */
export default async function SuperadminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (await requireSuperadmin()) {
    redirect("/superadmin/login");
  }

  return <SuperadminShell>{children}</SuperadminShell>;
}
