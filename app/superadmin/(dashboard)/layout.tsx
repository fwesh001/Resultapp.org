import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import SuperadminShell from "@/components/superadmin/SuperadminShell";

export const dynamic = "force-dynamic";

/** Guarded superadmin section — requires the session cookie set at login. */
export default async function SuperadminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const raw = cookieStore.get("superadmin_session")?.value;

  let valid = false;
  if (raw) {
    try {
      const session = JSON.parse(raw) as { superadmin?: boolean };
      valid = session?.superadmin === true;
    } catch {
      valid = false;
    }
  }
  if (!valid) {
    redirect("/superadmin/login");
  }

  return <SuperadminShell>{children}</SuperadminShell>;
}
