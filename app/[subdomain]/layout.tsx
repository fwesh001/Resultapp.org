import { School } from "@/types/school";

/**
 * Tenant (subdomain) layout.
 *
 * Receives the `subdomain` route parameter from the [subdomain] route group.
 * This layout wraps every page served under a tenant subdomain, providing
 * tenant-specific context such as school branding and configuration.
 */
export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;

  // --- Fetch tenant-specific data using the subdomain ---
  // In production, this would call your backend/DB to look up the school
  // by subdomain slug. Here we demonstrate the pattern.
  let school: School | null = null;
  try {
    const res = await fetch(
      `${process.env.BACKEND_URL || "http://localhost:3001"}/api/schools/${subdomain}`,
      {
        next: { tags: [`school-${subdomain}`] },
      },
    );
    if (res.ok) {
      school = (await res.json()) as School;
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
