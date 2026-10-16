"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Theme provider — ACTIVE. next-themes owns the theme via a `.dark` class on
 * <html> (attribute="class"), which globals.css re-points Tailwind's `dark:`
 * variant at. `defaultTheme="system"` + `enableSystem` follow the OS until the
 * user picks explicitly; the choice persists in localStorage under
 * "resultapp-theme".
 *
 * Previously this was locked with `forcedTheme="dark"` while the Light rollout
 * was paused. Do NOT re-add forcedTheme to "temporarily" hide light mode: it
 * disables setTheme globally, so every <ThemeToggle /> on the page would
 * render and do nothing — a visible control that lies.
 *
 * `suppressHydrationWarning` on <html> (root layout) is required: next-themes
 * writes the class from a pre-paint script, which React would otherwise flag
 * as a mutated server-rendered attribute.
 */
export default function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="resultapp-theme"
    >
      {children}
    </NextThemesProvider>
  );
}