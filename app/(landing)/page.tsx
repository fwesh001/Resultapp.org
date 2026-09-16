import Link from "next/link";
import {
  ArrowRight,
  Globe,
  FileSpreadsheet,
  GraduationCap,
  Calculator,
  Check,
  Users,
  Sparkles,
  ShieldCheck,
  Zap,
  Eye,
} from "lucide-react";
import { PricingCalculator } from "@/components/ui/PricingCalculator";

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0B0514] text-purple-50 selection:bg-purple-600 selection:text-white">
      {/* ambient background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0B0514] via-[#0F0A1E] to-[#0B0514]" />
        <div className="absolute left-1/2 top-[-220px] h-[680px] w-[1200px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,_rgba(147,51,234,0.22),transparent_65%)] blur-[1px]" />
        <div className="absolute left-[-10%] top-[18%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(124,58,237,0.14),transparent_70%)] blur-[40px]" />
        <div className="absolute right-[-8%] top-[42%] h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle_at_center,_rgba(168,85,247,0.11),transparent_70%)] blur-[40px]" />
        {/* subtle grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(168,85,247,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(168,85,247,0.04)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,#000_70%,transparent_110%)]" />
      </div>

      {/* HERO */}
      <section className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-6 pb-10 pt-10 text-center md:pb-16 md:pt-16">
        {/* eyebrow */}
        <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-500/[0.08] px-4 py-1.5 text-xs font-medium tracking-wide text-purple-200 backdrop-blur">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-purple-500" />
          </span>
          Trusted by 500+ schools across Nigeria
          <span className="hidden h-3 w-px bg-purple-500/20 md:inline-block" />
          <span className="hidden items-center gap-1 text-purple-300 md:inline-flex">
            <ShieldCheck className="h-3.5 w-3.5" /> Flutterwave secured
          </span>
        </div>

        <h1 className="mt-7 max-w-4xl text-[2.2rem] font-bold leading-[0.95] tracking-[-0.03em] md:text-6xl lg:text-[4.4rem]">
          <span className="block text-white">Automate Your</span>
          <span className="block bg-gradient-to-r from-purple-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">
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

        {/* product preview */}
        <div className="relative mt-10 w-full max-w-[1040px] md:mt-12">
          {/* glow behind card */}
          <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-b from-purple-600/20 via-violet-600/10 to-transparent blur-2xl" />
          <div className="absolute -inset-px -z-10 rounded-[2rem] bg-gradient-to-b from-purple-500/20 to-transparent opacity-60" />

          <div className="relative overflow-hidden rounded-[1.6rem] border border-purple-500/20 bg-gradient-to-b from-purple-900/20 to-[#0B0514]/80 p-2 shadow-[0_20px_80px_-20px_rgba(124,58,237,0.5),0_0_0_1px_rgba(168,85,247,0.1)_inset] backdrop-blur-xl md:rounded-[2rem] md:p-3">
            {/* window chrome */}
            <div className="flex items-center gap-2 rounded-t-[1.1rem] border border-purple-500/10 bg-[#0D0A18]/80 px-4 py-3 backdrop-blur md:rounded-t-[1.6rem] md:px-5">
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-purple-500/30 ring-1 ring-purple-400/20" />
                <span className="h-3 w-3 rounded-full bg-violet-500/30 ring-1 ring-violet-400/20" />
                <span className="h-3 w-3 rounded-full bg-fuchsia-500/30 ring-1 ring-fuchsia-400/20" />
              </div>
              <div className="mx-auto hidden items-center gap-2 rounded-full border border-purple-500/10 bg-purple-950/50 px-3 py-1 text-xs text-purple-200/60 md:flex">
                <Globe className="h-3.5 w-3.5 text-purple-400" />
                vhs.resultapp.org — Valley High School Portal
                <span className="h-3 w-px bg-purple-500/20" />
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                Live
              </div>
              <div className="ml-auto hidden items-center gap-1 rounded-full bg-purple-600/15 px-2.5 py-1 text-[11px] font-medium tracking-wide text-purple-200 md:inline-flex">
                <Eye className="h-3 w-3" /> PREVIEW
              </div>
            </div>

            {/* image container */}
            <div className="relative overflow-hidden rounded-b-[1.1rem] bg-[#0A0612] md:rounded-b-[1.4rem]">
              <img
                src="/hero-preview.avif"
                alt="ResultApp dashboard preview — abstract purple gradient showcasing the platform interface"
                className="h-[280px] w-full object-cover md:h-[520px]"
                loading="eager"
              />
              {/* overlay gradient to blend */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0A0612] via-transparent to-transparent opacity-40" />
              {/* floating stats card */}
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-3 rounded-2xl border border-purple-500/15 bg-[#0B0514]/85 p-3 backdrop-blur-xl md:bottom-5 md:left-5 md:right-auto md:min-w-[360px] md:p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.4)]">
                    <GraduationCap className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold leading-none text-white">Term Results Published</div>
                    <div className="mt-1 text-xs text-purple-200/60">Second Term • 2025/2026</div>
                  </div>
                </div>
                <div className="hidden items-center gap-2 md:flex">
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/20">✓ Live</span>
                  <span className="rounded-full bg-purple-600 px-3 py-1 text-xs font-semibold text-white">1,248 students</span>
                </div>
              </div>
            </div>
          </div>

          {/* bottom fade */}
          <div className="pointer-events-none absolute inset-x-0 -bottom-10 h-10 bg-gradient-to-t from-[#0B0514] to-transparent md:h-16" />
        </div>

        {/* trust strip */}
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

      {/* BENTO FEATURE GRID */}
      <section className="relative mx-auto w-full max-w-6xl px-6 pb-12 md:pb-16">
        <div className="mx-auto mb-8 max-w-2xl text-center md:mb-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/15 bg-purple-500/5 px-3 py-1 text-xs font-medium tracking-wide text-purple-300">
            <Sparkles className="h-3.5 w-3.5" /> PLATFORM FEATURES
          </div>
          <h2 className="mt-4 text-[1.7rem] font-semibold tracking-tight text-white md:text-4xl">
            Everything for seamless results
          </h2>
          <p className="mt-3 text-sm leading-6 text-purple-200/60 md:text-[15px]">
            Three powerful pillars — designed as a bento, built for speed, accuracy and delight.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-5">
          {/* Box 1: Custom Subdomains — spans 2 */}
          <div className="group relative overflow-hidden rounded-[1.8rem] border border-purple-500/15 bg-purple-900/10 p-6 backdrop-blur-xl transition-all hover:border-purple-500/25 hover:bg-purple-900/15 hover:shadow-[0_0_40px_rgba(147,51,234,0.15)] md:col-span-2 md:p-8">
            <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-purple-600/15 blur-[50px] transition-opacity group-hover:bg-purple-600/20" />
            <div className="relative">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-purple-500/20 bg-purple-600/15 text-purple-300">
                <Globe className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-xl font-semibold tracking-tight text-white">Custom Subdomains</h3>
              <p className="mt-2 max-w-[52ch] text-sm leading-6 text-purple-200/65">
                Every school gets its own portal — e.g.{" "}
                <span className="rounded-md border border-purple-500/20 bg-purple-950/50 px-1.5 py-0.5 font-mono text-purple-200">
                  vhs.resultapp.org
                </span>{" "}
                — with instant SSL, custom branding, and a dedicated admin dashboard. No subfolders, no confusion.
              </p>

              {/* visual: browser mock for subdomain */}
              <div className="mt-6 overflow-hidden rounded-2xl border border-purple-500/15 bg-[#0B0514]/60 backdrop-blur">
                <div className="flex items-center gap-2 border-b border-purple-500/10 bg-purple-950/20 px-3 py-2.5">
                  <div className="flex gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-purple-500/20" />
                    <span className="h-2.5 w-2.5 rounded-full bg-purple-500/20" />
                    <span className="h-2.5 w-2.5 rounded-full bg-purple-500/20" />
                  </div>
                  <div className="mx-auto flex items-center gap-2 rounded-full border border-emerald-500/15 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    https://vhs.resultapp.org
                    <ShieldCheck className="h-3 w-3" />
                  </div>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-[1.2fr_0.8fr]">
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-600 text-white">
                        <GraduationCap className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">Valley High School</div>
                        <div className="text-xs text-purple-200/50">vhs.resultapp.org • Active</div>
                      </div>
                      <span className="ml-auto rounded-full bg-purple-600 px-2.5 py-1 text-[11px] font-semibold text-white">PRO</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      {[
                        { k: "Students", v: "1,248" },
                        { k: "Classes", v: "18" },
                        { k: "Terms", v: "3/active" },
                      ].map((s) => (
                        <div key={s.k} className="rounded-xl border border-purple-500/10 bg-purple-900/10 px-3 py-2.5 text-center">
                          <div className="text-sm font-semibold text-white">{s.v}</div>
                          <div className="text-[11px] tracking-wide text-purple-300/60">{s.k}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-purple-500/10 bg-gradient-to-br from-purple-600/15 to-violet-600/10 p-3">
                    <div className="text-xs font-medium tracking-wide text-purple-200">PORTAL FEATURES</div>
                    <ul className="mt-2 space-y-1.5 text-xs text-purple-200/70">
                      {["Instant provisioning", "Custom logo & colors", "Role-based access"].map((t) => (
                        <li key={t} className="flex items-center gap-1.5">
                          <Check className="h-3.5 w-3.5 text-purple-400" /> {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {["SSL included", "Custom domain support", "99.9% uptime"].map((tag) => (
                  <span key={tag} className="rounded-full border border-purple-500/15 bg-purple-500/5 px-3 py-1 text-xs text-purple-200/70">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Box 2: Bulk CSV Upload — 1 column with decorative image */}
          <div className="group relative flex flex-col overflow-hidden rounded-[1.8rem] border border-purple-500/15 bg-purple-900/10 backdrop-blur-xl transition-all hover:border-purple-500/25 hover:bg-purple-900/15 hover:shadow-[0_0_40px_rgba(147,51,234,0.15)] md:col-span-1">
            {/* decorative image as background accent */}
            <div className="absolute inset-0">
              <img
                src="/bento-csv-accent.avif"
                alt=""
                className="h-full w-full object-cover opacity-[0.12] mix-blend-luminosity grayscale transition-opacity group-hover:opacity-[0.18]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0B0514] via-[#0B0514]/70 to-purple-950/20" />
              <div className="absolute inset-0 bg-gradient-to-br from-purple-600/10 via-transparent to-transparent" />
            </div>

            <div className="relative flex h-full flex-col p-6 md:p-7">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-purple-500/20 bg-purple-600/15 text-purple-300">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-xl font-semibold tracking-tight text-white">Bulk CSV Upload</h3>
              <p className="mt-2 text-sm leading-6 text-purple-200/65">
                Instant student onboarding. Drop your Excel/CSV and we map names, admission numbers, classes in seconds — with validation and error highlights.
              </p>

              {/* mock CSV preview */}
              <div className="mt-6 overflow-hidden rounded-xl border border-purple-500/15 bg-[#0B0514]/70 backdrop-blur">
                <div className="flex items-center justify-between border-b border-purple-500/10 bg-purple-900/10 px-3 py-2">
                  <span className="text-xs font-medium tracking-wide text-purple-200">students_jss1.csv</span>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">✓ Validated</span>
                </div>
                <div className="space-y-1 p-3 font-mono text-[11px] leading-5">
                  <div className="flex gap-2 text-purple-300/50">
                    <span className="w-6">1</span>
                    <span>Admission No, First Name, Class</span>
                  </div>
                  <div className="flex gap-2 text-purple-100">
                    <span className="w-6 text-purple-400/50">2</span>
                    <span>VHS/2024/001, Amara, JSS1A</span>
                  </div>
                  <div className="flex gap-2 text-purple-100">
                    <span className="w-6 text-purple-400/50">3</span>
                    <span>VHS/2024/002, Chinedu, JSS1A</span>
                  </div>
                  <div className="flex gap-2 text-purple-300/60">
                    <span className="w-6">4</span>
                    <span className="opacity-60">… 248 more rows</span>
                  </div>
                </div>
              </div>

              <div className="mt-auto pt-5">
                <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/15 bg-purple-500/10 px-3 py-1 text-xs font-medium text-purple-200">
                  <Zap className="h-3.5 w-3.5 text-purple-300" />
                  500 rows in ~8 seconds
                </div>
              </div>
            </div>
          </div>

          {/* Box 3: Automated Grading & Parent Portal — spans 3 columns */}
          <div className="group relative overflow-hidden rounded-[1.8rem] border border-purple-500/15 bg-purple-900/10 p-6 backdrop-blur-xl transition-all hover:border-purple-500/25 hover:bg-purple-900/15 hover:shadow-[0_0_40px_rgba(147,51,234,0.15)] md:col-span-3 md:p-8">
            <div className="pointer-events-none absolute -bottom-24 left-1/2 h-80 w-[700px] -translate-x-1/2 rounded-full bg-violet-600/10 blur-[50px] group-hover:bg-violet-600/15" />

            <div className="relative grid gap-6 md:grid-cols-[1.1fr_1.2fr] md:items-center md:gap-8">
              <div>
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-purple-500/20 bg-purple-600/15 text-purple-300">
                  <Calculator className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-xl font-semibold tracking-tight text-white md:text-2xl">
                  Automated Grading &amp; Parent Portal
                </h3>
                <p className="mt-3 max-w-[56ch] text-sm leading-6 text-purple-200/65 md:text-[15px]">
                  CA auto-calculation, instant digital report cards, and a secure parent login. No more manual totals, no more printing queues — parents view results the moment you publish.
                </p>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {[
                    { title: "Auto CA & Exam", desc: "CA1 + CA2 + Exam = Total, grade & remark auto-generated" },
                    { title: "1-tap Publish", desc: "Push to parent portal & send SMS/email notifications" },
                    { title: "Broadsheet Export", desc: "PDF & Excel, print-ready with school branding" },
                    { title: "Parent Access", desc: "Secure PIN to view & download report cards" },
                  ].map((f) => (
                    <div key={f.title} className="flex gap-3 rounded-xl border border-purple-500/10 bg-purple-950/20 p-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-600/20 text-purple-300">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                      <div>
                        <div className="text-sm font-medium text-white">{f.title}</div>
                        <div className="mt-1 text-xs leading-5 text-purple-200/60">{f.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* visual: grading table + parent card */}
              <div className="relative overflow-hidden rounded-[1.4rem] border border-purple-500/15 bg-[#0B0514]/60 p-3 backdrop-blur">
                <div className="overflow-hidden rounded-xl border border-purple-500/10 bg-[#0F0A1E]">
                  <div className="flex items-center justify-between border-b border-purple-500/10 bg-purple-900/10 px-4 py-3">
                    <span className="text-sm font-medium text-white">JSS1A — Mathematics</span>
                    <span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2.5 py-1 text-xs text-purple-200">Second Term</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-purple-950/30 text-[11px] tracking-wide text-purple-300/70">
                        <tr>
                          <th className="px-3 py-2 font-medium">Student</th>
                          <th className="px-2 py-2 font-medium">CA1</th>
                          <th className="px-2 py-2 font-medium">CA2</th>
                          <th className="px-2 py-2 font-medium">Exam</th>
                          <th className="px-3 py-2 text-right font-medium">Total • Grade</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-purple-500/5 text-purple-100/80">
                        {[
                          { n: "Amara O.", c1: 18, c2: 16, ex: 58, tot: 92, g: "A" },
                          { n: "Chinedu E.", c1: 15, c2: 14, ex: 52, tot: 81, g: "A" },
                          { n: "Fatima S.", c1: 12, c2: 13, ex: 44, tot: 69, g: "B" },
                        ].map((r) => (
                          <tr key={r.n} className="hover:bg-purple-900/10">
                            <td className="px-3 py-2.5 font-medium text-white">{r.n}</td>
                            <td className="px-2 py-2.5">{r.c1}</td>
                            <td className="px-2 py-2.5">{r.c2}</td>
                            <td className="px-2 py-2.5">{r.ex}</td>
                            <td className="px-3 py-2.5 text-right">
                              <span className="font-semibold text-white">{r.tot}</span>
                              <span className="ml-2 rounded-md bg-purple-600 px-1.5 py-0.5 text-[11px] font-bold text-white">{r.g}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between border-t border-purple-500/10 bg-purple-900/10 px-3 py-2 text-xs">
                    <span className="text-purple-300/60">Auto-calculated • No manual errors</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-1 font-medium text-emerald-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Saved
                    </span>
                  </div>
                </div>

                {/* parent portal card overlapping */}
                <div className="mt-3 flex items-center gap-3 rounded-xl border border-purple-500/15 bg-gradient-to-r from-purple-600/15 to-violet-600/15 p-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-purple-700">
                    <Users className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">Parent Portal Live</div>
                    <div className="truncate text-xs text-purple-200/60">parents.vhs.resultapp.org • PIN: 4821</div>
                  </div>
                  <span className="ml-auto shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-purple-700">View report</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING CALCULATOR */}
      <section className="relative mx-auto w-full max-w-6xl px-6 pb-16 md:pb-20">
        <div className="mb-8 text-center md:mb-10">
          <h2 className="text-[1.7rem] font-semibold tracking-tight text-white md:text-4xl">Simple pricing, brutal clarity</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-purple-200/60 md:text-base">
            Use the calculator. See your exact term cost instantly. No demos, no calls.
          </p>
        </div>

        <PricingCalculator />

        <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-5 text-purple-200/40">
          Prices in NGN. One credit = one student result for one term. Need 2000+?{" "}
          <Link href="/pricing" className="font-medium text-purple-300 underline decoration-purple-500/30 underline-offset-4 hover:text-purple-200">
            See volume discounts
          </Link>{" "}
          and enterprise plans.
        </p>
      </section>

      {/* bottom CTA — subtle */}
      <section className="relative mx-auto w-full max-w-6xl px-6 pb-12">
        <div className="relative overflow-hidden rounded-[1.8rem] border border-purple-500/15 bg-gradient-to-br from-purple-600/15 via-violet-600/10 to-transparent p-[1px]">
          <div className="rounded-[1.75rem] bg-gradient-to-br from-[#0F0A1E] to-[#0B0514] px-6 py-8 md:px-10 md:py-10">
            <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
              <div>
                <h3 className="text-xl font-semibold tracking-tight text-white md:text-2xl">Ready to digitize your school?</h3>
                <p className="mt-2 max-w-xl text-sm leading-6 text-purple-200/60">
                  Join 500+ schools that publish results in minutes, not weeks. Your subdomain is ready right after payment.
                </p>
              </div>
              <div className="flex shrink-0 gap-3">
                <Link
                  href="/register"
                  className="inline-flex items-center gap-2 rounded-full bg-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_30px_rgba(147,51,234,0.3)] hover:bg-purple-500"
                >
                  Get Started Free <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
