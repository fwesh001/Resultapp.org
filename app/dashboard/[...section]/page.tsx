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
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-zinc-500 transition hover:text-black"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Overview
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{name}</h1>
        <p className="text-zinc-600">
          This section of the classic dashboard is not available yet.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-xl border bg-white p-12 text-center shadow-sm">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100">
          <Hammer className="h-6 w-6 text-zinc-500" />
        </span>
        <h2 className="mt-4 font-semibold">Coming soon</h2>
        <p className="mt-1 max-w-sm text-sm text-zinc-500">
          {name} lives in your school&apos;s tenant admin portal today. Use the
          button below to continue, or check back after the next release.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-full bg-black px-6 text-sm font-semibold text-white transition hover:bg-zinc-800"
        >
          Back to Overview
        </Link>
      </div>
    </div>
  );
}
