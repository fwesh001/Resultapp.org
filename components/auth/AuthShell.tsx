"use client";

import Link from "next/link";
import { LogoLockup } from "@/components/brand/Logo";

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
    <div className="flex min-h-screen flex-col bg-surface-0 text-text-1">
      <header className="border-b border-line-2 px-5 py-4">
        <Link href="/" className="inline-flex items-center gap-2.5 font-semibold tracking-tight">
          <LogoLockup size="sm" wordmarkClassName="text-[15px] font-semibold" />
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="rounded-[1.6rem] border border-line-1 bg-surface-1 p-6 shadow-2xl sm:p-8">
            <h1 className="text-xl font-bold tracking-tight text-text-1">{title}</h1>
            {subtitle && (
              <p className="mt-2 text-sm leading-6 text-text-3">{subtitle}</p>
            )}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <div className="mt-6 text-center text-xs text-text-3">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
