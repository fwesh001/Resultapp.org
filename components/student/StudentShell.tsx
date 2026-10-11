"use client";

import { Logo } from "@/components/brand/Logo";
import Link from "next/link";
import { LogOut, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toTitleCase } from "@/lib/format";

interface StudentShellProps {
  subdomain: string;
  schoolName: string;
  /** Tenant crest (absolute Blob URL); falls back to a neutral cap. */
  logoUrl?: string;
  studentId: string;
  studentName: string;
  children: React.ReactNode;
}

/**
 * Student portal shell.
 *
 * Deliberately NOT a copy of StaffShell: students have no notification bell, no
 * form classes, and no sidebar drawer. Copying StaffShell wholesale would add
 * three moving parts (a bell that polls, a drawer, a dynamic class list) that a
 * parent-facing portal has no use for, and the bell in particular would put an
 * authenticated polling loop in front of every family.
 *
 * Signed out via POST /api/student/logout, which clears ONLY the student
 * cookie. An admin or staff signed in on the same browser must not be logged
 * out of their own portal by a student tapping Sign out.
 */
export default function StudentShell({
  subdomain,
  schoolName,
  logoUrl,
  studentId,
  studentName,
  children,
}: StudentShellProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/student/logout", { method: "POST" });
    } catch {
      // Fall through to the redirect anyway: a failed logout must not strand
      // the student on a page they can no longer use.
    }
    router.push(`/${subdomain}/student/login`);
    router.refresh();
  }

  return (
    <div className="flex h-screen flex-col bg-surface-0 text-text-1">
      <header className="relative z-40 flex items-center gap-3 border-b border-line-1 bg-surface-0/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <Link
          href={`/${subdomain}`}
          aria-label={`${toTitleCase(schoolName)} school portal`}
          className="flex min-w-0 items-center gap-3 rounded-lg transition hover:opacity-90"
        >
          <Logo size="sm" src={logoUrl} alt="" className="rounded-full" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold tracking-tight">
              {toTitleCase(schoolName)}
            </span>
            <span className="hidden text-[0.7rem] text-text-3 sm:block">
              Student Portal
            </span>
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-right sm:block">
            <span className="block text-xs font-medium leading-tight">{studentName}</span>
            <span className="block font-mono text-[0.7rem] leading-tight text-text-3">
              {studentId}
            </span>
          </span>

          <Link
            href={`/${subdomain}/student/password`}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-line-1 px-3 text-xs font-medium text-text-2 transition hover:bg-surface-2"
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Change password</span>
          </Link>

          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            aria-label="Sign out"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-line-1 px-3 text-xs font-medium text-text-2 transition hover:bg-surface-2 disabled:opacity-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{signingOut ? "Signing out…" : "Sign out"}</span>
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto bg-surface-0">{children}</main>
    </div>
  );
}