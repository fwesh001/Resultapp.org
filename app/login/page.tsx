import WorkspaceLocatorForm from "@/components/auth/WorkspaceLocatorForm";
import { GraduationCap } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Sign in — ResultApp",
  description: "Find your school workspace and continue to admin sign in.",
};

/**
 * Root-domain workspace locator (resultapp.org/login only — middleware never
 * rewrites root hosts into [subdomain], so this can't collide with tenants).
 */
export default function RootLoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B0514] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mt-6 rounded-[1.6rem] border border-purple-500/20 bg-purple-900/[0.07] p-6 backdrop-blur-xl sm:p-8">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600 text-white">
              <GraduationCap className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-white">Find your workspace</h1>
              <p className="text-xs font-mono text-purple-300/60">resultapp.org</p>
            </div>
          </div>

          <h2 className="mt-6 text-xl font-bold tracking-tight text-white">Which school are you with?</h2>
          <p className="mt-1 text-sm text-purple-200/60">
            Enter your school&apos;s subdomain to continue to its admin sign in.
          </p>

          <div className="mt-6">
            <WorkspaceLocatorForm />
          </div>

          <p className="mt-4 text-center text-xs text-purple-300/30">
            ResultApp • Workspace Locator
          </p>
        </div>
      </div>
    </div>
  );
}
