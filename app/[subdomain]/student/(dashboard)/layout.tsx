import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { readStudentSession } from "@/lib/studentAuth";
import StudentShell from "@/components/student/StudentShell";
import PasswordChangePrompt from "@/components/student/PasswordChangePrompt";

export const dynamic = "force-dynamic";

/**
 * Guarded student dashboard layout.
 *
 * Mirrors app/[subdomain]/staff/(dashboard)/layout.tsx: the shared guard
 * verifies the HMAC signature AND requires the session's tenant_id to match
 * this portal, so a session minted on one school's site cannot render another
 * school's dashboard.
 *
 * Server Components cannot delete cookies, so an invalid session redirects to
 * login rather than trying to clear the cookie here.
 */
export default async function StudentDashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain: raw } = await params;
  const subdomain = raw.toLowerCase().trim();

  // Bound to this portal's subdomain — a cross-tenant session is rejected.
  const identity = await readStudentSession(subdomain);
  if (!identity) {
    redirect(`/${subdomain}/student/login`);
  }

  const school = await getTenant(subdomain);
  const schoolName = school?.name || subdomain;
  const slug = school?.slug || subdomain;

  return (
    <StudentShell
      subdomain={slug}
      schoolName={schoolName}
      logoUrl={school?.logoUrl}
      studentId={identity.studentId}
      studentName={identity.fullName || identity.studentId}
    >
      {/*
        Soft prompt, rendered above the page content but inside the shell.
        Dismissible on purpose: a hard redirect on first login would strand
        whoever did not get to change the password on a shared family device,
        and would also break the "land on the result I clicked" flow.
      */}
      {identity.mustChangePassword ? <PasswordChangePrompt subdomain={slug} /> : null}
      {children}
    </StudentShell>
  );
}