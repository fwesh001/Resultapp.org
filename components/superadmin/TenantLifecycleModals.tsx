"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { TenantMenuTarget } from "@/components/superadmin/TenantRowMenu";

/* Suspend modal — low friction confirm + optional reason (audited). */

export function SuspendTenantModal({
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
  const [reason, setReason] = useState("");
  const suspending = tenant ? !tenant.suspended : true;
  return (
    <Modal
      open={tenant !== null}
      onOpenChange={(v) => {
        if (!v) {
          setReason("");
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
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lifecycle-suspend-reason" className="text-sm font-medium text-purple-100">
            Reason <span className="font-normal text-purple-300/50">(optional, recorded in audit log)</span>
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
            onClick={() => tenant && onConfirm(reason.trim())}
            disabled={busy}
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
