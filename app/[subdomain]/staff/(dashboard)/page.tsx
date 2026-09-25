import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTenant } from "@/lib/tenant";
import { BookOpen, Users, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

interface StaffSession {
  staff: { id: string; staff_id: string; full_name: string; email?: string | null; role?: string };
  tenant_id?: string;
}

async function getStaffDashboard(tenantId: string, staffId: string) {
  const base =
    process.env.BACKEND_URL?.trim() ||
    process.env.PROVISION_API_URL?.trim()?.replace(/\/api\/v1\/provision\/?$/, "") ||
    "http://159.223.178.34:8000";
  const url = `${base.replace(/\/$/, "")}/api/v1/tenant/${encodeURIComponent(tenantId)}/staff/${encodeURIComponent(staffId)}/dashboard`;
  const secret = process.env.BACKEND_API_SECRET?.trim() || process.env.PROVISION_API_SECRET?.trim() || process.env.API_SECRET_KEY?.trim() || "";
  const headers: Record<string, string> = secret ? { "X-API-SECRET-KEY": secret } : {};
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as { staff?: { full_name: string }; allocations?: Array<{ id: string; subject_name: string; class_name: string; staff_name: string }>; count?: number; form_classes?: Array<{ class_name: string }> } | null;
}

export default async function StaffDashboardPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain: raw } = await params;
  const subdomain = raw.toLowerCase().trim();

  const cookieStore = await cookies();
  const rawSession = cookieStore.get("staff_session")?.value;
  if (!rawSession) {
    redirect(`/${subdomain}/staff/login`);
  }

  let session: StaffSession | null = null;
  try {
    session = JSON.parse(rawSession) as StaffSession;
  } catch {
    redirect(`/${subdomain}/staff/login`);
  }

  const staff = session?.staff;
  if (!staff) {
    redirect(`/${subdomain}/staff/login`);
  }

  // Use staff_id for dashboard fetch (supports both UUID and staff_id string via backend OR query)
  const staffId = staff.staff_id || staff.id;
  const tenantForFetch = (session?.tenant_id as string) || subdomain;

  const [school, dashboard] = await Promise.all([
    getTenant(subdomain).catch(() => null),
    getStaffDashboard(tenantForFetch, staffId).catch(() => null),
  ]);

  const allocations = dashboard?.allocations || [];
  const formClasses = dashboard?.form_classes || [];
  const initialTerm = school?.currentTerm?.trim() || "Term 1";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Welcome back, {staff.full_name}</h1>
        <p className="mt-1 text-sm text-purple-200/60">
          {staff.staff_id} {staff.role ? `• ${staff.role}` : ""} • {school?.name || subdomain}.resultapp.org
        </p>
      </div>

      {allocations.length === 0 ? (
        <div className="rounded-2xl border border-amber-500/15 bg-amber-500/5 p-8 text-center">
          <Users className="mx-auto h-8 w-8 text-amber-300" />
          <h3 className="mt-3 text-sm font-semibold text-white">No allocations yet</h3>
          <p className="mt-1 text-sm text-purple-200/60">Your Principal hasn&apos;t assigned any classes. Please check back later or contact admin.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {allocations.map((a) => (
            <div
              key={a.id}
              className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-5 backdrop-blur hover:bg-purple-900/10"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600/15 ring-1 ring-purple-500/20">
                <BookOpen className="h-5 w-5 text-purple-300" />
              </div>
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-purple-300/60">{a.class_name}</p>
              <h3 className="mt-1 text-base font-semibold text-white">{a.subject_name}</h3>
              <p className="mt-1 text-xs text-purple-200/50">Assigned as {a.staff_name}</p>
              <Link
                href={`/${subdomain}/staff/grading/${encodeURIComponent(a.class_name)}/${encodeURIComponent(a.subject_name)}?term=${encodeURIComponent(initialTerm)}`}
                className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-full bg-purple-600 py-2 text-sm font-medium text-white transition hover:bg-purple-500"
              >
                <FileText className="h-4 w-4" /> Open Grading Sheet
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
