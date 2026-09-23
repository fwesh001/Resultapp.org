"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertCircle, Loader2, CheckCircle2, Coins, Layers, Power, KeyRound, Trash2 } from "lucide-react";
import { toTitleCase } from "@/lib/format";
import { SuspendTenantModal, DeleteTenantModal } from "@/components/superadmin/TenantLifecycleModals";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface School {
  subdomain: string;
  school_name: string;
  email?: string | null;
  phone?: string | null;
  is_active?: boolean;
  deleted_at?: string | null;
  subscription_status?: string | null;
  credit_balance?: number | null;
  slots_balance?: number | null;
  student_count?: number;
  created_at?: string;
}

interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

/** Tenant Detail View — profile, balances, manual overrides, audit trail. */
export default function TenantDetailPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const [tenantId, setTenantId] = useState<string>("");
  const [school, setSchool] = useState<School | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [grantType, setGrantType] = useState<"CREDIT" | "SLOT">("CREDIT");
  const [grantAmount, setGrantAmount] = useState("50");
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [showSuspend, setShowSuspend] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

  useEffect(() => {
    void params.then((p) => setTenantId(p.tenantId.toLowerCase().trim()));
  }, [params]);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const [sRes, aRes] = await Promise.all([
        fetch(`/api/superadmin/tenants/${encodeURIComponent(tenantId)}`, { cache: "no-store" }),
        fetch(`/api/superadmin/audit-logs?subdomain=${encodeURIComponent(tenantId)}&limit=20`, { cache: "no-store" }),
      ]);
      const sData = await sRes.json().catch(() => ({}));
      if (!sRes.ok) throw new Error((sData as { error?: string })?.error || `Failed (${sRes.status})`);
      setSchool((sData as { school?: School }).school ?? null);
      const aData = await aRes.json().catch(() => ({}));
      if (aRes.ok) setAudit((aData as { entries?: AuditEntry[] }).entries ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tenant");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(kind: string, fn: () => Promise<Response>) {
    setActing(kind);
    setNotice(null);
    setError(null);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error || `Failed (${res.status})`);
      return data as Record<string, unknown>;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      return null;
    } finally {
      setActing(null);
    }
  }

  async function handleGrant() {
    const amount = parseInt(grantAmount, 10);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) {
      setError("Grant amount must be 1-10000");
      return;
    }
    const data = await runAction("grant", () =>
      fetch(`/api/superadmin/tenants/${encodeURIComponent(tenantId)}/grant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token_type: grantType, amount }),
      }),
    );
    if (data) {
      setNotice(`Granted ${amount} ${grantType.toLowerCase()} (new balance ${data.new_balance}). Free — excluded from MRR.`);
      await load();
    }
  }

  async function handleToggleStatus(reason: string) {
    if (!school) return;
    const suspending = school.is_active !== false;
    const data = await runAction("status", () =>
      fetch(`/api/superadmin/tenants/${encodeURIComponent(tenantId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          suspending
            ? { is_active: false, subscription_status: "suspended", reason }
            : { is_active: true, subscription_status: "active", reason },
        ),
      }),
    );
    if (data) {
      setShowSuspend(false);
      setNotice(suspending ? "Tenant suspended." : "Tenant reactivated.");
      await load();
    }
  }

  async function handleDeleteConfirm(reason: string) {
    const data = await runAction("delete", () =>
      fetch(`/api/superadmin/tenants/${encodeURIComponent(tenantId)}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      }),
    );
    if (data) {
      setShowDelete(false);
      setNotice("School deleted (soft-delete — ledger preserved).");
      await load();
    }
  }

  async function handleRestore() {
    const data = await runAction("restore", () =>
      fetch(`/api/superadmin/tenants/${encodeURIComponent(tenantId)}/restore`, { method: "POST" }),
    );
    if (data) {
      setNotice("School restored.");
      await load();
    }
  }

  async function handleResetPassword() {
    if (!window.confirm("Generate a one-time temp password? The current password stops working immediately.")) return;
    setTempPassword(null);
    const data = await runAction("reset", () =>
      fetch(`/api/superadmin/tenants/${encodeURIComponent(tenantId)}/reset-password`, { method: "POST" }),
    );
    if (data && typeof data.temp_password === "string") {
      setTempPassword(data.temp_password);
      setNotice("Temp password generated — copy it now, it is shown only once.");
      await load();
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-12 text-purple-200/60">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading tenant…
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link href="/superadmin/tenants" className="inline-flex items-center gap-1.5 text-sm text-purple-300/60 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Tenants
      </Link>

      {error && (
        <div className="mt-4 flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="mt-4 flex gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {school && (
        <>
          {school.deleted_at && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4">
              <p className="text-sm text-red-200">
                This school was soft-deleted{` — portals return 404, ledger history preserved.`}
              </p>
              <button
                type="button"
                onClick={() => void handleRestore()}
                disabled={acting === "restore"}
                className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {acting === "restore" ? "Restoring…" : "Restore School"}
              </button>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">{toTitleCase(school.school_name)}</h1>
              <p className="mt-1 font-mono text-sm text-purple-300/60">{school.subdomain}.resultapp.org</p>
              <p className="mt-1 text-xs text-purple-200/50">
                {school.email || "no email"} {school.phone ? `• ${school.phone}` : ""} • since{" "}
                {school.created_at ? new Date(school.created_at).toLocaleDateString() : "—"}
              </p>
            </div>
            <span
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                school.deleted_at
                  ? "border-red-500/30 bg-red-500/15 text-red-200"
                  : school.is_active === false
                    ? "border-zinc-500/20 bg-zinc-500/10 text-zinc-300"
                    : "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
              }`}
            >
              {school.deleted_at ? "Deleted" : school.is_active === false ? "Suspended" : (school.subscription_status || "Unpaid")}
            </span>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.06] p-5">
              <div className="flex items-center gap-2 text-sm text-purple-200/60">
                <Coins className="h-4 w-4" /> Publishing Credits
              </div>
              <p className="mt-2 text-2xl font-bold text-white">{school.credit_balance ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.06] p-5">
              <div className="flex items-center gap-2 text-sm text-purple-200/60">
                <Layers className="h-4 w-4" /> Slot Balance
              </div>
              <p className="mt-2 text-2xl font-bold text-white">{school.slots_balance ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.06] p-5">
              <div className="flex items-center gap-2 text-sm text-purple-200/60">
                <Power className="h-4 w-4" /> Status
              </div>
              <p className="mt-2 text-2xl font-bold text-white">{school.is_active === false ? "Suspended" : "Active"}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-5">
              <h2 className="text-sm font-semibold text-white">Grant free tokens</h2>
              <p className="mt-1 text-xs text-purple-200/60">Free grants — recorded with ₦0, excluded from MRR.</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="flex gap-1.5" role="group" aria-label="Token type">
                  {(["CREDIT", "SLOT"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setGrantType(t)}
                      aria-pressed={grantType === t}
                      className={
                        grantType === t
                          ? "rounded-full bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white"
                          : "rounded-full border border-purple-500/20 px-3 py-1.5 text-xs text-purple-200 hover:bg-purple-900/20"
                      }
                    >
                      {t === "CREDIT" ? "Credits" : "Slots"}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={grantAmount}
                  onChange={(e) => setGrantAmount(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="50"
                  className="w-24 rounded-xl border border-purple-500/20 bg-[#0B0514] px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleGrant()}
                  disabled={acting === "grant"}
                  className="rounded-full bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
                >
                  {acting === "grant" ? "Granting…" : "Grant"}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-5">
              <h2 className="text-sm font-semibold text-white">Danger zone</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowSuspend(true)}
                  disabled={acting === "status"}
                  className="rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                >
                  {school.is_active === false ? "Reactivate tenant" : "Suspend tenant"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleResetPassword()}
                  disabled={acting === "reset"}
                  className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/20 px-4 py-2 text-xs font-medium text-purple-200 hover:bg-purple-900/20 disabled:opacity-50"
                >
                  <KeyRound className="h-3.5 w-3.5" /> Reset admin password
                </button>
                {!school.deleted_at && (
                  <button
                    type="button"
                    onClick={() => setShowDelete(true)}
                    disabled={acting === "delete"}
                    className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete school
                  </button>
                )}
              </div>
              {tempPassword && (
                <p className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 font-mono text-sm text-emerald-200">
                  Temp password: {tempPassword}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-purple-500/15 bg-purple-900/[0.04] p-5">
            <h2 className="text-sm font-semibold text-white">Audit trail — {school.subdomain}</h2>
            {audit.length === 0 ? (
              <p className="mt-2 text-xs text-purple-300/40">No recorded admin actions for this tenant.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {audit.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-purple-500/10 bg-[#0B0514]/40 px-3 py-2 text-xs">
                    <span className="font-mono text-purple-200">{a.action}</span>
                    <span className="text-purple-300/50">{new Date(a.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>


        </>
      )}

      <SuspendTenantModal
        tenant={
          school && showSuspend
            ? { subdomain: school.subdomain, school_name: school.school_name, suspended: school.is_active === false }
            : null
        }
        busy={acting === "status"}
        onClose={() => setShowSuspend(false)}
        onConfirm={(reason) => void handleToggleStatus(reason)}
      />
      <DeleteTenantModal
        tenant={
          school && showDelete
            ? { subdomain: school.subdomain, school_name: school.school_name, suspended: school.is_active === false }
            : null
        }
        busy={acting === "delete"}
        onClose={() => setShowDelete(false)}
        onConfirm={(reason) => void handleDeleteConfirm(reason)}
      />
    </div>
  );
}
