import ResultLoader from "@/components/ui/ResultLoader";

export default function GlobalLoading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B0514]">
      <ResultLoader />
    </div>
  );
}
