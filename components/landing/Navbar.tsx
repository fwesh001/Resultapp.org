"use client";

import { useState } from "react";
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

  const links = [
    { label: "Check Result", href: `/${subdomain}#result-checker` },
    { label: "Teacher Portal", href: `/${subdomain}/teacher/grading` },
    { label: "Admin", href: `/${subdomain}/admin/templates` },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-purple-500/20 bg-[#0B0514]/80 backdrop-blur-md">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href={`/${subdomain}`} className="flex items-center gap-2.5">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={`${toTitleCase(schoolName)} crest`}
              className="h-9 w-9 rounded-full border border-purple-500/20 object-cover"
            />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-purple-500/20 bg-purple-900/20">
              <GraduationCap className="h-5 w-5 text-purple-300" />
            </span>
          )}
          <span className="text-base font-semibold tracking-tight text-white">
            {toTitleCase(schoolName)}
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden items-center gap-6 md:flex">
          {links.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="text-sm text-purple-200/80 transition hover:text-white"
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
          className="inline-flex items-center justify-center rounded-lg border border-purple-500/20 p-2 text-purple-200 transition hover:bg-purple-900/20 md:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {/* Mobile dropdown */}
      {open && (
        <div className="border-t border-purple-500/20 bg-[#0B0514]/95 px-6 py-4 backdrop-blur-md md:hidden">
          <div className="flex flex-col gap-3">
            {links.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-2 text-sm text-purple-200/90 transition hover:bg-purple-900/20 hover:text-white"
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
