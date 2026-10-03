"use client";

import Link from "next/link";
import { GraduationCap } from "lucide-react";

/**
 * Minimal centred shell for the public auth-flow pages (verify-email,
 * forgot-password, reset-password).
 *
 * These are deliberately plain and self-contained: a user who arrives from an
 * email link on a phone should see the task immediately, not a marketing
 * header and nav.
 */
export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[#0B0514] text-white">
      <header className="border-b border-purple-500/15 px-5 py-4">
        <Link href="/" className="inline-flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-600 text-white">
            <GraduationCap className="h-5 w-5" />
          </span>
          <span className="text-[15px] font-semibold">resultapp.org</span>
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="rounded-[1.6rem] border border-purple-500/20 bg-purple-900/[0.07] p-6 shadow-2xl backdrop-blur-xl sm:p-8">
            <h1 className="text-xl font-bold tracking-tight text-white">{title}</h1>
            {subtitle && (
              <p className="mt-2 text-sm leading-6 text-purple-200/60">{subtitle}</p>
            )}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <div className="mt-6 text-center text-xs text-purple-300/40">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
