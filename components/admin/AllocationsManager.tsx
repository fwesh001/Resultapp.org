"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Users, UserCog, BookOpen, Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

// Types mirrors backend tables
type Student = { id: string; subdomain: string; student_id: string; full_name: string; class_name: string; gender: string | null; created_at: string };
type Staff = { id: string; subdomain: string; staff_id: string; full_name: string; email: string | null; phone: string | null; role: string; created_at: string };
type Allocation = { id: string; subdomain: string; subject_name: string; staff_name: string; class_name: string; created_at: string };

type Tab = "Students" | "Staff" | "Subjects";

const STAFF_ROLES = ["Teacher", "Form Master", "Vice Principal", "Principal", "Admin"] as const;

export function AllocationsManager({ tenantId }: { tenantId: string }) {
  const [activeTab, setActiveTab] = useState<Tab>("Students");

  const [students, setStudents] = useState<Student[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // modals
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [showAllocModal, setShowAllocModal] = useState(false);

  // forms
  const [studentForm, setStudentForm] = useState({ student_id: "", full_name: "", class_name: "", gender: "" });
  const [staffForm, setStaffForm] = useState({ staff_id: "", full_name: "", email: "", phone: "", role: "Teacher" });
  const [allocForm, setAllocForm] = useState({ subject_name: "", staff_name: "", class_name: "" });

  const [submitting, setSubmitting] = useState(false);

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

  async function handleCreate(type: "student" | "staff" | "allocation") {
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
      payload = { ...payload, staff_id: staffForm.staff_id.trim(), full_name: staffForm.full_name.trim(), email: staffForm.email.trim() || null, phone: staffForm.phone.trim() || null, role: staffForm.role };
    } else {
      if (!allocForm.subject_name.trim() || !allocForm.staff_name.trim() || !allocForm.class_name.trim()) {
        setError("Subject, Staff and Class are required");
        setSubmitting(false);
        return;
      }
      payload = { ...payload, subject_name: allocForm.subject_name.trim(), staff_name: allocForm.staff_name.trim(), class_name: allocForm.class_name.trim() };
    }

    try {
      const res = await fetch("/api/admin/allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed ${res.status}`);
      setSuccess(`${type.charAt(0).toUpperCase() + type.slice(1)} added`);
      // reset form + close modal
      if (type === "student") { setStudentForm({ student_id: "", full_name: "", class_name: "", gender: "" }); setShowStudentModal(false); }
      if (type === "staff") { setStaffForm({ staff_id: "", full_name: "", email: "", phone: "", role: "Teacher" }); setShowStaffModal(false); }
      if (type === "allocation") { setAllocForm({ subject_name: "", staff_name: "", class_name: "" }); setShowAllocModal(false); }
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(type: "student" | "staff" | "allocation", id: string) {
    if (!confirm(`Delete this ${type}?`)) return;
    try {
      const res = await fetch(`/api/admin/allocations?tenant_id=${encodeURIComponent(tenantId)}&type=${type}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || "Delete failed");
      setSuccess(`${type} deleted`);
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const tabs: Tab[] = ["Students", "Staff", "Subjects"];

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-purple-500/15 pb-4">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={
              activeTab === tab
                ? "rounded-full bg-purple-600 px-4 py-2 text-sm font-medium text-white shadow-[0_0_14px_rgba(147,51,234,0.3)]"
                : "rounded-full border border-purple-500/15 px-4 py-2 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-white"
            }
          >
            {tab === "Students" && <Users className="mr-1.5 inline h-4 w-4" />}
            {tab === "Staff" && <UserCog className="mr-1.5 inline h-4 w-4" />}
            {tab === "Subjects" && <BookOpen className="mr-1.5 inline h-4 w-4" />}
            {tab}
          </button>
        ))}
      </div>

      {/* Toasts */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" /> <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="ml-2 rounded-full p-1 hover:bg-white/10"><X className="h-4 w-4" /></button>
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
                <h3 className="text-sm font-semibold text-white">Registered Students ({students.length})</h3>
                <Button onClick={() => setShowStudentModal(true)} className="gap-1.5 rounded-full bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500">
                  <PlusIcon /> Add Student
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
                    {students.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-purple-200/40">No students yet. Add your first student.</td></tr>
                    ) : students.map((s) => (
                      <tr key={s.id} className="border-t border-purple-500/5 text-purple-100/80 hover:bg-purple-900/10">
                        <td className="px-4 py-3 font-mono text-xs">{s.student_id}</td>
                        <td className="px-4 py-3 font-medium text-white">{s.full_name}</td>
                        <td className="px-4 py-3">{s.class_name}</td>
                        <td className="px-4 py-3">{s.gender || "—"}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => handleDelete("student", s.id)} className="inline-flex items-center justify-center rounded-full border border-red-500/15 bg-red-500/5 p-2 text-red-300 hover:bg-red-500/15">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Staff Tab */}
          {activeTab === "Staff" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Staff Members ({staff.length})</h3>
                <Button onClick={() => setShowStaffModal(true)} className="gap-1.5 rounded-full bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500">
                  <PlusIcon /> Add Staff
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
                    {staff.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-purple-200/40">No staff yet. Add teachers first.</td></tr>
                    ) : staff.map((m) => (
                      <tr key={m.id} className="border-t border-purple-500/5 text-purple-100/80 hover:bg-purple-900/10">
                        <td className="px-4 py-3 font-mono text-xs">{m.staff_id}</td>
                        <td className="px-4 py-3 font-medium text-white">{m.full_name}</td>
                        <td className="px-4 py-3 text-purple-300/60">{m.email || "—"}</td>
                        <td className="px-4 py-3"><span className="rounded-full border border-purple-500/15 bg-purple-900/20 px-2.5 py-1 text-xs font-medium text-purple-200">{m.role}</span></td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => handleDelete("staff", m.id)} className="inline-flex items-center justify-center rounded-full border border-red-500/15 bg-red-500/5 p-2 text-red-300 hover:bg-red-500/15">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Subjects & Allocations Tab */}
          {activeTab === "Subjects" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Subjects & Allocations ({allocations.length})</h3>
                <Button onClick={() => setShowAllocModal(true)} className="gap-1.5 rounded-full bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500">
                  <PlusIcon /> Assign Subject
                </Button>
              </div>
              <p className="text-xs text-purple-300/40">Maps subject → staff → class. Unique on (subject, class) per school — one primary teacher per class.</p>
              <div className="overflow-x-auto rounded-xl border border-purple-500/15 bg-purple-900/[0.04]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-purple-500/10 bg-purple-950/20 text-left text-xs font-semibold uppercase tracking-wide text-purple-300/60">
                      <th className="px-4 py-3">Subject</th>
                      <th className="px-4 py-3">Staff</th>
                      <th className="px-4 py-3">Class</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocations.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-purple-200/40">No allocations yet. Assign a subject to a class and teacher.</td></tr>
                    ) : allocations.map((a) => (
                      <tr key={a.id} className="border-t border-purple-500/5 text-purple-100/80 hover:bg-purple-900/10">
                        <td className="px-4 py-3 font-medium text-white">{a.subject_name}</td>
                        <td className="px-4 py-3">{a.staff_name}</td>
                        <td className="px-4 py-3"><span className="rounded-full bg-purple-900/20 px-2.5 py-1 text-xs font-medium text-purple-200">{a.class_name}</span></td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => handleDelete("allocation", a.id)} className="inline-flex items-center justify-center rounded-full border border-red-500/15 bg-red-500/5 p-2 text-red-300 hover:bg-red-500/15">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Add Student Modal */}
      <Modal open={showStudentModal} onOpenChange={setShowStudentModal} title="Add Student" description="Admission No, Full Name, Class — Gender optional" className="border-purple-500/20 bg-[#0B0514] text-white">
        <div className="space-y-3">
          <Input label="Admission No" value={studentForm.student_id} onChange={(e) => setStudentForm((p) => ({ ...p, student_id: e.target.value }))} placeholder="e.g., VHS/001" />
          <Input label="Full Name" value={studentForm.full_name} onChange={(e) => setStudentForm((p) => ({ ...p, full_name: e.target.value }))} placeholder="e.g., Ada Okoro" />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-purple-100">Class</label>
            <input value={studentForm.class_name} onChange={(e) => setStudentForm((p) => ({ ...p, class_name: e.target.value }))} placeholder="e.g., JSS 1, SS 2A" list="class-suggestions" className="flex h-10 w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 placeholder:text-purple-300/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500" />
            <datalist id="class-suggestions">
              <option value="JSS 1" /><option value="JSS 2" /><option value="JSS 3" /><option value="SS 1" /><option value="SS 2" /><option value="SS 3" />
            </datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-purple-100">Gender (optional)</label>
            <select value={studentForm.gender} onChange={(e) => setStudentForm((p) => ({ ...p, gender: e.target.value }))} className="flex h-10 w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500">
              <option value="">Select gender</option><option value="Male">Male</option><option value="Female">Female</option>
            </select>
          </div>
          <Button onClick={() => handleCreate("student")} disabled={submitting} className="w-full gap-2 rounded-full bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-60">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add Student
          </Button>
        </div>
      </Modal>

      {/* Add Staff Modal */}
      <Modal open={showStaffModal} onOpenChange={setShowStaffModal} title="Add Staff" description="Staff ID, Full Name, Email, Role" className="border-purple-500/20 bg-[#0B0514] text-white">
        <div className="space-y-3">
          <Input label="Staff ID" value={staffForm.staff_id} onChange={(e) => setStaffForm((p) => ({ ...p, staff_id: e.target.value }))} placeholder="e.g., STF/003" />
          <Input label="Full Name" value={staffForm.full_name} onChange={(e) => setStaffForm((p) => ({ ...p, full_name: e.target.value }))} placeholder="e.g., Mr. Okoro" />
          <Input label="Email" type="email" value={staffForm.email} onChange={(e) => setStaffForm((p) => ({ ...p, email: e.target.value }))} placeholder="teacher@school.edu" />
          <Input label="Phone" value={staffForm.phone} onChange={(e) => setStaffForm((p) => ({ ...p, phone: e.target.value }))} placeholder="080..." />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-purple-100">Role</label>
            <select value={staffForm.role} onChange={(e) => setStaffForm((p) => ({ ...p, role: e.target.value }))} className="flex h-10 w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500">
              {STAFF_ROLES.map((r) => <option key={r} value={r} className="bg-[#0B0514]">{r}</option>)}
            </select>
          </div>
          <Button onClick={() => handleCreate("staff")} disabled={submitting} className="w-full gap-2 rounded-full bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-60">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add Staff
          </Button>
        </div>
      </Modal>

      {/* Assign Subject Modal */}
      <Modal open={showAllocModal} onOpenChange={setShowAllocModal} title="Assign Subject" description="Map subject → staff → class (unique per subject+class)" className="border-purple-500/20 bg-[#0B0514] text-white">
        <div className="space-y-3">
          <Input label="Subject Name" value={allocForm.subject_name} onChange={(e) => setAllocForm((p) => ({ ...p, subject_name: e.target.value }))} placeholder="e.g., Mathematics" />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-purple-100">Staff Name</label>
            <input value={allocForm.staff_name} onChange={(e) => setAllocForm((p) => ({ ...p, staff_name: e.target.value }))} placeholder="e.g., Mr. Okoro & Mrs. Bello" list="staff-list" className="flex h-10 w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 placeholder:text-purple-300/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500" />
            <datalist id="staff-list">{staff.map((s) => <option key={s.id} value={s.full_name} />)}</datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-purple-100">Class</label>
            <input value={allocForm.class_name} onChange={(e) => setAllocForm((p) => ({ ...p, class_name: e.target.value }))} placeholder="e.g., JSS 1, SS 2A" list="class-suggestions-alloc" className="flex h-10 w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 placeholder:text-purple-300/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500" />
            <datalist id="class-suggestions-alloc"><option value="JSS 1" /><option value="JSS 2" /><option value="SS 1" /></datalist>
          </div>
          <Button onClick={() => handleCreate("allocation")} disabled={submitting} className="w-full gap-2 rounded-full bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-60">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Assign
          </Button>
          <p className="text-xs text-purple-300/40">Tip: For co-teachers, enter &quot;Mr. Okoro &amp; Mrs. Bello&quot;.</p>
        </div>
      </Modal>
    </div>
  );
}

function PlusIcon() { return <Plus className="h-4 w-4" />; }
