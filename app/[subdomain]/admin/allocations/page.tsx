/**
 * Allocations & Roster placeholder.
 */
export default function AllocationsPage() {
  const tabs = ["Students", "Staff", "Subjects"];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight">
        Allocations &amp; Roster
      </h1>
      <p className="mt-1 text-sm text-purple-200/60">
        Manage class allocations across students, staff, and subjects.
      </p>

      {/* Simulated sub-nav */}
      <div className="mt-6 flex flex-wrap gap-2 border-b border-purple-500/15 pb-4">
        {tabs.map((tab, index) => (
          <button
            key={tab}
            type="button"
            className={
              index === 0
                ? "rounded-full bg-purple-600/20 px-4 py-2 text-sm font-medium text-purple-200"
                : "rounded-full border border-purple-500/15 px-4 py-2 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-white"
            }
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-purple-500/15 bg-purple-900/[0.04] p-6">
        <p className="text-sm text-purple-200/60">
          Roster management is coming soon. This section will list students,
          staff assignments, and subject allocations.
        </p>
      </div>
    </div>
  );
}
