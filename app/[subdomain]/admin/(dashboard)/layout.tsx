import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import AdminShell from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";

interface AdminSession {
  admin?: { email?: string };
  tenant_id?: string;
}

/**
 * Guarded admin dashboard layout — mirrors `staff/(dashboard)/layout.tsx`.
 *
 * Requires a valid `admin_session` cookie (set by POST /api/admin/login).
 * Legacy schools with NULL `admin_password_hash` can never mint a session,
 * so they always land on `/admin/login?setup=required`, which shows the
 * friendly "set up your admin password" banner instead of a bare 401.
 */
export default async function AdminDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain: raw } = await params;
  const subdomain = raw.toLowerCase().trim();

  const cookieStore = await cookies();
  const sessionRaw = cookieStore.get("admin_session")?.value;

  if (!sessionRaw) {
    redirect(`/${subdomain}/admin/login`);
  }

  try {
    const session = JSON.parse(sessionRaw) as AdminSession;
    const tenant = String(session?.tenant_id || "").toLowerCase().trim();
    const email = String(session?.admin?.email || "").trim();
    if (!tenant || tenant !== subdomain || !email || !session?.admin) {
      redirect(`/${subdomain}/admin/login`);
    }
  } catch {
    redirect(`/${subdomain}/admin/login`);
  }

  const school = await getTenant(subdomain);
  const schoolName = school?.name || subdomain;
  const slug = school?.slug || subdomain;

  return (
    <AdminShell subdomain={slug} schoolName={schoolName}>
      {children}
    </AdminShell>
  );
}
