"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Check,
  Clipboard,
  FlaskConical,
  GraduationCap,
  Shield,
  Users,
} from "lucide-react";
import {
  DEMO_GUIDE_EVENT,
  DEMO_PIN,
  DEMO_ADMIN_PERSONA,
  DEMO_FILLER_STAFF,
  DEMO_STAFF_PERSONAS,
  DEMO_STUDENT_PERSONAS,
  type DemoStaffPersona,
  type DemoStudentPersona,
  demoAdminEmail,
  demoAdminHomePath,
  demoAdminLoginPath,
  demoFormClassPath,
  demoModeratorHomePath,
  demoReportPath,
  demoStaffGradingPath,
  demoStaffHomePath,
  demoStaffLoginPath,
  demoStudentLoginPath,
} from "@/lib/demoPersonas";

/**
 * Demo credentials card — one-click copyable logins for every persona in the
 * ephemeral classroom, plus deep links that land directly on the state each
 * persona triggers (published result, fee hold, absent pupil, draft 404…).
 *
 * Two render variants:
 *   "modal"  — full tabbed guide; the body of the DemoHelp modal (every demo
 *              page) and the auto-open surface right after provisioning.
 *   "strip"  — compact credential rows; sits above the result checker on the
 *              demo tenant homepage, with a button that opens the full guide
 *              via the shared DEMO_GUIDE_EVENT.
 *
 * Content comes from lib/demoPersonas.ts, which mirrors the seeder and is
 * pinned by scripts/verify-demo-isolation.mjs — the card never hardcodes
 * credentials, it renders the manifest.
 */

type Variant = "modal" | "strip";
type Tab = "admin" | "staff" | "students";

interface DemoCredentialsCardProps {
  subdomain: string;
  variant?: Variant;
  initialTab?: Tab;
  className?: string;
}

// ---------------------------------------------------------------------------
// Clipboard with a textarea fallback (same pattern as the site's other
// copyable inputs) and a short visual confirmation.
// ---------------------------------------------------------------------------

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const copy = useCallback(async (value: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const el = document.createElement("textarea");
        el.value = value;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(value);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard denied (older Safari, strict permissions): the mono value is
      // always visible next to the button, nothing is lost.
    }
  }, []);

  return { copied, copy };
}

