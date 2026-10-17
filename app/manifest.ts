import type { MetadataRoute } from "next";

/**
 * Installability contract:
 *  - name / short_name / description surface in the OS install sheet.
 *  - start_url "/" mounts the marketing page; signed-in staff land back in
 *    their portal through their normal deep links.
 *  - standalone removes browser chrome once installed.
 *
 * ICONS: public/icon-192.png and public/icon-512.png are currently SOLID-BRAND
 * placeholders (uniform #9333EA squares) generated so install validation has
 * honest, exact sizes declared here. `public/logo.png` is portrait
 * (1045x1449), which PWA icon rules disallow (icons must be square). Until
 * real brand icons are designed, drop square exports at exactly those two
 * paths and this manifest picks them up with no code change.
 *
 * Next emits this at /manifest.webmanifest and injects the link tag — the
 * middleware matcher excludes dotted paths, so it is never rewritten.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Resultapp.org — Automate Your School's Results",
    short_name: "ResultApp",
    description:
      "The all-in-one result compilation platform for Nigerian schools — automated grading, digital report cards, custom school portals, and pay-per-student billing.",
    start_url: "/",
    display: "standalone",
    background_color: "#0B0514",
    theme_color: "#9333EA",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
