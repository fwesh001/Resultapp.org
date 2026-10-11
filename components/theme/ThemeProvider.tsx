"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Theme provider — LOCKED TO DARK.
 *
 * The Light Theme rollout is PAUSED pending a dedicated design sprint; the
 * phased token migration regressed the visuals and will be revisited properly
 * rather than un-done piecemeal.
 *
 * WHY `forcedTheme` AND NOT JUST `defaultTheme="dark"`
 * ---------------------------------------------------
 * These are easy to confuse and the difference is the whole point:
 *
 *   defaultTheme   — the value used ONLY when nothing is stored yet.
 *   forcedTheme    — overrides whatever is stored AND disables the setter.
 *
 * So `defaultTheme="dark"` alone would still be defeated by (a) a returning
 * user whose localStorage still holds "light" from before the pause, and
 * (b) `enableSystem`, which re-reads the OS on every load and would flip a
 * light-mode laptop back to light. `forcedTheme` ignores both, and makes
 * `setTheme` a no-op, so the app is dark for every user regardless of OS
 * preference or any previously stored value.
 *
 * The toggle is removed from all placements as well; `forcedTheme` is the
 * actual guarantee, and hiding the button alone would have been cosmetic.
 *
 * `enableSystem` is intentionally NOT set. It is ignored under `forcedTheme`,
 * but leaving it off keeps the intent legible to the next reader.
 *
 * To resume the rollout later: delete `forcedTheme`, restore
 * `defaultTheme="system"` + `enableSystem`, and re-add <ThemeToggle /> to the
 * navbar and the admin/staff shells.
 */
export default function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      forcedTheme="dark"
      defaultTheme="dark"
      disableTransitionOnChange
      storageKey="resultapp-theme"
    >
      {children}
    </NextThemesProvider>
  );
}