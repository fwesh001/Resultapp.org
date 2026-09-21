/**
 * Admin portal root layout — intentionally shell-free.
 *
 * Public routes (login, password setup) render here WITHOUT the AdminShell
 * sidebar. Authenticated routes live in `(dashboard)/` which owns the
 * `admin_session` guard + AdminShell (see `(dashboard)/layout.tsx`).
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
  params: Promise<{ subdomain: string }>;
}) {
  return <>{children}</>;
}
