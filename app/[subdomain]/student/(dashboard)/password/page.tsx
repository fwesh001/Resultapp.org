import { redirect } from "next/navigation";
import { readStudentSession } from "@/lib/studentAuth";
import PasswordChangeForm from "@/components/student/PasswordChangeForm";
import { KeyRound } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function StudentPasswordPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain: raw } = await params;
  const subdomain = raw.toLowerCase().trim();

  const identity = await readStudentSession(subdomain);
  if (!identity) {
    redirect(`/${subdomain}/student/login`);
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-8 sm:px-6">
      <div className="flex items-start gap-3">
        <div className="rounded-xl border border-line-2 bg-surface-2 p-2.5">
          <KeyRound className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-1">Change password</h1>
          <p className="mt-1 text-sm text-text-3">
            Signed in as{" "}
            <span className="font-mono text-accent">{identity.studentId}</span>
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-line-1 bg-surface-1 p-5 sm:p-6">
        <PasswordChangeForm tenantId={subdomain} />
      </div>
    </div>
  );
}