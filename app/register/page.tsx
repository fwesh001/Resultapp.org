import { RegisterSchoolForm } from "@/components/forms/RegisterSchoolForm";
// Phase 3: paid tier — keep side-by-side, not deleted: `SchoolRegistrationForm` remains at `@/components/forms/SchoolRegistrationForm`
import { CheckCircle2, ShieldCheck, Zap, GraduationCap, Users, Sparkles } from "lucide-react";
import { Footer } from "@/components/layout/Footer";
import Link from "next/link";

export const metadata = {
  title: "Register Your School — ResultApp",
  description:
    "Onboard your school to ResultApp in under 3 minutes. Pay per student at 100 NGN and get your automated portal at subdomain.resultapp.org.",
};

export default function RegisterPage() {
  return (
    <>
      <div className="min-h-screen bg-[#0B0514]">
      <main id="main-content" className="grid lg:h-screen lg:grid-cols-2 lg:overflow-hidden">
      {/* LEFT — Brand / Visual (sticky desktop, short banner mobile) */}
      <div className="relative hidden overflow-hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="absolute inset-0">
          <img src="/hero-preview.avif" alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B0514] via-purple-900/40 to-transparent" />
          <div className="absolute inset-0 bg-[#0B0514]/25" />
          <div className="absolute inset-0 bg-gradient-to-br from-violet-600/15 via-transparent to-transparent" />
        </div>

        {/* ambient */}
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-purple-600/20 blur-[70px]" />
        <div aria-hidden className="pointer-events-none absolute -left-20 bottom-0 h-64 w-64 rounded-full bg-violet-600/15 blur-[60px]" />

        <div className="relative z-10 flex h-full flex-col justify-between p-8 xl:p-10">
          <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.35)]">
              <GraduationCap className="h-5 w-5" />
            </span>
            <span className="text-[15px] font-semibold text-white">resultapp.org</span>
          </Link>

          <div>
            <h1 className="mt-5 max-w-[22ch] text-3xl font-bold leading-[0.95] tracking-tight text-white xl:text-4xl">
              Automate Your
              <span className="block bg-gradient-to-r from-purple-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">
                School’s Results.
              </span>
            </h1>
            <p className="mt-4 max-w-[36ch] text-sm leading-6 text-purple-200/70">
              Say goodbye to manual errors and printing costs.               Your portal at <span className="font-mono text-purple-200">yourschool.resultapp.org</span> goes live right after registration.
            </p>

            <div className="mt-8 grid gap-3">
              {[
                { icon: Users, text: "Custom subdomain + SSL" },
                { icon: Zap, text: "100 NGN per student — credits never expire" },
                { icon: ShieldCheck, text: "Flutterwave secured checkout" },
              ].map((r) => (
                <div key={r.text} className="flex items-center gap-3 rounded-xl border border-purple-500/10 bg-white/5 px-4 py-3 backdrop-blur">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-600/20 text-purple-300">
                    <r.icon className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-medium text-purple-50">{r.text}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs leading-5 text-purple-200/40">© {new Date().getFullYear()} resultapp.org • Secured by Flutterwave</p>
        </div>
      </div>

      {/* RIGHT — Scrollable Form */}
      <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-[#0B0514] lg:h-screen lg:min-h-0 lg:overflow-y-auto lg:overflow-x-hidden">
        {/* subtle ambient for right — no full-bleed image per user request */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#0B0514] via-[#0F0A1E] to-[#0B0514]" />
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-120px] h-[400px] w-[600px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,_rgba(147,51,234,0.12),transparent_70%)] blur-[1px]" />

        {/* mobile hero banner */}
        <div className="relative h-[190px] overflow-hidden lg:hidden">
          <img src="/hero-preview.avif" alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B0514] via-purple-900/35 to-transparent" />
          <div className="absolute inset-0 bg-[#0B0514]/20" />
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-5">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-600 text-white">
                <GraduationCap className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold text-white">resultapp.org</span>
            </Link>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-purple-100 backdrop-blur">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" /> Secured
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-0 p-5">
            <p className="text-sm font-semibold text-white">Create your school portal</p>
            <p className="text-xs text-purple-200/70">yourschool.resultapp.org in minutes</p>
          </div>
        </div>

        {/* desktop top bar (small) */}
        <div className="relative hidden items-center justify-end px-8 py-5 lg:flex">
          <span className="inline-flex items-center gap-2 rounded-full border border-purple-500/15 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-200">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            Secured by Flutterwave
          </span>
        </div>

        <div className="relative flex flex-1 items-start justify-center px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
          <div className="w-full max-w-[560px]">
            {/* Step indicator — purple rings */}
            <div className="mx-auto mb-8 flex items-center justify-center gap-2 text-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-600 text-white shadow-[0_0_14px_rgba(147,51,234,0.45)] ring-1 ring-purple-500/30">
                1
              </span>
              <span className="font-medium text-white">School details</span>
              <span className="h-px w-6 bg-purple-500/20 sm:w-8" />
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-purple-500/20 bg-purple-950/30 text-purple-300">
                2
              </span>
              <span className="text-purple-300/60">Setup</span>
              <span className="h-px w-6 bg-purple-500/20 sm:w-8" />
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-purple-500/15 bg-purple-950/20 text-purple-400/60">
                3
              </span>
              <span className="text-purple-300/40">Portal ready</span>
            </div>

            {/* heading (desktop right also shows, mobile banner already) */}
            <div className="mb-6 hidden lg:block">
              <h1 className="text-2xl font-bold tracking-tight text-white">Create your school portal</h1>
              <p className="mt-2 text-sm leading-6 text-purple-200/60">
                Get your automated portal at <span className="font-mono font-medium text-purple-200">yourschool.resultapp.org</span> in minutes. Pay only per student.
              </p>
            </div>


            {/* form card — dark — Phase 1: direct provision (no payment) */}
            <div className="rounded-[1.6rem] border border-purple-500/15 bg-purple-900/[0.07] p-5 backdrop-blur-xl sm:p-6 md:p-7">
              <div className="mb-6">
                <h2 className="text-base font-semibold tracking-tight text-white">School registration</h2>
                <p className="mt-1 text-sm text-purple-200/60">Enter your school details. Your portal at subdomain.resultapp.org will be provisioned securely.</p>
              </div>

              <RegisterSchoolForm />
              {/* Phase 3: paid flow remains available: import { SchoolRegistrationForm } from "@/components/forms/SchoolRegistrationForm" */}

              <p className="mt-6 text-center text-xs text-purple-200/50">
                Already have a portal?{" "}
                <Link href="/dashboard" className="font-medium text-purple-300 underline decoration-purple-500/30 underline-offset-4 hover:text-white">
                  Sign in
                </Link>
              </p>
            </div>

            <ul className="mt-5 space-y-2.5 text-sm">
              {[
                "Instant subdomain provisioning after registration",
                "Secure provisioning with instant SSL and admin onboarding",
                "Admin account + student slots credited automatically",
              ].map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <span className="text-purple-200/60">{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-5 rounded-xl border border-purple-500/15 bg-[#0F0A1E]/60 p-4 backdrop-blur">
              <p className="text-sm font-medium text-white">How it works</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-purple-200/60">
                <li>Fill school & admin details</li>
                <li>Pay via Flutterwave modal</li>
                <li>
                  Portal at <span className="font-mono text-purple-200">subdomain.resultapp.org</span> is auto-created
                </li>
              </ol>
            </div>

            <p className="mt-6 text-center text-xs text-purple-200/70">
              Questions? Email support@resultapp.org • WhatsApp +234 702 506 7494
            </p>
          </div>
        </div>
      </main>
      </div>
      <Footer />
    </>
  );
}
