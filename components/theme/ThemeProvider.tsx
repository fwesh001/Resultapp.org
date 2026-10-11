"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Theme provider.
 *
 * Wrapped so the choice lives in ONE place. <html> is written by next-themes
 * before paint (it injects a tiny blocking script), which is why the toggle
 * itself must not be rendered until mounted — see ThemeToggle.
 *
 * `attribute="class"` is what makes the `@custom-variant dark` rule in
 * globals.css fire. `disableTransitionOnChange` is set because the surfaces we
 * are migrating animate background/color, and animating a full theme swap makes
 * a school portal feel like it is flickering.
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