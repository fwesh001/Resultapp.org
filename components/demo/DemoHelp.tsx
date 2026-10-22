"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, CircleHelp } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import DemoCredentialsCard from "@/components/demo/DemoCredentialsCard";
import { faqsForPath, type DemoFaq } from "@/lib/demoHelpContent";
import { DEMO_GUIDE_EVENT, DEMO_GUIDE_STORAGE_KEY } from "@/lib/demoPersonas";

/**
 * Sticky demo help button with the credentials card + contextual FAQs.
 * Demo tenants only.
 *
 * - The credentials card is a PINNED first section: one-click copyable logins
 *   for the admin / staff / student personas the seeder creates.
 * - FAQ content comes from lib/demoHelpContent.ts, matched by current route.
 * - Single-open accordion reuses the product's FaqSection pattern.
 * - Onboarding opens: auto-opens ONCE per session on the login pages, and
 *   ONCE post-provisioning (DemoLauncher writes DEMO_GUIDE_STORAGE_KEY right
 *   before redirecting into a freshly provisioned classroom). DemoBanner's
 *   "Credentials" trigger opens it from any page via DEMO_GUIDE_EVENT, so
 *   there is always a one-tap path back even if it was dismissed.
 */

const LOGIN_PATH_RE = /\/(admin|staff|student)\/login/;
const SEEN_KEY = "demo-help-seen";

export function DemoHelp({ subdomain }: { subdomain: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const faqs = faqsForPath(pathname);

  // Auto-open sources, decided ONE tick after render so the effect body never
  // calls setState synchronously (react-hooks/set-state-in-effect): the
  // consumed-once post-provision flag wins over the once-per-session login
  // gate. Every side effect — storage reads/writes AND the open itself —
  // lives in the scheduled callback; the effect only schedules it, and the
  // cleanup cancels it if the route changes out from underneath.
  useEffect(() => {
    let cancelled = false;
    function decide() {
      if (cancelled) return;
      try {
        if (sessionStorage.getItem(DEMO_GUIDE_STORAGE_KEY)) {
          sessionStorage.removeItem(DEMO_GUIDE_STORAGE_KEY);
          setOpen(true);
          return;
        }
        if (!LOGIN_PATH_RE.test(pathname)) return;
        if (sessionStorage.getItem(SEEN_KEY)) return;
        sessionStorage.setItem(SEEN_KEY, "1");
        setOpen(true);
      } catch {
        // Private mode without sessionStorage: show help rather than nothing.
        setOpen(true);
      }
    }
    const timer = window.setTimeout(decide, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pathname]);

  // DemoBanner's "Credentials" control (and the homepage strip's guide
  // button) reach this modal from any page through the shared event —
  // setState happens in the subscriber callback, an allowed external
  // system interaction.
  useEffect(() => {
    function handleGuideEvent() {
      setOpen(true);
    }
    window.addEventListener(DEMO_GUIDE_EVENT, handleGuideEvent);
    return () => window.removeEventListener(DEMO_GUIDE_EVENT, handleGuideEvent);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Demo help — credentials and what can I try here?"
        className="fixed bottom-6 right-6 z-[60] flex h-12 w-12 items-center justify-center rounded-full bg-purple-600 text-white shadow-[0_0_24px_rgba(147,51,234,0.45)] transition hover:bg-purple-500"
      >
        <CircleHelp className="h-6 w-6" aria-hidden />
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Demo guide"
        description="Copy-ready logins for every persona, then plain-language help for this exact page."
        size="lg"
      >
        <DemoCredentialsCard subdomain={subdomain} variant="modal" />
        <hr className="my-5 border-line-1" />
        {/* key={pathname}: a route change remounts the accordion, so the open
            question resets to the first FAQ for the new page family without a
            setState-in-effect reset. */}
        <FaqAccordion key={pathname} faqs={faqs} />
      </Modal>
    </>
  );
}

function FaqAccordion({ faqs }: { faqs: DemoFaq[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="space-y-3">
      {faqs.map((faq, i) => {
        const expanded = openIndex === i;
        return (
          <div
            key={faq.q}
            className={`overflow-hidden rounded-2xl border backdrop-blur transition-colors ${
              expanded ? "border-purple-500/30 bg-purple-900/15" : "border-purple-500/15 bg-purple-900/10"
            }`}
          >
            <button
              type="button"
              onClick={() => setOpenIndex(expanded ? null : i)}
              aria-expanded={expanded}
              aria-controls={`demo-help-panel-${i}`}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <span className="text-[15px] font-medium text-white">{faq.q}</span>
              <ChevronDown
                className={`h-5 w-5 shrink-0 text-purple-300 transition-transform duration-300 ${
                  expanded ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </button>
            <div
              id={`demo-help-panel-${i}`}
              role="region"
              className={`grid transition-all duration-300 ease-in-out ${
                expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                <p className="px-5 pb-5 text-sm leading-6 text-purple-200/70">{faq.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
