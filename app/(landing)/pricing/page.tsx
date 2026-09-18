import Link from "next/link";
import { Sparkles, Check, Calendar, Wallet, RotateCcw, Users, ArrowRight } from "lucide-react";
import { PricingCalculator } from "@/components/ui/PricingCalculator";

export default function PricingPage() {
  return (
    <div className="relative isolate overflow-hidden bg-[#0B0514] text-purple-50 selection:bg-purple-600 selection:text-white">
      {/* bento-csv-accent fixed background — same prominent style as landing Zone B */}
      <div aria-hidden className="absolute inset-0 bg-cover bg-center bg-fixed" style={{ backgroundImage: "url('/bento-csv-accent.avif')" }} />
      <div aria-hidden className="absolute inset-0 bg-[#0B0514]/38" />
      <div aria-hidden className="absolute inset-0 bg-violet-950/12 mix-blend-multiply" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-[#0B0514]/10 via-transparent to-[#0B0514]/55" />
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(147,51,234,0.07),transparent_72%)]" />

      {/* subtle ambient to keep purple depth */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-180px] h-[680px] w-[1200px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,_rgba(147,51,234,0.15),transparent_65%)] blur-[1px]" />

      <div className="relative mx-auto max-w-6xl px-6 py-12 md:py-16">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-white md:text-5xl">
            Buy credits.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-7 text-purple-200/60 md:text-base">
            No lock-in. Buy credits upfront, use them as you add students. Unused slots roll over forever.
          </p>
        </div>

        <div className="mx-auto mt-10 max-w-[860px]">
          <PricingCalculator />
        </div>

        <div className="mx-auto mt-12 grid max-w-[860px] gap-4 md:grid-cols-3">
          {[
            {
              icon: Calendar,
              title: "Pay Per Term",
              desc: "No lock-in contracts. Pay only when you compile results. Ideal for small schools and seasonal intake.",
            },
            {
              icon: Wallet,
              title: "Credit Wallet System",
              desc: "Buy credits upfront, use them as you add students. Wallet auto-debits on publish — transparent ledger.",
            },
            {
              icon: RotateCcw,
              title: "Rollover Credits",
              desc: "Unused student slots roll over to the next term forever. Never pay twice for the same slot.",
            },
          ].map((c) => (
            <div
              key={c.title}
              className="group rounded-2xl border border-purple-500/20 bg-purple-900/10 p-6 backdrop-blur transition hover:border-purple-500/30 hover:bg-purple-900/15 hover:shadow-[0_0_30px_rgba(147,51,234,0.12)]"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-purple-500/20 bg-purple-600/15 text-purple-300">
                <c.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">{c.title}</h3>
              <p className="mt-2 text-sm leading-6 text-purple-200/60">{c.desc}</p>
              <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-purple-300">
                <Check className="h-3.5 w-3.5" /> Included
              </div>
            </div>
          ))}
        </div>


        <div className="mx-auto mt-10 max-w-[860px] text-center">
          <Link
            href="/register"
            className="group inline-flex items-center justify-center gap-2 rounded-full bg-purple-600 px-10 py-4 text-base font-semibold text-white shadow-[0_0_40px_rgba(147,51,234,0.45)] transition-all hover:bg-purple-500 hover:shadow-[0_0_60px_rgba(147,51,234,0.6)] motion-safe:animate-pulse hover:motion-safe:animate-none"
          >
            Get Started Now
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <p className="mt-3 text-xs text-purple-200/50">Setup in 3 minutes • Flutterwave secured • No card required to preview</p>
        </div>
      </div>
    </div>
  );
}
