import type { MetadataRoute } from "next";
import { headers } from "next/headers";

export default async function robots(): Promise<MetadataRoute.Robots> {
  // The demo host is a machine for ephemeral tenants, not content: crawlers
  // get nothing here. (Demo responses also carry X-Robots-Tag: noindex via
  // middleware — this is the second lock on the same door.)
  const host = (await headers()).get("host")?.split(":")[0].toLowerCase() || "";
  if (host === "demo.resultapp.org" || host.endsWith(".demo.resultapp.org")) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/superadmin"],
    },
    sitemap: "https://resultapp.org/sitemap.xml",
  };
}
