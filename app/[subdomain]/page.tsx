import { School } from "@/types/school";

interface TenantLookupResponse {
  school: School;
}

/**
 * Tenant (subdomain) landing page.
 *
 * Fetches school metadata from the FastAPI backend and renders
 * tenant-specific context for the subdomain that routed here.
 * For example, a request to `vhs.resultapp.org` renders the page for
 * "Victory High School".
 */
export default async function TenantPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;

  // --- Resolve tenant from backend ---
  const backendUrl = process.env.BACKEND_URL || "http://159.223.178.34:8000";
  let school: School | null = null;
  try {
    const res = await fetch(`${backendUrl}/api/v1/tenant/${subdomain}`, {
      next: { tags: [`school-${subdomain}`] },
    });
    if (res.ok) {
      const data = (await res.json()) as TenantLookupResponse;
      school = data.school;
    }
  } catch {
    // Fallback: continue without school data (e.g. during development)
  }

  return (
    <section className="tenant-page">
      <h2>Welcome{school ? ` to ${school.name}` : ""}</h2>
      <p>
        Subdomain: <code>{subdomain}</code>
      </p>
      {school ? (
        <dl>
          <dt>Status</dt>
          <dd>{school.isVerified ? "Verified" : "Unverified"}</dd>
          <dt>Subscription</dt>
          <dd>
            {school.subscription?.planName ?? "No plan"} ({school.subscription?.status ?? "none"})
          </dd>
          <dt>Credits</dt>
          <dd>{school.credits?.balance ?? "N/A"} remaining</dd>
          <dt>Motto</dt>
          <dd>{school.motto ?? "—"}</dd>
        </dl>
      ) : (
        <p className="text-muted">
          School data unavailable — running in development mode without a backend.
        </p>
      )}
    </section>
  );
}
