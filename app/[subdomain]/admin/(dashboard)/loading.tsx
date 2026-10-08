import ResultLoader from "@/components/ui/ResultLoader";

/**
 * Loading state for the tenant dashboards (admin + staff).
 *
 * Deliberately NOT at app/loading.tsx: a root loading boundary flushes a 200
 * shell before the page resolves, which prevents the tenant landing page from
 * returning a true 404 for unknown or purged subdomains. These dashboards do
 * resolve slowly (session checks plus tenant data), so they keep the spinner.
 *
 * See app/[subdomain]/report/loading.tsx for the same reasoning.
 */
export default function DashboardLoading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B0514]">
      <ResultLoader />
    </div>
  );
}