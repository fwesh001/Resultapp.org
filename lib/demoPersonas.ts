/**
 * Demo persona manifest — the single source of truth for the credentials the
 * onboarding card shows, mirrored 1:1 from backend/services/demo.py.
 *
 * WHY THIS IS A STATIC COPY (and not fetched from /api/demo/provision)
 * -----------------------------------------------------------
 * The demo seed is deliberately deterministic (DEMO_RNG_SEED in demo.py), so
 * every classroom is identical: same IDs, same shared PIN "123456", same
 * names. Rendering needs nothing dynamic except the subdomain (which the
 * tenant layout already knows) for the admin email and deep links. A static
 * manifest means the card works identically on a hard reload of any demo
 * page, not just immediately after the provision call — and
 * scripts/verify-demo-isolation.mjs PINS the shared literals on both sides,
 * so the card can never quietly drift away from what the seeder actually
 * creates.
 *
 * SAFETY: everything here is fictional, throwaway demo data scoped to an
 * ephemeral "demo-" tenant that auto-sweeps after an hour. Nothing below is a
 * production secret; the card is rendered only where isDemoTenant(school).
 */

/** The one shared PIN across every demo staff and student row (demo.py DEMO_STAFF_PIN). */
export const DEMO_PIN = "123456";

/** The seeded term/session the demo data lives in (demo.py DEMO_SESSION). */
export const DEMO_TERM = "Term 1";
export const DEMO_SESSION = "2026/2027";
/** The archived prior-session publication (demo.py DEMO_PRIOR_SESSION/TERM). */
export const DEMO_PRIOR_TERM = "Term 3";
export const DEMO_PRIOR_SESSION = "2025/2026";

// ---------------------------------------------------------------------------
// sessionStorage / CustomEvent plumbing for the auto-open + "Credentials"
// triggers. Shared by DemoLauncher (writer), DemoBanner (dispatcher) and
// DemoHelp (reader/consumer).
// ---------------------------------------------------------------------------
export const DEMO_GUIDE_STORAGE_KEY = "demo-open-guide";
export const DEMO_GUIDE_EVENT = "demo:open-guide";

// ---------------------------------------------------------------------------
// Path builders. Relative to the tenant root — middleware serves demo tenants
// from both demo.<domain>/<id>/... and plain subdomains, and a relative path
// resolves correctly on either (see lib/identityPrefix for the shared
// "prefix" pattern these mirror).
// ---------------------------------------------------------------------------

/** schools.email as seeded by demo.py's register_school call: e.g. "admin@demo.resultapp.org" for demo-abc123. */
export function demoAdminEmail(subdomain: string): string {
  return `${subdomain}@demo.resultapp.org`;
}

export function demoAdminLoginPath(subdomain: string): string {
  return `/${subdomain}/admin/login`;
}

export function demoStaffLoginPath(subdomain: string): string {
  return `/${subdomain}/staff/login`;
}

export function demoStudentLoginPath(subdomain: string): string {
  return `/${subdomain}/student/login`;
}

/** The admin console is fully live in the demo (roster, Command Center, billing). */
export function demoAdminHomePath(subdomain: string): string {
  return `/${subdomain}/admin`;
}

/** Staff home (after a staff/staff-portal login). */
export function demoStaffHomePath(subdomain: string): string {
  return `/${subdomain}/staff`;
}

export function demoModeratorHomePath(subdomain: string): string {
  return `/${subdomain}/moderator`;
}

export function demoStaffGradingPath(subdomain: string): string {
  return `/${subdomain}/staff/grading`;
}

export function demoFormClassPath(subdomain: string, className: string): string {
  return `/${subdomain}/staff/forms/${encodeURIComponent(className)}`;
}

/**
 * The public result checker. `academicSession` is optional — the report page
 * prefers the school's pinned session, and historical cards are reached via
 * the explicit override (the backend re-validates it against publications).
 */
export function demoReportPath(
  subdomain: string,
  studentId: string,
  opts?: { term?: string; academicSession?: string },
): string {
  const qs = new URLSearchParams({
    term: opts?.term || DEMO_TERM,
    ...(opts?.academicSession ? { academic_session: opts.academicSession } : {}),
  });
  return `/${subdomain}/report/${encodeURIComponent(studentId)}?${qs.toString()}`;
}

// ---------------------------------------------------------------------------
// Staff personas (mirrors demo.py _STAFF_NAMES / _DEMO_ALLOCATIONS /
// _DEMO_FORM_CLASSES: DEMO-ADM + T01..T05 sharing DEMO_PIN).
// ---------------------------------------------------------------------------
export interface DemoStaffPersona {
  staffId: string;
  name: string;
  /** Job title exactly as seeded (display string only — capabilities ride on other columns). */
  jobTitle: string;
  /** Short card headline. */
  headline: string;
  /** "What to try" steps, written against the seeded data. */
  whatToTry: string[];
  /** Deep links shown on the persona's card (tenant-relative paths). */
  actions: Array<{ label: string; href: string }>;
}

export const DEMO_ADMIN_PERSONA: DemoStaffPersona = {
  staffId: "DEMO-ADM",
  name: "Demo Guide",
  jobTitle: "School Admin",
  headline: "Full admin — the whole tenancy",
  whatToTry: [
    "Admin console: roster, allocations, results Command Center, audit",
    "Publish a result (the classroom ships with credits) and watch the checker flip",
    "Billing: slots + credits with the real checkout in test mode",
  ],
  actions: [
    { label: "Sign in at the Admin Portal", href: "**admin-login**" },
    { label: "Open the Admin console", href: "**admin-home**" },
  ],
};

