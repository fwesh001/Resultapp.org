"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Home, Undo2 } from "lucide-react";

export default function NotFound() {
  const router = useRouter();

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#0B0514] p-4 text-purple-50">
      {/* Ambient depth */}
      <div
        className="pointer-events-none absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-purple-900/30 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-emerald-900/10 blur-3xl"
        aria-hidden="true"
      />
      {/* Ghost watermark (large screens only) */}
      <span
        className="pointer-events-none absolute select-none text-[20rem] font-extrabold leading-none text-white/[0.03] max-md:hidden"
        aria-hidden="true"
      >
        404
      </span>

      {/* Focused card */}
      <div className="relative w-full max-w-sm rounded-3xl border border-purple-500/20 bg-purple-950/30 p-8 text-center shadow-2xl shadow-black/50 backdrop-blur-md">
        <p className="text-[clamp(4.5rem,20vw,7rem)] font-extrabold leading-none tracking-tight text-white drop-shadow-[0_0_28px_rgba(147,51,234,0.45)]">
          404
        </p>

        {/* Teacher's stamp */}
        <div className="mt-3 flex justify-center">
          <span className="inline-block -rotate-3 rounded-md border border-red-500/40 bg-red-950/40 px-3 py-1 text-xs font-bold tracking-widest text-red-400">
            F9 • NOT FOUND
          </span>
        </div>

        <p className="mt-4 text-sm text-purple-200/80">
          This page isn&apos;t on the register.
        </p>

        <Link
          href="/"
          className="mt-6 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-600/20 transition hover:bg-purple-500"
        >
          <Home className="h-4 w-4 shrink-0" />
          Back to homepage
        </Link>
        <button
          type="button"
          onClick={() => router.back()}
          className="mt-2 inline-flex min-h-[48px] items-center justify-center gap-2 px-4 text-sm text-purple-300/70 transition hover:text-white"
        >
          <Undo2 className="h-4 w-4 shrink-0" />
          Go back
        </button>

        <p className="mt-4 text-xs text-purple-400/50">
          If you typed this address, check the spelling.
        </p>
      </div>
    </div>
  );
}
