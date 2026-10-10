import type { Metadata } from "next";
import { cache } from "react";
import { getTenant, isDemoTenant } from "@/lib/tenant";
import { DemoBanner } from "@/components/demo/DemoBanner";
import { DemoHelp } from "@/components/demo/DemoHelp";

/**
 * Tenant (subdomain) layout.
 *
 * Provides tenant context via data attributes. Visual branding
 * (Navbar / hero / Footer) lives in `app/[subdomain]/page.tsx`
 * to avoid duplicate school-name rendering.
 */

/**
 * One tenant lookup per request, shared by the layout body and
 * `generateMetadata`.
 *
 * This matters: `getTenant` fetches with `cache: "no-store"` (see
 * lib/tenant.ts), so calling it from both places would send TWO uncached
 * round-trips to the registry for every single tenant page render. `cache()`
 * memoises per request, so the second caller reuses the first result while
 * still honouring the no-store semantics across requests (an admin editing
 * their logo is reflected on the very next page load).
 */
const getTenantOnce = cache(async (subdomain: string) => getTenant(subdomain));

/**
 * `logo_url` is a free-text column — an admin can type anything into Settings,
 * and the value is forwarded verbatim by the settings proxy. Next would throw
 * on a malformed `icons` URL, so anything that is not a parseable absolute
 * http(s) URL is treated as "no crest" and falls back to the product mark.
 *
 * Relative URLs are rejected rather than resolved against `metadataBase`:
 * `metadataBase` is pinned to the apex (app/layout.tsx), so resolving there
 * would point a tenant's favicon at the wrong origin on a subdomain.
 */
function sanitizeIconUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Per-tenant favicon + tab title.
 *
 * Every tenant route (`/`, `/admin/*`, `/staff/*`, `/report/*`,
 * `/teacher/grading`) is nested under this layout, so one export covers the
 * whole tenant surface.
 *
 * The browser's implicit `/favicon.ico` probe can never be per-tenant — the
 * middleware bypasses that path (middleware.ts), so `app/favicon.ico` remains
 * the implicit fallback. Browsers prefer the declared `<link rel="icon">`,
 * which is what we set here.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}): Promise<Metadata> {
  const { subdomain } = await params;
  const school = await getTenantOnce(subdomain);

  // A failed lookup or an unknown tenant yields null; inheriting the root
  // layout's title/icons is the correct degradation, not an empty document.
  if (!school) return {};

  const name = school.name?.trim();
  const icon = sanitizeIconUrl(school.logoUrl);
  // Demo tenants are throwaway sandboxes: they must read as ResultApp, not as
  // a real named school, or a shared demo link looks like a genuine result
  // portal for the school named in the tab.
  const demo = isDemoTenant(school);

  const title = demo
    ? { default: "Demo — ResultApp", template: "%s — Demo — ResultApp" }
    : name
      ? { default: name, template: `%s | ${name}` }
      : undefined;

  const icons = icon
    ? { icon: [{ url: icon }], apple: [{ url: icon }] }
    : undefined;

  return {
    ...(title ? { title } : {}),
    ...(icons ? { icons } : {}),
  };
}

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;

  const school = await getTenantOnce(subdomain);
  const demo = isDemoTenant(school);

  return (
    <div data-subdomain={subdomain} data-school-id={school?.id ?? undefined}>
      {demo && <DemoBanner subdomain={subdomain} />}
      <main>{children}</main>
      {demo && <DemoHelp />}
    </div>
  );
}