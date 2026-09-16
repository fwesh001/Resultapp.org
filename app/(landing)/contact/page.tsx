import { PageHero } from "@/components/ui/PageHero";
import { ContactForm } from "@/components/forms/ContactForm";
import { MapPin, Mail, MessageCircle, ExternalLink } from "lucide-react";
import Link from "next/link";

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-[#0B0514] text-purple-50">
      <PageHero title="Contact Us" />

      <div className="mx-auto max-w-6xl px-6 py-10 md:py-12">
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Left */}
          <div className="space-y-4">
            <a
              href="https://wa.me/2347025067494"
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-[#25D366] px-6 py-5 text-base font-bold text-white shadow-[0_0_30px_rgba(37,211,102,0.35)] transition hover:bg-[#20bd5a] hover:shadow-[0_0_40px_rgba(37,211,102,0.5)]"
            >
              <MessageCircle className="h-6 w-6" />
              Chat with Support: 07025067494
              <ExternalLink className="h-4 w-4 opacity-70" />
            </a>
            <p className="text-center text-xs text-purple-300/50">Fastest response • 8am–8pm WAT • Tap to open WhatsApp</p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-purple-500/15 bg-purple-900/10 p-5 backdrop-blur">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-600/15 text-purple-300 ring-1 ring-purple-500/15">
                  <MapPin className="h-5 w-5" />
                </div>
                <h3 className="mt-3 text-sm font-semibold text-white">Location</h3>
                <p className="mt-1 text-sm leading-6 text-purple-200/60">Abuja / Nasarawa<br />Nigeria • Remote-first</p>
              </div>
              <div className="rounded-2xl border border-purple-500/15 bg-purple-900/10 p-5 backdrop-blur">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-600/15 text-purple-300 ring-1 ring-purple-500/15">
                  <Mail className="h-5 w-5" />
                </div>
                <h3 className="mt-3 text-sm font-semibold text-white">Email</h3>
                <a href="mailto:zabdielfwesh001@gmail.com" className="mt-1 block text-sm font-medium text-purple-300 hover:text-white">
                  zabdielfwesh001@gmail.com
                </a>
                <p className="text-xs text-purple-300/50">For partnerships & support</p>
              </div>
            </div>

            <div className="rounded-2xl border border-purple-500/10 bg-[#0F0A1E]/60 p-5 text-center">
              <p className="text-xs tracking-wide text-purple-300/60">ENGINEERED BY</p>
              <a
                href="https://zabdiel.tech"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-white hover:text-purple-300"
              >
                Zabdiel Tech <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <p className="mt-1 text-xs text-purple-200/50">Crafting reliable ed-tech for Nigerian schools.</p>
            </div>
          </div>

          {/* Right */}
          <div>
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-white">Send a message</h2>
              <p className="text-sm text-purple-200/60">We reply within hours on weekdays.</p>
            </div>
            <ContactForm />
            <p className="mt-4 text-center text-xs text-purple-300/40">
              Or email <Link href="mailto:support@resultapp.org" className="underline decoration-purple-500/30 underline-offset-4 hover:text-purple-200">support@resultapp.org</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
