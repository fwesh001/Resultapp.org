"use client";

import SignInForm from "@/components/auth/SignInForm";
import { expandStaffId } from "@/lib/identityPrefix";

interface Props {
  tenantId: string;
  /**
   * Tenant's configured staff-ID prefix, already resolved by lib/tenant.ts
   * (falls back to "STAFF/" when the school has none set). Passed from the
   * server component that already loaded the school, so this needs no extra
   * fetch. Optional: we fall back to "STAFF/" without it.
   *
   * This is a per-tenant SETTING, not the subdomain — e.g. vhs uses "staff",
   * sha uses "STAFF/". Prefixing with the subdomain instead would produce an
   * ID that matches no account.
   */
  staffIdPrefix?: string | null;
}

/**
 * Staff portal sign-in — thin wrapper over the shared {@link SignInForm}
 * template so Admin & Staff share one UI + behavior.
 *
 * This is the ONLY caller that enables identifier expansion. Admin and root
 * sign in by email and must be left untouched, which is why the transform is
 * an opt-in prop on SignInForm rather than baked into it.
 */
export default function StaffLoginForm({ tenantId, staffIdPrefix }: Props) {
  return (
    <SignInForm
      tenantId={tenantId}
      endpoint="/api/staff/login"
      redirectTo={`/${tenantId}/staff`}
      identifierLabel="Staff ID or Email"
      identifierPlaceholder="e.g., 001 or staff@school.edu"
      identifierHint="Just the staff number or your email address."
      transformIdentifier={(raw) => expandStaffId(raw, staffIdPrefix || "STAFF/")}
      footerHint="Dual-login: Staff ID or Email + PIN"
    />
  );
}