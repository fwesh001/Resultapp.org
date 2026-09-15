"use client";

import * as React from "react";
import { useState } from "react";
import { Upload, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function StudentUploadForm() {
  const [fileName, setFileName] = useState<string | null>(null);
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

      <div className="rounded-lg border-2 border-dashed p-6 text-center">
        <Upload className="mx-auto h-8 w-8 text-zinc-400" />
        <div className="mt-2">
          <label className="cursor-pointer text-sm font-medium text-blue-600 hover:underline">
            Choose file
            <input
              type="file"
              name="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => setFileName(e.target.files?.[0]?.name || null)}
              required
            />
          </label>
          <span className="text-sm text-zinc-500"> or drag and drop</span>
        </div>
        {fileName ? (
          <p className="mt-2 text-sm font-medium">{fileName}</p>
        ) : (
          <p className="mt-1 text-xs text-zinc-500">CSV, XLSX up to 5MB</p>
        )}
      </div>

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
