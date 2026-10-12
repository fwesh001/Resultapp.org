/**
 * Client-side wrapper for the pending-registration hold.
 *
 * WHY THIS IS A SEPARATE FILE
 * ---------------------------
 * lib/pendingRegistrations.ts is marked `server-only` because it holds the
 * backend secret and decrypts stored credentials. A client component cannot
 * import it. This module is the browser-facing half: it POSTs the wizard's
 * details to /api/register-school/hold and returns the tx_ref to charge
 * against.
 *
 * The password crosses the network to our own API — it must, since the school
 * is being created — and is encrypted server-side before storage. It is never
 * placed in the checkout `meta`, which Flutterwave retains.
 */

export interface HoldRequest {
  school_name: string;
  subdomain: string;
  admin_name?: string;
  admin_email: string;
  admin_password: string;
  student_count: number;
  accepted_terms?: boolean;
}

export async function holdRegistration(p: HoldRequest): Promise<string> {
  const res = await fetch("/api/register-school/hold", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });

  let data: { tx_ref?: string; error?: string } = {};
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new Error("Checkout is unavailable right now. Please try again.");
  }

  if (!res.ok || !data.tx_ref) {
    throw new Error(data.error || "Could not start checkout. Please try again.");
  }
  return data.tx_ref;
}
