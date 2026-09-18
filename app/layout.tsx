import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/toast";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://resultapp.org"),
  title: {
    default: "Resultapp.org — Automate Your School's Results",
    template: "%s | Resultapp.org",
  },
  description:
    "Resultapp.org is the all-in-one result compilation platform for Nigerian schools — automated grading, digital report cards, custom school portals, and pay-per-student billing.",
  keywords: [
    "school results",
    "report cards",
    "Nigerian schools",
    "student grading",
    "result compilation",
    "school portal",
    "Resultapp",
  ],
  openGraph: {
    type: "website",
    siteName: "Resultapp.org",
    title: "Resultapp.org — Automate Your School's Results",
    description:
      "Say goodbye to manual grading errors and printing costs. The all-in-one result compilation platform built for modern schools.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Resultapp.org — Automate Your School's Results",
    description:
      "Automated grading, digital report cards, and custom portals for Nigerian schools.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
