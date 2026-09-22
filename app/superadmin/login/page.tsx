import SuperadminLoginForm from "@/components/superadmin/SuperadminLoginForm";
import { ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

/** Public platform-owner sign-in (outside the guarded shell). */
export default function SuperadminLoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B0514] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-[1.6rem] border border-purple-500/20 bg-purple-900/[0.07] p-6 backdrop-blur-xl sm:p-8">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600 text-white">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-white">Command Center</h1>
              <p className="text-xs font-mono text-purple-300/60">resultapp.org • superadmin</p>
            </div>
          </div>

          <h2 className="mt-6 text-xl font-bold tracking-tight text-white">Platform sign in</h2>
          <p className="mt-1 text-sm text-purple-200/60">
            Restricted area. Sign in with the platform password.
          </p>

          <div className="mt-6">
            <SuperadminLoginForm />
          </div>
        </div>
      </div>
    </div>
  );
}
