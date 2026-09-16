import { School } from "@/types/school";
import { getTenant } from "@/lib/tenant";

/**
 * Tenant (subdomain) landing page.
 *
 * Renders real school stats and branding fetched from the FastAPI backend.
 * For example, a request to `vhs.resultapp.org` renders "Victory High School"
 * with its verified status, subscription plan, and student count.
 */
export default async function TenantPage({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;

  const school: School | null = await getTenant(subdomain);

  return (
    <section className="tenant-page">
      <h2>Welcome{school ? ` to ${school.name}` : ""}</h2>
      <p>
        Subdomain: <code>{subdomain}</code>
      </p>
      {school ? (
        <dl>
          <dt>Status</dt>
          <dd>
            {school.isActive ? "Active" : "Inactive"} ·{" "}
            {school.isVerified ? "Verified" : "Unverified"}
          </dd>
          {school.subscription && (
            <>
              <dt>Subscription</dt>
              <dd>
                {school.subscription.planName} ({school.subscription.status})
              </dd>
            </>
          )}
          {school.credits && (
            <>
              <dt>Students</dt>
              <dd>{school.credits.balance.toLocaleString()}</dd>
            </>
          )}
          {school.city && school.state && (
            <>
              <dt>Location</dt>
              <dd>
                {school.city}, {school.state}
              </dd>
            </>
          )}
          {school.motto && (
            <>
              <dt>Motto</dt>
              <dd>{school.motto}</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="text-muted">
          School data unavailable — backend unreachable or subdomain not
          provisioned.
        </p>
      )}
    </section>
  );
}