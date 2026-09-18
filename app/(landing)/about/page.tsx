import { PageHero } from "@/components/ui/PageHero";
import Image from "next/image";
import { Target, Shield } from "lucide-react";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[#0B0514] text-purple-50">
      <PageHero title="About ResultApp" />

      <div className="mx-auto max-w-6xl px-6 py-12 md:py-16">
        <div className="relative">
          {/* center line */}
          <div className="pointer-events-none absolute left-1/2 top-0 hidden h-full w-px -translate-x-1/2 bg-purple-800/50 md:block" />

          {/* Section 1: Our Mission — image left, text right, Target */}
          <div className="relative grid gap-8 md:grid-cols-2 md:gap-12 md:items-center">
            <div className="relative order-1">
              <div className="overflow-hidden rounded-[1.4rem] border border-purple-500/15 bg-purple-900/10 shadow-[0_0_40px_rgba(147,51,234,0.12)] isolate">
                <Image
                  src="/our_mission.jpg"
                  alt="Students collaborating"
                  width={1408}
                  height={768}
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="block h-[240px] w-full max-w-full object-cover object-center md:h-[300px]"
                />
              </div>
              <div className="pointer-events-none absolute -inset-2 -z-10 rounded-[1.6rem] bg-purple-600/10 blur-xl" />
            </div>

            <div className="order-2 md:pl-6">
              <h2 className="text-2xl font-bold tracking-tight text-white">Our Mission</h2>
              <p className="mt-3 text-sm leading-7 text-purple-200/60">
                ResultApp exists to eliminate weeks of manual result compilation for Nigerian schools. From a 50-pupil community primary to a 3,000-student college, we give every school fast, affordable, and accurate processing.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-purple-200/70">
                <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-purple-500" /> Principals spend minutes, not weeks, publishing.</li>
                <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-purple-500" /> No more transcription errors or printing queues.</li>
              </ul>
            </div>

            {/* center node */}
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 md:flex">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-purple-500/20 bg-[#0B0514] text-purple-300 shadow-[0_0_20px_rgba(168,85,247,0.45)]">
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
              <h2 className="text-2xl font-bold tracking-tight text-white">Our Values</h2>
              <p className="mt-3 text-sm leading-7 text-purple-200/60">
                Affordability, reliability, and human support. Credits never expire, data stays in Africa with daily backups and 99.9% uptime, and real people answer on WhatsApp 8am–8pm WAT.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-purple-200/70">
                <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-purple-500" /> Affordability: Pay per student, not per month.</li>
                <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-purple-500" /> Reliability: 99.9% uptime, daily backups.</li>
                <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-purple-500" /> Human support: 8am–8pm WAT.</li>
              </ul>
            </div>

            <div className="relative order-1 md:order-2">
              <div className="overflow-hidden rounded-[1.4rem] border border-purple-500/15 bg-purple-900/10 shadow-[0_0_40px_rgba(147,51,234,0.12)] isolate">
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
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-purple-500/20 bg-[#0B0514] text-purple-300 shadow-[0_0_20px_rgba(168,85,247,0.45)]">
                <Shield className="h-5 w-5" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