/**
 * Roster fillers — seeded by demo.py (shared PIN) but not persona cards: they
 * complete the four form classes so every report card resolves a signatory.
 * Rendered as a footnote on the staff tab so the advertised staff list stays
 * byte-consistent with what the seeder actually creates (see
 * scripts/verify-demo-isolation.mjs).
 */
export const DEMO_FILLER_STAFF: Array<Pick<DemoStaffPersona, "staffId" | "name" | "jobTitle">> = [
  { staffId: "DEMO-T04", name: "Mr. S. Alabi", jobTitle: "Teacher · Form Master (JSS1B)" },
  { staffId: "DEMO-T05", name: "Mrs. N. Eze", jobTitle: "Teacher · Form Master (JSS3A)" },
];

export const DEMO_STAFF_PERSONAS: DemoStaffPersona[] = [
  {
    staffId: "DEMO-T01",
    name: "Mrs. A. Balogun",
    jobTitle: "Teacher",
    headline: "Subject teacher only — the classic gradebook",
    whatToTry: [
      "My Classes → Mathematics (JSS1A): enter scores, save as individual subject marks",
      "Notice the sidebar: no form-class tools, no publishes — grading she can, publishing she can't",
    ],
    actions: [
      { label: "Sign in at the Staff Portal", href: "**staff-login**" },
      { label: "Peek at the grading grid", href: "**staff-grading**" },
    ],
  },
  {
    staffId: "DEMO-T02",
    name: "Mr. E. Okonkwo",
    jobTitle: "Teacher · Form Master (JSS1A)",
    headline: "Subject + Form Teacher — two hats in one login",
    whatToTry: [
      "My Form Class (JSS1A): behavioural traits A–E + per-student remarks for the cohort",
      "Grade English Language in JSS1A — subject allocations inside his own form class",
    ],
    actions: [
      { label: "Sign in at the Staff Portal", href: "**staff-login**" },
      { label: "Open his form class (JSS1A)", href: "**form-class-JSS1A**" },
    ],
  },
  {
    staffId: "DEMO-T03",
    name: "Miss F. Abdullahi",
    jobTitle: "Vice Principal · Moderator deputy",
    headline: "The RBAC showcase — deputy powers, no billing keys",
    whatToTry: [
      "Her staff sidebar reveals the Moderator Console: allocations, results, clearance, templates",
      "Clearance: place an Administrative Hold on any student, then open the public checker and watch the card flip to \"Result Withheld\"",
      "Publish a draft result — note the moderator console ships WITHOUT billing/settings",
    ],
    actions: [
      { label: "Sign in at the Staff Portal", href: "**staff-login**" },
      { label: "Then open the Moderator Console", href: "**moderator-home**" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Student personas (mirrors demo.py _DEMO_PERSONA_STUDENT + the seed rules).
// Every row intentionally triggers one measured report-card state.
// ---------------------------------------------------------------------------
export interface DemoStudentPersona {
  studentId: string;
  name: string;
  className: string;
  /** Fun card label. */
  label: string;
  /** What state this child demonstrates (one line). */
  situation: string;
  /** 1-2 bullets explaining exactly what the prospect will see. */
  highlights: string[];
  /** Whether the state requires a student portal sign-in to be visible. */
  loginRequired: boolean;
}

export const DEMO_STUDENT_PERSONAS: DemoStudentPersona[] = [
  {
    studentId: "STD001",
    name: "Amara Okafor",
    className: "JSS1A",
    label: "The Scholar",
    situation: "A complete, published report card",
    highlights: [
      "Published Term 1 result — every subject, traits, remarks and the full signature block",
      "Sign in as her for the full card; without signing in the same link shows the shared-link \"Sign in to view\" preview",
    ],
    loginRequired: true,
  },
  {
    studentId: "STD002",
    name: "Chidi Nwosu",
    className: "JSS1A",
    label: "The Bursar's Case",
    situation: "Published, but on an Administrative Hold (unpaid fees)",
    highlights: [
      "The public checker shows \"Result Withheld\" instead of grades — works for any visitor",
      "Even signing in as him doesn't release the grades; releasing takes a bursar action (place/release the hold from the Clearance console)",
    ],
    loginRequired: false,
  },
  {
    studentId: "STD003",
    name: "Kemi Adeleke",
    className: "JSS1A",
    label: "The Absentee",
    situation: "Published with deliberately zero score rows",
    highlights: [
      "Sign in as her, then open the result: the card degrades gracefully to a readable \"carries no scores (e.g. absent)\" state",
    ],
    loginRequired: true,
  },
  {
    studentId: "STD013",
    name: "Tunde Bakare",
    className: "JSS1B",
    label: "Not Yet Published",
    situation: "Grades entered, term unpublished",
    highlights: [
      "The public checker shows a tidy \"No Published Result\" 404 (deliberately identical to an unknown student)",
      "Sign in as an admin and the same pupil becomes a blurred \"Draft — Pending Publication\" preview",
    ],
    loginRequired: false,
  },
  {
    studentId: "STD020",
    name: "Fatima Hassan",
    className: "JSS1B",
    label: "Nothing Released Yet",
    situation: "Zero publications — the empty dashboard",
    highlights: [
      "Sign in as her: \"No results published yet\" — nothing is missing, the school simply hasn't released a result",
    ],
    loginRequired: true,
  },
];
