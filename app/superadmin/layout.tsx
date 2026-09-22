/**
 * Superadmin root layout — intentionally shell-free.
 * Public routes (login) render here directly. Guarded routes live in
 * `(dashboard)/` which owns the session check + SuperadminShell.
 */
export default function SuperadminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
