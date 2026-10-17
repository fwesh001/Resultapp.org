import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Metadata lives here because support/page.tsx is a client component
 * ("use client") and cannot export a metadata object — layouts stay server
 * components by default, so the segment title/description still resolve.
 */
export const metadata: Metadata = {
  title: "Support Hub",
  description:
    "Report a bug or share feedback on ResultApp — the support hub gets teacher and admin issues triaged quickly.",
};

export default function SupportLayout({ children }: { children: ReactNode }) {
  return children;
}
