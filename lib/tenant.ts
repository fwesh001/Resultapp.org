import { School, Subscription } from "@/types/school";

/**
 * Tenant fetching + normalization.
 *
 * Fetches school metadata from the FastAPI backend
 * (`GET {BACKEND_URL}/api/v1/tenant/{subdomain}`) and maps the registry's
 * snake_case columns onto the frontend `School` interface so layout/page
 * components render real data instead of fallbacks.
 *
 * Env:
 * - BACKEND_URL : FastAPI base URL (defaults to droplet IP for production)
 */

/** Raw shape returned by the backend schools registry / tenant endpoint. */
interface TenantRegistrySchool {
  id: string;
  subdomain: string;
  school_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  logo_url: string | null;
  hero_bg_url: string | null;
  motto: string | null;
  proprietor_name: string | null;
  registration_number: string | null;
  is_verified: boolean;
  is_active: boolean;
  subscription_plan: string | null;
  subscription_status: string | null;
  student_count: number;
  credit_balance: number | null;
  slots_balance: number | null;
  id_prefix: string | null;
  current_term: string | null;
  current_session: string | null;
  new_term_begins: string | null;
  location: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
}

interface TenantLookupResponse {
  school: TenantRegistrySchool;
}

function getBackendUrl(): string {
  return (process.env.BACKEND_URL || "http://159.223.178.34:8000").replace(
    /\/$/,
    "",
  );
}

/** Map backend registry columns onto the frontend School type. */
function normalizeSchool(raw: TenantRegistrySchool): School {
  const locationParts =
    raw.location?.split(",").map((part) => part.trim()) ?? [];
  return {
    id: raw.id,
    name: raw.school_name,
    slug: raw.subdomain,
    email: raw.email ?? "",
    phone: raw.phone ?? undefined,
    address: raw.address ?? undefined,
    city: raw.city ?? locationParts[0] ?? undefined,
    state: raw.state ?? locationParts[1] ?? undefined,
    country: raw.country ?? "NG",
    logoUrl: raw.logo_url ?? undefined,
    heroBgUrl: raw.hero_bg_url ?? undefined,
    motto: raw.motto ?? undefined,
    proprietorName: raw.proprietor_name ?? undefined,
    registrationNumber: raw.registration_number ?? undefined,
    idPrefix: raw.id_prefix?.trim() ? raw.id_prefix.trim().toUpperCase() : raw.subdomain.toUpperCase(),
    newTermBegins: raw.new_term_begins ?? undefined,
    slotsBalance: raw.slots_balance ?? raw.student_count ?? 0,
    creditBalance: raw.credit_balance ?? 0,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    isVerified: raw.is_verified,
    isActive: raw.status === "active" || raw.is_active,
    subscription:
      raw.subscription_plan || raw.subscription_status
        ? ({
            id: `${raw.subdomain}-sub`,
            schoolId: raw.id,
            planId: (raw.subscription_plan || "free").toLowerCase(),
            planName: raw.subscription_plan || "Free",
            status: raw.subscription_status || "inactive",
            currentPeriodStart: raw.created_at,
            currentPeriodEnd: raw.updated_at,
            cancelAtPeriodEnd: false,
          } as Subscription)
        : undefined,
    credits:
      raw.student_count > 0 || (raw.credit_balance ?? 0) > 0
        ? {
            // credit_balance is the spendable token balance (zero-downtime:
            // falls back to legacy student_count until migration backfills it).
            balance: raw.credit_balance ?? raw.student_count,
            totalPurchased: raw.student_count,
            totalUsed: Math.max(0, raw.student_count - (raw.credit_balance ?? raw.student_count)),
          }
        : undefined,
  };
}

/**
 * Fetch and normalize school metadata for a tenant subdomain.
 * Returns `null` if the backend is unreachable or the school is unknown.
 */
export async function getTenant(
  subdomain: string,
): Promise<School | null> {
  try {
    const res = await fetch(
      `${getBackendUrl()}/api/v1/tenant/${subdomain}`,
      { next: { tags: [`school-${subdomain}`] } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as TenantLookupResponse;
    return normalizeSchool(data.school);
  } catch {
    return null;
  }
}