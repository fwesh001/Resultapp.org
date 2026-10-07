/**
 * Demo help content — page-specific FAQs in plain language.
 *
 * Single copy file: product/support can edit these strings without touching
 * any component. Matched by URL path, first match wins; anything unmatched
 * falls back to the general guide.
 */

export interface DemoFaq {
  q: string;
  a: string;
}

interface DemoHelpEntry {
  match: RegExp;
  faqs: DemoFaq[];
}

const LOGIN_FAQS: DemoFaq[] = [
  {
    q: "What do I type to log in?",
    a: "Use Staff ID DEMO-ADM with PIN 123456. That signs you in as the demo school's guide with full access — no email needed.",
  },
  {
    q: "Is this my real school data?",
    a: "No — every name, score, and result here is fictional sample data. Your demo classroom resets automatically after about an hour.",
  },
  {
    q: "I dismissed this help — how do I get it back?",
    a: "Tap the purple ? button in the bottom-right corner anytime. It shows guidance for whatever page you're on.",
  },
];

export const DEMO_HELP: DemoHelpEntry[] = [
  {
    match: /\/admin\/login/,
    faqs: [
      ...LOGIN_FAQS,
      {
        q: "Where do I go after logging in?",
        a: "The admin dashboard shows the whole school at a glance: roster, results to publish, slots and credits, and billing.",
      },
    ],
  },
  {
    match: /\/staff\/login/,
    faqs: [
      ...LOGIN_FAQS,
      {
        q: "What can staff do here?",
        a: "Enter and save scores for their allocated subjects and classes, then hand results to the admin for publishing.",
      },
    ],
  },
  {
    match: /\/admin\/(students|allocations)/,
    faqs: [
      {
        q: "How do I manage the roster?",
        a: "Students live in classes like JSS1A. Adding a pupil uses one slot of the school's capacity; removing one returns it automatically.",
      },
      {
        q: "What are allocations?",
        a: "They link each subject to the teacher responsible for it in each class — that's what decides who can enter scores where.",
      },
    ],
  },
  {
    match: /\/admin\/billing/,
    faqs: [
      {
        q: "How do slots and payments work?",
        a: "One slot lets the school add one pupil, bought once and never expiring. In this demo, checkout runs in test mode: use card 5531 8866 9555 5447 or Mock Bank transfer — no real money moves, and the same server verification runs as production.",
      },
      {
        q: "What are credits?",
        a: "Credits are spent when report cards are published. Drafting, previewing, and re-printing are always free.",
      },
    ],
  },
  {
    match: /\/(staff|teacher)\/grading/,
    faqs: [
      {
        q: "How do I input and save scores?",
        a: "Pick your class and subject, type scores into the grid, and save. Your entries merge with what's already there — saving twice never duplicates anything.",
      },
      {
        q: "What do CA, Test, and Exam mean?",
        a: "Continuous Assessment (40%) plus Exam (60%) make the 100% total, following the demo school's Junior Secondary Standard template.",
      },
    ],
  },
];

export const DEMO_HELP_FALLBACK: DemoFaq[] = [
  {
    q: "What is this demo?",
    a: "A private, fully working school portal with fictional data — 40 students, 6 staff, graded terms, and published results. It resets automatically after about an hour.",
  },
  {
    q: "What should I try first?",
    a: "Log in as staff (DEMO-ADM / 123456), enter a few scores under Staff grading, then check a published Term 1 report from the portal homepage.",
  },
  {
    q: "What is a Slot?",
    a: "One slot lets the school add one pupil to its roster. Schools buy slots once and they never expire — this demo classroom comes with 40.",
  },
  {
    q: "How do I publish results?",
    a: "Teachers enter scores under Staff grading, then an admin publishes the term. Published results appear instantly on the public result checker.",
  },
  {
    q: "Is my school's data safe?",
    a: "Every school gets its own private portal. Nothing here is shared between schools, and demo data is fictional.",
  },
];

/** First matching FAQ set for a pathname, else the general guide. */
export function faqsForPath(pathname: string): DemoFaq[] {
  const entry = DEMO_HELP.find((e) => e.match.test(pathname));
  return entry ? entry.faqs : DEMO_HELP_FALLBACK;
}
