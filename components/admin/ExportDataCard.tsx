"use client";

import * as React from "react";
import { useCallback, useMemo, useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Progress";
import { Select, type SelectOption } from "@/components/ui/Select";
import { toast } from "@/components/ui/toast";

/**
 * Admin "Export Data" card + configuration modal.
 *
 * Server component (the dashboard) cannot hold modal state, so this client
 * child owns the whole interaction and the dashboard only renders <Card/>.
 *
 * WHY THE DOWNLOAD USES A READABLE STREAM, NOT res.blob()
 * -------------------------------------------------------
 * `await res.blob()` gives you zero progress — you only learn it is finished
 * once the whole workbook is already in memory. To show a truthful bar we
 * consume `res.body.getReader()` and count bytes against the
 * `Content-Length` the proxy forwards, so the percentage is real. This is why
 * the modal has three distinct phases rather than one indeterminate spinner:
 *
 *   gathering  → request sent, no bytes yet (server is querying + writing)
 *   formatting → bytes arriving, percentage is measured
 *   saving     → complete, writing the Blob to disk
 */

type DatasetKey = "summary" | "students" | "staff" | "classes" | "subjects" | "results";
type Phase = "idle" | "gathering" | "formatting" | "saving" | "error";

const DATASETS: Array<{ key: DatasetKey; label: string; hint: string }> = [
  { key: "summary", label: "School Summary", hint: "Profile + live counts" },
  { key: "students", label: "Students", hint: "Roster + clearance status" },
  { key: "staff", label: "Staff", hint: "Staff list and roles" },
  { key: "classes", label: "Classes", hint: "Class sizes + form teachers" },
  { key: "subjects", label: "Subjects", hint: "Subject catalogue + teachers" },
  { key: "results", label: "Results Summary", hint: "Publication state per student" },
];

const CLEARANCE_OPTIONS: SelectOption[] = [
  { value: "all", label: "All students" },
  { value: "cleared", label: "Cleared only" },
  { value: "owing", label: "Defaulters only" },
];

const TERM_OPTIONS: SelectOption[] = [
  { value: "Term 1", label: "Term 1" },
  { value: "Term 2", label: "Term 2" },
  { value: "Term 3", label: "Term 3" },
];

const DEFAULT_SELECTION: DatasetKey[] = ["summary", "students", "staff", "classes"];

export interface ExportDataCardProps {
  subdomain: string;
  currentTerm?: string | null;
}

export function ExportDataCard({ subdomain, currentTerm }: ExportDataCardProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<DatasetKey[]>(DEFAULT_SELECTION);
  const [clearance, setClearance] = useState("all");
  const [term, setTerm] = useState(currentTerm || "Term 1");

  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const busy = phase === "gathering" || phase === "formatting" || phase === "saving";
  const hasStudents = selected.includes("students");
  const hasResults = selected.includes("results");

  const reset = useCallback(() => {
    setPhase("idle");
    setPct(0);
    setBytes(0);
    setError(null);
  }, []);

  function toggle(key: DatasetKey) {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  const statusText = useMemo(() => {
    switch (phase) {
      case "gathering":
        return "Gathering records…";
      case "formatting":
        return bytes > 0
          ? `Formatting spreadsheet… ${(bytes / 1024).toFixed(0)} KB`
          : "Formatting spreadsheet…";
      case "saving":
        return "Saving your download…";
      case "error":
        return error || "Export failed";
      default:
        return "Choose the data to include, then generate your workbook.";
    }
  }, [phase, bytes, error]);

  /**
   * Stream the workbook and save it, tracking real byte progress.
   */
  const runExport = useCallback(async () => {
    if (busy || selected.length === 0) return;
    setError(null);
    setPct(0);
    setBytes(0);
    setPhase("gathering");

    let objectUrl: string | null = null;
    try {
      const res = await fetch("/api/admin/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: subdomain,
          datasets: selected,
          students: { clearance },
          results: { term },
          className: null,
        }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error || `Export failed (${res.status})`,
        );
      }

      // Total bytes, when the server declares it. Absent => we can still show
      // that bytes are flowing, just not a true percentage.
      const totalHeader = res.headers.get("content-length");
      const total = totalHeader ? Number(totalHeader) : 0;

      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          setBytes(received);
          setPct(total > 0 ? (received / total) * 100 : 0);
          setPhase("formatting");
        }
      }

      // Force the bar to 100 before the final save beat, so it never sticks
      // at e.g. 97% while the user watches "Saving…".
      setPct(100);
      setPhase("saving");

      const blob = new Blob(chunks as BlobPart[], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      objectUrl = URL.createObjectURL(blob);

      // Prefer the server's sanitised filename; it already applied RFC 5987.
      const disp = res.headers.get("content-disposition") || "";
      const starMatch = disp.match(/filename\*=UTF-8''([^;]+)/i);
      const plainMatch = disp.match(/filename="([^"]+)"/i);
      let filename = "school-data-export.xlsx";
      if (starMatch?.[1]) {
        try {
          filename = decodeURIComponent(starMatch[1]);
        } catch {
          /* fall through to the ASCII form */
        }
      } else if (plainMatch?.[1]) {
        filename = plainMatch[1];
      }

      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();

      const sheetCount = res.headers.get("x-export-sheets")?.split(",").filter(Boolean).length;
      toast.success(`Exported ${filename}`, {
        description: sheetCount ? `${sheetCount} sheet${sheetCount === 1 ? "" : "s"} downloaded.` : undefined,
      });
      reset();
      setOpen(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Export failed";
      setError(message);
      setPhase("error");
      toast.error("Export failed", { description: message });
    } finally {
      // Revoke only after the click has been dispatched, otherwise the
      // browser may cancel the download mid-flight.
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl as string), 4000);
    }
  }, [busy, selected, clearance, term, subdomain, reset]);

  return (
    <>
      <div className="rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-purple-500/15 bg-purple-600/10">
            <FileSpreadsheet className="h-5 w-5 text-purple-300" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Export Data</h2>
            <p className="mt-1 text-sm text-purple-200/60">
              Download your school&apos;s records as an Excel workbook.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <Button
            type="button"
            onClick={() => {
              reset();
              setOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-full bg-purple-600 font-semibold text-white transition hover:bg-purple-500"
          >
            <Download className="h-4 w-4" /> Export Data
          </Button>
        </div>
      </div>

      <Modal
        open={open}
        onOpenChange={(v) => {
          if (!v && !busy) {
            reset();
          }
          setOpen(v);
        }}
        title="Export School Data"
        description="Select the datasets to include. Each becomes its own sheet in one Excel file."
        size="lg"
      >
        <div className="space-y-5">
          {/* Dataset toggles */}
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-zinc-200">
              Data to include
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {DATASETS.map((d) => (
                <label
                  key={d.key}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-purple-500/20 bg-purple-900/[0.06] p-3 transition hover:border-purple-500/40"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(d.key)}
                    onChange={() => toggle(d.key)}
                    disabled={busy}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded accent-purple-500"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-purple-100">
                      {d.label}
                    </span>
                    <span className="block text-xs text-purple-300/50">
                      {d.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {selected.length === 0 && (
              <p className="mt-2 text-xs text-amber-300/70">
                Select at least one dataset.
              </p>
            )}
          </fieldset>

          {/* Smart filter — only shown when it can actually do something. */}
          {hasStudents && (
            <div>
              <Select
                aria-label="Filter students by financial clearance"
                label="Students — Clearance Status"
                value={clearance}
                onChange={setClearance}
                disabled={busy}
                options={CLEARANCE_OPTIONS}
              />
            </div>
          )}

          {hasResults && (
            <div>
              <Select
                aria-label="Academic term"
                label="Results — Academic Term"
                value={term}
                onChange={setTerm}
                disabled={busy}
                options={TERM_OPTIONS}
              />
            </div>
          )}

          {/* Progress / status — replaces the form while running. */}
          {phase !== "idle" && (
            <div className="rounded-xl border border-purple-500/20 bg-purple-900/[0.06] p-4">
              <p className="mb-2 text-sm text-purple-100">{statusText}</p>
              <Progress
                value={phase === "error" ? 0 : pct}
                tone={phase === "error" ? "danger" : "brand"}
                label="Export progress"
                showValue={phase !== "error"}
              />
              {phase === "error" && error && (
                <p className="mt-2 text-xs text-red-300">{error}</p>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                setOpen(false);
              }}
              disabled={busy}
              className="rounded-full"
            >
              {phase === "error" ? "Close" : "Cancel"}
            </Button>
            <Button
              type="button"
              onClick={() => void runExport()}
              disabled={busy || selected.length === 0}
              className="inline-flex items-center gap-2 rounded-full bg-purple-600 font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" /> Generate Excel
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

export default ExportDataCard;