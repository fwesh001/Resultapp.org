import type { Metadata } from "next";
import { DemoLauncher } from "@/components/demo/DemoLauncher";

export const metadata: Metadata = {
  title: "Interactive Demo — ResultApp",
  description:
    "Explore a live ResultApp school portal with realistic sample data. No signup, no payment — your demo classroom is ready in seconds.",
  robots: { index: false, follow: false },
};

/**
 * Demo landing page. Served at demo.resultapp.org/ (rewritten from the bare
 * demo host by middleware) and at resultapp.org/demo.
 *
 * A single "Launch interactive demo" button provisions an ephemeral tenant
 * (POST /api/demo/provision) and hands the prospect straight to it. Nothing
 * here touches Vercel or Cloudflare — path routing serves every demo id from
 * the one verified demo.resultapp.org domain.
 */
export default function DemoLandingPage() {
  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-[#0B0514] text-white">
      {/* Same hero-preview.avif the marketing pages use, so the demo feels
          like the same product rather than a bare debug page. Layered behind
          the content with -z-10 (inside this `isolate` stacking context) and
          dimmed enough to keep the body copy at its existing contrast — the
          demo page has no hero of its own, so the card list needs the darker
          scrim more than the landing page does. */}
      <div aria-hidden className="absolute inset-0 -z-10">
        <img src="/hero-preview.avif" alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-[#0B0514]/80" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B0514] via-transparent to-[#0B0514]/60" />
      </div>

      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
          Walk through a real school portal
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-purple-200/70">
          We spin up a private demo classroom — 40 students, 6 staff, graded
          terms, and a published result set — so you can click through staff
          grading, report cards, and the admin dashboard exactly as a school
          would. It takes seconds, and it disappears automatically after an
          hour.
        </p>
        <DemoLauncher />
        <ul className="mt-10 grid w-full gap-3 text-left text-sm text-purple-200/70 sm:grid-cols-3">
          <li className="rounded-2xl border border-purple-500/15 bg-purple-900/10 p-4">
            <span className="font-semibold text-white">Staff grading</span>
            <br />
            Enter scores as a class teacher with a realistic gradebook.
          </li>
          <li className="rounded-2xl border border-purple-500/15 bg-purple-900/10 p-4">
            <span className="font-semibold text-white">Report cards</span>
            <br />
            Check a published Term 1 result exactly like a parent would.
          </li>
          <li className="rounded-2xl border border-purple-500/15 bg-purple-900/10 p-4">
            <span className="font-semibold text-white">Admin billing</span>
            <br />
            See slots, credits, and the real Flutterwave checkout in test mode.
          </li>
        </ul>
        <p className="mt-8 text-xs text-purple-300/40">
          Demo data is fictional and resets automatically. Ready for the real
          thing?{" "}
          <a href="/register" className="underline underline-offset-4 hover:text-white">
            Register your school
          </a>
        </p>
      </div>
    </main>
  );
}
