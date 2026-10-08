import ResultLoader from "@/components/ui/ResultLoader";

/**
 * Loading state for the report card only.
 *
 * This used to live at app/loading.tsx and wrap EVERY route, which broke the
 * tenant landing page's 404: a root loading boundary flushes its shell with a
 * 200 status before the page resolves, so notFound() could still swap the UI
 * but the HTTP status had already been committed. Unknown or purged
 * subdomains answered 200 instead of 404.
 *
 * Scoping the boundary to the report route keeps the spinner where the render
 * is actually slow (the publication gate does several sequential backend
 * calls) and leaves the tenant landing free to answer with a real status.
 */
export default function ReportLoading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B0514]">
      <ResultLoader />
    </div>
  );
}