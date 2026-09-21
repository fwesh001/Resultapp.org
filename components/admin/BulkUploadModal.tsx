"use client";

import * as React from "react";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  Download,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  Loader2,
  X,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

export type BulkEntity = "students" | "staff" | "subjects";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: BulkEntity;
  tenantId: string;
  onImported: () => void;
}

const CHUNK_SIZE = 500;

const ENTITY_META: Record<
  BulkEntity,
  {
    title: string;
    batchType: string;
    headers: string[];
    required: string[];
    examples: string[][];
    guide: string[][];
  }
> = {
  students: {
    title: "Bulk Upload Students",
    batchType: "students_batch",
    headers: ["admission_no", "full_name", "class_name", "gender"],
    required: ["full_name", "class_name"],
    examples: [
      ["vhs/001", "Adaeze Okafor", "JSS 1", "Female"],
      ["", "Tunde Bakare", "JSS 1", "Male"],
    ],
    guide: [
      ["Column", "Required?", "Notes"],
      ["admission_no", "Optional", "Leave blank to auto-assign (e.g. vhs/001). Must be unique."],
      ["full_name", "Yes", "Student's full name."],
      ["class_name", "Yes", "Must match an existing class or a new one you intend to create."],
      ["gender", "Optional", "Male or Female only."],
    ],
  },
  staff: {
    title: "Bulk Upload Staff",
    batchType: "staff_batch",
    headers: ["staff_id", "full_name", "email", "phone", "role"],
    required: ["staff_id", "full_name", "role"],
    examples: [
      ["STF001", "Mrs. Adaeze Okafor", "ada@school.edu", "+2348012345678", "Teacher"],
      ["STF002", "Mr. John Doe", "", "", "Form Master"],
    ],
    guide: [
      ["Column", "Required?", "Notes"],
      ["staff_id", "Yes", "Unique staff ID."],
      ["full_name", "Yes", "Staff full name."],
      ["email", "Optional", "Used for login."],
      ["phone", "Optional", "Contact phone."],
      ["role", "Yes", "One of: Teacher, Form Master, Vice Principal, Principal, Admin."],
    ],
  },
  subjects: {
    title: "Bulk Upload Subjects",
    batchType: "subjects_batch",
    headers: ["subject_name"],
    required: ["subject_name"],
    examples: [["Mathematics"], ["English Language"]],
    guide: [
      ["Column", "Required?", "Notes"],
      ["subject_name", "Yes", "Duplicates are skipped automatically."],
    ],
  },
};

interface ParsedRow {
  index: number; // spreadsheet row number (header = 1)
  data: Record<string, string>;
  errors: string[];
}

function normalizeHeader(h: string): string {
  const v = h.trim().toLowerCase().replace(/[\s_]+/g, "_");
  // Accept friendly aliases
  if (["admission_no", "admissionno", "admission_number", "student_id", "id"].includes(v)) return "admission_no";
  if (["classname", "class"].includes(v)) return "class_name";
  if (["fullname", "name"].includes(v)) return "full_name";
  if (["subject"].includes(v)) return "subject_name";
  if (["staffid"].includes(v)) return "staff_id";
  return v;
}

const STAFF_ROLES = new Set(["Teacher", "Form Master", "Vice Principal", "Principal", "Admin"]);

