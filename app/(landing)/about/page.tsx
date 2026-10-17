import type { Metadata } from "next";
import { PageHero } from "@/components/ui/PageHero";
import Image from "next/image";
import Link from "next/link";
import { Target, Shield } from "lucide-react";

export const metadata: Metadata = {
  title: "About ResultApp",
  description:
    "ResultApp is built for Nigerian schools: automated grading, digital report cards, custom school portals, and pay-per-student billing. Meet the mission.",
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-surface-0 text-text-1">
      <PageHero title="About ResultApp" />

      <div className="mx-auto max-w-6xl px-6 py-12 md:py-16">
        <div className="relative">
          {/* center line */}
          <div className="pointer-events-none absolute left-1/2 top-0 hidden h-full w-px -translate-x-1/2 bg-line-2 md:block" />

          {/* Section 1: Our Mission — image left, text right, Target */}
          <div className="relative grid gap-8 md:grid-cols-2 md:gap-12 md:items-center">
            <div className="relative order-1">
              <div className="overflow-hidden rounded-[1.4rem] border border-line-1 bg-surface-1 shadow-[0_0_40px_rgba(147,51,234,0.12)] isolate">
                <Image
                  src="/our_mission.jpg"
                  alt="Students collaborating"
                  width={1408}
                  height={768}
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="block h-[240px] w-full max-w-full object-cover object-center md:h-[300px]"
                />
              </div>
              <div className="pointer-events-none absolute -inset-2 -z-10 rounded-[1.6rem] bg-accent-soft blur-xl" />
            </div>

            <div className="order-2 md:pl-6">
              <h2 className="text-2xl font-bold tracking-tight text-text-1">Our Mission</h2>
              <p className="mt-3 text-sm leading-7 text-text-3">
                ResultApp exists to eliminate weeks of manual result compilation for Nigerian schools. From a 50-pupil community primary to a 3,000-student college, we give every school fast, affordable, and accurate processing.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-text-2">
                <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-accent" /> Principals spend minutes, not weeks, publishing.</li>
                <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-accent" /> No more transcription errors or printing queues.</li>
              </ul>
            </div>

            {/* center node */}
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 md:flex">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line-1 bg-surface-1 text-accent shadow-[0_0_20px_rgba(168,85,247,0.45)]">
                <Target className="h-5 w-5" />
              </span>
            </div>
          </div>

          {/* spacer */}
          <div className="h-10 md:h-16" />

          {/* Section 2: Our Values — text left, image right, Shield */}
          <div className="relative grid gap-8 md:grid-cols-2 md:gap-12 md:items-center">
            {/* text first on desktop */}
            <div className="order-2 md:order-1 md:pr-6 md:text-right">
              <h2 className="text-2xl font-bold tracking-tight text-text-1">Our Values</h2>
              <p className="mt-3 text-sm leading-7 text-text-3">
                Affordability, reliability, and human support. Credits never expire, portal sessions are cryptographically signed and expire after 12 hours, and real people answer on WhatsApp 8am–8pm WAT.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-text-2">
                <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-accent" /> Affordability: Pay per student, not per month.</li>
                <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-accent" /> Reliability: signed sessions, tenant-isolated portals, regular backups.</li>
                <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-accent" /> Human support: 8am–8pm WAT.</li>
                <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-accent" /> Straight answers: what we store, and where, is set out in our <Link href="/privacy" className="underline decoration-accent/40 underline-offset-4 hover:text-text-1">Privacy Policy</Link>.</li>
              </ul>
            </div>

            <div className="relative order-1 md:order-2">
              <div className="overflow-hidden rounded-[1.4rem] border border-line-1 bg-surface-1 shadow-[0_0_40px_rgba(147,51,234,0.12)] isolate">
                <Image
                  src="/our_value.jpg"
                  alt="Team values"
                  width={1408}
                  height={666}
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="block h-[240px] w-full max-w-full object-cover object-center md:h-[300px]"
                />
              </div>
              <div className="pointer-events-none absolute -inset-2 -z-10 rounded-[1.6rem] bg-violet-600/10 blur-xl" />
            </div>

            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 md:flex">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line-1 bg-surface-1 text-accent shadow-[0_0_20px_rgba(168,85,247,0.45)]">
                <Shield className="h-5 w-5" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
