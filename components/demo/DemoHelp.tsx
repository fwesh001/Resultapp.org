"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, CircleHelp } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { faqsForPath } from "@/lib/demoHelpContent";

/**
 * Sticky demo help button with contextual FAQs. Demo tenants only.
 *
 * - Content comes from lib/demoHelpContent.ts, matched by current route.
 * - Single-open accordion reuses the product's FaqSection pattern.
 * - Auto-opens ONCE per browser session, and only on the login pages, so
 *   prospects get the dummy credentials handed to them at the door without
 *   being nagged inside the dashboard.
 */

const LOGIN_PATH_RE = /\/(admin|staff)\/login/;
const SEEN_KEY = "demo-help-seen";

export function DemoHelp() {
  const [open, setOpen] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const pathname = usePathname();
  const faqs = faqsForPath(pathname);

  useEffect(() => {
    if (!LOGIN_PATH_RE.test(pathname)) return;
    try {
      if (sessionStorage.getItem(SEEN_KEY)) return;
      sessionStorage.setItem(SEEN_KEY, "1");
      setOpen(true);
    } catch {
      // Private mode without sessionStorage: show help rather than nothing.
      setOpen(true);
    }
  }, [pathname]);

  // Reset the open question when the route family changes.
  useEffect(() => {
    setOpenIndex(0);
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Demo help — what can I try here?"
        className="fixed bottom-6 right-6 z-[60] flex h-12 w-12 items-center justify-center rounded-full bg-purple-600 text-white shadow-[0_0_24px_rgba(147,51,234,0.45)] transition hover:bg-purple-500"
      >
        <CircleHelp className="h-6 w-6" aria-hidden />
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Demo guide"
        description="Plain-language help for this exact page."
      >
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
      </Modal>
    </>
  );
}
