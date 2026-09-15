import Link from "next/link";
import { ArrowRight, CheckCircle2, FileSpreadsheet, School, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function HomePage() {
  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="mx-auto flex w-full max-w-6xl flex-col items-center gap-8 px-6 py-20 text-center md:py-28">
        <div className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-sm shadow-sm">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          Trusted by 500+ schools across Nigeria
        </div>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight md:text-6xl">
          School result compilation,{" "}
          <span className="text-blue-600">made effortless</span>
        </h1>
        <p className="max-w-2xl text-lg leading-8 text-zinc-600">
          ResultApp helps principals and admins compile, manage, and publish
          student results in minutes. Pay only for the students you process —
          no monthly subscription traps.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/register">
            <Button size="lg" className="gap-2">
              Get Started Free <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/pricing">
            <Button variant="outline" size="lg">
              View Pricing
            </Button>
          </Link>
        </div>

        <div className="mt-8 grid w-full max-w-4xl grid-cols-1 gap-6 md:grid-cols-3">
          {[
            { icon: FileSpreadsheet, title: "Bulk Upload", desc: "Upload scores via Excel/CSV" },
            { icon: ShieldCheck, title: "Secure & Compliant", desc: "Bank-grade security, NAPPS aligned" },
            { icon: School, title: "Principal Portal", desc: "Dedicated dashboard per school" },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-xl border bg-white p-6 text-left shadow-sm"
            >
              <f.icon className="mb-3 h-8 w-8 text-blue-600" />
              <h3 className="font-semibold">{f.title}</h3>
              <p className="text-sm text-zinc-600">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Social proof / features */}
      <section className="border-t bg-zinc-50 py-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-2xl font-semibold">
            Why schools switch to ResultApp
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              "Generate broadsheets & report cards automatically",
              "Credits never expire — pay per student, not per term",
              "Flutterwave-secured checkout & instant receipts",
              "Role-based access for teachers & admins",
              "Export to PDF / Print-ready report sheets",
              "24/7 support via WhatsApp & email",
            ].map((item) => (
              <div key={item} className="flex gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                <p className="text-sm leading-6 text-zinc-700">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto w-full max-w-6xl px-6 py-16 text-center">
        <div className="rounded-2xl bg-black px-8 py-12 text-white">
          <h2 className="text-3xl font-semibold">Ready to digitize your results?</h2>
          <p className="mx-auto mt-3 max-w-xl text-zinc-300">
            Onboard your school in under 3 minutes. No card required to start.
          </p>
          <Link href="/register" className="mt-6 inline-block">
            <Button variant="secondary" size="lg">
              Create School Account
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
