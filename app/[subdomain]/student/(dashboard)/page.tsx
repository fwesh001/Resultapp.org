import Link from "next/link";
import { redirect } from "next/navigation";
import { readStudentSession } from "@/lib/studentAuth";
import { GraduationCap, FileText, ArrowRight, CalendarDays } from "lucide-react";
import { toTitleCase } from "@/lib/format";

export const dynamic = "force-dynamic";

interface HistoryRow {
  term?: string | null;
  academic_session?: string | null;
  published_at?: string | null;
}

function getSecret(): string {
  return (
    process.env.BACKEND_API_SECRET?.trim() ||
    process.env.PROVISION_API_SECRET?.trim() ||
    process.env.API_SECRET_KEY?.trim() ||
    ""
  );
}

function getBackendBase(): string {
  const raw =
    process.env.BACKEND_URL?.trim() ||
    process.env.PROVISION_API_URL?.trim()?.replace(/\/api\/v1\/provision\/?$/, "") ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    "http://159.223.178.34:8000";
  return raw.replace(/\/$/, "");
}

function formatPublished(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Student dashboard — published result history.
 *
 * Server-rendered straight from the backend rather than through
 * /api/student/results. That endpoint exists for the client-side checker; the
 * dashboard already has the session in hand, so calling it here would be a
 * pointless round trip through our own process to reach the same data.
 *
 * The student_id comes from the VERIFIED session, never from a query param, so
 * this page cannot be pointed at another child.
 */
export default async function StudentDashboardPage({
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

  const secret = getSecret();
  let results: HistoryRow[] = [];
  let historyError = false;

  if (secret) {
    try {
      const url =
        `${getBackendBase()}/api/v1/tenant/${encodeURIComponent(subdomain)}/student/results` +
        `?student_id=${encodeURIComponent(identity.studentId)}`;
      const res = await fetch(url, {
        headers: { "X-API-SECRET-KEY": secret },
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as { results?: HistoryRow[] };
        results = Array.isArray(data.results) ? data.results : [];
      } else {
        historyError = true;
      }
    } catch {
      historyError = true;
    }
  } else {
    historyError = true;
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="flex items-start gap-3">
        <div className="rounded-xl border border-purple-500/20 bg-purple-900/20 p-2.5">
          <GraduationCap className="h-5 w-5 text-purple-300" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Your Results
          </h1>
          <p className="mt-1 text-sm text-purple-200/60">
            {identity.fullName || identity.studentId}
            {identity.className ? (
              <>
                {" · "}
                <span className="text-purple-300">{toTitleCase(identity.className)}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      {historyError ? (
        <div className="mt-6 rounded-2xl border border-amber-400/25 bg-amber-500/5 p-5 text-sm text-amber-100/80">
          We could not load your results right now. Please try again in a moment.
        </div>
      ) : results.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-purple-500/20 bg-purple-900/[0.07] p-8 text-center">
          <FileText className="mx-auto h-8 w-8 text-purple-300/40" />
          <h2 className="mt-3 text-base font-semibold text-white">No results published yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-purple-200/60">
            Results appear here as soon as your school publishes them. Nothing is missing — the
            school has simply not released a result yet.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {results.map((r, i) => {
            const term = (r.term || "").trim();
            const session = (r.academic_session || "").trim();
            const published = formatPublished(r.published_at);

            // Carry BOTH term and session. Sending term alone resolves against
            // whichever session the school teaches NOW, so an archived link
            // would quietly render the wrong year.
            const href =
              `/${subdomain}/report/${identity.studentId.split("/").map(encodeURIComponent).join("/")}` +
              `?term=${encodeURIComponent(term)}` +
              (session ? `&academic_session=${encodeURIComponent(session)}` : "");

            const isLatest = i === 0;

            return (
              <li key={`${session}-${term}`}>
                <Link
                  href={href}
                  className="group flex items-center gap-4 rounded-2xl border border-purple-500/20 bg-purple-900/[0.07] p-4 transition hover:border-purple-400/40 hover:bg-purple-900/15"
                >
                  <div className="rounded-xl border border-purple-500/20 bg-purple-900/20 p-2.5">
                    <FileText className="h-4 w-4 text-purple-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-white">{term || "Result"}</span>
                      {session ? (
                        <span className="rounded-full border border-purple-500/25 bg-purple-900/30 px-2 py-0.5 font-mono text-[0.7rem] text-purple-200/80">
                          {session}
                        </span>
                      ) : null}
                      {isLatest ? (
                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[0.7rem] font-medium text-emerald-300">
                          Latest
                        </span>
                      ) : null}
                    </div>
                    {published ? (
                      <span className="mt-1 flex items-center gap-1 text-xs text-purple-300/50">
                        <CalendarDays className="h-3 w-3" /> Published {published}
                      </span>
                    ) : null}
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-purple-300/40 transition group-hover:translate-x-0.5 group-hover:text-purple-200" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}