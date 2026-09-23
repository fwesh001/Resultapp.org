"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useGlobalTerm } from "@/lib/useGlobalTerm";

interface ResultLookupWidgetProps {
  subdomain: string;
}

export default function ResultLookupWidget({
  subdomain,
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    const normalized = normalizePrefixLower(trimmedId);
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
        placeholder="e.g. vhs/001"
        required
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="mt-2 w-full rounded-xl border border-purple-500/20 bg-[#0B0514] px-4 py-3 text-white placeholder:text-purple-300/40 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
      />

      <label
        htmlFor="term"
        className="mt-4 block text-sm font-medium text-purple-200"
      >
        Term
      </label>
      <select
        id="term"
        value={term}
        onChange={(e) => {
          setTermTouched(true);
          setTerm(e.target.value);
        }}
        className="mt-2 w-full rounded-xl border border-purple-500/20 bg-[#0B0514] px-4 py-3 text-white focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
      >
        <option>Term 1</option>
        <option>Term 2</option>
        <option>Term 3</option>
      </select>

      <button
        type="submit"
        className="mt-6 w-full rounded-xl bg-purple-600 px-4 py-3 font-semibold text-white transition hover:bg-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-2 focus:ring-offset-[#0B0514]"
      >
        View Report Card
      </button>
    </form>
  );
}
