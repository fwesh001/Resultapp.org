import { SchoolRegistrationForm } from "@/components/forms/SchoolRegistrationForm";
import { CheckCircle2, ShieldCheck, Zap, GraduationCap } from "lucide-react";
import Link from "next/link";

export const metadata = {
  title: "Register Your School — ResultApp",
  description:
    "Onboard your school to ResultApp in under 3 minutes. Pay per student at 100 NGN and get your automated portal at subdomain.resultapp.org.",
};

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-zinc-50">
      {/* Top bar */}
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-black text-white">
            <GraduationCap className="h-5 w-5" />
          </span>
          resultapp.org
        </Link>
        <div className="hidden items-center gap-2 text-sm text-zinc-600 md:flex">
          <ShieldCheck className="h-4 w-4 text-green-600" />
          Secured by Flutterwave
        </div>
      </header>

      {/* Centered onboarding shell */}
      <div className="mx-auto max-w-6xl px-6 py-8 md:py-12">
        {/* Step indicator */}
        <div className="mx-auto mb-8 flex max-w-3xl items-center justify-center gap-2 text-sm">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black text-white">
            1
          </span>
          <span className="font-medium">School details</span>
          <span className="h-px w-8 bg-zinc-300" />
          <span className="flex h-7 w-7 items-center justify-center rounded-full border bg-white text-zinc-500">
            2
          </span>
          <span className="text-zinc-500">Payment</span>
          <span className="h-px w-8 bg-zinc-300" />
          <span className="flex h-7 w-7 items-center justify-center rounded-full border bg-white text-zinc-500">
            3
          </span>
          <span className="text-zinc-500">Portal ready</span>
        </div>

        <div className="grid gap-8 md:grid-cols-5 md:items-start">
          {/* Left: context / benefits - centered on mobile, left on desktop */}
          <div className="md:col-span-2">
            <div className="sticky top-6">
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
                Create your school portal
              </h1>
              <p className="mt-3 text-zinc-600">
                Get your automated portal at{" "}
                <span className="font-mono font-medium text-black">yourschool.resultapp.org</span>{" "}
                in minutes. Pay only per student.
              </p>

              <div className="mt-8 space-y-4">
                <div className="flex gap-3 rounded-xl border bg-white p-4 shadow-sm">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <Zap className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">100 NGN per student</h3>
                    <p className="text-sm text-zinc-600">
                      Example: 150 students = ₦15,000 one-time. Credits never expire.
                    </p>
                  </div>
                </div>

                <ul className="space-y-2.5 text-sm">
                  {[
                    "Instant subdomain provisioning after payment",
                    "Secure checkout via Flutterwave (card, transfer, USSD)",
                    "Admin account + student slots credited automatically",
                  ].map((item) => (
                    <li key={item} className="flex gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                      <span className="text-zinc-700">{item}</span>
                    </li>
                  ))}
                </ul>

                <div className="rounded-lg bg-zinc-900 p-4 text-white">
                  <p className="text-sm font-medium">How it works</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-300">
                    <li>Fill school & admin details</li>
                    <li>Pay via Flutterwave modal</li>
                    <li>Portal at <span className="font-mono text-white">subdomain.resultapp.org</span> is auto-created</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>

          {/* Right: centered form card */}
          <div className="md:col-span-3">
            <div className="rounded-2xl border bg-white p-6 shadow-sm md:p-8">
              <div className="mb-6">
                <h2 className="text-lg font-semibold">School registration</h2>
                <p className="text-sm text-zinc-500">
                  Enter your school details. Your total will be calculated instantly.
                </p>
              </div>

              {/* The form handles validation, real-time pricing, and Flutterwave success -> provisioning UI */}
              <SchoolRegistrationForm />

              <p className="mt-6 text-center text-xs text-zinc-500">
                Already have a portal?{" "}
                <Link href="/dashboard" className="font-medium text-black underline">
                  Sign in
                </Link>
              </p>
            </div>

            <p className="mt-4 text-center text-xs text-zinc-500">
              Questions? Email support@resultapp.org • WhatsApp +234 800 RESULTAPP
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
