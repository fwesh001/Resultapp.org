import { getTenant } from "@/lib/tenant";

/**
 * Tenant (subdomain) layout.
 *
 * Provides tenant context via data attributes. Visual branding
 * (Navbar / hero / Footer) lives in `app/[subdomain]/page.tsx`
 * to avoid duplicate school-name rendering.
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
      <main>{children}</main>
    </div>
  );
}