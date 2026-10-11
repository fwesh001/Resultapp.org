"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useGlobalTerm } from "@/lib/useGlobalTerm";
import { expandStudentId } from "@/lib/identityPrefix";
import { Select } from "@/components/ui/Select";

interface ResultLookupWidgetProps {
  subdomain: string;
  /**
   * Tenant's configured admission-number prefix, already resolved by
   * lib/tenant.ts (falls back to the subdomain when the school has none set).
   * Passed from the server component that already loaded the school, so this
   * needs no extra fetch. Optional: we fall back to `subdomain` without it.
   */
  idPrefix?: string | null;
}

export default function ResultLookupWidget({
  subdomain,
  idPrefix,
}: ResultLookupWidgetProps) {
  const router = useRouter();
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [term, setTerm] = useState("Term 1");
  // Default-plus-override: global admin term until the user picks otherwise.
  const [termTouched, setTermTouched] = useState(false);
  const globalTerm = useGlobalTerm(subdomain);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!termTouched && globalTerm && term !== globalTerm.term) {
      setTerm(globalTerm.term);
    }
  }, [globalTerm, termTouched]);

  function normalizePrefixLower(raw: string): string {
    const v = raw.replace(/\s+/g, "");
    const slashIdx = v.indexOf("/");
    if (slashIdx !== -1) {
      return v.slice(0, slashIdx).toLowerCase() + v.slice(slashIdx);
    }
    // No slash: treat whole value as prefix-like — lower first alpha run, keep numbers
    // Simpler: lower leading letters before first digit
    const m = v.match(/^([A-Za-z]+)(.*)$/);
    if (m) return m[1].toLowerCase() + m[2];
    return v.toLowerCase();
  }

  /** Shared by both paths: build the per-segment-encoded report path. */
  function buildReportPath(normalized: string): string {
    // Encode each path segment separately so the prefix separator stays a REAL
    // slash: "/report/vhs/001", not "/report/vhs%2F001".
    //
    // encodeURIComponent() on the whole ID escapes "/" as "%2F", which works by
    // accident (Next decodes catch-all segments, and app/api/report/route.ts
    // re-splits before calling the backend) but leaks an unreadable address bar
    // and makes the shared link look broken. This mirrors the encoder already
    // proven in app/api/report/route.ts.
    const encodedPath = normalized
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    return `/${subdomain}/report/${encodedPath}?term=${encodeURIComponent(term)}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedId = studentId.trim();
    if (!trimmedId) return;

    setError("");
    setBusy(true);

    // Expand a bare "001" to the stored "vhs/001". Leaves emails and
    // already-prefixed input alone, so existing users who type the full ID
    // keep working unchanged (see lib/identityPrefix for why we only expand
    // unambiguous bare numbers).
    const expanded = expandStudentId(trimmedId, idPrefix, subdomain);
    const normalized = normalizePrefixLower(expanded);

    try {
      // Verify the password BEFORE navigating. The backend strips grades
      // server-side for anyone without a verified session, so navigating first
      // would land the student on a locked preview and require a second trip
      // through the login form.
      const res = await fetch("/api/student/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: subdomain, identifier: expanded, password }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Invalid admission number or password.");
        setBusy(false);
        // Clear only the password. Re-typing the admission number after a
        // mistyped password is exactly the wrong thing to ask a parent to do.
        setPassword("");
        return;
      }

      setPassword("");
      router.push(buildReportPath(normalized));
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-xl rounded-2xl border border-line-1 bg-surface-1 p-6 shadow-lg backdrop-blur"
    >
      <label
        htmlFor="student-id"
        className="block text-sm font-medium text-text-1"
      >
        Student ID
      </label>
      <input
        id="student-id"
        type="text"
        value={studentId}
        onChange={(e) => setStudentId(normalizePrefixLower(e.target.value))}
        placeholder="e.g., 001"
        required
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode="numeric"
        aria-describedby="student-id-hint"
        className="mt-2 w-full rounded-xl border border-line-1 bg-surface-1 px-4 py-3 text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
      />
      {/* Explains the auto-prefix, and reassures anyone who types the full ID
          anyway — their input is still honoured verbatim. */}
      <p id="student-id-hint" className="mt-2 text-xs text-text-3">
        Just the admission number — the school prefix{" "}
        <span className="font-mono text-text-2">{idPrefix || subdomain}/</span> is added
        automatically.
      </p>

      <label
        htmlFor="student-password"
        className="mt-4 block text-sm font-medium text-text-1"
      >
        Password
      </label>
      <input
        id="student-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="e.g., 123456"
        required
        autoComplete="current-password"
        className="mt-2 w-full rounded-xl border border-line-1 bg-surface-1 px-4 py-3 text-text-1 placeholder:text-text-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/50"
      />
      <p className="mt-2 text-xs text-text-3">
        First time here? Use the default password{" "}
        <span className="font-mono text-text-2">123456</span>, then change it in the{" "}
        <span className="font-medium text-text-2">Student Portal</span>.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-200"
        >
          {error}
        </p>
      ) : null}

      <label
        htmlFor="term"
        className="mt-4 block text-sm font-medium text-text-1"
      >
        Term
      </label>
      <Select
        id="term"
        className="mt-2"
        triggerClassName="h-12 px-4"
        aria-label="Term"
        value={term}
        onChange={(v) => {
          setTermTouched(true);
          setTerm(v);
        }}
        options={[
          { value: "Term 1", label: "Term 1" },
          { value: "Term 2", label: "Term 2" },
          { value: "Term 3", label: "Term 3" },
        ]}
      />

      <button
        type="submit"
        disabled={busy}
        className="mt-6 w-full rounded-xl bg-accent px-4 py-3 font-semibold text-accent-fg transition hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface-0 disabled:opacity-60"
      >
        {busy ? "Checking…" : "View Report Card"}
      </button>
    </form>
  );
}
