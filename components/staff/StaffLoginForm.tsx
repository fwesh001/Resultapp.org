"use client";

import SignInForm from "@/components/auth/SignInForm";

interface Props {
  tenantId: string;
}

/**
 * Staff portal sign-in — thin wrapper over the shared {@link SignInForm}
 * template so Admin & Staff share one UI + behavior.
 */
export default function StaffLoginForm({ tenantId }: Props) {
  return (
    <SignInForm
      tenantId={tenantId}
      endpoint="/api/staff/login"
      redirectTo={`/${tenantId}/staff`}
    />
  );
}
