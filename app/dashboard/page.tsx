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
        <p className="text-zinc-600">Welcome back, Principal. Here&apos;s your school overview.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-zinc-500">{s.label}</p>
              <s.icon className="h-5 w-5 text-zinc-400" />
            </div>
            <p className="mt-2 text-2xl font-bold">{s.value}</p>
            <p className="mt-1 text-xs text-zinc-500">{s.change}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border bg-white p-6">
          <h3 className="font-semibold">Quick Actions</h3>
          <ul className="mt-4 space-y-2 text-sm">
            <li className="rounded-lg border p-3 hover:bg-zinc-50">Upload student scores (CSV)</li>
            <li className="rounded-lg border p-3 hover:bg-zinc-50">Generate term broadsheet</li>
            <li className="rounded-lg border p-3 hover:bg-zinc-50">Purchase credits</li>
          </ul>
        </div>
        <div className="rounded-xl border bg-white p-6">
          <h3 className="font-semibold">Recent Activity</h3>
          <p className="mt-4 text-sm text-zinc-500">No recent activity. Start by uploading a class list.</p>
        </div>
      </div>
    </div>
  );
}
