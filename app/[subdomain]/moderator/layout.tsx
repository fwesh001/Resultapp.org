/**
 * Moderator console root layout — intentionally shell-free, mirroring
 * `app/[subdomain]/admin/layout.tsx`.
 *
 * The one route outside `(dashboard)` that needs chrome is `/moderator/login`,
 * and that page has to be able to redirect; wrapping it in the sidebar would
 * flash a menu built from a session that does not exist yet.
 */
export default async function ModeratorLayout({
  children,
}: {
  children: React.ReactNode;
  params: Promise<{ subdomain: string }>;
}) {
  return <>{children}</>;
}