import { getTenant } from "@/lib/tenant";

/**
 * Tenant (subdomain) layout.
 *
 * Receives the `subdomain` route parameter from the [subdomain] route group.
 * Fetches and normalizes school metadata via `lib/tenant` and renders
 * tenant-specific branding and context from the FastAPI backend.
 */
export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;

  const school = await getTenant(subdomain);

  return (
    <div data-subdomain={subdomain} data-school-id={school?.id ?? undefined}>
      {school && (
        <header className="tenant-header">
          {school.logoUrl && (
            <img src={school.logoUrl} alt={`${school.name} logo`} />
          )}
          <div>
            <h1>{school.name}</h1>
            {school.motto && <p className="text-muted">{school.motto}</p>}
          </div>
        </header>
      )}
      <main>{children}</main>
    </div>
  );
}