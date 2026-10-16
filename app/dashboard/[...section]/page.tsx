import Link from "next/link";
import { Hammer, ArrowLeft } from "lucide-react";
import { toTitleCase } from "@/lib/format";

/**
 * Honest placeholder for dashboard sections that are not built yet
 * (Students, Results, Upload Scores, Credits & Billing, Settings).
 * Specific routes take precedence once implemented.
 */
export default async function DashboardSectionPlaceholder({
  params,
}: {
  params: Promise<{ section: string[] }>;
}) {
  const { section } = await params;
  const name = toTitleCase((section[0] || "section").replace(/-/g, " "));

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/dashboard"
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-text-3 transition hover:text-text-1"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Overview
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{name}</h1>
        <p className="text-text-2">
          This section of the classic dashboard is not available yet.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-xl border bg-surface-1 p-12 text-center shadow-sm">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2">
          <Hammer className="h-6 w-6 text-text-3" />
        </span>
        <h2 className="mt-4 font-semibold">Coming soon</h2>
        <p className="mt-1 max-w-sm text-sm text-text-3">
          {name} lives in your school&apos;s tenant admin portal today. Use the
          button below to continue, or check back after the next release.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-full bg-accent px-6 text-sm font-semibold text-accent-fg transition hover:bg-accent-hover"
        >
          Back to Overview
        </Link>
      </div>
    </div>
  );
}
