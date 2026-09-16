import Link from "next/link";
import { Home, LifeBuoy } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B0514] text-purple-50 p-4 relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="bg-purple-900/20 blur-3xl rounded-full w-96 h-96 absolute -z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />

      {/* Broadsheet Card */}
      <div className="max-w-lg w-full bg-purple-950/20 border border-purple-500/20 backdrop-blur-md rounded-2xl p-6 md:p-8 shadow-2xl relative">
        {/* Top Badge */}
        <div className="flex justify-center mb-6">
          <span className="text-purple-300 bg-purple-900/40 border border-purple-500/30 px-3 py-1 rounded-full text-xs font-mono">
            ERROR 404 • UNRECORDED ROUTE
          </span>
        </div>

        {/* Title */}
        <div className="text-center">
          <h1 className="text-xl md:text-2xl font-bold tracking-[0.2em] text-purple-50">
            OFFICIAL RESULT SHEET
          </h1>
          <p className="text-[11px] font-mono text-purple-400/70 tracking-widest mt-1">
            RESULTAPP.ORG • ACADEMIC REGISTRY • PORTAL v1.0
          </p>
          {/* subtle divider */}
          <div className="h-px bg-purple-500/20 my-4" />
        </div>

        {/* Student Info Row */}
        <div className="flex justify-between gap-4 text-sm bg-purple-950/30 rounded-xl p-4 border border-purple-500/10 mb-4">
          <div>
            <p className="text-purple-400 text-[11px] font-mono tracking-widest uppercase">
              Student
            </p>
            <p className="font-semibold text-purple-100 mt-1">Valued Visitor</p>
          </div>
          <div className="text-right">
            <p className="text-purple-400 text-[11px] font-mono tracking-widest uppercase">
              Academic Term
            </p>
            <p className="font-semibold text-purple-100 mt-1">Current Session</p>
          </div>
        </div>

        {/* Exam Results Table/Grid */}
        <div className="grid grid-cols-3 gap-0 border border-purple-500/10 rounded-xl overflow-hidden text-sm bg-purple-950/10">
          <div className="p-3 md:p-4 bg-purple-900/20 flex flex-col justify-center">
            <p className="text-purple-400 text-[11px] font-mono uppercase tracking-wider">
              Subject
            </p>
            <p className="font-medium text-purple-100 mt-1.5 leading-tight">
              URL Navigation 101
            </p>
          </div>
          <div className="p-3 md:p-4 flex flex-col items-center justify-center text-center border-x border-purple-500/10 bg-purple-900/10">
            <p className="text-purple-400 text-[11px] font-mono uppercase tracking-wider">
              Score
            </p>
            <p className="font-bold text-purple-50 text-lg mt-1.5">0 / 100</p>
          </div>
          <div className="p-3 md:p-4 flex flex-col items-center justify-center text-center bg-purple-900/20">
            <p className="text-purple-400 text-[11px] font-mono uppercase tracking-wider">
              Grade
            </p>
            <div className="mt-1.5">
              <span className="text-red-400 bg-red-950/40 border border-red-500/30 font-bold px-3 py-1 rounded-md text-xs inline-block shadow shadow-red-900/20">
                F9 (PAGE NOT FOUND)
              </span>
            </div>
          </div>
        </div>

        {/* Principal's Remark Box */}
        <div className="bg-purple-900/30 border-l-4 border-purple-500 p-4 rounded-r-lg my-4 text-sm text-purple-200 italic">
          Remark: Student strayed off the curriculum. Immediate repetition of the homepage is
          recommended.
        </div>

        {/* Call to Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6">
          <Link
            href="/"
            className="bg-purple-600 hover:bg-purple-500 text-white font-medium px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-purple-600/20 flex items-center justify-center gap-2"
          >
            <Home className="w-4 h-4 shrink-0" />
            Back to Main Hall
          </Link>
          <Link
            href="/support"
            className="bg-purple-950/50 hover:bg-purple-900/50 border border-purple-500/20 text-purple-200 px-5 py-2.5 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            <LifeBuoy className="w-4 h-4 shrink-0" />
            Report Missing Link
          </Link>
        </div>

        <p className="text-center text-[11px] text-purple-400/50 mt-6 font-mono">
          ResultApp Registry • Every route is recorded — except this one.
        </p>
      </div>
    </div>
  );
}
