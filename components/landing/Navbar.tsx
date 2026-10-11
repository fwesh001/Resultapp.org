"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GraduationCap, Menu, X } from "lucide-react";
import { toTitleCase } from "@/lib/format";

interface NavbarProps {
  schoolName: string;
  subdomain: string;
  logoUrl?: string;
}

export default function Navbar({ schoolName, subdomain, logoUrl }: NavbarProps) {
  const [open, setOpen] = useState(false);

  // Escape closes the mobile dropdown.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const links = [
    // Bare hash, not a path: on a subdomain host the middleware rewrites
    // `/<sub>` to `/<sub>/<sub>`, which matches no route. A fragment-only href
    // stays same-document on both the apex and subdomain hosts.
    { label: "Check Result", href: "#result-checker" },
    // Student Portal sits with the other role portals, not under "Check
    // Result": a parent looking for "where do I sign in" is not looking for the
    // report lookup. `/student` (not `/student/login`) so an existing session
    // lands on the dashboard rather than being asked to sign in again.
    { label: "Student Portal", href: `/${subdomain}/student` },
    { label: "Staff Portal", href: `/${subdomain}/staff` },
    { label: "Admin", href: `/${subdomain}/admin` },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-line-1 bg-surface-0/80 backdrop-blur-md">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href={`/${subdomain}`} className="flex items-center gap-2.5">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={`${toTitleCase(schoolName)} crest`}
              className="h-9 w-9 rounded-full border border-line-1 object-cover"
            />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line-1 bg-accent-soft">
              <GraduationCap className="h-5 w-5 text-accent" />
            </span>
          )}
          <span className="text-base font-semibold tracking-tight text-text-1">
            {toTitleCase(schoolName)}
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden items-center gap-6 md:flex">
          {links.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="text-sm text-text-2 transition hover:text-text-1"
            >
              {link.label}
            </Link>
          ))}
        </div>

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
      </nav>

      {/* Mobile dropdown */}
      {open && (
        <div className="border-t border-line-1 bg-surface-0/95 px-6 py-4 backdrop-blur-md md:hidden">
          <div className="flex flex-col gap-3">
            {links.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-2 text-sm text-text-2 transition hover:bg-surface-2 hover:text-text-1"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
