"use client";

import { useState } from "react";
import { ChevronDown, MessageCircleQuestion } from "lucide-react";

import { faqs } from "@/lib/faq";

/** Landing-page FAQ accordion (single-open). */
export default function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section aria-labelledby="faq-heading" className="relative mx-auto w-full max-w-3xl px-6 pb-16 md:pb-20">
      <div className="mb-8 text-center md:mb-10">
        <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/15 bg-purple-500/5 px-3 py-1 text-xs font-medium tracking-wide text-purple-300">
          <MessageCircleQuestion className="h-3.5 w-3.5" /> FAQ
        </div>
        <h2 id="faq-heading" className="mt-4 text-[1.7rem] font-semibold tracking-tight text-white md:text-4xl">
          Frequently Asked Questions
        </h2>
        <p className="mt-3 text-sm leading-6 text-purple-200/60 md:text-[15px]">
          Straight answers on pricing, setup, teaching on mobile, and data security.
        </p>
      </div>

      <div className="space-y-3">
        {faqs.map((f, i) => {
          const open = openIndex === i;
          return (
            <div
              key={f.question}
              className={`overflow-hidden rounded-2xl border backdrop-blur transition-colors ${
                open ? "border-purple-500/30 bg-purple-900/15" : "border-purple-500/15 bg-purple-900/10"
              }`}
            >
              <button
                type="button"
                onClick={() => setOpenIndex(open ? null : i)}
                aria-expanded={open}
                aria-controls={`faq-panel-${i}`}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <span className="text-[15px] font-medium text-white">{f.question}</span>
                <ChevronDown
                  className={`h-5 w-5 shrink-0 text-purple-300 transition-transform duration-300 ${
                    open ? "rotate-180" : ""
                  }`}
                  aria-hidden="true"
                />
              </button>
              <div
                id={`faq-panel-${i}`}
                role="region"
                className={`grid transition-all duration-300 ease-in-out ${
                  open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <p className="px-5 pb-5 text-sm leading-6 text-purple-200/70">{f.answer}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
