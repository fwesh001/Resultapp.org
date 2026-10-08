import ResultLoader from "@/components/ui/ResultLoader";

/**
 * Loading state for the staff dashboard. See the admin sibling for why this
 * boundary is scoped rather than global.
 */
export default function StaffDashboardLoading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B0514]">
      <ResultLoader />
    </div>
  );
}