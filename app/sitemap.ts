import type { MetadataRoute } from "next";
import { LEGAL_ROUTES } from "@/lib/legal/constants";

const BASE_URL = "https://resultapp.org";

const STATIC_ROUTES = [
  "/",
  "/about",
  "/pricing",
  "/contact",
  "/support",
  "/register",
  LEGAL_ROUTES.privacy,
  LEGAL_ROUTES.terms,
  LEGAL_ROUTES.refund,
];

/** Legal pages are stable, so they change least often of the set. */
const LOW_FREQUENCY_ROUTES = new Set<string>([
  LEGAL_ROUTES.privacy,
  LEGAL_ROUTES.terms,
  LEGAL_ROUTES.refund,
]);

export default function sitemap(): MetadataRoute.Sitemap {
  return STATIC_ROUTES.map((route) => {
    const changeFrequency = LOW_FREQUENCY_ROUTES.has(route)
      ? ("yearly" as const)
      : route === "/"
        ? ("weekly" as const)
        : ("monthly" as const);

    return {
      url: `${BASE_URL}${route}`,
      lastModified: new Date(),
      changeFrequency,
      priority: route === "/" ? 1 : route === "/register" ? 0.9 : 0.7,
    };
  });
}
