"use client";

import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

const HELP_CARDS: { title: string; body: string }[] = [
  {
    title: "What is a Slot?",
    body: "One slot lets the school add one pupil to its roster. The school buys slots once and they never expire — this demo classroom comes with 40.",
  },
  {
    title: "How do I publish results?",
    body: "Teachers enter scores under Staff grading, then an admin publishes the term. Published results appear instantly on the public result checker — try it from the portal homepage.",
  },
  {
    title: "What happens when I pay?",
    body: "Schools pay per student slot through Flutterwave (card, USSD, or bank transfer). In this demo, checkout runs in test mode so no real money moves.",
  },
  {
    title: "Is my school's data safe?",
    body: "Every school gets its own private portal. Staff sign in with their Staff ID, admins with email and password, and nothing here is shared between schools.",
  },
  {
    title: "How long does this demo last?",
    body: "About an hour. It resets automatically, so feel free to click everything — you cannot break anything.",
  },
];

/**
 * Sticky demo help button. Demo tenants only. Reuses the app's accessible
 * Modal primitive (focus trap, Escape, scroll lock) so help is consistent
 * with every other dialog in the product.
 */
export function DemoHelp() {
  const [open, setOpen] = useState(false);
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
        title="What can I try in this demo?"
        description="A quick tour in plain language — no school-admin jargon."
      >
        <div className="space-y-3">
          {HELP_CARDS.map((card) => (
            <div
              key={card.title}
              className="rounded-xl border border-purple-500/15 bg-purple-900/10 p-4"
            >
              <p className="text-sm font-semibold text-white">{card.title}</p>
              <p className="mt-1 text-sm leading-6 text-purple-200/70">{card.body}</p>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
