"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

interface Props {
  className?: string;
}

/**
 * Light/dark toggle.
 *
 * Renders a same-size placeholder until mounted. Reading `resolvedTheme` during
 * the first render would produce different markup on the server than on the
 * client — a hydration mismatch — because the server cannot know what is in
 * localStorage or what the OS reports. The placeholder reserves the space so
 * the header does not visibly jump when the real button appears.
 *
 * The button is a real <button> with aria-label and aria-pressed rather than a
 * bare icon, so it is reachable by keyboard and announced by a screen reader.
 */
export default function ThemeToggle({ className = "" }: Props) {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <span
        aria-hidden="true"
        className={`inline-block min-h-[44px] min-w-[44px] rounded-lg border border-line-1 ${className}`}
      />
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={isDark}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-line-1 bg-surface-1 p-2 text-text-2 transition hover:bg-surface-2 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}