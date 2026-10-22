/**
 * Demo help content — page-specific FAQs in plain language.
 *
 * Single copy file: product/support can edit these strings without touching
 * any component. Matched by URL path, first match wins; anything unmatched
 * falls back to the general guide.
 *
 * The copyable credentials themselves live in the pinned section of the
 * DemoGuide modal (components/demo/DemoCredentialsCard.tsx backed by
 * lib/demoPersonas.ts); these FAQs teach the flows around them. Keep the
 * route matchers below in sync with scripts/verify-demo-isolation.mjs, which
 * asserts this dictionary still covers login, roster, billing and grading.
 */

export interface DemoFaq {
  q: string;
  a: string;
}

interface DemoHelpEntry {
  match: RegExp;
  faqs: DemoFaq[];
}

const LOGIN_FAQ_NOTES = [
  {
    q: "Which demo roles can I try here?",
    a: "Three staff logins plus the admin: DEMO-T01 is a plain subject teacher; DEMO-T02 is a subject teacher AND the JSS1A form teacher; DEMO-T03 (Vice Principal) elevates into the Moderator Console — results publishing and clearance holds without full admin rights. All PIN 123456.",
  },
  {
    q: "Is this my real school data?",
    a: "No — every name, score, and result here is fictional sample data. Your demo classroom resets automatically after about an hour.",
  },
  {
    q: "I dismissed this help — how do I get it back?",
    a: "Tap the purple ? button in the bottom-right corner anytime. It shows the credentials card plus guidance for whatever page you're on.",
  },
];

export const DEMO_HELP: DemoHelpEntry[] = [
  {
    match: /\/admin\/login/,
    faqs: [
      {
        q: "What do I type to log in as the school admin?",
        a: "The admin email shown in the credentials card (it ends @demo.resultapp.org) with PIN 123456. That signs you into the full admin console — roster, allocations, the Results Command Center, and billing in test mode.",
      },
      ...LOGIN_FAQ_NOTES,
      {
        q: "Where do I go after logging in?",
        a: "The admin dashboard shows the whole school at a glance: roster, results to publish, slots and credits, and billing.",
      },
    ],
  },
  {
    match: /\/staff\/login/,
    faqs: [
      {
        q: "What do I type to log in?",
        a: "Use Staff ID DEMO-ADM with PIN 123456. That signs you in as the demo school's guide with full access — no email needed. The credentials card also lists three teacher personas (DEMO-T01–T03) if you want the staff-side experience instead.",
      },
      ...LOGIN_FAQ_NOTES,
      {
        q: "What can staff do here?",
        a: "Enter and save scores for their allocated subjects and classes, then hand results to the admin for publishing. DEMO-T02 can also edit behavioural traits for JSS1A as its form teacher, and DEMO-T03 gets a Moderator Console link.",
      },
    ],
  },
  {
    match: /\/student\/login/,
    faqs: [
      {
        q: "What do I type to log in as a student?",
        a: "Try STD001 with password 123456 — that's Amara, the showcase pupil with a complete published result. STD013 and STD020 show what students see when nothing is published yet, and STD002 stays \"Result Withheld\" even while signed in — the unpaid-fees hold is by design.",
      },
      ...LOGIN_FAQ_NOTES,
    ],
  },
  {
    match: /\/moderator/,
    faqs: [
      {
        q: "What can the moderator do that staff can't?",
        a: "Publish results, manage subject allocations and templates, and place or release Administrative Holds (fees) in the Clearance tab. Billing, settings and the audit trail stay admin-only — that boundary is the point of the demo.",
      },
      {
        q: "How do I see a hold take effect?",
        a: "Clearance tab → place a hold on any pupil, then open their result from the public portal homepage: the card flips to \"Result Withheld\" until the hold is released.",
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
        a: "They link each subject to the teacher responsible for it in each class — that's what decides who can enter scores where. Form classes are assigned separately, one form teacher per class.",
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
        a: "Credits are spent when report cards are published. Drafting, previewing, and re-printing are always free. This demo classroom ships with a small balance so you can publish without paying first.",
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
  {
    match: /\/student($|\/)/,
    faqs: [
      {
        q: "What am I looking at?",
        a: "The student portal lists only PUBLISHED results, newest session first. STD001 has a full Term 1 card plus last session's archive; STD020 shows the friendly empty state because nothing has been released for her yet.",
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
    a: "Sign in anywhere from the credentials card above: grade scores as DEMO-T01, edit a form class as DEMO-T02, publish and hold results as DEMO-T03, explore the admin console with DEMO-ADM, then check result cards on the portal homepage.",
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
