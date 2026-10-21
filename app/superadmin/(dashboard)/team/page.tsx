import { redirect } from "next/navigation";
import { superadminAccessOrLogin, enforceSuperadminPage } from "@/lib/superadminGuard";
import TeamView from "@/components/superadmin/TeamView";

export const dynamic = "force-dynamic";

/**
 * Team — OWNER-ONLY platform member management.
 *
 * Double gate:
 * 1. "team" must be in the viewer's page scope (resolve_platform_admin_pages
 *    never emits "team" for a non-owner, so in practice only owners pass);
 * 2. the viewer must ALSO hold the owner ROLE outright — belt-and-braces, and
 *    mirrored in the /api/superadmin/platform-admins proxies because the
 *    backend cannot see cookies.
 */
export default async function SuperadminTeamPage() {
  const denied = await enforceSuperadminPage("team");
  if (denied) return denied;

  const result = await superadminAccessOrLogin();
  if ("login" in result) redirect(result.target);
  if (result.access.role !== "owner" || !result.access.adminId) {
    return (
      <div className="mx-auto max-w-xl px-6 py-20 text-center">
        <h1 className="text-xl font-bold tracking-tight text-text-1">Owner only</h1>
        <p className="mt-2 text-sm text-text-2">
          Team management is reserved for the platform owner. If this is your role in
          reality but not in the database, it needs the one-time SQL bootstrap.
        </p>
      </div>
    );
  }

  return <TeamView selfAdminId={result.access.adminId} />;
}
