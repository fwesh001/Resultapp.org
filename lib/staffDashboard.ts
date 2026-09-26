export interface StaffAllocation {
  id: string;
  subject_name: string;
  class_name: string;
  staff_name: string;
}

export interface StaffFormClass {
  class_name: string;
}

export interface StaffDashboardData {
  staff?: { full_name: string };
  allocations?: StaffAllocation[];
  count?: number;
  form_classes?: StaffFormClass[];
}

/**
 * Shared server-side staff dashboard fetch (per-tenant staff portal).
 *
 * Used by both the staff dashboard page and the dashboard layout (sidebar
 * "My Form Class" link). Identical URL + options across both callers lets
 * Next.js request memoization collapse them into a single backend hit per
 * render. Always `cache: "no-store"`; returns null when unreachable.
 */
export async function getStaffDashboard(
  tenantId: string,
  staffId: string,
): Promise<StaffDashboardData | null> {
  const base =
    process.env.BACKEND_URL?.trim() ||
    process.env.PROVISION_API_URL?.trim()?.replace(/\/api\/v1\/provision\/?$/, "") ||
    "http://159.223.178.34:8000";
  const url = `${base.replace(/\/$/, "")}/api/v1/tenant/${encodeURIComponent(tenantId)}/staff/dashboard?staff_id=${encodeURIComponent(staffId)}`;
  const secret =
    process.env.BACKEND_API_SECRET?.trim() ||
    process.env.PROVISION_API_SECRET?.trim() ||
    process.env.API_SECRET_KEY?.trim() ||
    "";
  const headers: Record<string, string> = secret ? { "X-API-SECRET-KEY": secret } : {};
  try {
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as StaffDashboardData | null;
  } catch {
    return null;
  }
}
