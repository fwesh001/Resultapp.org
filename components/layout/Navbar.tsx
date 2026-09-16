import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-purple-500/10 bg-[#0B0514]/70 backdrop-blur-xl supports-[backdrop-filter]:bg-[#0B0514]/60">
      <div className="mx-auto flex h-[64px] max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.35)]">
            <GraduationCap className="h-5 w-5" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-white">resultapp.org</span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
          <Link href="/pricing" className="text-purple-200/70 transition-colors hover:text-white">
            Pricing
          </Link>
          <Link href="/about" className="text-purple-200/70 transition-colors hover:text-white">
            About
          </Link>
          <Link href="/dashboard" className="text-purple-200/70 transition-colors hover:text-white">
            Dashboard
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <Link href="/register" className="hidden md:inline-flex">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full border border-purple-500/15 bg-purple-900/10 text-purple-200 hover:bg-purple-500/10 hover:text-white"
            >
              Sign In
            </Button>
          </Link>
          <Link href="/register">
            <Button
              size="sm"
              className="rounded-full bg-purple-600 px-5 font-semibold text-white shadow-[0_0_20px_rgba(147,51,234,0.3)] hover:bg-purple-500"
            >
              Get Started
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
