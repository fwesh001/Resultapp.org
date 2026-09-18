import { redirect } from "next/navigation";

/**
 * The standalone grading hub moved into the staff dashboard at /staff.
 * Keeps direct /staff/grading visits resolving instead of 404ing.
 * (Focused per-class sheets still live at /staff/grading/[class]/[subject].)
 */
export default async function StaffGradingHubAlias({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  redirect(`/${subdomain.toLowerCase().trim()}/staff`);
}
