import { CreditCard, GraduationCap, FileBarChart, Users } from "lucide-react";

export default function DashboardPage() {
  const stats = [
    { label: "Student Credits", value: "1,240", icon: CreditCard, change: "320 remaining" },
    { label: "Students", value: "860", icon: Users, change: "+24 this term" },
    { label: "Results Compiled", value: "732", icon: FileBarChart, change: "85% completion" },
    { label: "Classes", value: "12", icon: GraduationCap, change: "JSS1 – SS3" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-text-2">Welcome back, Principal. Here&apos;s your school overview.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border bg-surface-1 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-text-3">{s.label}</p>
              <s.icon className="h-5 w-5 text-text-2" />
            </div>
            <p className="mt-2 text-2xl font-bold">{s.value}</p>
            <p className="mt-1 text-xs text-text-3">{s.change}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border bg-surface-1 p-6">
          <h3 className="font-semibold">Quick Actions</h3>
          <ul className="mt-4 space-y-2 text-sm">
            <li className="rounded-lg border p-3 hover:bg-surface-2">Upload student scores (CSV)</li>
            <li className="rounded-lg border p-3 hover:bg-surface-2">Generate term broadsheet</li>
            <li className="rounded-lg border p-3 hover:bg-surface-2">Purchase credits</li>
          </ul>
        </div>
        <div className="rounded-xl border bg-surface-1 p-6">
          <h3 className="font-semibold">Recent Activity</h3>
          <p className="mt-4 text-sm text-text-3">No recent activity. Start by uploading a class list.</p>
        </div>
      </div>
    </div>
  );
}