function CopyChip({
  value,
  label,
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const { copied, copy } = useCopy();
  const done = copied === value;
  return (
    <button
      type="button"
      onClick={() => void copy(value)}
      aria-label={done ? `${label ?? value} copied` : `Copy ${label ?? value}`}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium transition-colors ${
        done
          ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
          : "border-purple-400/25 bg-purple-500/10 text-purple-200 hover:border-purple-400/50 hover:bg-purple-500/20"
      } ${className ?? ""}`}
    >
      {done ? <Check className="h-3 w-3" aria-hidden /> : <Clipboard className="h-3 w-3" aria-hidden />}
      <span className="font-mono">{value}</span>
    </button>
  );
}

/** A small inline copy button (icon only) for rows whose value is already displayed. */
function CopyIconBtn({ value }: { value: string }) {
  const { copied, copy } = useCopy();
  const done = copied === value;
  return (
    <button
      type="button"
      onClick={() => void copy(value)}
      aria-label={done ? "Copied" : `Copy ${value}`}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors ${
        done
          ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
          : "border-purple-400/25 text-purple-300 hover:border-purple-400/50 hover:bg-purple-500/20"
      }`}
    >
      {done ? <Check className="h-3 w-3" aria-hidden /> : <Clipboard className="h-3 w-3" aria-hidden />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Persona href resolution. Action tokens live in lib/demoPersonas.ts as
// "**kind**"-encoded strings so the manifest stays a pure data file; this
// turns them into tenant-relative paths.
// ---------------------------------------------------------------------------

function resolveHref(href: string, subdomain: string, persona: DemoStaffPersona): string {
  if (href === "**admin-login**") return demoAdminLoginPath(subdomain);
  if (href === "**admin-home**") return demoAdminHomePath(subdomain);
  if (href === "**staff-login**") return demoStaffLoginPath(subdomain);
  if (href === "**staff-grading**") return demoStaffGradingPath(subdomain);
  if (href === "**moderator-home**") return demoModeratorHomePath(subdomain);
  if (href.startsWith("**form-class-")) {
    return demoFormClassPath(subdomain, href.slice("**form-class-".length, -2));
  }
  // Unknown token: land on the portal home that matches the persona family —
  // never render a literal "**..." link.
  if (persona.staffId === "DEMO-ADM") return demoAdminHomePath(subdomain);
  return demoStaffHomePath(subdomain);
}

function PersonaLink({ href, subdomain, persona }: { href: string; subdomain: string; persona: DemoStaffPersona }) {
  return (
    <Link
      href={resolveHref(href, subdomain, persona)}
      className="inline-flex min-h-[36px] items-center rounded-lg border border-purple-400/30 bg-purple-500/10 px-3 py-1.5 text-xs font-semibold text-purple-100 transition hover:border-purple-400/60 hover:bg-purple-500/25"
    >
      {href.startsWith("**form-class-") ? `${href.slice(12, -2)} form class` : href.replace(/\*\*/g, "")}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function AdminPanel({ subdomain }: { subdomain: string }) {
  const email = demoAdminEmail(subdomain);
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-purple-500/25 bg-purple-900/15 p-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-purple-300" aria-hidden />
            <span className="text-[15px] font-semibold text-white">Admin Portal — {DEMO_ADMIN_PERSONA.name}</span>
          </div>
          <span className="font-mono text-[11px] font-medium text-purple-300">{DEMO_ADMIN_PERSONA.staffId}</span>
        </div>
        <p className="mt-1.5 text-sm leading-6 text-purple-200/80">{DEMO_ADMIN_PERSONA.headline}</p>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <dt className="w-20 shrink-0 text-xs font-medium uppercase tracking-wide text-purple-300/70">
              Admin email
            </dt>
            <dd>
              <CopyChip value={email} label={email} />
            </dd>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <dt className="w-20 shrink-0 text-xs font-medium uppercase tracking-wide text-purple-300/70">
              Staff ID
            </dt>
            <dd>
              <CopyChip value={DEMO_ADMIN_PERSONA.staffId} label="DEMO-ADM" />
            </dd>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <dt className="w-20 shrink-0 text-xs font-medium uppercase tracking-wide text-purple-300/70">
              PIN
            </dt>
            <dd>
              <CopyChip value={DEMO_PIN} label="PIN" />
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs leading-5 text-purple-300/60">
          Sign in at the Admin Portal with the admin email — or at the Staff Portal with{" "}
          <span className="font-mono">DEMO-ADM</span>. Both use the PIN.
        </p>
        <ul className="mt-3 space-y-1 text-sm text-purple-200/75">
          {DEMO_ADMIN_PERSONA.whatToTry.map((tip) => (
            <li key={tip} className="flex gap-2">
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-purple-400/60" />
              {tip}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href={demoAdminLoginPath(subdomain)}
          className="inline-flex min-h-[38px] items-center rounded-lg bg-purple-600 px-4 text-sm font-semibold text-white transition hover:bg-purple-500"
        >
          Go to Admin Portal sign-in
        </Link>
        <Link
          href={demoStaffLoginPath(subdomain)}
          className="inline-flex min-h-[38px] items-center rounded-lg border border-purple-400/30 bg-purple-500/10 px-4 text-sm font-semibold text-purple-100 transition hover:border-purple-400/60 hover:bg-purple-500/25"
        >
          Use the Staff Portal instead
        </Link>
      </div>
    </div>
  );
}

function StaffPanel({ subdomain }: { subdomain: string }) {
  return (
    <div className="space-y-3">
      {DEMO_STAFF_PERSONAS.map((persona) => (
        <div key={persona.staffId} className="rounded-2xl border border-purple-500/20 bg-purple-900/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <div>
              <p className="text-[15px] font-semibold text-white">{persona.name}</p>
              <p className="text-xs text-purple-300/80">{persona.jobTitle} — {persona.headline}</p>
            </div>
            <CopyChip value={persona.staffId} label={persona.staffId} />
          </div>
          <ul className="mt-2.5 space-y-1 text-sm text-purple-200/75">
            {persona.whatToTry.map((tip) => (
              <li key={tip} className="flex gap-2">
                <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-purple-400/60" />
                {tip}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {persona.actions.map((action) => (
              <PersonaLink key={action.href + action.label} href={action.href} subdomain={subdomain} persona={persona} />
            ))}
            <span className="inline-flex items-center gap-1 text-xs text-purple-300/60">
              PIN <span className="font-mono font-medium text-purple-200">{DEMO_PIN}</span>
              <CopyIconBtn value={DEMO_PIN} />
            </span>
          </div>
        </div>
      ))}
      <div className="rounded-2xl border border-purple-500/15 bg-purple-900/5 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-purple-300/70">Also on the roster</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-purple-200/70">
          {DEMO_FILLER_STAFF.map((filler) => (
            <span key={filler.staffId} className="inline-flex items-center gap-1.5">
              <CopyChip value={filler.staffId} label={filler.staffId} />
              <span>{filler.jobTitle}</span>
            </span>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-purple-300/60">
          Two more ordinary teachers who complete the form classes — sign in with either ID to see the plain staff experience.
        </p>
      </div>
    </div>
  );
}

function StudentPanel({ subdomain }: { subdomain: string }) {
  return (
    <div className="space-y-3">
      {DEMO_STUDENT_PERSONAS.map((persona) => (
        <StudentPersonaCard key={persona.studentId} persona={persona} subdomain={subdomain} />
      ))}
    </div>
  );
}

function StudentPersonaCard({ persona, subdomain }: { persona: DemoStudentPersona; subdomain: string }) {
  return (
    <div className="rounded-2xl border border-purple-500/20 bg-purple-900/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div>
          <p className="text-[15px] font-semibold text-white">{persona.name}</p>
          <p className="text-xs text-purple-300/80">
            {persona.className} — {persona.label}
          </p>
        </div>
        <CopyChip value={persona.studentId} label={persona.studentId} />
      </div>
      <p className="mt-1.5 text-sm text-purple-100">{persona.situation}</p>
      <ul className="mt-2 space-y-1 text-sm text-purple-200/75">
        {persona.highlights.map((h) => (
          <li key={h} className="flex gap-2">
            <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-purple-400/60" />
            {h}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={demoReportPath(subdomain, persona.studentId)}
          className="inline-flex min-h-[36px] items-center rounded-lg border border-purple-400/30 bg-purple-500/10 px-3 py-1.5 text-xs font-semibold text-purple-100 transition hover:border-purple-400/60 hover:bg-purple-500/25"
        >
          Open the result
        </Link>
        <Link
          href={demoStudentLoginPath(subdomain)}
          className="inline-flex min-h-[36px] items-center rounded-lg border border-purple-400/30 bg-purple-500/10 px-3 py-1.5 text-xs font-semibold text-purple-100 transition hover:border-purple-400/60 hover:bg-purple-500/25"
        >
          {persona.loginRequired ? "Sign in as this student" : "Student portal (optional)"}
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

const TABS: Array<{ id: Tab; label: string; icon: ReactNode }> = [
  { id: "admin", label: "Admin", icon: <Shield className="h-3.5 w-3.5" aria-hidden /> },
  { id: "staff", label: "Staff", icon: <Users className="h-3.5 w-3.5" aria-hidden /> },
  { id: "students", label: "Students", icon: <GraduationCap className="h-3.5 w-3.5" aria-hidden /> },
];

export default function DemoCredentialsCard({
  subdomain,
  variant = "modal",
  initialTab = "admin",
  className,
}: DemoCredentialsCardProps) {
  const [tab, setTab] = useState<Tab>(initialTab);

  const openFullGuide = useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(DEMO_GUIDE_EVENT));
    }
  }, []);

  const ariaId = useMemo(() => `demo-cred-panel-${subdomain}`, [subdomain]);

  if (variant === "strip") {
    return (
      <div className={className}>
        <div className="rounded-2xl border border-purple-400/15 bg-purple-950/20 p-4 text-left">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-purple-300" aria-hidden />
            <p className="text-sm font-bold text-white">Demo credentials</p>
            <p className="ml-auto font-mono text-[11px] font-medium text-purple-300/80">
              PIN {DEMO_PIN} · <CopyIconBtn value={DEMO_PIN} />
            </p>
          </div>
          <ul className="mt-2.5 space-y-1.5 text-sm">
            <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1.5 font-medium text-white">
                <Shield className="h-3.5 w-3.5 text-purple-300" aria-hidden /> Admin portal
              </span>
              <span className="font-mono text-xs text-purple-300/80">{demoAdminEmail(subdomain)}</span>
              <CopyIconBtn value={demoAdminEmail(subdomain)} />
              <Link href={demoAdminLoginPath(subdomain)} className="text-xs font-semibold text-purple-300 underline underline-offset-2 hover:text-purple-100">
                open
              </Link>
            </li>
            <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1.5 font-medium text-white">
                <Users className="h-3.5 w-3.5 text-purple-300" aria-hidden /> Staff
              </span>
              <span className="font-mono text-xs text-purple-300/80">DEMO-ADM · DEMO-T01–T03</span>
              <Link href={demoStaffLoginPath(subdomain)} className="text-xs font-semibold text-purple-300 underline underline-offset-2 hover:text-purple-100">
                open
              </Link>
            </li>
            <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1.5 font-medium text-white">
                <GraduationCap className="h-3.5 w-3.5 text-purple-300" aria-hidden /> Student
              </span>
              <span className="font-mono text-xs text-purple-300/80">STD001 (+ STD002 · STD003)</span>
              <Link href={demoStudentLoginPath(subdomain)} className="text-xs font-semibold text-purple-300 underline underline-offset-2 hover:text-purple-100">
                open
              </Link>
            </li>
          </ul>
          <button
            type="button"
            onClick={openFullGuide}
            className="mt-3 inline-flex min-h-[38px] w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 text-sm font-semibold text-white transition hover:bg-purple-500"
          >
            <FlaskConical className="h-4 w-4" aria-hidden /> Open the full persona guide
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div role="tablist" aria-label="Demo persona groups" className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={ariaId}
            onClick={() => setTab(t.id)}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition ${
              tab === t.id
                ? "bg-purple-600 text-white shadow-[0_0_18px_rgba(147,51,234,0.35)]"
                : "border border-purple-400/25 text-purple-200 hover:border-purple-400/50 hover:bg-purple-500/20"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div id={ariaId} role="tabpanel" className="mt-3">
        {tab === "admin" && <AdminPanel subdomain={subdomain} />}
        {tab === "staff" && <StaffPanel subdomain={subdomain} />}
        {tab === "students" && <StudentPanel subdomain={subdomain} />}
      </div>

      <p className="mt-3 text-xs leading-5 text-purple-300/60">
        Every login shares PIN{" "}
        <span className="font-mono font-medium text-purple-200">{DEMO_PIN}</span> — all data is fictional
        and this classroom erases itself after about an hour. Test-mode checkout: 5531 8866 9555 5447 / Mock
        Bank transfer.
      </p>
    </div>
  );
}
