"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Trash2, Users, UserCog, BookOpen, Layers, Loader2, CheckCircle2, AlertCircle, X, Sparkles, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

// Types mirrors backend tables
type Student = { id: string; subdomain: string; student_id: string; full_name: string; class_name: string; gender: string | null; created_at: string };
type Staff = { id: string; subdomain: string; staff_id: string; full_name: string; email: string | null; phone: string | null; role: string; created_at: string };
type Allocation = { id: string; subdomain: string; subject_name: string; staff_name: string; class_name: string; created_at: string };
type Subject = { id: string; subdomain: string; subject_name: string; created_at: string };

type Tab = "Students" | "Staff" | "Subjects" | "Allocate";

const STAFF_ROLES = ["Teacher", "Form Master", "Vice Principal", "Principal", "Admin"] as const;
const STANDARD_SUBJECTS = [
  "Mathematics",
  "English Language",
  "Basic Science",
  "Civic Education",
  "Agricultural Science",
  "Social Studies",
  "Business Studies",
  "Basic Technology",
];

export function AllocationsManager({ tenantId, idPrefix: idPrefixProp }: { tenantId: string; idPrefix?: string }) {
  const [activeTab, setActiveTab] = useState<Tab>("Students");

  const [students, setStudents] = useState<Student[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Filters & search & editing
  const [searchTerm, setSearchTerm] = useState("");
  const [studentClassFilter, setStudentClassFilter] = useState<string>("All");
  const [allocateClassFilter, setAllocateClassFilter] = useState<string>("All");
  const [editingRecord, setEditingRecord] = useState<Student | Staff | null>(null);

  // modals
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [showSubjectModal, setShowSubjectModal] = useState(false);
  const [showAllocModal, setShowAllocModal] = useState(false);

  // forms
  const [studentForm, setStudentForm] = useState({ student_id: "", full_name: "", class_name: "", gender: "" });
  const [staffForm, setStaffForm] = useState({ staff_id: "", full_name: "", email: "", phone: "", role: "Teacher" });
  const [subjectForm, setSubjectForm] = useState({ subject_name: "" });
  const [allocForm, setAllocForm] = useState({ class_name: "", subject_name: "", staff_name: "" });

  const [submitting, setSubmitting] = useState(false);

  // Computed available classes from registered students (unique, sorted)
  const availableClasses = useMemo(() => {
    return Array.from(new Set(students.map((s) => s.class_name).filter(Boolean))).sort();
  }, [students]);

  // Group allocations by class for easy reading (filtered later)
  const allocationsByClass = useMemo(() => {
    const sorted = [...allocations].sort((a, b) => a.class_name.localeCompare(b.class_name) || a.subject_name.localeCompare(b.subject_name));
    const grouped = new Map<string, Allocation[]>();
    for (const a of sorted) {
      if (!grouped.has(a.class_name)) grouped.set(a.class_name, []);
      grouped.get(a.class_name)!.push(a);
    }
    return grouped;
  }, [allocations]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/allocations?tenant_id=${encodeURIComponent(tenantId)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed ${res.status}`);
      setStudents((data as { students?: Student[] }).students || []);
      setStaff((data as { staff?: Staff[] }).staff || []);
      setAllocations((data as { allocations?: Allocation[] }).allocations || []);
      setSubjects((data as { subjects?: Subject[] }).subjects || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load roster");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // auto-dismiss toast
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(t);
  }, [success]);

  // Reset filters when tenant changes? Keep search global
  const q = searchTerm.toLowerCase().trim();

  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const matchesSearch = !q || [s.student_id, s.full_name, s.class_name].some((v) => v.toLowerCase().includes(q));
      const matchesClass = studentClassFilter === "All" || s.class_name === studentClassFilter;
      return matchesSearch && matchesClass;
    });
  }, [students, q, studentClassFilter]);

  const filteredStaff = useMemo(() => {
    if (!q) return staff;
    return staff.filter((m) => [m.staff_id, m.full_name, m.email || "", m.role].some((v) => v.toLowerCase().includes(q)));
  }, [staff, q]);

  const filteredSubjects = useMemo(() => {
    if (!q) return subjects;
    return subjects.filter((s) => s.subject_name.toLowerCase().includes(q));
  }, [subjects, q]);

  const filteredAllocations = useMemo(() => {
    return allocations.filter((a) => {
      const matchesSearch = !q || [a.subject_name, a.staff_name, a.class_name].some((v) => v.toLowerCase().includes(q));
      const matchesClass = allocateClassFilter === "All" || a.class_name === allocateClassFilter;
      return matchesSearch && matchesClass;
    });
  }, [allocations, q, allocateClassFilter]);

  const filteredAllocationsByClass = useMemo(() => {
    const sorted = [...filteredAllocations].sort((a, b) => a.class_name.localeCompare(b.class_name) || a.subject_name.localeCompare(b.subject_name));
    const grouped = new Map<string, Allocation[]>();
    for (const a of sorted) {
      if (!grouped.has(a.class_name)) grouped.set(a.class_name, []);
      grouped.get(a.class_name)!.push(a);
    }
    return grouped;
  }, [filteredAllocations]);

  // Prefix for new Admission Nos — uppercased configured id_prefix (e.g. VHS) or fallback to subdomain.
  const idPrefix = useMemo(() => {
    const raw = (idPrefixProp || tenantId).trim();
    return raw ? raw.toUpperCase() : tenantId.toUpperCase();
  }, [tenantId, idPrefixProp]);

  // Keep prefix in sync if school.idPrefix becomes available via props later — no-op for now.

  function nextAdmissionNo(prefix: string, existing: Student[]): string {
    const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(\\d+)$`);
    let max = 0;
    for (const s of existing) {
      const m = s.student_id.match(re);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
    // If no prefixed IDs exist yet, fall back to total count + 1 so VHS/001 appears on first create.
    const fallback = existing.filter((s) => s.subdomain.toLowerCase() === tenantId.toLowerCase()).length;
    const nextNum = max > 0 ? max + 1 : fallback + 1;
    return `${prefix}/${String(nextNum).padStart(3, "0")}`;
  }

  function openAddStudent() {
    setEditingRecord(null);
    setStudentForm({ student_id: nextAdmissionNo(idPrefix, students), full_name: "", class_name: "", gender: "" });
    setShowStudentModal(true);
  }

  function openEditStudent(s: Student) {
    setEditingRecord(s);
    setStudentForm({ student_id: s.student_id, full_name: s.full_name, class_name: s.class_name, gender: s.gender || "" });
    setShowStudentModal(true);
  }

  function openAddStaff() {
    setEditingRecord(null);
    setStaffForm({ staff_id: "", full_name: "", email: "", phone: "", role: "Teacher" });
    setShowStaffModal(true);
  }

  function openEditStaff(m: Staff) {
    setEditingRecord(m);
    setStaffForm({ staff_id: m.staff_id, full_name: m.full_name, email: m.email || "", phone: m.phone || "", role: m.role as typeof STAFF_ROLES[number] });
    setShowStaffModal(true);
  }

  function closeStudentModal(open: boolean) {
    setShowStudentModal(open);
    if (!open) {
      setEditingRecord(null);
      setStudentForm({ student_id: "", full_name: "", class_name: "", gender: "" });
    }
  }

  function closeStaffModal(open: boolean) {
    setShowStaffModal(open);
    if (!open) {
      setEditingRecord(null);
      setStaffForm({ staff_id: "", full_name: "", email: "", phone: "", role: "Teacher" });
    }
  }

  async function handleCreate(type: "student" | "staff" | "allocation" | "subject" | "bulk_subjects") {
    // If editing, delegate to PATCH
    const isEditingStudent = type === "student" && editingRecord && "student_id" in editingRecord;
    const isEditingStaff = type === "staff" && editingRecord && "staff_id" in editingRecord;

    if (isEditingStudent || isEditingStaff) {
      const recordType = type as "student" | "staff";
      const recId = (editingRecord as Student | Staff).id;
      // Build sparse payload — only updatable fields
      const patchPayload: Record<string, unknown> = {};
      if (type === "student") {
        if (!studentForm.full_name.trim() || !studentForm.class_name.trim()) {
          setError("Full Name and Class are required");
          return;
        }
        patchPayload.full_name = studentForm.full_name.trim();
        patchPayload.class_name = studentForm.class_name.trim();
        if (studentForm.gender) patchPayload.gender = studentForm.gender;
        else patchPayload.gender = null;
      } else {
        if (!staffForm.full_name.trim() || !staffForm.role.trim()) {
          setError("Full Name and Role are required");
          return;
        }
        patchPayload.full_name = staffForm.full_name.trim();
        patchPayload.email = staffForm.email.trim() || null;
        patchPayload.phone = staffForm.phone.trim() || null;
        patchPayload.role = staffForm.role;
      }

      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/allocations?tenant_id=${encodeURIComponent(tenantId)}&type=${recordType}&id=${encodeURIComponent(recId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchPayload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed ${res.status}`);
        setSuccess(`${recordType.charAt(0).toUpperCase() + recordType.slice(1)} updated`);
        if (type === "student") closeStudentModal(false);
        else closeStaffModal(false);
        setEditingRecord(null);
        await fetchAll();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Update failed");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Otherwise create
    setSubmitting(true);
    setError(null);
    let payload: Record<string, unknown> = { tenant_id: tenantId, type };

    if (type === "student") {
      if (!studentForm.student_id.trim() || !studentForm.full_name.trim() || !studentForm.class_name.trim()) {
        setError("Admission No, Full Name and Class are required");
        setSubmitting(false);
        return;
      }
      payload = { ...payload, student_id: studentForm.student_id.trim(), full_name: studentForm.full_name.trim(), class_name: studentForm.class_name.trim(), gender: studentForm.gender || null };
    } else if (type === "staff") {
      if (!staffForm.staff_id.trim() || !staffForm.full_name.trim() || !staffForm.role.trim()) {
        setError("Staff ID, Full Name and Role are required");
        setSubmitting(false);
        return;
      }
      payload = {
        ...payload,
        staff_id: staffForm.staff_id.trim(),
        full_name: staffForm.full_name.trim(),
        email: staffForm.email.trim() || null,
        phone: staffForm.phone.trim() || null,
        role: staffForm.role,
      };
    } else if (type === "subject") {
      if (!subjectForm.subject_name.trim()) {
        setError("Subject name is required");
        setSubmitting(false);
        return;
      }
      payload = { ...payload, subject_name: subjectForm.subject_name.trim() };
    } else if (type === "bulk_subjects") {
      payload = { ...payload, subjects: STANDARD_SUBJECTS };
    } else {
      // allocation
      if (!allocForm.subject_name.trim() || !allocForm.staff_name.trim() || !allocForm.class_name.trim()) {
        setError("Class, Subject and Staff are required");
        setSubmitting(false);
        return;
      }
      payload = {
        ...payload,
        subject_name: allocForm.subject_name.trim(),
        staff_name: allocForm.staff_name.trim(),
        class_name: allocForm.class_name.trim(),
      };
    }

    try {
      const res = await fetch("/api/admin/allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed ${res.status}`);
      if (type === "bulk_subjects") {
        const count = (data as { count?: number }).count ?? 0;
        setSuccess(`Quick add: ${count} subjects added (duplicates skipped)`);
      } else {
        setSuccess(`${type.charAt(0).toUpperCase() + type.slice(1)} added`);
      }
      if (type === "student") {
        setStudentForm({ student_id: "", full_name: "", class_name: "", gender: "" });
        setShowStudentModal(false);
      } else if (type === "staff") {
        setStaffForm({ staff_id: "", full_name: "", email: "", phone: "", role: "Teacher" });
        setShowStaffModal(false);
      } else if (type === "subject") {
        setSubjectForm({ subject_name: "" });
        setShowSubjectModal(false);
      } else if (type === "allocation") {
        setAllocForm({ class_name: "", subject_name: "", staff_name: "" });
        setShowAllocModal(false);
      }
      // bulk_subjects has no modal
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(type: "student" | "staff" | "allocation" | "subject", id: string) {
    if (!confirm(`Delete this ${type}?`)) return;
    try {
      const res = await fetch(`/api/admin/allocations?tenant_id=${encodeURIComponent(tenantId)}&type=${type}&id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || "Delete failed");
      setSuccess(`${type} deleted`);
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: "Students", label: "Students", icon: Users },
    { key: "Staff", label: "Staff", icon: UserCog },
    { key: "Subjects", label: "Subjects", icon: BookOpen },
    { key: "Allocate", label: "Allocate", icon: Layers },
  ];

  const isEditingStudent = !!(editingRecord && activeTab === "Students" && "student_id" in editingRecord);
  const isEditingStaff = !!(editingRecord && activeTab === "Staff" && "staff_id" in editingRecord);

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-purple-500/15 pb-4">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={
                activeTab === tab.key
                  ? "rounded-full bg-purple-600 px-4 py-2 text-sm font-medium text-white shadow-[0_0_14px_rgba(147,51,234,0.3)]"
                  : "rounded-full border border-purple-500/15 px-4 py-2 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-white"
              }
            >
              <Icon className="mr-1.5 inline h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Shared Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-purple-300/40" />
          <input
            type="search"
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex h-10 w-full rounded-xl border border-purple-800/50 bg-purple-950/30 pl-10 pr-3 text-sm text-purple-50 placeholder:text-purple-300/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
          />
        </div>
        {activeTab === "Students" && (
          <select
            value={studentClassFilter}
            onChange={(e) => setStudentClassFilter(e.target.value)}
            className="flex h-10 w-full sm:w-40 rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 text-sm text-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
          >
            <option value="All" className="bg-[#0B0514]">
              All Classes
            </option>
            {availableClasses.map((c) => (
              <option key={c} value={c} className="bg-[#0B0514]">
                {c}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Toasts */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" /> <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="ml-2 rounded-full p-1 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {success}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-8 text-sm text-purple-200/60">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading roster…
        </div>
      ) : (
        <>
          {/* Students Tab */}
          {activeTab === "Students" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Registered Students ({filteredStudents.length}/{students.length})</h3>
                <Button onClick={openAddStudent} className="gap-1.5 rounded-full bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500">
                  <Plus className="h-4 w-4" /> Add Student
                </Button>
              </div>

              <div className="overflow-x-auto rounded-xl border border-purple-500/15 bg-purple-900/[0.04]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-purple-500/10 bg-purple-950/20 text-left text-xs font-semibold uppercase tracking-wide text-purple-300/60">
                      <th className="px-4 py-3">Admission No</th>
                      <th className="px-4 py-3">Full Name</th>
                      <th className="px-4 py-3">Class</th>
                      <th className="px-4 py-3">Gender</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm text-purple-200/40">
                          {students.length === 0 ? "No students yet. Add your first student." : "No students match search/filter."}
                        </td>
                      </tr>
                    ) : (
                      filteredStudents.map((s) => (
                        <tr key={s.id} className="border-t border-purple-500/5 text-purple-100/80 hover:bg-purple-900/10">
                          <td className="px-4 py-3 font-mono text-xs">{s.student_id}</td>
                          <td className="px-4 py-3 font-medium text-white">{s.full_name}</td>
                          <td className="px-4 py-3">{s.class_name}</td>
                          <td className="px-4 py-3">{s.gender || "—"}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex gap-1.5">
                              <button
                                onClick={() => openEditStudent(s)}
                                className="inline-flex items-center justify-center rounded-full border border-purple-500/15 bg-purple-900/10 p-2 text-purple-300 hover:bg-purple-900/20"
                                aria-label="Edit student"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleDelete("student", s.id)}
                                className="inline-flex items-center justify-center rounded-full border border-red-500/15 bg-red-500/5 p-2 text-red-300 hover:bg-red-500/15"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Staff Tab */}
          {activeTab === "Staff" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Staff Members ({filteredStaff.length}/{staff.length})</h3>
                <Button onClick={openAddStaff} className="gap-1.5 rounded-full bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500">
                  <Plus className="h-4 w-4" /> Add Staff
                </Button>
              </div>
              <div className="overflow-x-auto rounded-xl border border-purple-500/15 bg-purple-900/[0.04]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-purple-500/10 bg-purple-950/20 text-left text-xs font-semibold uppercase tracking-wide text-purple-300/60">
                      <th className="px-4 py-3">Staff ID</th>
                      <th className="px-4 py-3">Full Name</th>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStaff.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm text-purple-200/40">
                          {staff.length === 0 ? "No staff yet. Add staff first." : "No staff match search."}
                        </td>
                      </tr>
                    ) : (
                      filteredStaff.map((m) => (
                        <tr key={m.id} className="border-t border-purple-500/5 text-purple-100/80 hover:bg-purple-900/10">
                          <td className="px-4 py-3 font-mono text-xs">{m.staff_id}</td>
                          <td className="px-4 py-3 font-medium text-white">{m.full_name}</td>
                          <td className="px-4 py-3 text-purple-300/60">{m.email || "—"}</td>
                          <td className="px-4 py-3">
                            <span className="rounded-full border border-purple-500/15 bg-purple-900/20 px-2.5 py-1 text-xs font-medium text-purple-200">{m.role}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex gap-1.5">
                              <button
                                onClick={() => openEditStaff(m)}
                                className="inline-flex items-center justify-center rounded-full border border-purple-500/15 bg-purple-900/10 p-2 text-purple-300 hover:bg-purple-900/20"
                                aria-label="Edit staff"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleDelete("staff", m.id)}
                                className="inline-flex items-center justify-center rounded-full border border-red-500/15 bg-red-500/5 p-2 text-red-300 hover:bg-red-500/15"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Subjects Tab */}
          {activeTab === "Subjects" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-white">Master Subjects ({filteredSubjects.length}/{subjects.length})</h3>
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleCreate("bulk_subjects")}
                    disabled={submitting}
                    variant="outline"
                    className="gap-1.5 rounded-full border-purple-500/20 bg-purple-900/10 px-4 py-2 text-sm font-medium text-purple-200 hover:bg-purple-900/20 disabled:opacity-50"
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Quick Add Standard Subjects
                  </Button>
                  <Button onClick={() => setShowSubjectModal(true)} className="gap-1.5 rounded-full bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500">
                    <Plus className="h-4 w-4" /> Add Subject
                  </Button>
                </div>
              </div>
              <p className="text-xs text-purple-300/40">Standard Nigerian subjects can be added with one click — duplicates are skipped. Master list powers the Allocate dropdown.</p>
              <div className="overflow-x-auto rounded-xl border border-purple-500/15 bg-purple-900/[0.04]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-purple-500/10 bg-purple-950/20 text-left text-xs font-semibold uppercase tracking-wide text-purple-300/60">
                      <th className="px-4 py-3">Subject</th>
                      <th className="px-4 py-3">Created At</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSubjects.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-sm text-purple-200/40">
                          {subjects.length === 0 ? "No subjects yet. Add manually or use Quick Add." : "No subjects match search."}
                        </td>
                      </tr>
                    ) : (
                      filteredSubjects.map((s) => (
                        <tr key={s.id} className="border-t border-purple-500/5 text-purple-100/80 hover:bg-purple-900/10">
                          <td className="px-4 py-3 font-medium text-white">{s.subject_name}</td>
                          <td className="px-4 py-3 text-xs text-purple-300/50">{new Date(s.created_at).toLocaleDateString()}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleDelete("subject", s.id)}
                              className="inline-flex items-center justify-center rounded-full border border-red-500/15 bg-red-500/5 p-2 text-red-300 hover:bg-red-500/15"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Allocate Tab — Command Center */}
          {activeTab === "Allocate" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Allocate — Command Center ({filteredAllocations.length}/{allocations.length})</h3>
                <Button onClick={() => setShowAllocModal(true)} className="gap-1.5 rounded-full bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500">
                  <Plus className="h-4 w-4" /> Assign Subject
                </Button>
              </div>

              {/* Class sub-tabs */}
              <div className="flex gap-2 overflow-x-auto pb-2">
                {["All", ...availableClasses].map((cls) => (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => setAllocateClassFilter(cls)}
                    className={
                      allocateClassFilter === cls
                        ? "shrink-0 rounded-full bg-purple-600 px-3 py-1.5 text-xs font-medium text-white shadow-[0_0_10px_rgba(147,51,234,0.3)]"
                        : "shrink-0 rounded-full border border-purple-500/15 px-3 py-1.5 text-xs font-medium text-zinc-400 transition hover:bg-white/5 hover:text-white"
                    }
                  >
                    {cls}
                  </button>
                ))}
                {availableClasses.length === 0 && (
                  <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">No classes yet</span>
                )}
              </div>

              {filteredAllocations.length > 0 ? (
                <div className="space-y-6">
                  {Array.from(filteredAllocationsByClass.entries()).map(([className, rows]) => (
                    <div key={className} className="overflow-hidden rounded-xl border border-purple-500/15 bg-purple-900/[0.04]">
                      <div className="border-b border-purple-500/10 bg-purple-950/30 px-4 py-2">
                        <span className="rounded-full bg-purple-600/20 px-3 py-1 text-xs font-semibold text-purple-200">{className}</span>
                        <span className="ml-2 text-xs text-purple-300/50">{rows.length} allocation{rows.length !== 1 ? "s" : ""}</span>
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-purple-500/10 bg-purple-950/10 text-left text-xs font-semibold uppercase tracking-wide text-purple-300/60">
                            <th className="px-4 py-3">Subject</th>
                            <th className="px-4 py-3">Staff</th>
                            <th className="px-4 py-3 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((a) => (
                            <tr key={a.id} className="border-t border-purple-500/5 text-purple-100/80 hover:bg-purple-900/10">
                              <td className="px-4 py-3 font-medium text-white">{a.subject_name}</td>
                              <td className="px-4 py-3">{a.staff_name}</td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  onClick={() => handleDelete("allocation", a.id)}
                                  className="inline-flex items-center justify-center rounded-full border border-red-500/15 bg-red-500/5 p-2 text-red-300 hover:bg-red-500/15"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-8 text-center text-sm text-purple-200/40">
                  {allocations.length === 0 ? (
                    <>No allocations yet. Use <span className="font-medium text-white">Assign Subject</span> to map a subject to a class and staff member.</>
                  ) : (
                    <>No allocations match filter “{allocateClassFilter}” or search “{searchTerm}”.</>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Add/Edit Student Modal */}
      <Modal
        open={showStudentModal}
        onOpenChange={closeStudentModal}
        title={isEditingStudent ? "Edit Student" : "Add Student"}
        description={isEditingStudent ? "Update Full Name, Class, Gender — Admission No is locked" : "Admission No, Full Name, Class — Gender optional"}
        className="border-purple-500/20 bg-[#0B0514] text-white"
      >
        <div className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Admission No"
                value={studentForm.student_id}
                onChange={(e) => setStudentForm((p) => ({ ...p, student_id: e.target.value.toUpperCase() }))}
                placeholder={`e.g., ${idPrefix}/001`}
                disabled={isEditingStudent}
              />
            </div>
            {!isEditingStudent && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStudentForm((p) => ({ ...p, student_id: nextAdmissionNo(idPrefix, students) }))}
                className="mb-[2px] shrink-0 rounded-xl border border-purple-500/20 bg-purple-900/20 text-purple-200 hover:bg-purple-800/30 hover:text-white"
                title="Generate next Admission No"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Auto
              </Button>
            )}
          </div>
          {!isEditingStudent && (
            <p className="text-xs text-purple-300/40">
              Prefix <span className="font-mono text-purple-200">{idPrefix}</span> from Settings → auto-filled as{" "}
              <span className="font-mono text-purple-200">{nextAdmissionNo(idPrefix, students)}</span>. Change it in Admin → Settings.
            </p>
          )}
          <Input label="Full Name" value={studentForm.full_name} onChange={(e) => setStudentForm((p) => ({ ...p, full_name: e.target.value }))} placeholder="e.g., Ada Okoro" />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-purple-100">Class</label>
            <input value={studentForm.class_name} onChange={(e) => setStudentForm((p) => ({ ...p, class_name: e.target.value }))} placeholder="e.g., JSS 1, SS 2A" list="class-suggestions-edit" className="flex h-10 w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 placeholder:text-purple-300/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500" />
            <datalist id="class-suggestions-edit">
              <option value="JSS 1" />
              <option value="JSS 2" />
              <option value="JSS 3" />
              <option value="SS 1" />
              <option value="SS 2" />
              <option value="SS 3" />
            </datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-purple-100">Gender (optional)</label>
            <select value={studentForm.gender} onChange={(e) => setStudentForm((p) => ({ ...p, gender: e.target.value }))} className="flex h-10 w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500">
              <option value="">Select gender</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>
          <Button
            onClick={() => handleCreate("student")}
            disabled={submitting}
            className="w-full gap-2 rounded-full bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isEditingStudent ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {isEditingStudent ? "Save Changes" : "Add Student"}
          </Button>
        </div>
      </Modal>

      {/* Add/Edit Staff Modal */}
      <Modal
        open={showStaffModal}
        onOpenChange={closeStaffModal}
        title={isEditingStaff ? "Edit Staff" : "Add Staff"}
        description={isEditingStaff ? "Update Full Name, Email, Phone, Role — Staff ID is locked" : "Staff ID, Full Name, Email, Role"}
        className="border-purple-500/20 bg-[#0B0514] text-white"
      >
        <div className="space-y-3">
          <Input label="Staff ID" value={staffForm.staff_id} onChange={(e) => setStaffForm((p) => ({ ...p, staff_id: e.target.value }))} placeholder="e.g., STF/003" disabled={isEditingStaff} />
          <Input label="Full Name" value={staffForm.full_name} onChange={(e) => setStaffForm((p) => ({ ...p, full_name: e.target.value }))} placeholder="e.g., Mr. Okoro" />
          <Input label="Email" type="email" value={staffForm.email} onChange={(e) => setStaffForm((p) => ({ ...p, email: e.target.value }))} placeholder="staff@school.edu" />
          <Input label="Phone" value={staffForm.phone} onChange={(e) => setStaffForm((p) => ({ ...p, phone: e.target.value }))} placeholder="080..." />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-purple-100">Role</label>
            <select value={staffForm.role} onChange={(e) => setStaffForm((p) => ({ ...p, role: e.target.value }))} className="flex h-10 w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500">
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r} className="bg-[#0B0514]">
                  {r}
                </option>
              ))}
            </select>
          </div>
          <Button
            onClick={() => handleCreate("staff")}
            disabled={submitting}
            className="w-full gap-2 rounded-full bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isEditingStaff ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {isEditingStaff ? "Save Changes" : "Add Staff"}
          </Button>
        </div>
      </Modal>

      {/* Add Subject Modal */}
      <Modal open={showSubjectModal} onOpenChange={setShowSubjectModal} title="Add Subject" description="Add a single subject to the master list" className="border-purple-500/20 bg-[#0B0514] text-white">
        <div className="space-y-3">
          <Input label="Subject Name" value={subjectForm.subject_name} onChange={(e) => setSubjectForm((p) => ({ ...p, subject_name: e.target.value }))} placeholder="e.g., Mathematics" />
          <Button onClick={() => handleCreate("subject")} disabled={submitting} className="w-full gap-2 rounded-full bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-60">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add Subject
          </Button>
        </div>
      </Modal>

      {/* Assign Subject Modal — 3 dropdowns */}
      <Modal open={showAllocModal} onOpenChange={setShowAllocModal} title="Assign Subject" description="Select Class, Subject and Staff to create allocation" className="border-purple-500/20 bg-[#0B0514] text-white">
        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-purple-100">Class</label>
            {availableClasses.length === 0 ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-300">
                Register students first to generate classes. Classes are derived from the Students roster.
              </div>
            ) : (
              <select
                value={allocForm.class_name}
                onChange={(e) => setAllocForm((p) => ({ ...p, class_name: e.target.value }))}
                className="flex h-10 w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
              >
                <option value="" className="bg-[#0B0514]">
                  Select class
                </option>
                {availableClasses.map((c) => (
                  <option key={c} value={c} className="bg-[#0B0514]">
                    {c}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-purple-100">Subject</label>
            {subjects.length === 0 ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-300">
                No subjects yet. Add subjects in the Subjects tab or Quick Add.
              </div>
            ) : (
              <select
                value={allocForm.subject_name}
                onChange={(e) => setAllocForm((p) => ({ ...p, subject_name: e.target.value }))}
                className="flex h-10 w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
              >
                <option value="" className="bg-[#0B0514]">
                  Select subject
                </option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.subject_name} className="bg-[#0B0514]">
                    {s.subject_name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-purple-100">Staff</label>
            {staff.length === 0 ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-300">
                No staff yet. Add staff in the Staff tab.
              </div>
            ) : (
              <select
                value={allocForm.staff_name}
                onChange={(e) => setAllocForm((p) => ({ ...p, staff_name: e.target.value }))}
                className="flex h-10 w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
              >
                <option value="" className="bg-[#0B0514]">
                  Select staff
                </option>
                {staff.map((s) => (
                  <option key={s.id} value={s.full_name} className="bg-[#0B0514]">
                    {s.full_name} — {s.role}
                  </option>
                ))}
              </select>
            )}
          </div>

          <Button
            onClick={() => handleCreate("allocation")}
            disabled={submitting || availableClasses.length === 0 || subjects.length === 0 || staff.length === 0}
            className="w-full gap-2 rounded-full bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Assign
          </Button>
          <p className="text-xs text-purple-300/40">Tip: Unique on (subject, class) — one primary staff member per class.</p>
        </div>
      </Modal>
    </div>
  );
}
