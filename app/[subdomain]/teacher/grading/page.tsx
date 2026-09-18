import { redirect } from "next/navigation";

/**
 * Legacy alias — the grading workspace moved to /staff/grading.
 * Keeps bookmarked /teacher/grading URLs resolving instead of 404ing.
 */
export default async function TeacherGradingAlias({
  params,
}: {
  params: Promise<{ subdomain: string }>;
}) {
  const { subdomain } = await params;
  redirect(`/${subdomain.toLowerCase().trim()}/staff/grading`);
}
