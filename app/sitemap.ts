import type { MetadataRoute } from "next";

const BASE_URL = "https://resultapp.org";

const STATIC_ROUTES = [
  "/",
  "/about",
  "/pricing",
  "/contact",
  "/support",
  "/register",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return STATIC_ROUTES.map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "/" ? "weekly" : "monthly",
    priority: route === "/" ? 1 : route === "/register" ? 0.9 : 0.7,
  }));
}
