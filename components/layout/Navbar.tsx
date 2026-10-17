"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogoLockup } from "@/components/brand/Logo";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

const links = [
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
  { label: "Support", href: "/support" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);

  // Escape closes the mobile menu.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open ]);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-line-1 bg-surface-0/70 backdrop-blur-xl supports-[backdrop-filter]:bg-surface-0/60">
      <div className="mx-auto flex h-[64px] max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex min-h-[44px] items-center gap-2.5 font-semibold tracking-tight">
          <LogoLockup
            size="sm"
            wordmarkClassName="text-[15px] font-semibold tracking-tight text-text-1"
          />
        </Link>

        <nav className="hidden items-center gap-2 text-sm font-medium md:flex">
          <Link href="#features" className="inline-flex min-h-[44px] items-center rounded-md px-3 text-text-2 transition-colors hover:text-text-1">
            Features
          </Link>
          <Link href="#pricing" className="inline-flex min-h-[44px] items-center rounded-md px-3 text-text-2 transition-colors hover:text-text-1">
            Pricing
          </Link>
          <Link href="/about" className="inline-flex min-h-[44px] items-center rounded-md px-3 text-text-2 transition-colors hover:text-text-1">
            About
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <Link href="/login" className="hidden md:inline-flex">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full border border-line-1 bg-surface-1 text-text-2 hover:bg-surface-2 hover:text-text-1"
            >
              Sign In
            </Button>
          </Link>
          <Link href="/register" className="hidden sm:inline-flex">
            <Button
              size="sm"
              className="rounded-full bg-accent px-5 font-semibold text-accent-fg shadow-[0_0_20px_rgba(147,51,234,0.3)] hover:bg-accent-hover"
            >
              Get Started
            </Button>
          </Link>
          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-line-1 p-2 text-text-2 transition hover:bg-surface-2 md:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="border-t border-line-1 bg-surface-0/95 px-6 py-4 backdrop-blur-md md:hidden">
          <nav className="flex flex-col gap-1" aria-label="Mobile">
            {links.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                onClick={() => setOpen(false)}
                className="inline-flex min-h-[44px] items-center rounded-lg px-2 py-2 text-sm text-text-2 transition hover:bg-surface-2 hover:text-text-1"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-line-1 bg-surface-1 px-5 text-sm font-semibold text-text-2 transition hover:bg-surface-2 hover:text-text-1"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              onClick={() => setOpen(false)}
              className="mt-2 inline-flex min-h-[44px] items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg shadow-[0_0_20px_rgba(147,51,234,0.3)] hover:bg-accent-hover"
            >
              Get Started
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
