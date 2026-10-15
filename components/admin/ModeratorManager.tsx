#!/usr/bin/env node
/**
 * Moderator Management — promote/demote tenant staff.
 *
 * WHY THIS IS A SEPARATE SCREEN AND NOT A SETTINGS FIELD
 * -----------------------------------------------------
 * Every other cap in this system is about what a role can DO. `moderators` is
 * about who can BECOME one, so it sits behind its own guard: the API refuses
 * anyone without the `moderators` capability regardless of what they could
 * otherwise write into the settings form.
 *
 * That guard is the entire security property. A deputy who can promote staff
 * can promote themselves to full admin and the rest of the cap list becomes
 * decoration. So the check is `capability == "moderators"`, never
 * `role === "admin"` — the capability is what the session claim actually says.
 *
 * LAST-ADMIN FLOOR
 * ----------------
 * The backend refuses to demote the final admin, so this UI refuses to offer
 * it too. A school that locks itself out of its own portal cannot email its way
 * back in, and the only recovery is a direct database edit. Surfacing the rule
 * here means the guard is visible before anyone clicks it.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ShieldOff, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toTitleCase } from "@/lib/format";

interface StaffRow {
  staff_id: string;
  full_name: string;
  email: string | null;
  role: string;
  is_moderator: boolean;
  moderator_granted_at: string | null;
  student_count?: number;
}

interface ModeratorManagerProps {
  subdomain: string;
  /** True when the signed-in admin is the last one; disables self-demotion. */
  isOnlyAdmin?: boolean;
}

