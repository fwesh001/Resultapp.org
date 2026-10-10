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
  const [term, setTerm] = useState("Term 1");
  // Default-plus-override: global admin term until the user picks otherwise.
  const [termTouched, setTermTouched] = useState(false);
  const globalTerm = useGlobalTerm(subdomain);

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedId = studentId.trim();
    if (!trimmedId) return;
    // Expand a bare "001" to the stored "vhs/001". Leaves emails and
    // already-prefixed input alone, so existing users who type the full ID
    // keep working unchanged (see lib/identityPrefix for why we only expand
    // unambiguous bare numbers).
    const expanded = expandStudentId(trimmedId, idPrefix, subdomain);
    const normalized = normalizePrefixLower(expanded);
    router.push(
      `/${subdomain}/report/${encodeURIComponent(normalized)}?term=${encodeURIComponent(term)}`,
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-xl rounded-2xl border border-purple-500/20 bg-purple-900/[0.04] p-6 shadow-lg shadow-purple-950/30 backdrop-blur"
    >
      <label
        htmlFor="student-id"
        className="block text-sm font-medium text-purple-200"
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
        className="mt-2 w-full rounded-xl border border-purple-500/20 bg-[#0B0514] px-4 py-3 text-white placeholder:text-purple-300/40 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
      />
      {/* Explains the auto-prefix, and reassures anyone who types the full ID
          anyway — their input is still honoured verbatim. */}
      <p id="student-id-hint" className="mt-2 text-xs text-purple-300/50">
        Just the admission number — the school prefix{" "}
        <span className="font-mono text-purple-200/80">{idPrefix || subdomain}/</span> is added
        automatically.
      </p>

      <label
        htmlFor="term"
        className="mt-4 block text-sm font-medium text-purple-200"
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
        className="mt-6 w-full rounded-xl bg-purple-600 px-4 py-3 font-semibold text-white transition hover:bg-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-2 focus:ring-offset-[#0B0514]"
      >
        View Report Card
      </button>
    </form>
  );
}
