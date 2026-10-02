"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Select, type SelectOption } from "@/components/ui/Select";
import type { TenantMenuTarget } from "@/components/superadmin/TenantRowMenu";

/* Suspend modal — a required CAUSE plus an optional free-text note.

   The cause is required, not cosmetic. It is persisted on the tenant row as
   `suspension_reason` and is what decides whether a payment can restore the
   portal: non-payment suspensions lift automatically, abuse/legal/security ones
   must be lifted by a human. An operator who leaves this unset on an abuse
   suspension silently re-enables paying your way out of the ban, so the select
   blocks the confirm button until it is chosen. */

/** Must match SUSPENSION_REASONS in backend/routers/admin.py. */
const SUSPENSION_REASONS = [
  {
    value: "nonpayment",
    label: "Non-payment",
    hint: "A verified payment restores access automatically.",
  },
  {
    value: "abuse",
    label: "Abuse",
    hint: "Abuse of the service. A payment will NOT restore access.",
  },
  {
    value: "legal",
    label: "Legal or regulatory",
    hint: "A payment will NOT restore access.",
  },
  {
    value: "security",
    label: "Security or data risk",
    hint: "A payment will NOT restore access.",
  },
] as const;

export function SuspendTenantModal({
  tenant,
  busy,
  onClose,
  onConfirm,
}: {
  tenant: TenantMenuTarget | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string, suspensionReason: string | null) => void;
}) {
  const [reason, setReason] = useState("");
  const [cause, setCause] = useState<string>("");
  const suspending = tenant ? !tenant.suspended : true;
  const causeHint = SUSPENSION_REASONS.find((r) => r.value === cause)?.hint;
  const canSubmit = !busy && (!suspending || cause !== "");
  return (
    <Modal
      open={tenant !== null}
      onOpenChange={(v) => {
        if (!v) {
          setReason("");
          setCause("");
          onClose();
        }
      }}
      title={suspending ? "Suspend tenant?" : "Reactivate tenant?"}
      description={
        tenant
          ? suspending
            ? `${tenant.subdomain} — public, staff, and report access will pause. Admin billing stays reachable.`
            : `${tenant.subdomain} — full portal access will be restored.`
          : undefined
      }
      size="sm"
      className="border-purple-500/20 bg-[#0B0514] text-white"
    >
      <div className="space-y-3">
        {suspending && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lifecycle-suspend-cause" className="text-sm font-medium text-purple-100">
              Cause <span className="font-normal text-amber-300/70">(required)</span>
            </label>
            <Select
              id="lifecycle-suspend-cause"
              aria-label="Cause (required)"
              value={cause}
              onChange={setCause}
              disabled={busy}
              placeholder="Select a cause…"
              options={[
                { value: "", label: "Select a cause…" },
                ...SUSPENSION_REASONS.map((r): SelectOption => ({ value: r.value, label: r.label })),
              ]}
            />
            {causeHint && <p className="text-xs text-purple-300/60">{causeHint}</p>}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lifecycle-suspend-reason" className="text-sm font-medium text-purple-100">
            Note{" "}
            <span className="font-normal text-purple-300/50">
              (optional, free text — recorded in the audit log)
            </span>
          </label>
          <textarea
            id="lifecycle-suspend-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Unpaid invoice #1042"
            disabled={busy}
            className="w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 placeholder:text-purple-300/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy} className="rounded-full">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() =>
              tenant && canSubmit && onConfirm(reason.trim(), suspending ? cause : null)
            }
            disabled={!canSubmit}
            className="gap-1.5 rounded-full bg-amber-600 font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {suspending ? "Suspend" : "Reactivate"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* Delete modal — high friction: exact subdomain + reason required. */

export function DeleteTenantModal({
  tenant,
  busy,
  onClose,
  onConfirm,
}: {
  tenant: TenantMenuTarget | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [reason, setReason] = useState("");
  const canDelete =
    tenant !== null && confirmText.trim() === tenant.subdomain && reason.trim().length >= 3 && !busy;
  return (
    <Modal
      open={tenant !== null}
      onOpenChange={(v) => {
        if (!v) {
          setConfirmText("");
          setReason("");
          onClose();
        }
      }}
      title="Delete school?"
      description={
        tenant
          ? `${tenant.subdomain} will vanish from every portal (404). Ledger history and revenue are preserved. This is reversible via Restore.`
          : undefined
      }
      size="sm"
      className="border-red-500/20 bg-[#0B0514] text-white"
    >
      <div className="space-y-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lifecycle-delete-confirm" className="text-sm font-medium text-purple-100">
            Type <span className="font-mono font-semibold text-red-300">{tenant?.subdomain}</span> to confirm
          </label>
          <input
            id="lifecycle-delete-confirm"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={tenant?.subdomain ?? ""}
            disabled={busy}
            autoComplete="off"
            className="w-full rounded-xl border border-red-500/30 bg-purple-950/30 px-3 py-2 font-mono text-sm text-purple-50 placeholder:text-purple-300/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lifecycle-delete-reason" className="text-sm font-medium text-purple-100">
            Reason <span className="font-normal text-purple-300/50">(required, min 3 chars — audit log)</span>
          </label>
          <textarea
            id="lifecycle-delete-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. School closed at end of session"
            disabled={busy}
            className="w-full rounded-xl border border-purple-800/50 bg-purple-950/30 px-3 py-2 text-sm text-purple-50 placeholder:text-purple-300/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy} className="rounded-full">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => tenant && canDelete && onConfirm(reason.trim())}
            disabled={!canDelete}
            className="gap-1.5 rounded-full bg-red-600 font-semibold text-white hover:bg-red-500 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete School
          </Button>
        </div>
      </div>
    </Modal>
  );
}
