"use client";

import SignInForm from "@/components/auth/SignInForm";
import { expandStudentId } from "@/lib/identityPrefix";

interface Props {
  tenantId: string;
  /**
   * Tenant's configured student-ID prefix, already resolved by lib/tenant.ts
   * (falls back to the subdomain when the school has none set).
   *
   * This is a per-tenant SETTING, not the subdomain — vhs uses "vhs", sha
   * uses "sha". Prefixing with the subdomain when the school has a custom
   * prefix would produce an ID matching no account, which is why the server
   * component passes the resolved value rather than letting this guess.
   */
  studentIdPrefix?: string | null;
  /** Where to go after a successful sign-in. */
  redirectTo?: string;
}

/**
 * Student portal sign-in — thin wrapper over the shared {@link SignInForm},
 * exactly as StaffLoginForm does, so all three portals share one UI.
 *
 * Identifier expansion is enabled for the same reason staff has it: a child
 * should not have to type the school's prefix. expandStudentId only expands
 * unambiguous bare NUMBERS, leaving anything containing letters or a slash
 * untouched so legacy ids ("stf001") are never corrupted.
 */
export default function StudentLoginForm({ tenantId, studentIdPrefix, redirectTo }: Props) {
  return (
    <SignInForm
      tenantId={tenantId}
      endpoint="/api/student/login"
      redirectTo={redirectTo || `/${tenantId}/student`}
      identifierLabel="Admission Number"
      identifierPlaceholder="e.g., 001"
      identifierHint="Just your admission number."
      transformIdentifier={(raw) => expandStudentId(raw, studentIdPrefix || tenantId)}
      footerHint="Admission Number + Password"
    />
  );
}