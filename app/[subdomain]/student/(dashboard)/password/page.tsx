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
        <div className="rounded-xl border border-purple-500/20 bg-purple-900/20 p-2.5">
          <KeyRound className="h-5 w-5 text-purple-300" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Change password</h1>
          <p className="mt-1 text-sm text-purple-200/60">
            Signed in as{" "}
            <span className="font-mono text-purple-300">{identity.studentId}</span>
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-purple-500/20 bg-purple-900/[0.07] p-5 sm:p-6">
        <PasswordChangeForm tenantId={subdomain} />
      </div>
    </div>
  );
}