export default function ModeratorManager({ subdomain, isOnlyAdmin = false }: ModeratorManagerProps) {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * What the admin is about to change, held until they confirm.
   *
   * Null means "no dialog". Holding the row (not just a boolean) is what lets
   * the dialog title, permission note and confirm label be derived from the
   * specific person being promoted rather than from generic wording.
   */
  const [pendingToggle, setPendingToggle] = useState<{ row: StaffRow; next: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/staff?tenant_id=${encodeURIComponent(subdomain)}`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        staff?: StaffRow[];
      };
      if (!res.ok || data.success === false) {
        throw new Error(data.error || `Could not load staff (${res.status})`);
      }
      setStaff(Array.isArray(data.staff) ? data.staff : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load staff.");
    } finally {
      setLoading(false);
    }
  }, [subdomain]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Ask first, then act.
   *
   * This used to call `window.confirm` inline. Two problems with that: a
   * browser-native dialog cannot be styled, so it rendered as a grey Chrome box
   * in the middle of a carefully themed admin portal; and `ConfirmDialog`
   * already exists and is used in eight other places for exactly this shape of
   * decision.
   *
   * So the click now only records WHAT is being changed and opens the dialog.
   * The PATCH lives in the dialog's onConfirm. Same deferred pattern as
   * AllocationsManager (`pendingDelete`) and CommandCenterClient
   * (`pendingPublish`).
   */
  function toggle(row: StaffRow) {
    const next = !row.is_moderator;

    // Client-side mirror of the backend's last-admin floor. The server is the
    // authority; this just avoids offering a click that must fail.
    if (!next && isOnlyAdmin) {
      toast.error(`Cannot demote ${toTitleCase(row.role)} ${row.staff_id} — it is the last admin.`);
      return;
    }
    setPendingToggle({ row, next });
  }

  async function commitToggle() {
    const pending = pendingToggle;
    if (!pending) return;
    const { row, next } = pending;
    const verb = next ? "promote" : "demote";

    setBusy(row.staff_id);
    try {
      const res = await fetch("/api/admin/staff/moderator", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subdomain,
          staff_id: row.staff_id,
          is_moderator: next,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || data.success === false) {
        throw new Error(data.error || `Could not ${verb} (${res.status})`);
      }
      toast.success(
        next
          ? `${row.full_name || row.staff_id} is now a Moderator.`
          : `${row.full_name || row.staff_id} no longer has Moderator access.`,
      );
      setPendingToggle(null);
      await load();
    } catch (e) {
      // Leave the dialog open on failure so the message is visible next to the
      // buttons that caused it; closing it would throw the error into a toast
      // the admin may have already looked away from.
      toast.error(e instanceof Error ? e.message : `Could not ${verb}.`);
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-purple-200/60">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading staff…
      </p>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
        <p className="text-sm text-red-300">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-purple-500/25 px-4 py-2 text-sm font-medium text-purple-200 transition hover:bg-white/5"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Try again
        </button>
      </div>
    );
  }

  if (staff.length === 0) {
    return (
      <p className="rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-4 text-sm text-purple-200/60">
        No staff on the roster yet. Upload a staff list or add people from the
        Command Center first.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-purple-300" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-purple-200/70">
          A <strong className="text-white">Moderator</strong> is a deputy. They can
          run the day-to-day portal — dashboard, allocations, results, clearance,
          templates, exports and notifications — but cannot touch school settings,
          billing, the audit log, or this screen.
        </p>
      </div>

      <ul className="space-y-2">
        {staff.map((row) => {
          const isAdminRow = toLowerRole(row.role) === "admin";
          const locked = !row.is_moderator && isAdminRow && isOnlyAdmin;
          const working = busy === row.staff_id;

          return (
            <li
              key={row.staff_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-3 sm:p-4"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">
                  {row.full_name || row.staff_id}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-purple-300/60">
                  <span className="font-mono">{row.staff_id}</span>
                  <span aria-hidden="true">·</span>
                  <span>{toTitleCase(row.role)}</span>
                  {row.is_moderator ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-300">
                      <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Moderator
                    </span>
                  ) : null}
                </p>
              </div>

              <button
                type="button"
                onClick={() => void toggle(row)}
                disabled={working || locked}
                aria-label={
                  row.is_moderator
                    ? `Remove Moderator access from ${row.full_name || row.staff_id}`
                    : `Grant Moderator access to ${row.full_name || row.staff_id}`
                }
                title={
                  locked
                    ? "This is the last admin on the account — it cannot be demoted"
                    : undefined
                }
                className={`inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  row.is_moderator
                    ? "border border-purple-500/25 text-purple-200 hover:bg-white/5"
                    : "bg-purple-600 text-white hover:bg-purple-500"
                }`}
              >
                {working ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : row.is_moderator ? (
                  <ShieldOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                )}
                {row.is_moderator ? "Remove access" : "Make Moderator"}
              </button>
            </li>
          );
        })}
      </ul>

      {isOnlyAdmin ? (
        <p className="flex items-start gap-2 text-xs text-amber-300/80">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          This school has one admin left, so demotion is blocked. Promote another
          admin first if you need to hand over.
        </p>
      ) : null}

      {/* The permission list lives in `note`, not `message`.
          `message` is rendered by Modal as a single description string, so the
          old "\\n\\n" separator would have collapsed and run the gains straight
          into the losses with no line break. `note` is a separate element and
          reads as the footnote it is. */}
      <ConfirmDialog
        open={pendingToggle !== null}
        onOpenChange={(o) => { if (!o) setPendingToggle(null); }}
        title={
          pendingToggle?.next
            ? `Promote ${pendingToggle.row.full_name || pendingToggle.row.staff_id} to Moderator?`
            : `Remove Moderator access from ${pendingToggle?.row.full_name || pendingToggle?.row.staff_id}?`
        }
        message={
          pendingToggle?.next
            ? "They will be able to sign in to the Admin Portal with their existing Staff ID and PIN."
            : `They keep their ${toTitleCase(pendingToggle?.row.role ?? "")} role but lose all admin-portal access immediately.`
        }
        note={
          pendingToggle?.next
            ? "Gains: Dashboard, Allocations, Results, Clearance, Templates, Export and Notifications. Does NOT gain: Settings, Billing, Audit or Moderator Management. They are notified on the staff portal and by email."
            : "Their in-progress Admin Portal session keeps working until it expires or they sign out."
        }
        confirmLabel={pendingToggle?.next ? "Promote" : "Remove access"}
        variant={pendingToggle?.next ? "default" : "danger"}
        loading={busy !== null}
        onConfirm={() => void commitToggle()}
      />
    </div>
  );
}

/** Role strings arrive from Postgres and can be mixed case. */
function toLowerRole(role: string): string {
  return String(role || "").trim().toLowerCase();
}
