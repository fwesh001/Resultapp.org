"use client";

import * as React from "react";
import { useState } from "react";
import { Upload, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import UploadField from "@/components/ui/UploadField";

export function StudentUploadForm() {
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    // TODO: wire to lib/api-client.ts -> apiClient.upload("/students/import", formData)
    await new Promise((r) => setTimeout(r, 1000));
    setLoading(false);
    alert("Demo: students would be uploaded via FastAPI backend");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border bg-white p-6">
      <div className="flex items-center gap-2">
        <FileSpreadsheet className="h-5 w-5" />
        <h3 className="font-semibold">Upload Students</h3>
      </div>
      <p className="text-sm text-zinc-500">
        Upload a CSV or Excel file with student records. Columns: admissionNumber, firstName, lastName, classLevel, gender.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <Input label="Class Level" name="classLevel" placeholder="e.g. JSS2" required />
        <Input label="Session" name="session" placeholder="2025/2026" required />
      </div>

      <UploadField
        id="student-file"
        behavior="select"
        name="file"
        required
        accept=".csv,.xlsx,.xls"
        preview="file"
        tone="light"
        helper="CSV, XLSX up to 5MB"
      />

      <Button type="submit" disabled={loading} className="w-full gap-2">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {loading ? "Uploading..." : "Upload Students"}
      </Button>

      <p className="text-xs text-zinc-500">
        Need a template?{" "}
        <a href="#" className="font-medium text-black underline">
          Download sample CSV
        </a>
      </p>
    </form>
  );
}