export function BulkUploadModal({ open, onOpenChange, entity, tenantId, onImported }: Props) {
  const meta = ENTITY_META[entity];
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const validRows = useMemo(() => rows.filter((r) => r.errors.length === 0), [rows]);
  const invalidRows = useMemo(() => rows.filter((r) => r.errors.length > 0), [rows]);

  function reset() {
    setFileName(null);
    setRows([]);
    setParseError(null);
    setImporting(false);
    setProgress(null);
    setResult(null);
    setImportError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function downloadTemplate() {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([meta.headers, ...meta.examples]);
    ws["!cols"] = meta.headers.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, ws, entity);
    const guide = XLSX.utils.aoa_to_sheet(meta.guide);
    guide["!cols"] = [{ wch: 18 }, { wch: 14 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, guide, "Guide");
    XLSX.writeFile(wb, `${tenantId}-${entity}-template.xlsx`);
  }

  function validateRow(data: Record<string, string>): string[] {
    const errs: string[] = [];
    for (const req of meta.required) {
      if (!data[req]?.trim()) errs.push(`${req} is required`);
    }
    if (entity === "students" && data.gender?.trim()) {
      const g = data.gender.trim().toLowerCase();
      if (g !== "male" && g !== "female") errs.push("gender must be Male or Female");
    }
    if (entity === "staff" && data.role?.trim() && !STAFF_ROLES.has(data.role.trim())) {
      errs.push(`role must be one of ${Array.from(STAFF_ROLES).join(", ")}`);
    }
    return errs;
  }

  async function handleFile(file: File) {
    reset();
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error("Spreadsheet has no sheets");
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: "" });
      if (aoa.length < 2) throw new Error("File has no data rows (need a header row + at least one row)");
      const headers = (aoa[0] as unknown[]).map((h) => normalizeHeader(String(h ?? "")));
      const parsed: ParsedRow[] = [];
      const seenKeys = new Set<string>();
      for (let i = 1; i < aoa.length; i++) {
        const cells = aoa[i] as unknown[];
        // Skip fully-empty rows
        if (cells.every((c) => String(c ?? "").trim() === "")) continue;
        const data: Record<string, string> = {};
        headers.forEach((h, ci) => {
          if (h) data[h] = String(cells[ci] ?? "").trim();
        });
        const errors = validateRow(data);
        // In-file duplicate detection
        const key =
          entity === "students"
            ? (data.admission_no || "").toLowerCase()
            : entity === "staff"
              ? (data.staff_id || "").toLowerCase()
              : (data.subject_name || "").toLowerCase();
        if (key) {
          if (seenKeys.has(`${entity}:${key}`)) errors.push("duplicate within file");
          else seenKeys.add(`${entity}:${key}`);
        }
        parsed.push({ index: i + 1, data, errors });
      }
      if (parsed.length === 0) throw new Error("No data rows found");
      setRows(parsed);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Could not parse file");
    }
  }

  function toPayloadRow(r: ParsedRow): Record<string, string> {
    if (entity === "students") {
      return {
        student_id: r.data.admission_no || "",
        full_name: r.data.full_name || "",
        class_name: r.data.class_name || "",
        gender: r.data.gender || "",
      };
    }
    if (entity === "staff") {
      return {
        staff_id: r.data.staff_id || "",
        full_name: r.data.full_name || "",
        email: r.data.email || "",
        phone: r.data.phone || "",
        role: r.data.role || "",
      };
    }
    return { subject_name: r.data.subject_name || "" };
  }

  async function handleImport() {
    if (validRows.length === 0 || importing) return;
    setImporting(true);
    setImportError(null);
    setResult(null);
    try {
      const payload = validRows.map(toPayloadRow);
      let inserted = 0;
      let skipped = 0;
      for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
        const chunk = payload.slice(i, i + CHUNK_SIZE);
        setProgress({ done: Math.min(i + CHUNK_SIZE, payload.length), total: payload.length });
        const res = await fetch("/api/admin/allocations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenant_id: tenantId, type: meta.batchType, rows: chunk }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          inserted?: number;
          skipped?: number;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || `Import failed on rows ${i + 1}-${i + chunk.length} (${res.status})`);
        }
        inserted += data.inserted ?? 0;
        skipped += data.skipped ?? 0;
      }
      setResult({ inserted, skipped });
      onImported();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
      title={meta.title}
      description={`Upload .xlsx or .csv for ${tenantId}. Parsed in your browser — only clean JSON is sent.`}
      size="lg"
      className="border-purple-500/20 bg-[#0B0514] text-white"
    >
      <div className="space-y-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={downloadTemplate}
          className="gap-1.5 rounded-full border-purple-500/20 bg-purple-950/20 text-purple-200 hover:bg-purple-900/30"
        >
          <Download className="h-3.5 w-3.5" /> Download Template (.xlsx)
        </Button>

        {/* Dropzone */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Choose spreadsheet file"
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
          className={[
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition",
            dragOver ? "border-purple-400 bg-purple-900/20" : "border-purple-500/20 bg-purple-900/[0.04] hover:bg-purple-900/10",
          ].join(" ")}
        >
          <FileSpreadsheet className="h-8 w-8 text-purple-300/60" />
          <p className="text-sm font-medium text-white">
            {fileName ?? "Drop .xlsx / .csv here or click to browse"}
          </p>
          <p className="text-xs text-purple-300/50">
            Columns: {meta.headers.join(", ")}
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
        </div>

        {parseError && (
          <div className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{parseError}</span>
          </div>
        )}

        {rows.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-300 ring-1 ring-emerald-500/20">
                {validRows.length} valid
              </span>
              {invalidRows.length > 0 && (
                <span className="rounded-full bg-red-500/10 px-2.5 py-1 font-medium text-red-300 ring-1 ring-red-500/20">
                  {invalidRows.length} with errors (excluded)
                </span>
              )}
              <span className="text-purple-300/40">
                Previewing first {Math.min(8, rows.length)} of {rows.length}
              </span>
            </div>
            <div className="max-h-56 overflow-auto rounded-xl border border-purple-500/15">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-[#150A26] text-purple-300/60">
                  <tr>
                    <th className="px-3 py-2 font-medium">Row</th>
                    {meta.headers.map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>
                    ))}
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-500/10">
                  {rows.slice(0, 8).map((r) => (
                    <tr key={r.index} className={r.errors.length ? "bg-red-500/5" : undefined}>
                      <td className="px-3 py-2 font-mono text-purple-200/60">{r.index}</td>
                      {meta.headers.map((h) => (
                        <td key={h} className="max-w-32 truncate px-3 py-2 text-white">
                          {r.data[normalizeHeader(h)] || <span className="text-zinc-600">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        {r.errors.length ? (
                          <span className="text-red-300">{r.errors.join("; ")}</span>
                        ) : (
                          <span className="text-emerald-300">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {invalidRows.length > 8 && (
              <p className="text-xs text-purple-300/40">
                + {invalidRows.length - 8} more rows with errors (all excluded from import).
              </p>
            )}
          </div>
        )}

        {importError && (
          <div className="flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{importError}</span>
          </div>
        )}
        {result && (
          <div className="flex gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              Imported {result.inserted} {entity}
              {result.skipped > 0 && ` (${result.skipped} skipped as duplicates)`}.
            </span>
          </div>
        )}
        {progress && importing && (
          <p className="text-xs text-purple-300/50">
            Uploading rows {progress.done} of {progress.total}…
          </p>
        )}

        {/* Sticky footer */}
        <div className="action-bar-sticky flex items-center justify-end gap-2 rounded-b-xl">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
            disabled={importing}
            className="gap-1.5 rounded-full"
          >
            <X className="h-3.5 w-3.5" /> Close
          </Button>
          <Button
            type="button"
            onClick={() => void handleImport()}
            disabled={validRows.length === 0 || importing}
            className="gap-1.5 rounded-full bg-purple-600 font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
          >
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Importing…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" /> Import {validRows.length} {entity}
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
