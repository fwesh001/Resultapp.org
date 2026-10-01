/**
 * Single source of truth for landing-page FAQs — drives both the
 * FaqSection accordion UI and the FAQPage JSON-LD in app/(landing)/page.tsx.
 * Kept in a plain (non-client) module so server components can import it.
 */
export const faqs: Array<{ question: string; answer: string }> = [
  {
    question: "How does the pricing work?",
    answer:
      "There are two separate things. Slots are the students you can add to your roster — you buy them once at a volume-discounted rate (₦100, ₦90 at 500+ students, or ₦80 at 1000+), and they are permanent. Credits are what you spend to publish a term's results. There are no subscriptions, no renewals, and neither slots nor credits expire.",
  },
  {
    question: "How long does it take to set up my school?",
    answer:
      "Setup is instant. You receive a dedicated portal (e.g., yourschool.resultapp.org) immediately upon registration, complete with your purchased roster slots credited to your account.",
  },
  {
    question: "Can teachers enter grades using their mobile phones?",
    answer:
      "Yes. The Smart Staff Hub is fully optimized for mobile devices, allowing teachers to input and save grades securely from anywhere.",
  },
  {
    question: "Is our school and student data secure?",
    answer:
      "Absolutely. Each school operates in an isolated secure tenant environment, and our database is continuously backed up to prevent data loss.",
  },
];
