"use client";

import { useEffect, useState } from "react";

interface TocEntry {
  id: string;
  label: string;
}

interface LegalTocProps {
  entries: TocEntry[];
}

/**
 * Sticky table of contents with scroll-spy. A client component so the active
 * section can be highlighted; the surrounding document stays a server
 * component and only this leaf is shipped to the browser.
 *
 * Short sections can fail to trigger the intersection observer while a long
 * one dominates the viewport, so the "last heading above the fold" is derived
 * directly from scroll position and is the source of truth.
 */
export function LegalToc({ entries }: LegalTocProps) {
  const [active, setActive] = useState(entries[0]?.id ?? "");

  useEffect(() => {
    const onScroll = () => {
      const offset = 140;
      let current = entries[0]?.id ?? "";

      for (const entry of entries) {
        const el = document.getElementById(entry.id);
        if (el && el.getBoundingClientRect().top - offset <= 0) {
          current = entry.id;
        }
      }

      // Pin the last entry once the page is scrolled to the bottom.
      const atBottom =
        window.innerHeight + window.scrollY >= document.body.scrollHeight - 8;
      if (atBottom) {
        current = entries[entries.length - 1]?.id ?? current;
      }

      setActive(current);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [entries]);

  return (
    <nav aria-label="Table of contents">
      <p className="text-xs font-semibold uppercase tracking-wide text-purple-300/70">
        On this page
      </p>
      <ul className="mt-4 space-y-1 border-l border-purple-500/15">
        {entries.map((entry) => {
          const isActive = entry.id === active;
          return (
            <li key={entry.id}>
              <a
                href={`#${entry.id}`}
                aria-current={isActive ? "true" : undefined}
                className={`-ml-px block border-l py-1.5 pl-4 text-sm leading-5 transition-colors ${
                  isActive
                    ? "border-purple-400 font-medium text-white"
                    : "border-transparent text-purple-200/55 hover:border-purple-500/40 hover:text-purple-100"
                }`}
              >
                {entry.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
