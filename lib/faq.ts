/**
 * Single source of truth for landing-page FAQs — drives both the
 * FaqSection accordion UI and the FAQPage JSON-LD in app/(landing)/page.tsx.
 * Kept in a plain (non-client) module so server components can import it.
 */
export const faqs: Array<{ question: string; answer: string }> = [
  {
    question: "How does the pricing work?",
    answer:
      "We use a flexible pay-as-you-go credit system. You only use credits when publishing final results. There are no monthly subscriptions or holiday overhead costs.",
  },
  {
    question: "How long does it take to set up my school?",
    answer:
      "Setup is instant. You receive a dedicated portal (e.g., yourschool.resultapp.org) immediately upon registration, complete with free trial credits.",
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
