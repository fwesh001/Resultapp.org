import Link from "next/link";
import {
  ArrowRight,
  FileSpreadsheet,
  Calculator,
  Check,
  Users,
  Sparkles,
} from "lucide-react";
import { PricingCalculator } from "@/components/ui/PricingCalculator";
import FaqSection from "@/components/landing/FaqSection";
import FeaturesGrid from "@/components/landing/FeaturesGrid";
import { faqs } from "@/lib/faq";

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({
    "@type": "Question",
    name: f.question,
    acceptedAnswer: { "@type": "Answer", text: f.answer },
  })),
};

export default function HomePage() {
  return (
    <div className="text-purple-50 selection:bg-purple-600 selection:text-white">
      {/* ==================== ZONE A: Hero → Automated Grading — hero-preview.avif fixed ==================== */}
      <div className="relative isolate overflow-hidden bg-[#0B0514] [clip-path:inset(0)]">
        {/* Viewport-fixed background layer, clipped to this section via
            clip-path so mobile browsers skip background-attachment repaints */}
        <div
          aria-hidden
          className="fixed inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/hero-preview.avif')" }}
        />
        {/* 75% dark overlay for readability — was invisible before due to -z behind body */}
        <div aria-hidden className="absolute inset-0 bg-[#0B0514]/75" />
        {/* purple tint + gradients to keep monochromatic palette */}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-[#0B0514]/20 via-violet-950/15 to-[#0B0514]/85" />
        {/* ambient glows */}
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-220px] h-[680px] w-[1200px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,_rgba(147,51,234,0.18),transparent_65%)] blur-[1px]" />
        <div aria-hidden className="pointer-events-none absolute left-[-10%] top-[18%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(124,58,237,0.14),transparent_70%)] blur-[40px]" />
        <div aria-hidden className="pointer-events-none absolute right-[-8%] top-[42%] h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(168,85,247,0.11),transparent_70%)] blur-[40px]" />
        {/* subtle grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(168,85,247,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(168,85,247,0.04)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,#000_70%,transparent_110%)]"
        />

        {/* HERO */}
        <section className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-6 pb-10 pt-10 text-center md:pb-12 md:pt-16">
          <h1 className="mt-7 max-w-4xl text-[2.2rem] font-bold leading-[0.95] tracking-[-0.03em] md:text-6xl lg:text-[4.4rem]">
            <span className="block text-white">Automate Your</span>
            <span className="block bg-purple-500 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">
              School&apos;s Results.
            </span>
          </h1>

          <p className="mt-5 max-w-2xl text-[15px] leading-7 text-purple-200/70 md:text-lg md:leading-8">
            Say goodbye to manual grading errors and printing costs. The all-in-one result
            compilation platform built for modern schools.
          </p>

          <div className="mt-8 flex w-full flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/register"
              className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-purple-600 px-7 py-[14px] text-[15px] font-semibold text-white shadow-[0_0_30px_rgba(147,51,234,0.35),0_1px_0_rgba(255,255,255,0.15)_inset] transition-all hover:bg-purple-500 hover:shadow-[0_0_45px_rgba(147,51,234,0.5)] sm:w-auto"
            >
              Register Your School
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex w-full items-center justify-center rounded-full border border-purple-500/25 bg-purple-900/15 px-7 py-[14px] text-[15px] font-medium text-purple-100 backdrop-blur transition-all hover:border-purple-400/30 hover:bg-purple-500/10 hover:text-white sm:w-auto"
            >
              View Pricing
            </Link>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-purple-200/50">
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-purple-400" /> No monthly subscription
            </span>
            <span className="h-3 w-px bg-purple-500/15 max-sm:hidden" />
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-purple-400" /> Credits never expire
            </span>
            <span className="h-3 w-px bg-purple-500/15 max-sm:hidden" />
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-purple-400" /> Setup in 3 minutes
            </span>
          </div>

          {/* trust strip — now directly under CTAs since preview removed */}
          <div className="mt-10 flex w-full max-w-4xl flex-col items-center gap-3 rounded-2xl border border-purple-500/10 bg-purple-900/[0.06] px-6 py-4 backdrop-blur md:flex-row md:justify-between">
            <p className="text-xs font-medium tracking-widest text-purple-300/70">TRUSTED WORKFLOW</p>
            <div className="flex flex-wrap justify-center gap-6 text-sm text-purple-200/70">
              <span className="inline-flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-purple-400" /> CSV Import</span>
              <span className="h-4 w-px bg-purple-500/15 max-sm:hidden" />
              <span className="inline-flex items-center gap-2"><Calculator className="h-4 w-4 text-purple-400" /> Auto Grading</span>
              <span className="h-4 w-px bg-purple-500/15 max-sm:hidden" />
              <span className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-purple-400" /> Parent Portal</span>
            </div>
          </div>
        </section>

        {/* BENTO FEATURE GRID — still inside Zone A */}
        <section className="relative mx-auto w-full max-w-6xl px-6 pb-12 md:pb-16">
          <div className="mx-auto mb-8 max-w-2xl text-center md:mb-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/15 bg-purple-500/5 px-3 py-1 text-xs font-medium tracking-wide text-purple-300">
              <Sparkles className="h-3.5 w-3.5" /> PLATFORM FEATURES
            </div>
            <h2 className="mt-4 text-[1.7rem] font-semibold tracking-tight text-white md:text-4xl">
              Everything for seamless results
            </h2>
            <p className="mt-3 text-sm leading-6 text-purple-200/60 md:text-[15px]">
              Four powerful promises — speed, accuracy, branding and delight.
            </p>
          </div>

          <FeaturesGrid />
        </section>
      </div>

      {/* ==================== ZONE B: Pricing → CTA — bento-csv-accent.avif fixed ==================== */}
      <div className="relative isolate overflow-hidden bg-[#0B0514] [clip-path:inset(0)]">
        {/* Viewport-fixed background layer, clipped to this section via
            clip-path so mobile browsers skip background-attachment repaints */}
        <div
          aria-hidden
          className="fixed inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/bento-csv-accent.avif')" }}
        />
        {/* light veil — was 80%+90% now ~38% so bento-csv-accent shows VERY well */}
        <div aria-hidden className="absolute inset-0 bg-[#0B0514]/38" />
        <div aria-hidden className="absolute inset-0 bg-violet-950/12 mix-blend-multiply" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-[#0B0514]/10 via-transparent to-[#0B0514]/55" />
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(147,51,234,0.07),transparent_72%)]" />

        {/* PRICING CALCULATOR */}
        <section className="relative mx-auto w-full max-w-6xl px-6 pb-16 pt-10 md:pb-20 md:pt-12">
          <div className="mb-8 text-center md:mb-10">
            <h2 className="text-[1.7rem] font-semibold tracking-tight text-white md:text-4xl">Simple pricing, brutal clarity</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-purple-200/60 md:text-base">
              Use the calculator. See your exact slot cost instantly. No demos, no calls.
            </p>
          </div>

          <PricingCalculator />

          <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-5 text-purple-200/40">
            Prices in NGN. Slots are your permanent roster capacity and are bought once. Publishing results is a separate credit top-up — nothing expires. Need 2000+?{" "}
            <Link href="/pricing" className="font-medium text-purple-300 underline decoration-purple-500/30 underline-offset-4 hover:text-purple-200">
              See volume discounts
            </Link>{" "}
            on slot pricing.
          </p>
        </section>

        {/* FAQ — above the footer */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
        <div className="relative">
          <FaqSection />
        </div>
      </div>
    </div>
  );
}
