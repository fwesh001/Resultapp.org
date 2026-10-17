import { PageHero } from "@/components/ui/PageHero";
import { ContactForm } from "@/components/forms/ContactForm";
import { MapPin, Mail, MessageCircle, ExternalLink } from "lucide-react";
import Link from "next/link";

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-surface-0 text-text-1">
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
            <p className="text-center text-xs text-text-3">Fastest response • 8am–8pm WAT • Tap to open WhatsApp</p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-line-1 bg-surface-1 p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent ring-1 ring-accent/30">
                  <MapPin className="h-5 w-5" />
                </div>
                <h3 className="mt-3 text-sm font-semibold text-text-1">Location</h3>
                <p className="mt-1 text-sm leading-6 text-text-3">Abuja / Nasarawa<br />Nigeria • Remote-first</p>
              </div>
              <div className="rounded-2xl border border-line-1 bg-surface-1 p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent ring-1 ring-accent/30">
                  <Mail className="h-5 w-5" />
                </div>
                <h3 className="mt-3 text-sm font-semibold text-text-1">Email</h3>
                <a href="mailto:zabdielfwesh001@gmail.com" className="mt-1 block text-sm font-medium text-accent hover:text-text-1">
                  zabdielfwesh001@gmail.com
                </a>
                <p className="text-xs text-text-3">For partnerships & support</p>
              </div>
            </div>

            <div className="rounded-2xl border border-line-2 bg-surface-2 p-5 text-center">
              <p className="text-xs tracking-wide text-text-3">ENGINEERED BY</p>
              <a
                href="https://zabdiel.tech"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-text-1 hover:text-accent"
              >
                Zabdiel Tech <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <p className="mt-1 text-xs text-text-3">Crafting reliable ed-tech for Nigerian schools.</p>
            </div>
          </div>

          {/* Right */}
          <div>
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-text-1">Send a message</h2>
              <p className="text-sm text-text-3">We reply within hours on weekdays.</p>
            </div>
            <ContactForm />
            <p className="mt-4 text-center text-xs text-text-3">
              Or email <Link href="mailto:support@resultapp.org" className="underline decoration-accent/30 underline-offset-4 hover:text-text-2">support@resultapp.org</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
