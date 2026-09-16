import { School } from "@/types/school";

interface TenantLookupResponse {
  school: School;
}

/**
 * Tenant (subdomain) layout.
 *
 * Receives the `subdomain` route parameter from the [subdomain] route group.
 * Fetches school metadata from the FastAPI backend and renders tenant-specific
 * context such as school branding and configuration.
 */
export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;

  // --- Fetch tenant-specific data from FastAPI backend ---
  // Uses BACKEND_URL from environment (defaults to droplet IP for production).
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
    <div data-subdomain={subdomain} data-school-id={school?.id ?? undefined}>
      {school && (
        <header className="tenant-header">
          <h1>{school.name}</h1>
          {school.logoUrl && <img src={school.logoUrl} alt={school.name} />}
        </header>
      )}
      <main>{children}</main>
    </div>
  );
}
